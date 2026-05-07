/**
 * Connection registry — CRUD over `mcpist.connections` on the registry DB
 * (MCPIST_REGISTRY_DATABASE_URL).
 *
 * Owner-managed: every value is encrypted at rest with CREDENTIAL_ENCRYPTION_KEY
 * (AES-256-GCM, see lib/credentials/crypto.ts). URLs leave this module only via
 * `getDatabaseUrl(name)` and `listDatabaseEntriesWithUrls()`; MCP-facing APIs
 * use `listDatabaseSummaries()` so the LLM never sees connection strings.
 *
 * Caching: `getDatabaseUrl` caches resolved URLs per warm Lambda for 60s to
 * avoid hitting the registry on every tool call. `replaceDatabases` clears
 * the cache so subsequent calls see the new state immediately.
 */

import postgres from "postgres";
import { encrypt, decrypt } from "@/lib/credentials/crypto";

const NAME_RE = /^[a-z][a-z0-9_-]*$/;
const CACHE_TTL_MS = 60_000;

export interface DatabaseSummary {
  name: string;
  description: string;
}

export interface DatabaseEntry extends DatabaseSummary {
  url: string;
}

interface CacheLine {
  url: string;
  expiresAt: number;
}

const urlCache = new Map<string, CacheLine>();
let listCache: { entries: DatabaseEntry[]; expiresAt: number } | null = null;

function getRegistryUrl(): string {
  const url = process.env.MCPIST_REGISTRY_DATABASE_URL;
  if (!url) {
    throw new Error("MCPIST_REGISTRY_DATABASE_URL is not set");
  }
  return url;
}

function openRegistry() {
  return postgres(getRegistryUrl(), {
    ssl: "require",
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });
}

/**
 * Validate a libpq connection string. Mirrors the check in
 * mcp/modules/postgresql/tools.ts so the same SSRF + sanity rules apply at
 * registration time and at query time.
 */
export function validateConnectionString(connStr: string): void {
  let url: URL;
  try {
    url = new URL(connStr);
  } catch {
    throw new Error("invalid connection string format");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("scheme must be postgresql or postgres");
  }
  if (!url.hostname) throw new Error("host is required");

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    throw new Error("localhost connections are not allowed for security reasons");
  }
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error("database name is required");
}

function validateName(name: string) {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid name "${name}": must match ${NAME_RE.source}`,
    );
  }
}

/** Read the full registry. Internal — callers pick a public projection below. */
async function readAll(): Promise<DatabaseEntry[]> {
  if (listCache && listCache.expiresAt > Date.now()) return listCache.entries;
  const sql = openRegistry();
  try {
    const rows = await sql<{ name: string; description: string; encrypted: string }[]>`
      SELECT name, description, encrypted
      FROM mcpist.connections
      ORDER BY name
    `;
    const entries: DatabaseEntry[] = [];
    for (const r of rows) {
      const url = await decrypt(r.encrypted);
      entries.push({ name: r.name, description: r.description, url });
    }
    listCache = { entries, expiresAt: Date.now() + CACHE_TTL_MS };
    return entries;
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch (e) {
      console.error("[registry] sql.end failed:", e);
    }
  }
}

/** Public list with URLs included — for the owner SPA when ?reveal=1, and for tools. */
export async function listDatabaseEntriesWithUrls(): Promise<DatabaseEntry[]> {
  return readAll();
}

/** MCP-safe projection: name + description only. */
export async function listDatabaseSummaries(): Promise<DatabaseSummary[]> {
  const entries = await readAll();
  return entries.map((e) => ({ name: e.name, description: e.description }));
}

/** Resolve a name to a URL. Throws with available names listed on miss. */
export async function getDatabaseUrl(name: string): Promise<string> {
  const cached = urlCache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const entries = await readAll();
  const hit = entries.find((e) => e.name === name);
  if (!hit) {
    const available = entries.map((e) => e.name).join(", ") || "(none registered)";
    throw new Error(
      `unknown database "${name}". Available: ${available}. Use list_databases to discover.`,
    );
  }
  urlCache.set(name, { url: hit.url, expiresAt: Date.now() + CACHE_TTL_MS });
  return hit.url;
}

export interface ReplaceInput {
  name: string;
  description?: string;
  url: string;
}

/**
 * Bulk replace the registry: upsert everything in `entries`, delete anything
 * not in it. Validates every URL before any write — the entire call is
 * atomic via a single transaction.
 */
export async function replaceDatabases(entries: ReplaceInput[]): Promise<void> {
  // Validate up front so we never partially write.
  const seen = new Set<string>();
  for (const e of entries) {
    validateName(e.name);
    if (seen.has(e.name)) throw new Error(`duplicate name "${e.name}"`);
    seen.add(e.name);
    validateConnectionString(e.url);
  }

  // Encrypt before opening the txn — encryption is async + CPU-bound.
  const prepared = await Promise.all(
    entries.map(async (e) => ({
      name: e.name,
      description: e.description ?? "",
      encrypted: await encrypt(e.url),
    })),
  );

  const sql = openRegistry();
  try {
    await sql.begin(async (tx) => {
      const names = prepared.map((p) => p.name);
      // Delete entries that aren't in the new set. Empty list → wipe all.
      if (names.length === 0) {
        await tx`DELETE FROM mcpist.connections`;
      } else {
        await tx`DELETE FROM mcpist.connections WHERE name <> ALL(${names})`;
      }
      for (const p of prepared) {
        await tx`
          INSERT INTO mcpist.connections (name, description, encrypted)
          VALUES (${p.name}, ${p.description}, ${p.encrypted})
          ON CONFLICT (name) DO UPDATE
            SET description = EXCLUDED.description,
                encrypted   = EXCLUDED.encrypted,
                updated_at  = now()
        `;
      }
    });
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch (e) {
      console.error("[registry] sql.end failed:", e);
    }
  }

  // Invalidate caches so the next read sees the new state.
  urlCache.clear();
  listCache = null;
}
