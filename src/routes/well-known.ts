/**
 * .well-known endpoints for MCP OAuth discovery.
 *
 * mcp-postgresql runs its OWN OAuth Authorization Server (proxying Clerk for
 * end-user login under the hood). Discovery metadata advertises our
 * authorize / token / register endpoints — clients (Claude.ai, Claude
 * Desktop, ...) never talk to Clerk's OAuth surface directly.
 *
 * Mounted at both /api/v1/.well-known/* (canonical) and /.well-known/*
 * (apex, mounted in hono-app) so MCP clients that look in either spot
 * find the metadata.
 */

import { Hono } from "hono";
import { getAppUrl } from "@/lib/app-url";
import { AUTH0_ISSUER } from "@/lib/auth0";
import { ALL_SCOPES } from "@/lib/scopes";

const corsAndCacheHeaders = {
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
};

const app = new Hono()
  /**
   * RFC 9728 Protected Resource Metadata. Tells the MCP client that we
   * are also the authorization server and which bearer-token shape
   * we accept on /api/v1/mcp.
   */
  .get("/oauth-protected-resource", (c) => {
    const appUrl = getAppUrl(c.req.raw);
    return c.json(
      {
        resource: `${appUrl}/api/v1/mcp`,
        // 認可サーバーは Auth0（Regulus の docs/056）。issuer と一字一句同じ（末尾の / も）。
        authorization_servers: [AUTH0_ISSUER],
        scopes_supported: ALL_SCOPES,
        bearer_methods_supported: ["header"],
      },
      200,
      corsAndCacheHeaders,
    );
  });

export default app;
