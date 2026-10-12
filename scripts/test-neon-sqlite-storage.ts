import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const storage = read("server/storage-dual.ts");
const storageSqlite = read("server/storage.ts");
const storagePostgres = read("server/storage-postgres.ts");
const migration = read("server/migrate-postgres.ts");
const restore = read("server/neon-sqlite-sync.ts");
const boot = read("server/index.ts");
const deploymentDocs = read("docs/neon-sqlite-storage.md");

assert.match(storage, /private async writeEssential/);
assert.match(storage, /NEON_REQUIRED/);
assert.match(storage, /NEON_RETRY_COOLDOWN_MS = 30_000/);
assert.match(storage, /neonQuotaBlocked/);
assert.match(storage, /this\.turso = null/);
assert.doesNotMatch(storage, /storage-turso/);
assert.match(storage, /async createAiLog\(log: InsertAiLog\)\s+\{ return this\.sqlite\.createAiLog\(log\); \}/);
assert.match(storage, /async upsertMarketData\(data: InsertMarketData\) \{ return this\.sqlite\.upsertMarketData\(data\); \}/);

assert.match(migration, /invista_database_identity/);
assert.match(migration, /INVISTA_PLATFORM/);
assert.match(migration, /const platformId = "invista-core"/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(migration, /uq_deriv_tokens_one_active_primary/);
assert.match(migration, /platform mismatch/);
assert.match(migration, /WHERE is_active = TRUE AND slot_index IS NOT NULL/);
assert.match(migration, /WHERE is_active = TRUE AND is_primary = TRUE/);
assert.doesNotMatch(migration, /sqliteDb\.select\(\)\.from/);
assert.doesNotMatch(migration, /SINCRONIZAR USUÁRIOS DO SQLITE/i);

assert.match(restore, /pgSchema\.users/);
assert.match(restore, /pgSchema\.derivTokens/);
assert.match(restore, /pgSchema\.tradeConfigurations/);
assert.match(restore, /pgSchema\.modalityModuleConfigs/);
assert.match(restore, /rankedTokens/);
assert.match(restore, /is_primary/);
assert.match(restore, /isPrimary/);
assert.match(restore, /function isEncryptedTokenFormat/);
assert.match(restore, /function tokenFingerprint/);
assert.match(restore, /localActiveTokens/);
assert.match(restore, /tokenFingerprint\(decryptTokenForMatching/);
assert.match(restore, /Never guess a slot from row order or timestamps/);
assert.match(restore, /parts\.length === 3[\s\S]*?\{32\}[\s\S]*?\{32\}/);
assert.doesNotMatch(restore, /token\.includes\(\s*['"]:['"]\s*\)/);
assert.doesNotMatch(restore, /pgSchema\.(tradeOperations|marketData|aiLogs)/);

assert.match(storagePostgres, /async updateDerivToken[\s\S]*?db\.transaction/);
assert.match(storagePostgres, /currentPrimary/);
assert.match(storagePostgres, /eq\(pgSchema\.derivTokens\.isPrimary, true\)/);
assert.match(storageSqlite, /eq\(derivTokens\.isPrimary, true\)/);
assert.match(storageSqlite, /isPrimary: true/);
assert.match(storagePostgres, /async upsertDerivTokenBySlot[\s\S]*?db\.transaction/);
assert.match(storagePostgres, /async createTradeConfig[\s\S]*?db\.transaction/);
assert.match(storagePostgres, /async updateTradeConfig[\s\S]*?db\.transaction/);
assert.match(boot, /restoreEssentialDataToSqlite/);
assert.match(boot, /maxPersistenceAttempts = 3/);
assert.match(boot, /persistenceReady = true/);
assert.doesNotMatch(boot, /anonymousSecurityProbe|req\.path\.startsWith\(['"]\/__audit_/);
assert.match(boot, /process\.exit\(1\)/);
assert.match(deploymentDocs, /same `DATABASE_URL` and the same valid `ENCRYPTION_KEY`/);
assert.match(deploymentDocs, /shared `invista-core` identity/);
assert.doesNotMatch(deploymentDocs, /separate Neon database per platform/i);

console.log("NEON + SQLITE STORAGE CONTRACT PASSED");
