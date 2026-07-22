/**
 * Canonical app URL resolution.
 *
 * The OAuth flow's redirect_uri is registered ONCE with each provider's
 * developer console — the value we send at authorize/token time has to
 * match byte-for-byte. Deriving it from `Host`/`x-forwarded-host` would
 * break the moment a request hits a deployment-specific Vercel URL
 * (`mcp-postgresql-abc123-shibaleos-projects.vercel.app`) instead of the canonical
 * alias (`postgresql.mcp.shibaleo.uk`).
 *
 * Resolution order:
 *   1. publicConfig.baseUrl — the canonical prod origin (Clerk-registered
 *      custom domain), baked at build time. null in dev.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — auto-injected by Vercel; canonical
 *      production hostname even on preview-URL hits (safety fallback).
 *   3. Request-derived URL — fallback for `pnpm dev` / self-hosted setups.
 */
import { publicConfig } from "@/lib/public-config";

function ensureScheme(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host.replace(/\/+$/, "");
  }
  return `https://${host.replace(/\/+$/, "")}`;
}

export function getAppUrl(req: Request): string {
  if (publicConfig.baseUrl) return ensureScheme(publicConfig.baseUrl);

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return ensureScheme(vercelProd);

  // Local dev: use whatever host the request came in on.
  const url = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (url.protocol === "https:" ? "https" : "http");
  return `${proto}://${host}`;
}

export function getOAuthCallbackUrl(req: Request): string {
  return `${getAppUrl(req)}/api/v1/oauth/callback`;
}
