# Secrets & Config — mcpist-vc (将来: mcp-postgresql)

このアプリの secret / config の置き場所と、新しいマシン・クローンでのセットアップ手順。
パターンは `data-drills-cf` / `data-meals-cf` と共通（dev/prod 分離 playbook 準拠）。
差分は **ホスティングが Cloudflare Worker ではなく Vercel** な点（後述）。

## TL;DR（新規クローンのセットアップ）

1. `bws` CLI を入れる（Windows は scoop。https://github.com/bitwarden/sdk-sm）
2. `.env.local` を作り、`BWS_ACCESS_TOKEN` を1行だけ書く
   （値 = Bitwarden Secrets Manager の machine account token。data-drills / data-meals と同一でよい）
   ```
   BWS_ACCESS_TOKEN=<bitwarden machine account token>
   ```
3. `pnpm install && pnpm dev`

これだけで動く。実 secret は Bitwarden から自動注入され、非機密 config は commit 済み。
**環境ごとに用意するのは `.env.local` の token 1つだけ。**

## 置き場所の区分け（2 バケツだけ。曖昧な第3を作らない）

- **secret** → 注入（git に置かない）。ローカル=bws、prod runtime=**Vercel Production env**。
- **非 secret** → **すべて git 追跡**。`src/lib/public-config.ts` に dev/prod 分岐で集約（`import.meta.env.PROD` でビルド時 tree-shake）。

| 種類 | 例 | 場所 | git |
|---|---|---|---|
| 実 secret | `CLERK_SECRET_KEY` `MCP_POSTGRESQL_*` | **bws**（`shibaleo-{dev,prod}-secrets`、token の `--project-id` で切替）+ prod runtime は Vercel Production env | — |
| bootstrap token | `BWS_ACCESS_TOKEN` | `.env.local` | ignore |
| **非機密 config** | `clerkPublishableKey` / `baseUrl` | **`src/lib/public-config.ts`**（dev/prod 分岐） | **commit** |

**`.env*` は全て gitignore（`!.env.example` のみ例外）。`.mcp.json` も同様（実トークンを含む）。**

## secret 命名（共有 bws project での衝突回避）

Bitwarden 無料枠は 3 project（ops hub / dev / prod）で満杯。4つ目は作れないので、
複数アプリが同じ dev/prod-secrets に**同居**する。mcpist 固有 secret は将来のリポ名
`mcp-postgresql` に前方互換な **`MCP_POSTGRESQL_` prefix** で名前空間を分ける
（`mcp-memory` 等が同居しても衝突しない）。

| bws key | 用途 | dev / prod |
|---|---|---|
| `CLERK_SECRET_KEY` | Clerk owner lookup（**共有インスタンス = 同値**なので bare） | sk_test / sk_live |
| `MCP_POSTGRESQL_REGISTRY_DATABASE_URL` | 接続レジストリ DB（`mcp_postgresql.connections`） | development / production ブランチ (pooled) |
| `MCP_POSTGRESQL_SERVER_JWT_SIGNING_KEY` | OAuth token 署名 (Ed25519 seed) | **別値** |
| `MCP_POSTGRESQL_CREDENTIAL_ENCRYPTION_KEY` | 接続文字列の at-rest 暗号鍵 (AES-256-GCM) | **別値** |

- project id: dev `6eece948-709c-4a86-8923-b48e017573b9` / prod `16c74c07-0fb8-468a-8606-b48e01757644`
- ops hub `b49ccb02-f02b-4c7e-a4c1-b48e005732fc`（`VERCEL_TOKEN` 等の deploy token。アプリは読まない）
- `SERVER_JWT_SIGNING_KEY` / `CREDENTIAL_ENCRYPTION_KEY` は「自己発行」だが、稼働アプリが
  runtime に読み・dev/prod で値が違うので **app runtime secret（dev/prod-secrets）** に分類する。
  分類軸は「誰が発行したか」ではなく「runtime に読む＆環境で値が違うか」。

## 注入の仕組み

`package.json` の dev / db スクリプト:

```
dotenv -e .env.local -- bws run --project-id <dev-project-id> -- <cmd>
```

1. `dotenv-cli` が `.env.local` を load（`BWS_ACCESS_TOKEN`）
2. `bws run` が Bitwarden から実 secret を env に注入
3. その環境で本来のコマンド（vite / bootstrap-db）を実行

`pnpm build`（prod）は Vite + esbuild が `import.meta.env.PROD` を焼くだけで、secret は build に不要。

## インフラ

- **Neon**: data-drills / data-meals と同一の共有 hub `royal-frost-48342064`（us-west-2, pg17）。
  レジストリは `mcp_postgresql` スキーマ（`data_drills` / `data_meals` / `data_memory` と同居）。
  dev=`development` ブランチ / prod=`production` ブランチ。接続文字列は各バケツの
  `DATABASE_URL` と同一（スキーマ修飾 `mcp_postgresql.connections` でアクセスするので分離される）。
  スキーマ作成は `pnpm db:bootstrap`（dev）/ `pnpm db:bootstrap:prod`（prod）。
- **Clerk**: data-drills / data-meals と同一インスタンス。dev=humble-grub-88 の pk_test/sk_test、
  prod=shibaleo.uk の pk_live/sk_live。pk は `public-config.ts`、sk は bws / Vercel env。
- **Vercel**: project `mcpist-vc`。カスタムドメイン **`postgresql.mcp.shibaleo.uk`**
  （shibaleo.uk サブドメイン = live Clerk `clerk.shibaleo.uk` を satellite なしで共有）。
  region sfo1。`.vercel/project.json` でリンク済み。

## ⚠️ Vercel 特有（CF Worker との差分）

- **Hyperdrive が無い**。CF では `DATABASE_URL` を Hyperdrive が runtime 供給していたので Worker Secret 不要だったが、
  Vercel では **`MCP_POSTGRESQL_REGISTRY_DATABASE_URL` を実 runtime env として Vercel に push** する必要がある。
  serverless なので Neon の **`-pooler` ホスト**を使う。
- サーバーバンドル（`api/_bundle.mjs`, esbuild）は `import.meta.env.PROD` を自前で解決できないため、
  `scripts/build-api.mjs` の `define` で `PROD=true` を注入している（client は Vite が、dev は vite ssrLoadModule が解決）。

## prod デプロイ（cutover）— 非対話

```bash
pnpm secrets:prod   # scripts/set-vercel-secrets.mjs:
                    #   prod-secrets から app secret を read + hub から VERCEL_TOKEN を read し、
                    #   vercel env add <KEY> production に stdin で set。値は出力されない。
pnpm deploy         # = bws run(hub) -- vercel deploy --prod --yes（VERCEL_TOKEN 注入で非対話）
# 検証: https://postgresql.mcp.shibaleo.uk で Clerk ログイン + 接続レジストリ CRUD
#       /api/v1/health で has* フラグ確認
```

- `bws run` はネスト不可。`secrets:prod` はスクリプト自身が bws を **per-project の secret list** で
  呼び（app secret=prod-secrets / VERCEL_TOKEN=hub）、値は stdin/env で vercel へ渡す（storage を混ぜない）。
- Function が runtime に読む secret（`CLERK_SECRET_KEY` / `MCP_POSTGRESQL_*` 全て）を push。
  pk・baseUrl は bundle 焼き込みなので対象外。追加時は `scripts/set-vercel-secrets.mjs` の `KEYS` に足す。
- `DRY_RUN=1 pnpm secrets:prod` で vercel を呼ばず値解決だけ確認できる。

## secret / config を足す時の判断

- **外部から貰う credential・自己発行でも runtime に読み環境で違うもの** → bws（+ prod は Vercel env）
- **クライアントに配布される公開値**（publishable key / 公開 URL）→ `src/lib/public-config.ts` に commit
