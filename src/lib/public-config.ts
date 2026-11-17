/**
 * 公開 (非機密) config の単一ソース。dev/prod を分岐し、git 追跡する。
 *
 * 方針: 「secret は注入 / 非 secret はすべて git 追跡 / 曖昧な第3を作らない」。
 * ここに置くのは **公開値のみ** — client bundle に焼かれても・リポジトリに commit されても
 * 問題ない値 (publishable key / 公開 URL 等)。
 * **実 secret (AUTH0_MCP_CONSOLE_CLIENT_SECRET / MCP_POSTGRESQL_* 等) は絶対に置かない**。それらは
 * process.env 経由で注入する (ローカル=bws、prod=Vercel env)。詳細は SECRETS.md。
 *
 * dev/prod の選択は `import.meta.env.PROD` (ビルド時定数)。未使用ブランチは tree-shake され、
 * 各 bundle には該当環境の値だけが残る。
 * - client bundle: Vite が置換
 * - server bundle: esbuild の define (scripts/build-api.mjs) が置換
 * - dev server: Vite dev の ssrLoadModule が解決 (import.meta.env.PROD=false)
 */

interface PublicConfig {
  /**
   * 管理画面のログインの Auth0 アプリ（Regulus の infra/auth0/mcp の mcp-console。BFF）。2 つの MCP で共有。
   * client secret は注入（AUTH0_MCP_CONSOLE_CLIENT_SECRET）。src/lib/session.ts が使う
   */
  auth0ConsoleClientId: string;
  /**
   * 正規の origin。OAuth の redirect_uri を byte 一致で組み立てるのに使う。
   * prod は Auth0（mcp-console）に戻り先として登録したカスタムドメイン。dev は null → リクエストの Host から導出する。
   */
  baseUrl: string | null;
}

const dev: PublicConfig = {
  auth0ConsoleClientId: "aLCUzt9VYGtj6OgMgkpj6bQUeMOm339S",
  baseUrl: null,
};

const prod: PublicConfig = {
  auth0ConsoleClientId: "aLCUzt9VYGtj6OgMgkpj6bQUeMOm339S",
  baseUrl: "https://postgresql.mcp.shibaleo.uk",
};

export const publicConfig: PublicConfig = import.meta.env.PROD ? prod : dev;
