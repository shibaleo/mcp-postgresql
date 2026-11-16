/**
 * /api/v1/mcp — Streamable HTTP transport endpoint.
 *
 * Authentication is enforced by the parent router middleware
 * (lib/hono-app.ts), so by the time we get here the request has been
 * proven to come from the owner.
 *
 * Side effect: ensures all built-in modules are imported so the registry
 * is populated. Each `import "@/lib/mcp/modules/<name>"` self-registers
 * via `registerModule(...)`.
 */

import { Hono } from "hono";
import type { Env } from "@/lib/hono-app";
import { getAppUrl } from "@/lib/app-url";
import { missingScope } from "@/lib/scopes";
import {
  handleMessage,
  RPC_PARSE_ERROR_RESPONSE,
} from "@/lib/mcp/transport";

// Self-registering module imports.
import "@/lib/mcp/modules/postgresql";

const app = new Hono<Env>().post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(RPC_PARSE_ERROR_RESPONSE);
  }

  // 権限はここ 1 か所で判断する（Regulus の docs/056 §1 の 3）。書き込みの道具は書き込みの scope が要る
  const need = missingScope(body, c.get("authResult").scopes);
  if (need) {
    const prm = `${getAppUrl(c.req.raw)}/api/v1/.well-known/oauth-protected-resource`;
    return c.json({ error: `missing scope ${need}` }, 403, {
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${need}", resource_metadata="${prm}"`,
    });
  }

  const result = await handleMessage(body);
  if (result === null) {
    return c.body(null, 202);
  }
  return c.json(result);
});

export default app;
