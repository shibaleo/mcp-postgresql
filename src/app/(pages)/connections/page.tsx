"use client";

/**
 * Connections — owner-managed PostgreSQL connection registry.
 *
 * Loads with ?reveal=1 so the form pre-populates with the current URLs
 * (this page is owner-only, behind the auth gate). Save submits a bulk
 * replace; entries removed locally are deleted server-side.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { usePageTitle } from "@/lib/page-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Entry {
  name: string;
  description: string;
  url: string;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.host}${u.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

export default function ConnectionsPage() {
  usePageTitle("Connections");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/connections?reveal=1");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: Entry[] };
        if (!aborted) setEntries(json.data);
      } catch (e) {
        if (!aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  const update = (i: number, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) =>
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  const add = () =>
    setEntries((prev) => [...prev, { name: "", description: "", url: "" }]);

  const validate = (): string | null => {
    const seen = new Set<string>();
    for (const e of entries) {
      if (!NAME_RE.test(e.name)) return `invalid name: "${e.name}"`;
      if (seen.has(e.name)) return `duplicate name: "${e.name}"`;
      seen.add(e.name);
      if (!e.url) return `missing URL for "${e.name}"`;
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/connections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const body = (await res.json()) as { data?: unknown; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(`Saved ${entries.length} connection${entries.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 grid place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load connections: {error}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Connections</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Register PostgreSQL databases the LLM can query. Names are
            lowercase, URLs are stored encrypted at rest.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={add}>
            <Plus className="size-4" />
            Add
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No connections registered. Click <strong>Add</strong> to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base font-mono truncate">
                    {e.name || "(unnamed)"}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(i)}
                    title="Remove"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                {e.url && (
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {maskUrl(e.url)}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3 border-t pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      value={e.name}
                      placeholder="warehouse"
                      onChange={(ev) => update(i, { name: ev.target.value })}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Description</Label>
                    <Input
                      value={e.description}
                      placeholder="What's in this database?"
                      onChange={(ev) =>
                        update(i, { description: ev.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Connection string</Label>
                  <Textarea
                    value={e.url}
                    placeholder="postgresql://user:pass@host:5432/db"
                    onChange={(ev) => update(i, { url: ev.target.value })}
                    className="font-mono text-xs min-h-[60px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Standard libpq URL. SSL is appended automatically. localhost
                    is blocked for SSRF safety.
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
