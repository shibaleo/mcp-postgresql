/**
 * 公開 (非機密) config の単一ソース。dev/prod を分岐し、git 追跡する。
 *
 * 方針: 「secret は注入 / 非 secret はすべて git 追跡 / 曖昧な第3を作らない」。
 * ここに置くのは **公開値のみ** — client bundle に焼かれても・リポジトリに commit されても
 * 問題ない値 (publishable key / 公開 URL 等)。
 * **実 secret (CLERK_SECRET_KEY / MCP_POSTGRESQL_* 等) は絶対に置かない**。それらは
 * process.env 経由で注入する (ローカル=bws、prod=Vercel env)。詳細は SECRETS.md。
 *
 * dev/prod の選択は `import.meta.env.PROD` (ビルド時定数)。未使用ブランチは tree-shake され、
 * 各 bundle には該当環境の値だけが残る。
 * - client bundle: Vite が置換
 * - server bundle: esbuild の define (scripts/build-api.mjs) が置換
 * - dev server: Vite dev の ssrLoadModule が解決 (import.meta.env.PROD=false)
 *
 * Clerk は data-drills-cf / data-meals-cf と同一インスタンスを共有 (dev=humble-grub-88 の
 * pk_test / prod=shibaleo.uk の pk_live)。pk は公開値なのでここに、sk は bws / Vercel env に。
 */

interface PublicConfig {
  /** Clerk Publishable Key (公開)。frontend の ClerkProvider + server の JWKS domain 推定に使う。 */
  clerkPublishableKey: string;
  /**
   * 正規の origin。OAuth の redirect_uri を byte 一致で組み立てるのに使う。
   * prod は Clerk 登録済みのカスタムドメイン。dev は null → リクエストの Host から導出する。
   */
  baseUrl: string | null;
}

const dev: PublicConfig = {
  clerkPublishableKey: "pk_test_aHVtYmxlLWdydWItODguY2xlcmsuYWNjb3VudHMuZGV2JA",
  baseUrl: null,
};

const prod: PublicConfig = {
  clerkPublishableKey: "pk_live_Y2xlcmsuc2hpYmFsZW8udWsk",
  baseUrl: "https://postgresql.mcp.shibaleo.uk",
};

export const publicConfig: PublicConfig = import.meta.env.PROD ? prod : dev;
