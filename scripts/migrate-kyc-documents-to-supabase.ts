import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { pgDb, pgSchema, isPostgresAvailable } from "../server/db-postgres";
import {
  deletePrivateDocument,
  readPrivateDocument,
  storePrivateDocument,
} from "../server/services/private-document-storage";

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function legacyFilePath(reference: string, root: string): string | null {
  if (reference.startsWith("supabase://")) return null;
  const raw = reference.startsWith("local://") ? reference.slice("local://".length) : reference;
  const resolved = path.resolve(raw);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("LEGACY_DOCUMENT_PATH_OUTSIDE_UPLOAD_DIRECTORY");
  }
  return resolved;
}

function mimeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".pdf") return "application/pdf";
  throw new Error("LEGACY_DOCUMENT_FORMAT_UNSUPPORTED");
}

async function main() {
  if (!isPostgresAvailable || !pgDb) throw new Error("DATABASE_URL PostgreSQL/Neon não está disponível.");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente seguro antes da migração.");
  }

  const root = path.resolve(process.env.DOCUMENT_UPLOAD_DIR || path.join(process.cwd(), "uploads", "documents"));
  const documents = await pgDb.select().from(pgSchema.documentos);
  let migrated = 0;
  let alreadyMigrated = 0;
  let missing = 0;

  for (const document of documents as any[]) {
    const reference = String(document.arquivo || "");
    if (reference.startsWith("supabase://")) {
      alreadyMigrated++;
      continue;
    }

    const filePath = legacyFilePath(reference, root);
    if (!filePath || !existsSync(filePath)) {
      console.error("[KYC MIGRATION] Arquivo legado não encontrado; registro preservado:", document.id);
      missing++;
      continue;
    }

    const original = await readFile(filePath);
    const originalHash = hash(original);
    const objectReference = await storePrivateDocument(document.userId, {
      buffer: original,
      mimetype: mimeForPath(filePath),
      originalname: path.basename(filePath),
    });

    try {
      const verified = await readPrivateDocument(objectReference);
      if (hash(verified.buffer) !== originalHash) {
        throw new Error("KYC_OBJECT_VERIFICATION_FAILED: hash do arquivo enviado não confere.");
      }
      await pgDb.update(pgSchema.documentos)
        .set({ arquivo: objectReference, updatedAt: new Date() })
        .where(eq(pgSchema.documentos.id, document.id));
      migrated++;
      console.info("[KYC MIGRATION] Documento migrado e verificado:", document.id);
    } catch (error) {
      await deletePrivateDocument(objectReference).catch(() => {});
      throw error;
    }
  }

  console.info("[KYC MIGRATION] Resumo:", { migrated, alreadyMigrated, missing });
  if (missing > 0) {
    throw new Error("KYC_MIGRATION_INCOMPLETE: alguns arquivos locais não foram encontrados; não apague a cópia original até resolver os itens ausentes.");
  }
}

main().catch(error => {
  console.error("[KYC MIGRATION] Falha:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
