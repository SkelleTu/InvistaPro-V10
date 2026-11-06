import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");
const workflow = read(".github/workflows/neon-encrypted-backup.yml");
const backup = read("scripts/backup-neon-to-supabase.ts");
const restore = read("scripts/decrypt-neon-backup.ts");
const docs = read("docs/NEON_BACKUP_AND_RESTORE.md");
assert.match(workflow, /schedule:/);
assert.match(workflow, /workflow_dispatch/);
assert.match(workflow, /pg_dump .*--format=custom/);
for (const secret of ["DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","BACKUP_ENCRYPTION_KEY"]) {
  assert.match(workflow, new RegExp(`secrets\\.${secret}`));
}
assert.match(backup, /aes-256-gcm/);
assert.match(backup, /createBucket\(bucket,\s*\{\s*public: false/);
assert.match(backup, /plaintextSha256/);
assert.match(backup, /encryptedSha256/);
assert.match(restore, /createDecipheriv\("aes-256-gcm"/);
assert.match(restore, /BACKUP_HASH_MISMATCH/);
assert.match(docs, /Settings → Secrets and variables → Actions/);
assert.match(docs, /nova branch\/banco Neon isolado/);
console.log("✓ encrypted backup policy: scheduled dump, private storage, authenticated encryption and restore hash verification");
