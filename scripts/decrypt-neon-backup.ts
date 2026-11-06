import { createHash, createDecipheriv } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const input = String(process.env.ENCRYPTED_BACKUP_PATH || "");
  const output = String(process.env.RESTORED_DUMP_PATH || "");
  const keyHex = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  const expectedHash = String(process.env.EXPECTED_PLAINTEXT_SHA256 || "").trim().toLowerCase();
  if (!input || !output || !/^[0-9a-fA-F]{64}$/.test(keyHex) || !/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new Error("Set ENCRYPTED_BACKUP_PATH, RESTORED_DUMP_PATH, BACKUP_ENCRYPTION_KEY and EXPECTED_PLAINTEXT_SHA256.");
  }
  const payload = await readFile(input);
  if (payload.subarray(0, 5).toString("ascii") !== "IPBK1" || payload.length < 33) throw new Error("BACKUP_FORMAT_INVALID");
  const iv = payload.subarray(5, 17);
  const tag = payload.subarray(17, 33);
  const ciphertext = payload.subarray(33);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  decipher.setAuthTag(tag);
  const dump = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const actualHash = createHash("sha256").update(dump).digest("hex");
  if (actualHash !== expectedHash) throw new Error("BACKUP_HASH_MISMATCH");
  await writeFile(output, dump, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: "decrypted_and_verified", output, bytes: dump.length, sha256: actualHash }));
}

main().catch(error => {
  console.error("InvistaPRO backup decryption failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
