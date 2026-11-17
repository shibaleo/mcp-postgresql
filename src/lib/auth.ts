/**
 * Auth for mcp-postgresql — single-owner mode（Regulus の docs/056）。
 *
 * 受けるのは Auth0 のアクセストークンだけ（src/lib/auth0.ts が確かめる）。入口は 2 つ:
 *   1. Bearer（MCP のクライアント。Claude など）… 宛先はこの MCP の口の URL
 *   2. 管理画面のセッションの cookie（src/lib/session.ts）… 中身は同じ Auth0 のアクセストークン
 * どちらから来たか（transport）を残し、管理画面の API は session だけに限る（hono-app.ts）。
 * Clerk は 2026-11-17 に外した。
 */
import { getAppUrl } from "@/lib/app-url";
import { AUTH0_ISSUER, peekIssuer, verifyAuth0AccessToken } from "@/lib/auth0";
import { SESSION_AUDIENCE } from "@/lib/session";

// 画面に出す持ち主の表示（/me）。誰が通るかは Auth0 の tid で決まる（auth0.ts）
export const OWNER_EMAIL = "shiba.dog.leo.private@gmail.com";

export interface AuthResult {
  authenticated: true;
  source: "auth0";
  /** どう運ばれてきたか。管理画面の API は session だけ（MCP のクライアントのトークンでは使えない） */
  transport: "bearer" | "session";
  scopes: string[];
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

/**
 * Bearer があればそれだけを見る（cookie に落ちない）。無ければ管理画面のセッションのトークン
 * （hono-app.ts が session.ts から取り出して渡す）。
 */
export async function authenticate(req: Request, sessionToken: string | null): Promise<AuthResult | null> {
  const bearer = extractBearerToken(req);
  if (bearer) {
    if (peekIssuer(bearer) !== AUTH0_ISSUER) return null;
    const r = await verifyAuth0AccessToken(bearer, { audience: `${getAppUrl(req)}/api/v1/mcp` });
    if (!r.ok) {
      console.log(`[auth] auth0 token rejected: ${r.reason}`);
      return null;
    }
    return { authenticated: true, source: "auth0", transport: "bearer", scopes: r.principal.scopes };
  }
  if (sessionToken) {
    const r = await verifyAuth0AccessToken(sessionToken, { audience: SESSION_AUDIENCE });
    if (!r.ok || r.principal.kind !== "user") return null;
    return { authenticated: true, source: "auth0", transport: "session", scopes: r.principal.scopes };
  }
  return null;
}
