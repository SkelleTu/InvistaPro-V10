import express from "express";
import multer from "multer";
import { isAuthenticated } from "../auth";
import { dualStorage } from "../storage-dual";
import { whatsappService } from "../whatsappService";
import { readPrivateDocument } from "../services/private-document-storage";
import { saveKycDocument } from "../services/kyc-document-service";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else {
      const error = new Error("Tipo de arquivo não permitido. Use apenas JPEG, PNG ou PDF.") as any;
      error.code = "INVALID_FILE_TYPE";
      error.statusCode = 400;
      cb(error);
    }
  },
});

function isAdministrativeUser(user: any): boolean {
  const allowedEmails = [
    process.env.ADMIN_EMAIL,
    process.env.MASTER_EMAIL,
    process.env.INVISTA_MASTER_EMAIL,
    process.env.INVISTAPRO_ACCOUNT_EMAIL,
  ].map(value => String(value || "").trim().toLowerCase()).filter(Boolean);
  return Boolean(user?.isAdmin) || allowedEmails.includes(String(user?.email || "").trim().toLowerCase());
}

router.get("/status", isAuthenticated, async (req: any, res) => {
  try {
    const userId = String(req.user?.id || req.session?.passport?.user || "");
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });
    const [user, userDocuments] = await Promise.all([
      dualStorage.getUser(userId),
      dualStorage.getUserDocumentos(userId),
    ]);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({
      verified: Boolean(user?.documentosVerificados),
      verifiedAt: user?.documentosAprovadosEm ?? null,
      documents: userDocuments.map(document => ({
        id: document.id,
        tipo: document.tipo,
        status: document.status,
        motivoRejeicao: document.motivoRejeicao,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Error getting KYC status:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
});

router.post("/upload", isAuthenticated, (req, res, next) => {
  upload.single("documento")(req, res, (error: any) => {
    if (error) {
      if (error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "O arquivo deve ter no máximo 5 MB." });
      if (error.code === "INVALID_FILE_TYPE") return res.status(400).json({ message: error.message });
      console.error("KYC Multer error:", error);
      return res.status(400).json({ message: "Não foi possível receber o arquivo." });
    }
    next();
  });
}, async (req: any, res) => {
  try {
    const userId = String(req.user?.id || req.session?.passport?.user || "");
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });
    if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado." });

    const tipo = String(req.body?.tipo || "").trim().toLowerCase();
    if (!["rg", "cnh", "comprovante"].includes(tipo)) {
      return res.status(400).json({ message: "Tipo de documento inválido." });
    }

    const user = await dualStorage.getUser(userId);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    let documentResult;
    try {
      documentResult = await saveKycDocument(userId, tipo, req.file);
    } catch (uploadError) {
      const uploadMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
      if (uploadMessage === "KYC_DOCUMENT_ALREADY_APPROVED") {
        return res.status(409).json({ message: "Este documento já foi aprovado. Entre em contato com o suporte se precisar alterá-lo." });
      }
      if (uploadMessage === "KYC_DOCUMENT_TYPE_INVALID") {
        return res.status(400).json({ message: "Tipo de documento inválido." });
      }
      throw uploadError;
    }

    try {
      await whatsappService.sendDocumentUploadNotification(user, tipo);
    } catch (notificationError) {
      console.error("KYC notification failed; document upload remains successful:", notificationError);
    }

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({
      message: "Documento enviado com sucesso! Aguarde a análise.",
      document: { id: documentResult.id, tipo: documentResult.tipo, status: "pendente" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error uploading KYC document:", message);
    if (message.includes("DOCUMENT_CONTENT_TYPE_MISMATCH")) {
      return res.status(400).json({ message: "O conteúdo não corresponde a um JPEG, PNG ou PDF válido." });
    }
    if (message.includes("PRIVATE_DOCUMENT_STORAGE_NOT_CONFIGURED")) {
      return res.status(503).json({ code: "PRIVATE_DOCUMENT_STORAGE_NOT_CONFIGURED", message: "O armazenamento privado de documentos ainda não foi configurado." });
    }
    return res.status(500).json({ message: "Erro ao enviar documento." });
  }
});

router.get("/document/:documentId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = String(req.user?.id || req.session?.passport?.user || "");
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });
    const document = await dualStorage.getDocumento(String(req.params.documentId || ""));
    if (!document) return res.status(404).json({ message: "Documento não encontrado." });

    const user = await dualStorage.getUser(userId);
    const isOwner = document.userId === userId;
    if (!isOwner && !isAdministrativeUser(user)) {
      return res.status(403).json({ message: "Acesso negado." });
    }

    const storedFile = await readPrivateDocument(String(document.arquivo));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", storedFile.contentType);
    res.setHeader("Content-Length", String(storedFile.buffer.length));
    return res.status(200).send(storedFile.buffer);
  } catch (error) {
    console.error("Error getting KYC document:", error);
    return res.status(404).json({ message: "Arquivo do documento indisponível." });
  }
});

export default router;
