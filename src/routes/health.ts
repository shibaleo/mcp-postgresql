/**
 * /api/v1/health — fast liveness probe. Reports which env vars are set
 * so deploy misconfigurations are visible without poking other endpoints.
 */

import { Hono } from "hono";
import { getAppUrl } from "@/lib/app-url";

const app = new Hono().get("/", (c) =>
  c.json({
    status: "ok",
    env: {
      hasConsoleClientSecret: !!process.env.AUTH0_MCP_CONSOLE_CLIENT_SECRET,
      hasSessionKey: !!process.env.MCP_POSTGRESQL_SESSION_KEY,
      hasEncKey: !!process.env.MCP_POSTGRESQL_CREDENTIAL_ENCRYPTION_KEY,
      hasRegistryUrl: !!process.env.MCP_POSTGRESQL_REGISTRY_DATABASE_URL,
      appUrl: getAppUrl(c.req.raw),
    },
    runtime: {
      node: process.version,
      cwd: process.cwd(),
    },
  }),
);

export default app;
