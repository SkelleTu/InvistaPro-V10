import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const storage = read("server/storage-dual.ts");
const migration = read("server/migrate-postgres.ts");
const restore = read("server/neon-sqlite-sync.ts");
const boot = read("server/index.ts");

assert.match(storage, /private async writeEssential/);
assert.match(storage, /NEON_REQUIRED/);
assert.match(storage, /this\.turso = null/);
assert.doesNotMatch(storage, /storage-turso/);
assert.match(storage, /async createAiLog\(log: InsertAiLog\)\s+\{ return this\.sqlite\.createAiLog\(log\); \}/);
assert.match(storage, /async upsertMarketData\(data: InsertMarketData\) \{ return this\.sqlite\.upsertMarketData\(data\); \}/);

assert.match(migration, /invista_database_identity/);
assert.match(migration, /INVISTA_PLATFORM/);
assert.match(migration, /platform mismatch/);
assert.doesNotMatch(migration, /sqliteDb\.select\(\)\.from/);
assert.doesNotMatch(migration, /SINCRONIZAR USUÁRIOS DO SQLITE/i);

assert.match(restore, /pgSchema\.users/);
assert.match(restore, /pgSchema\.derivTokens/);
assert.match(restore, /pgSchema\.tradeConfigurations/);
assert.match(restore, /pgSchema\.modalityModuleConfigs/);
assert.doesNotMatch(restore, /pgSchema\.(tradeOperations|marketData|aiLogs)/);

assert.match(boot, /restoreEssentialDataToSqlite/);
assert.match(boot, /if \(!persistenceReady/);
assert.match(boot, /persistenceReady = true/);

console.log("NEON + SQLITE STORAGE CONTRACT PASSED");
