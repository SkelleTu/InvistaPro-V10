import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`BACKUP_CONFIG_MISSING:${name}`);
  return value;
}

async function main() {
  const dumpPath = required("BACKUP_DUMP_PATH");
  const supabaseUrl = required("SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const encryptionKeyHex = required("BACKUP_ENCRYPTION_KEY");
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) throw new Error("BACKUP_ENCRYPTION_KEY_MUST_BE_32_BYTE_HEX");

  const dump = await readFile(dumpPath);
  if (!dump.length) throw new Error("BACKUP_DUMP_EMPTY");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKeyHex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(dump), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encrypted = Buffer.concat([Buffer.from("IPBK1", "ascii"), iv, authTag, ciphertext]);
  const sha256 = createHash("sha256").update(dump).digest("hex");
  const encryptedSha256 = createHash("sha256").update(encrypted).digest("hex");
  const generatedAt = new Date();
  const date = generatedAt.toISOString().slice(0, 10);
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  const bucket = String(process.env.BACKUP_BUCKET || "invistapro-database-backups").trim();
  const objectPath = `daily/${date}/invistapro-${timestamp}.dump.enc`;
  const manifestPath = `${objectPath}.manifest.json`;
  const databaseHost = (() => { try { return new URL(required("DATABASE_URL")).hostname; } catch { return "unknown"; } })();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const buckets = await supabase.storage.listBuckets();
  if (buckets.error) throw buckets.error;
  const existingBucket = buckets.data.find(item => item.name === bucket);
  if (existingBucket?.public) throw new Error("BACKUP_BUCKET_MUST_BE_PRIVATE");
  if (!existingBucket) {
    const created = await supabase.storage.createBucket(bucket, {
      public: false, fileSizeLimit: "500MB",
      allowedMimeTypes: ["application/octet-stream", "application/json"],
    });
    if (created.error) throw created.error;
  }
  const uploaded = await supabase.storage.from(bucket).upload(objectPath, encrypted, {
    contentType: "application/octet-stream", cacheControl: "0", upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const manifest = {
    platform: "InvistaPRO V10", generatedAt: generatedAt.toISOString(),
    databaseHost, format: "pg_dump custom", encryption: "AES-256-GCM",
    plaintextBytes: dump.length, encryptedBytes: encrypted.length,
    plaintextSha256: sha256, encryptedSha256, objectPath,
    restoreNote: "Download encrypted object, decrypt with BACKUP_ENCRYPTION_KEY, then restore with pg_restore. Verify both hashes before restore.",
  };
  const manifestUpload = await supabase.storage.from(bucket).upload(
    manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)), {
      contentType: "application/json", cacheControl: "0", upsert: false,
    },
  );
  if (manifestUpload.error) {
    await supabase.storage.from(bucket).remove([objectPath]).catch(() => {});
    throw manifestUpload.error;
  }
  console.log(JSON.stringify({
    status: "backup_uploaded", bucket, objectPath, manifestPath,
    encryptedBytes: encrypted.length, encryptedSha256,
  }));
}

main().catch(error => {
  console.error("InvistaPRO encrypted database backup failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
