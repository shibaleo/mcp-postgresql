/**
 * Auth for mcp-postgresql — single-owner mode.
 *
 * No DB. The app has exactly one principal: the owner identified by
 * OWNER_EMAIL (hardcoded below). Two credential types are accepted:
 *
 *   1. Clerk session JWT (browser → Vercel) — verified via JWKS, then the
 *      Clerk profile is fetched once and the primary email is matched
 *      against OWNER_EMAIL. Anyone else: rejected.
 *   2. Auth0 access token (MCP client → Vercel) — Regulus の docs/056。src/lib/auth0.ts が確かめる。
 *      自作の OAuth（Ed25519 の疑似 OAuth）は 2026-11-17 に消した。
 *
 * In-memory caches per warm Lambda avoid re-hitting Clerk on every request.
 */

import * as jose from "jose";
import { publicConfig } from "@/lib/public-config";
import { getAppUrl } from "@/lib/app-url";
import { AUTH0_ISSUER, peekIssuer, verifyAuth0AccessToken } from "@/lib/auth0";
import { ALL_SCOPES } from "@/lib/scopes";

export const OWNER_EMAIL = "shiba.dog.leo.private@gmail.com";

export interface AuthResult {
  authenticated: true;
  /** "auth0" = MCP のクライアント（Regulus の docs/056）。"clerk" = ブラウザの管理画面（web の Auth0 化で消す） */
  source: "auth0" | "clerk";
  /** 許された scope。旧の仕組みは持ち主だけが使えるので全部（ALL_SCOPES） */
  scopes: string[];
}

const OWNER: AuthResult = { authenticated: true, source: "clerk", scopes: ALL_SCOPES };

// ── Clerk JWKS ────────────────────────────────────────────────────────────

function getClerkDomain(): string | null {
  const pk = publicConfig.clerkPublishableKey;
  if (!pk) return null;
  const encoded = pk.replace(/^pk_(test|live)_/, "");
  try {
    return atob(encoded).replace(/\$$/, "");
  } catch {
    return null;
  }
}

let clerkJWKS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function getClerkJWKS() {
  if (clerkJWKS) return clerkJWKS;
  const domain = getClerkDomain();
  if (!domain) return null;
  clerkJWKS = jose.createRemoteJWKSet(
    new URL(`https://${domain}/.well-known/jwks.json`),
  );
  return clerkJWKS;
}

// ── Caches ────────────────────────────────────────────────────────────────

const ownerByClerkIdCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const OWNER_CACHE_TTL = 5 * 60 * 1000;

// ── Clerk path ────────────────────────────────────────────────────────────

interface ClerkUserResponse {
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
}

async function fetchOwnerEmail(clerkUserId: string): Promise<string | null> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${sk}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as ClerkUserResponse;
    if (!u.email_addresses || u.email_addresses.length === 0) return null;
    const primary = u.email_addresses.find(
      (e) => e.id === u.primary_email_address_id,
    );
    return primary?.email_address ?? u.email_addresses[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

async function isClerkUserOwner(clerkUserId: string): Promise<boolean> {
  const cached = ownerByClerkIdCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;
  const email = await fetchOwnerEmail(clerkUserId);
  const allowed = email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  ownerByClerkIdCache.set(clerkUserId, {
    allowed,
    expiresAt: Date.now() + OWNER_CACHE_TTL,
  });
  return allowed;
}

async function verifyClerkToken(token: string): Promise<AuthResult | null> {
  const jwks = getClerkJWKS();
  if (!jwks) return null;
  try {
    const { payload } = await jose.jwtVerify(token, jwks);
    const clerkUserId = payload.sub as string;
    if (!clerkUserId) return null;
    if (!(await isClerkUserOwner(clerkUserId))) return null;
    return OWNER;
  } catch {
    return null;
  }
}

// ── Token extraction ──────────────────────────────────────────────────────

function extractBearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function extractSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)__session=([^;]*)/);
  return m ? m[1] : null;
}

// ── Public ────────────────────────────────────────────────────────────────

export async function authenticate(req: Request): Promise<AuthResult | null> {
  const bearer = extractBearerToken(req);
  // 新: Auth0 のアクセストークン（発行元で振り分ける。宛先はこの MCP の口の URL）
  if (bearer && peekIssuer(bearer) === AUTH0_ISSUER) {
    const r = await verifyAuth0AccessToken(bearer, { audience: `${getAppUrl(req)}/api/v1/mcp` });
    if (!r.ok) {
      console.log(`[auth] auth0 token rejected: ${r.reason}`);
      return null;
    }
    return { authenticated: true, source: "auth0", scopes: r.principal.scopes };
  }
  if (bearer) {
    // Clerk の JWT（ブラウザの管理画面。Bearer で来ることもある）
    const c = await verifyClerkToken(bearer);
    if (c) return c;
  }
  const cookie = extractSessionCookie(req);
  if (cookie) {
    const r = await verifyClerkToken(cookie);
    if (r) return r;
  }
  return null;
}

