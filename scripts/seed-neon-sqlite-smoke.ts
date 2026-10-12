import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { pgDb, pgSchema } from "../server/db-postgres";
import { runPostgresMigration } from "../server/migrate-postgres";

async function main() {
  if (process.env.CI_STORAGE_SMOKE !== "1") {
    throw new Error("This fixture may only run in the isolated CI storage smoke test.");
  }
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("CI smoke DATABASE_URL is required.");
  const url = new URL(rawUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/audit") {
    throw new Error("Refusing to seed anything except the isolated local audit database.");
  }

  await runPostgresMigration();
  const keyHex = process.env.ENCRYPTION_KEY ?? "";
  assert.match(keyHex, /^[0-9a-fA-F]{64}$/, "CI encryption key must be 32-byte hex");
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = "AUDIT-ONLY-NOT-A-REAL-DERIV-TOKEN";
  const ciphertext = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
  const encryptedToken = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext}`;

  const userId = "audit-neon-user-0000000000000000";
  const tokenId = "audit-neon-token-000000000000000";
  const configId = "audit-neon-config-00000000000000";
  const moduleConfigId = "audit-neon-module-000000000000";

  await pgDb.insert(pgSchema.users).values({
    id: userId,
    email: "audit-neon-sqlite@example.invalid",
    passwordHash: "audit-only-not-a-real-password-hash",
    nomeCompleto: "CI Storage Fixture",
    cpf: "999.999.999-99",
    telefone: "11999999999",
    endereco: "CI-only",
    cidade: "Araras",
    estado: "SP",
    cep: "00000-000",
    chavePix: "audit-neon-sqlite@example.invalid",
    tipoChavePix: "email",
    contaAprovada: false,
    isAdmin: false,
  }).onConflictDoNothing();

  await pgDb.insert(pgSchema.derivTokens).values({
    id: tokenId,
    userId,
    token: encryptedToken,
    accountType: "demo",
    isActive: false,
    isPrimary: true,
    slotIndex: null,
  }).onConflictDoNothing();

  await pgDb.insert(pgSchema.tradeConfigurations).values({
    id: configId,
    userId,
    mode: "audit-only",
    isActive: true,
    operationsCount: 0,
    intervalType: "ticks",
    intervalValue: 1,
    selectedModalities: '["digit_differs"]',
    fixedStake: 0.35,
  }).onConflictDoNothing();

  await pgDb.insert(pgSchema.modalityModuleConfigs).values({
    id: moduleConfigId,
    userId,
    modality: "digit_differs",
    slotConfigs: '[{"slotIndex":0,"enabled":false}]',
  }).onConflictDoNothing();

  console.log("CI-only Neon fixture seeded for restore verification; token plaintext was not logged.");
  await (pgDb as any).$client.end({ timeout: 5 });
}

main().catch(async (error) => {
  console.error("CI Neon fixture setup failed:", error?.message || String(error));
  try { await (pgDb as any)?.$client?.end({ timeout: 1 }); } catch {}
  process.exitCode = 1;
});
