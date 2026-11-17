/**
 * セッションの cookie の封（AES-256-GCM）と、ログイン後の戻り先の検証。DB も Auth0 も要らない純粋な部分。
 * Regulus の apps/web/src/core/auth/session-crypto.ts と同じ（直すときは両方）。
 *
 * 封の中身はトークン（アクセストークン・refresh token）なので、署名だけでなく暗号化する。
 * 追加の認証データ（AAD）に cookie の名前を入れ、ある cookie の中身を別の cookie に移しても開かないようにする
 * （ログインの途中の状態をセッションとして差し込む、のような取り違えを封の段階で止める）。
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE の code_challenge（S256） */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** 鍵は 32 バイトを base64（標準・URL のどちらでも）で */
function importKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    const raw = fromB64url(secret.replace(/=+$/, ""));
    if (raw.length !== 32) throw new Error(`SESSION_KEY must be 32 bytes (got ${raw.length})`);
    k = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function seal(value: unknown, secret: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(aad) },
    await importKey(secret),
    enc.encode(JSON.stringify(value)),
  );
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64url(out);
}

/** 開けなければ null（鍵が替わった・改ざん・別の cookie の中身）。理由は区別しない */
export async function unseal<T>(sealed: string, secret: string, aad: string): Promise<T | null> {
  try {
    const buf = fromB64url(sealed);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf.slice(0, 12), additionalData: enc.encode(aad) },
      await importKey(secret),
      buf.slice(12),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

/**
 * ログイン後の戻り先。**同じサイトの中のパスだけ**を通す（開いたリダイレクトにしない）。
 * `//evil.example` や `/\evil.example`（ブラウザが別のホストと解釈する）も弾く。
 */
export function safeReturnTo(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  if (/[\r\n]/.test(v)) return "/";
  return v;
}
