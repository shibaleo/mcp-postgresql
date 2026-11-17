import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authenticate, OWNER_EMAIL, type AuthResult } from "@/lib/auth";
import session, { isSameOrigin, sessionAccessToken } from "@/lib/session";
import { getAppUrl } from "@/lib/app-url";

console.log("[boot] hono-app: module load");

export type Env = { Variables: { authResult: AuthResult } };

import health from "@/routes/health";
import mcp from "@/routes/mcp";
import wellKnown from "@/routes/well-known";
import connections from "@/routes/connections";

/* ── V1 API sub-app ──
 *
 * Order matters:
 *   1. cross-cutting middleware (logger, request trace, onError)
 *   2. public routes (health, OAuth discovery + endpoints)
 *   3. auth middleware
 *   4. protected routes (/mcp, /me)
 */

const v1 = new Hono<Env>()
  .use("*", logger())
  // CORS — required for browser-based MCP clients (Claude.ai, ChatGPT, ...).
  // Must come before the auth gate so OPTIONS preflight succeeds without
  // a bearer token. `exposeHeaders` is what lets the client's JS actually
  // read WWW-Authenticate (browsers hide it from `fetch().headers` by
  // default, breaking OAuth discovery).
  .use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowMethods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
      ],
      exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
      credentials: false,
      maxAge: 3600,
    }),
  )
  .use("*", async (c, next) => {
    const start = Date.now();
    const path = c.req.path;
    const method = c.req.method;
    console.log(`[req] start ${method} ${path}`);
    try {
      await next();
      console.log(
        `[req] done ${method} ${path} status=${c.res.status} ms=${Date.now() - start}`,
      );
    } catch (e) {
      console.error(
        `[req] error ${method} ${path} ms=${Date.now() - start}:`,
        e instanceof Error ? `${e.message}\n${e.stack}` : e,
      );
      throw e;
    }
  })
  .onError((err, c) => {
    console.error("[onError]", err);
    const causeMsg = err.cause instanceof Error ? err.cause.message : "";
    const msg = causeMsg
      ? `${err.message} - ${causeMsg}`
      : err.message || "Internal Server Error";
    return c.json({ error: msg }, 500);
  })
  // Public
  .route("/health", health)
  // MCP OAuth discovery endpoints (RFC 9728 + RFC 8414).
  .route("/.well-known", wellKnown)
  // 管理画面のログイン（BFF。認証の外 = ここが認証を作る側）
  .route("/session", session)
  // Auth gate
  .use("*", async (c, next) => {
    const path = c.req.path;
    if (
      path.startsWith("/api/v1/.well-known/") ||
      path.startsWith("/api/v1/session/") ||
      path === "/api/v1/health"
    ) {
      return next();
    }
    // Bearer があればセッションは見ない（refresh の往復をしない）
    const hasBearer = c.req.header("authorization") !== undefined;
    const sessionToken = hasBearer ? null : await sessionAccessToken(c);
    const result = await authenticate(c.req.raw, sessionToken);
    if (!result) {
      // RFC 9728 §5.1: include resource_metadata so MCP clients can
      // discover the authorization server and start the OAuth flow.
      const appUrl = getAppUrl(c.req.raw);
      const resourceMetadata = `${appUrl}/api/v1/.well-known/oauth-protected-resource`;
      return c.json(
        { error: "Unauthorized" },
        401,
        {
          "WWW-Authenticate": `Bearer realm="mcp-postgresql", resource_metadata="${resourceMetadata}"`,
        },
      );
    }
    // cookie で来た書き込みは同じ origin からに限る（CSRF）
    if (result.transport === "session" && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !isSameOrigin(c.req.raw)) {
      return c.json({ error: "cross-site request" }, 403);
    }
    // 管理画面の API は管理画面のセッションだけ。MCP のクライアント（Claude など）のトークンでは使えない
    if (result.transport !== "session" && !path.startsWith("/api/v1/mcp")) {
      return c.json({ error: "console only (sign in on the web console)" }, 403);
    }
    c.set("authResult", result);
    await next();
  })
  // Protected
  .route("/mcp", mcp)
  .route("/connections", connections)
  // `/me` is the canonical "am I logged in" probe used by AuthGate.
  // In single-owner mode the only valid identity is the owner.
  .get("/me", (c) =>
    c.json({
      data: {
        id: "owner",
        name: OWNER_EMAIL,
        email: OWNER_EMAIL,
      },
    }),
  );

/**
 * Root app. Mounts:
 *   - /api/v1/* → v1 (everything else)
 *   - /.well-known/* → wellKnown (apex-level OAuth discovery)
 *
 * The apex mount is essential: Claude.ai constructs the authorization
 * server metadata URL from the issuer (which we declare as our root
 * domain), so it fetches `https://postgresql.mcp.shibaleo.uk/.well-known/...`.
 * Without the apex mount that path falls through to the SPA HTML.
 */
const app = new Hono()
  .route("/.well-known", wellKnown)
  .route("/api/v1", v1);

export default app;

export type AppType = typeof app;
