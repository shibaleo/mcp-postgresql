/**
 * /api/v1/health — fast liveness probe. Reports which env vars are set
 * so deploy misconfigurations are visible without poking other endpoints.
 */

import { Hono } from "hono";
import { getAppUrl } from "@/lib/app-url";
import { publicConfig } from "@/lib/public-config";

const app = new Hono().get("/", (c) =>
  c.json({
    status: "ok",
    env: {
      hasClerkPK: !!publicConfig.clerkPublishableKey,
      hasClerkSK: !!process.env.CLERK_SECRET_KEY,
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
