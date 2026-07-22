# MIGRATION — mcpist-vc → mcp-postgresql

このリポは将来 **GitHub 上に `mcp-postgresql` リポジトリを新規作成し、ほぼそのままコピー**して
移行する予定。`mcpist` という名前を廃し、サービス名 `mcp-postgresql`（PostgreSQL 用 MCP サーバー）に
統一するのが目的。本書はその方向性・手順・ローテーション運用・既知の障害をまとめる。

関連: `SECRETS.md`（secret/config の置き場所）。姉妹リポ `data-memory`（→ `mcp-memory`）も同じパターン。

## 現状（このリポで確立した構成）

- **Vite SPA + Hono API を単一 Vercel Function** にデプロイ（region sfo1、カスタムドメイン `postgresql.mcp.shibaleo.uk`）。
- **非機密 config は `src/lib/public-config.ts`**（git 追跡、`import.meta.env.PROD` で dev/prod 分岐、tree-shake）。
- **secret は bws**（`shibaleo-{dev,prod}-secrets`、token 1本を `--project-id` で切替）→ prod は Vercel Production env。
- prefix `MCP_POSTGRESQL_`、Neon スキーマ `mcp_postgresql`（共有ハブ `royal-frost-48342064` の
  dev=development / prod=production ブランチ）。この命名は既に**将来のリポ名に前方互換**。

## 方向性

1. GitHub に **`mcp-postgresql`** を新規作成。
2. このリポの中身をほぼコピー（`.git` は引き継がず新規履歴でも可）。
3. Vercel は **既存プロジェクト `mcpist-vc` の Git 連携先を新リポに差し替える**のを推奨（後述）。
4. 命名は既に `MCP_POSTGRESQL_` / `mcp_postgresql` なので **env / schema の改名は不要**。
5. 仕上げに残った `mcpist` 由来の文字列（下記 TODO）を掃除。

## なぜ今は速いか（この整備の成果）

- **命名が前方互換**: secret prefix・schema 名が既に `mcp_postgresql` 系。移行時に env/DB を触らない。
- **bws が SSOT**: 新リポは**同じ bws キーを読むだけ**。secret の再投入は原則不要（ローテーション時のみ `bws secret edit`）。
- **Neon schema/data は共有ハブ上でそのまま**: `DATABASE_URL` 同一、`mcp_postgresql` スキーマ共有。DB 移行不要。
- **クローンは `.env.local`（BWS token 1本）だけで動く**。公開値は commit 済み。

## 移行ランブック

```
# 1) 新リポ作成 + コピー
gh repo create shibaleo/mcp-postgresql --private
# 中身をコピー（.env.local と .vercel は gitignore なので付いてこない → 手で用意）

# 2) ローカル用意
cp <old>/.env.local .          # BWS_ACCESS_TOKEN 1本（dev/prod-secrets 共通）
pnpm install
pnpm dev                       # bws 注入で dev 起動・localhost で確認

# 3) Vercel（推奨: 既存プロジェクトの Git 連携先を差し替え）
#    Vercel Dashboard → Project mcpist-vc → Settings → Git → Connected Repository を
#    shibaleo/mcp-postgresql に変更。projectId・カスタムドメイン・Production env は保持される。
#    → .vercel/project.json は既存のまま（projectId 不変）。ドメイン移設も Clerk 再登録も不要。
#
#    別案: 新 Vercel プロジェクトを作る場合は churn が増える（下記「障害」参照）。

# 4) デプロイ
pnpm deploy                    # bws run(hub) -- vercel deploy --prod
# 検証: https://postgresql.mcp.shibaleo.uk/api/v1/health
```

## シークレットローテーション ランブック

このリポが読む app secret: `CLERK_SECRET_KEY`(共有)・`MCP_POSTGRESQL_REGISTRY_DATABASE_URL`・
`MCP_POSTGRESQL_SERVER_JWT_SIGNING_KEY`・`MCP_POSTGRESQL_CREDENTIAL_ENCRYPTION_KEY`。

基本形（DB パスワード / JWT 鍵など**データ依存のないもの**）:
```
# 1) 新値を生成（例: JWT seed）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# 2) bws を更新（dev/prod それぞれ）
bws secret edit <secret-id> --value <new>      # or 付属スクリプトで
# 3) prod へ反映 + デプロイ
pnpm secrets:prod && pnpm deploy
```

- **`MCP_POSTGRESQL_SERVER_JWT_SIGNING_KEY` を回すと既発行の OAuth アクセス/リフレッシュトークンが失効** →
  MCP クライアントは**再認可**が必要（想定内）。
- **⚠️ `MCP_POSTGRESQL_CREDENTIAL_ENCRYPTION_KEY` は単純 swap 不可**。`mcp_postgresql.connections` の
  接続文字列がこの鍵で at-rest 暗号化されているため、**旧鍵で復号 → 新鍵で再暗号化 → 上書き**が必要
  （dev/prod それぞれのブランチで）。手順は初期移行で使った Phase 2 スクリプトと同型
  （`decrypt(old) → encrypt(new)`、平文は transcript に出さない）。これが唯一データ依存のあるローテーション。

## 既知の障害・落とし穴

1. **`.vercel/project.json` は gitignore** → 新リポには付いてこない。既存プロジェクト流用なら手でコピー、
   新規なら `vercel link`。
2. **カスタムドメイン & Clerk**: `postgresql.mcp.shibaleo.uk` は現 Vercel プロジェクトに紐付き、かつ
   shibaleo.uk サブドメインとして Clerk(pk_live) が通っている。**新 Vercel プロジェクトを作るとドメイン移設が発生**
   （旧から外し新に付け直し）。ドメインさえ同じなら Clerk 再登録は不要。→ **既存プロジェクトの Git 連携差し替えが最小コスト**。
3. **暗号鍵ローテーションのデータ依存**（上記）。ここだけは「回して deploy」では壊れる。
4. **JWT/audience ローテーションでトークン失効** → クライアント再認可。
5. **audience 文字列が未リネーム**: `src/lib/auth.ts` / `src/lib/oauth-server/access-tokens.ts` の
   `mcpist-oauth-access` が残っている。mcp-postgresql 化のタイミングで `mcp-postgresql-oauth-access` に直すのが理想
   （鍵ローテーションと同時にやれば追加の失効コストなし）。data-memory は既に `mcp-memory-oauth-access` に修正済み。
6. **pnpm ストアのメジャー差**（このマシンで発生実績）。fresh clone + `pnpm install` で解消。
7. **旧リソースの後始末**: 移行後、旧 GitHub リポ / （新プロジェクトを作った場合の）旧 Vercel プロジェクトの廃止を判断。

## TODO（mcpist → mcp-postgresql 化で掃除する残りの `mcpist` 文字列）

- `src/lib/auth.ts`: ヘッダコメント "Auth for mcpist-vc"、`ACCESS_TOKEN_AUDIENCE = "mcpist-oauth-access"`
- `src/lib/oauth-server/access-tokens.ts`: `AUDIENCE = "mcpist-oauth-access"`（+ コメント）
- `package.json` の `name`、`README.md`、その他ドキュメントの表記
- （schema / env / bws キー / ドメインは既に mcp_postgresql 系なので変更不要）
