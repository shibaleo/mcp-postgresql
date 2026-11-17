// prod runtime secret を Vercel Production env へ push する。
//
// 実行: `pnpm secrets:prod` = dotenv -e .env.local -- node scripts/set-vercel-secrets.mjs
//   (bws でラップしない。BWS_ACCESS_TOKEN を持った状態でこのスクリプトが bws を per-project で呼ぶ)
//
// secret の2分類を storage で混ぜない:
//   - app runtime secret (CLERK_SECRET_KEY / MCP_POSTGRESQL_*) → prod-secrets から read
//   - Vercel CLI の認証 (VERCEL_TOKEN)                          → hub から read
//   bws run はネスト不可なので、両者を別々の単一プロジェクト list で取得し、値は
//   メモリ内に保持。Vercel CLI へは stdin で渡し、標準出力には出さない。
//
// DRY_RUN=1 で vercel を呼ばず値解決だけ確認する。
import { execFileSync, spawnSync } from "node:child_process";

const HUB = "b49ccb02-f02b-4c7e-a4c1-b48e005732fc"; // ops token (VERCEL_TOKEN)
const PROD = "16c74c07-0fb8-468a-8606-b48e01757644"; // app runtime secrets
// 稼働 Function が process.env から runtime に読む app secret。
// Vercel の env 名 = コードが読む名前。値は prod-secrets の同名 key から取る。
const KEYS = [
  "CLERK_SECRET_KEY",
  "MCP_POSTGRESQL_REGISTRY_DATABASE_URL",
  "MCP_POSTGRESQL_CREDENTIAL_ENCRYPTION_KEY",
];
const TARGET = "production";
const sh = process.platform === "win32";
const DRY = process.env.DRY_RUN === "1";

function bwsSecrets(projectId, label) {
  try {
    const out = execFileSync("bws", ["secret", "list", projectId, "-o", "json"], {
      shell: sh,
    }).toString();
    return Object.fromEntries(JSON.parse(out).map((s) => [s.key, s.value]));
  } catch (e) {
    console.error(`✗ bws secret list (${label}) 失敗:`, e.message.split("\n")[0]);
    process.exit(1);
  }
}

const prodSecrets = bwsSecrets(PROD, "prod");
const vercelToken = bwsSecrets(HUB, "hub")["VERCEL_TOKEN"];
if (!vercelToken) {
  console.error("✗ hub に VERCEL_TOKEN が無い");
  process.exit(1);
}

// vercel CLI に token は env で渡す (argv に出さない)。.vercel/project.json でリンク済み。
const childEnv = { ...process.env, VERCEL_TOKEN: vercelToken };

let failed = false;
for (const key of KEYS) {
  const value = prodSecrets[key];
  if (!value) {
    console.error(`✗ ${key}: prod-secrets に無い`);
    failed = true;
    continue;
  }
  if (DRY) {
    console.log(`• ${key}: resolved from prod-secrets — DRY_RUN, vercel 呼ばず`);
    continue;
  }
  // 既存があると add が衝突するので先に rm（無ければ黙って無視）。
  spawnSync("vercel", ["env", "rm", key, TARGET, "--yes"], {
    env: childEnv,
    stdio: ["ignore", "ignore", "ignore"],
    shell: sh,
  });
  // 値は stdin で渡す（標準出力には出さない）。
  const status = spawnSync("vercel", ["env", "add", key, TARGET], {
    input: value,
    env: childEnv,
    stdio: ["pipe", "inherit", "inherit"],
    shell: sh,
  }).status;
  if (status === 0) console.log(`✓ ${key} → Vercel ${TARGET}`);
  else {
    console.error(`✗ ${key}: vercel env add 失敗`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
