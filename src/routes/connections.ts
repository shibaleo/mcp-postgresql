/**
 * /api/v1/connections — owner-managed PostgreSQL connection registry.
 *
 *   GET  /              → [{name, description}]                 (no URLs)
 *   GET  /?reveal=1     → [{name, description, url}]            (owner UI to edit existing)
 *   PUT  /              → bulk replace; body is the full new list
 *
 * Sits behind the auth gate in lib/hono-app.ts — both Clerk-session and
 * OAuth-access-token requests are accepted, but in single-owner mode either
 * path means "the owner".
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listDatabaseSummaries,
  listDatabaseEntriesWithUrls,
  replaceDatabases,
} from "@/lib/databases";

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

const entrySchema = z.object({
  name: z.string().regex(NAME_RE, "name must match ^[a-z][a-z0-9_-]*$"),
  description: z.string().default(""),
  url: z.string().min(1),
});

const putBody = z.object({
  entries: z.array(entrySchema),
});

const app = new Hono()
  .get("/", async (c) => {
    const reveal = c.req.query("reveal") === "1";
    if (reveal) {
      const entries = await listDatabaseEntriesWithUrls();
      return c.json({ data: entries });
    }
    const summaries = await listDatabaseSummaries();
    return c.json({ data: summaries });
  })
  .put("/", zValidator("json", putBody), async (c) => {
    const body = c.req.valid("json");
    try {
      await replaceDatabases(body.entries);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 400);
    }
    return c.json({ data: { ok: true, count: body.entries.length } });
  });

export default app;
