/**
 * One-shot bootstrap: apply the baseline migration to the registry DB.
 *
 * Usage:  pnpm db:bootstrap   (wraps this in `bws run` — see package.json)
 *
 * Reads MCP_POSTGRESQL_REGISTRY_DATABASE_URL (bws-injected). Idempotent — re-running is
 * a no-op since every CREATE uses IF NOT EXISTS.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// Lightweight .env.local loader so we don't need the dotenv dep. In normal
// use the registry URL is injected by `bws run`; this only picks up local
// overrides / the BWS token from .env.local.
function loadEnv() {
  let text;
  try {
    text = readFileSync(".env.local", "utf-8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv();

const url = process.env.MCP_POSTGRESQL_REGISTRY_DATABASE_URL;
if (!url) {
  console.error("MCP_POSTGRESQL_REGISTRY_DATABASE_URL is not set");
  process.exit(1);
}

const sqlText = readFileSync("database/migrations/00000000000001_baseline.sql", "utf-8");

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  connect_timeout: 30,
});

const safeHost = url.replace(/\/\/[^@]+@/, "//***@");
console.log("→ applying baseline migration to", safeHost);
const t0 = Date.now();
try {
  await sql.unsafe(sqlText);
  console.log(`✓ done in ${Date.now() - t0}ms`);
} catch (e) {
  console.error("✗ migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
