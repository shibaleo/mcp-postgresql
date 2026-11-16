/**
 * Auth0 が発行したアクセストークンを確かめる（Regulus の docs/056）。リソースサーバーとして見るのは標準の JWT の
 * claim だけ（iss・aud・exp・署名・scope・tid・azp）。Regulus の apps/api/src/auth/auth0.ts と同じ部品。
 *
 * 認可サーバーは Auth0（https://auth.shibaleo.uk/。Regulus の infra/auth0）。この MCP の API は
 * Regulus の infra/auth0/mcp で作っている（宛先 = この MCP の口の URL）。
 */
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/** 発行元（トークンの iss）。末尾の / まで一字一句同じ */
export const AUTH0_ISSUER = "https://auth.shibaleo.uk/";
/** このファミリーのテナント（トークンの tid）。1 つしか無くても確かめる */
export const TENANT_TID = "shibaleo";

export interface Principal {
  kind: "user" | "machine";
  sub: string;
  clientId: string | null;
  scopes: string[];
  tid: string | null;
}

export type ClaimsCheck = { ok: true; principal: Principal } | { ok: false; reason: string };

export function principalFromClaims(payload: JWTPayload, expectedTid: string): ClaimsCheck {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return { ok: false, reason: "no sub" };
  const gty = (payload as { gty?: unknown }).gty;
  const kind: Principal["kind"] = gty === "client-credentials" || sub.endsWith("@clients") ? "machine" : "user";
  const tid = typeof payload.tid === "string" ? payload.tid : null;
  if (tid !== expectedTid) return { ok: false, reason: tid ? `tid mismatch (${tid})` : "no tid" };
  const azp = (payload as { azp?: unknown }).azp;
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
  return { ok: true, principal: { kind, sub, clientId: typeof azp === "string" ? azp : null, scopes, tid } };
}

/** iss をざっと見る（署名はまだ確かめない）。どの検証に回すかの振り分けにだけ使う */
export function peekIssuer(token: string): string | null {
  try {
    const iss = decodeJwt(token).iss;
    return typeof iss === "string" ? iss : null;
  } catch {
    return null;
  }
}

let jwks: JWTVerifyGetKey | null = null;

export async function verifyAuth0AccessToken(
  token: string,
  opts: { audience: string; getKey?: JWTVerifyGetKey },
): Promise<ClaimsCheck> {
  jwks ??= createRemoteJWKSet(new URL(`${AUTH0_ISSUER}.well-known/jwks.json`));
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, opts.getKey ?? jwks, {
      issuer: AUTH0_ISSUER,
      audience: opts.audience,
      algorithms: ["RS256"],
    }));
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "invalid token" };
  }
  return principalFromClaims(payload, TENANT_TID);
}
