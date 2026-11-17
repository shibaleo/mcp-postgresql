/**
 * 管理画面のセッション（BFF。Regulus の docs/056・apps/web/src/core/auth/session.ts と同じ形）。
 *
 * Vercel の関数が Auth0（mcp-console。Regulus の infra/auth0/mcp）と code を交換し（PKCE ＋ client secret）、
 * アクセストークンと refresh token を暗号化して HttpOnly の cookie 1 枚に入れる。**ブラウザの JS はトークンを持たない。**
 * トークンの宛先はこの MCP の API（https://postgresql.mcp.shibaleo.uk/api/v1/mcp）。開発（localhost）でも本番の宛先のトークンを使う
 * （開発用の Auth0 の API は無い。確かめるのはこのサーバーだけ）。
 *
 * 管理画面の API（/connections・/me）は、cookie で来たトークンだけを受ける（auth.ts・hono-app.ts）。
 * MCP のクライアント（Claude など）の Bearer では使えない。
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as jose from "jose";
import { getAppUrl } from "@/lib/app-url";
import { AUTH0_ISSUER, verifyAuth0AccessToken } from "@/lib/auth0";
import { publicConfig } from "@/lib/public-config";
import { ALL_SCOPES } from "@/lib/scopes";
import { pkceChallenge, randomToken, safeReturnTo, seal, unseal } from "@/lib/session-crypto";

/** セッションのトークンの宛先（= この MCP の Auth0 の API の識別子） */
export const SESSION_AUDIENCE = "https://postgresql.mcp.shibaleo.uk/api/v1/mcp";

const SESSION_MAX_AGE = 364 * 24 * 3600;
const TX_MAX_AGE = 600;
const REFRESH_MARGIN_SEC = 60;
const SCOPES = ["openid", "email", "profile", "offline_access", ...ALL_SCOPES].join(" ");

function secret(name: "AUTH0_MCP_CONSOLE_CLIENT_SECRET" | "MCP_POSTGRESQL_SESSION_KEY"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
const sessionKey = () => secret("MCP_POSTGRESQL_SESSION_KEY");

/** https なら `__Host-`（Secure・Path=/・Domain なし を強制） */
function names(c: Context) {
  const base = getAppUrl(c.req.raw);
  const secure = base.startsWith("https://");
  const prefix = secure ? "__Host-" : "";
  return { base, secure, session: `${prefix}mcp_session`, tx: `${prefix}mcp_auth_tx` };
}

const cookieOpts = (secure: boolean, maxAge: number) =>
  ({ httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge }) as const;

interface Session {
  at: string;
  rt: string;
  exp: number;
}

interface LoginTx {
  state: string;
  verifier: string;
  returnTo: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenEndpoint(body: Record<string, string>): Promise<TokenResponse | { error: string }> {
  try {
    const res = await fetch(`${AUTH0_ISSUER}oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: publicConfig.auth0ConsoleClientId,
        client_secret: secret("AUTH0_MCP_CONSOLE_CLIENT_SECRET"),
        ...body,
      }),
    });
    const json = (await res.json()) as TokenResponse & { error?: string };
    if (!res.ok || !json.access_token) return { error: json.error ?? `http_${res.status}` };
    return json;
  } catch {
    return { error: "network" };
  }
}

function expOf(at: string, expiresIn: number): number {
  try {
    const { exp } = jose.decodeJwt(at);
    if (typeof exp === "number") return exp;
  } catch {
    /* 下へ */
  }
  return Math.floor(Date.now() / 1000) + expiresIn;
}

async function revoke(rt: string) {
  try {
    await fetch(`${AUTH0_ISSUER}oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: publicConfig.auth0ConsoleClientId,
        client_secret: secret("AUTH0_MCP_CONSOLE_CLIENT_SECRET"),
        token: rt,
      }),
    });
  } catch {
    // 失効に失敗しても cookie は消す
  }
}

async function writeSession(c: Context, s: Session) {
  const n = names(c);
  setCookie(c, n.session, await seal(s, sessionKey(), n.session), cookieOpts(n.secure, SESSION_MAX_AGE));
}

/** 人のトークンで、この MCP の宛先・テナントのものか */
async function isConsoleToken(at: string): Promise<boolean> {
  const r = await verifyAuth0AccessToken(at, { audience: SESSION_AUDIENCE });
  if (!r.ok) {
    console.log(`[session] token rejected: ${r.reason}`);
    return false;
  }
  return r.principal.kind === "user";
}

/**
 * cookie のセッションからアクセストークンを取り出す。切れかけていれば refresh して cookie を書き直す。
 * refresh token は回転させていない（infra/auth0/mcp）ので、並行するリクエストが同時に refresh しても壊れない。
 */
export async function sessionAccessToken(c: Context): Promise<string | null> {
  const n = names(c);
  const raw = getCookie(c, n.session);
  if (!raw) return null;
  const s = await unseal<Session>(raw, sessionKey(), n.session);
  if (!s) {
    deleteCookie(c, n.session, cookieOpts(n.secure, 0));
    return null;
  }
  if (s.exp - Math.floor(Date.now() / 1000) > REFRESH_MARGIN_SEC) return s.at;

  const r = await tokenEndpoint({ grant_type: "refresh_token", refresh_token: s.rt });
  if ("error" in r) {
    console.log(`[session] refresh failed: ${r.error}`);
    if (r.error !== "network" && !r.error.startsWith("http_5")) deleteCookie(c, n.session, cookieOpts(n.secure, 0));
    return null;
  }
  await writeSession(c, { at: r.access_token, rt: r.refresh_token ?? s.rt, exp: expOf(r.access_token, r.expires_in) });
  return r.access_token;
}

/**
 * 同じ origin からのリクエストか（cookie で書き込む操作の CSRF 対策）。
 * Sec-Fetch-Site を見て、無ければ Origin を見る。どちらも無ければ通さない。
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(getAppUrl(req)).origin;
}

const loginError = (c: Context, code: string) => c.redirect(`/?login_error=${encodeURIComponent(code)}`);

/** /api/v1/session/{login,callback,logout}。認証の外（ここが認証を作る側） */
const app = new Hono()
  .get("/login", async (c) => {
    const n = names(c);
    const tx: LoginTx = { state: randomToken(), verifier: randomToken(), returnTo: safeReturnTo(c.req.query("returnTo")) };
    setCookie(c, n.tx, await seal(tx, sessionKey(), n.tx), cookieOpts(n.secure, TX_MAX_AGE));
    const q = new URLSearchParams({
      response_type: "code",
      client_id: publicConfig.auth0ConsoleClientId,
      redirect_uri: `${n.base}/api/v1/session/callback`,
      scope: SCOPES,
      audience: SESSION_AUDIENCE,
      state: tx.state,
      code_challenge: await pkceChallenge(tx.verifier),
      code_challenge_method: "S256",
      connection: "google-oauth2",
    });
    return c.redirect(`${AUTH0_ISSUER}authorize?${q}`);
  })
  .get("/callback", async (c) => {
    const n = names(c);
    const raw = getCookie(c, n.tx);
    deleteCookie(c, n.tx, cookieOpts(n.secure, 0));
    const tx = raw ? await unseal<LoginTx>(raw, sessionKey(), n.tx) : null;
    if (!tx || c.req.query("state") !== tx.state) return loginError(c, "state");
    const authError = c.req.query("error");
    if (authError) return loginError(c, authError);
    const code = c.req.query("code");
    if (!code) return loginError(c, "no_code");

    const r = await tokenEndpoint({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${n.base}/api/v1/session/callback`,
      code_verifier: tx.verifier,
    });
    if ("error" in r) return loginError(c, `exchange_${r.error}`);
    if (!r.refresh_token) return loginError(c, "no_refresh_token");
    // 通らないセッションを作らない（tid の無い利用者 = このファミリーの利用者でない）
    if (!(await isConsoleToken(r.access_token))) {
      await revoke(r.refresh_token);
      return loginError(c, "no_user");
    }
    await writeSession(c, { at: r.access_token, rt: r.refresh_token, exp: expOf(r.access_token, r.expires_in) });
    return c.redirect(tx.returnTo);
  })
  .post("/logout", async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: "cross-site request" }, 403);
    const n = names(c);
    const raw = getCookie(c, n.session);
    const s = raw ? await unseal<Session>(raw, sessionKey(), n.session) : null;
    if (s) await revoke(s.rt);
    deleteCookie(c, n.session, cookieOpts(n.secure, 0));
    const q = new URLSearchParams({ client_id: publicConfig.auth0ConsoleClientId, returnTo: n.base });
    return c.redirect(`${AUTH0_ISSUER}v2/logout?${q}`, 303);
  });

export default app;
