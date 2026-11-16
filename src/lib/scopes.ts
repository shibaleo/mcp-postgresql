/**
 * 道具ごとに要る scope（Regulus の docs/056 §9。権限は /api/v1/mcp の 1 か所で判断する）。
 * 書き込みの道具は postgres:write、それ以外は postgres:read。
 * 書き込みの道具を足したら WRITE_TOOLS にも足す（足し忘れると読み取りの scope で書けてしまう）。
 */
export const READ_SCOPE = "postgres:read";
export const WRITE_SCOPE = "postgres:write";
export const ALL_SCOPES = [READ_SCOPE, WRITE_SCOPE];

export const WRITE_TOOLS = new Set<string>(["execute","execute_ddl"]);

/** JSON-RPC の 1 通に要る scope。tools/call は道具で決め、それ以外（initialize・tools/list など）は読み取り */
export function requiredScope(message: unknown): string {
  const m = message as { method?: unknown; params?: { name?: unknown } } | null;
  if (m?.method === "tools/call" && typeof m.params?.name === "string" && WRITE_TOOLS.has(m.params.name)) {
    return WRITE_SCOPE;
  }
  return READ_SCOPE;
}

/** 1 通か束（配列）のうち、持っていない scope（無ければ null） */
export function missingScope(body: unknown, granted: string[]): string | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    const need = requiredScope(m);
    if (!granted.includes(need)) return need;
  }
  return null;
}
