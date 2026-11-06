import { dualStorage } from "../storage-dual";
import {
  deletePrivateDocument,
  storePrivateDocument,
} from "./private-document-storage";

const ALLOWED_DOCUMENT_TYPES = new Set(["cpf", "rg", "cnh", "comprovante"]);

export async function saveKycDocument(
  userId: string,
  type: string,
  file: { buffer: Buffer; mimetype: string; originalname: string }
) {
  if (!userId) throw new Error("KYC_USER_REQUIRED");
  const normalizedType = String(type || "").trim().toLowerCase();
  if (!ALLOWED_DOCUMENT_TYPES.has(normalizedType)) throw new Error("KYC_DOCUMENT_TYPE_INVALID");

  const existingDocuments = await dualStorage.getUserDocumentos(userId);
  const existing = existingDocuments.find(document => document.tipo === normalizedType);
  if (existing?.status === "aprovado") throw new Error("KYC_DOCUMENT_ALREADY_APPROVED");

  const newReference = await storePrivateDocument(userId, file);
  try {
    let saved;
    if (existing) {
      saved = await dualStorage.updateDocumento(existing.id, {
        arquivo: newReference,
        status: "pendente",
        motivoRejeicao: null,
        aprovadoPor: null,
        aprovadoEm: null,
        updatedAt: new Date().toISOString(),
      } as any);
    } else {
      saved = await dualStorage.createDocumento({
        userId,
        tipo: normalizedType,
        arquivo: newReference,
        status: "pendente",
      });
    }

    if (existing?.arquivo && existing.arquivo !== newReference) {
      await deletePrivateDocument(existing.arquivo).catch(error =>
        console.error("Could not remove replaced KYC object:", error)
      );
    }
    return saved;
  } catch (error) {
    await deletePrivateDocument(newReference).catch(cleanupError =>
      console.error("KYC upload cleanup failed:", cleanupError)
    );
    throw error;
  }
}
