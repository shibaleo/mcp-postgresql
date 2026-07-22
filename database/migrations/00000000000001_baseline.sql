-- Baseline schema for the connection registry. Idempotent — safe to re-run.

CREATE SCHEMA IF NOT EXISTS mcp_postgresql;

CREATE TABLE IF NOT EXISTS mcp_postgresql.connections (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_-]*$'),
  description text NOT NULL DEFAULT '',
  -- AES-256-GCM ciphertext: "v1:" + base64(nonce(12) || ciphertext || tag(16))
  encrypted   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
