import express from "express";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { users, documentos } from "@shared/schema";
import { isAuthenticated } from "../auth";
import { whatsappService } from "../whatsappService";
import multer from "multer";
import path from "path";
import crypto from "crypto";

// Extend session type
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/documents/');
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    
    // Sanitizar tipo para prevenir path traversal
    const sanitizedTipo = (req.body.tipo || 'documento')
      .replace(/[^a-z0-9-_]/gi, '')
      .substring(0, 20);
    
    const userId = (req as any).session.passport?.user || 'unknown';
    const sanitizedUserId = userId.replace(/[^a-z0-9-_]/gi, '').substring(0, 20);
    
    cb(null, `${sanitizedUserId}-${sanitizedTipo}-${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Criar erro específico para tipo de arquivo
      const error = new Error('Tipo de arquivo não permitido. Use apenas JPEG, PNG ou PDF.') as any;
      error.code = 'INVALID_FILE_TYPE';
      error.statusCode = 400;
      cb(error);
    }
  }
});

// Get KYC status for current user
router.get('/status', isAuthenticated, async (req, res) => {
  try {
    const userId = (req as any).session.passport?.user;

    // Get user documents
    const userDocuments = await db
      .select()
      .from(documentos)
      .where(eq(documentos.userId, userId))
      .orderBy(desc(documentos.createdAt));

    // Get user info
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const kycStatus = {
      verified: user[0]?.documentosVerificados || false,
      verifiedAt: user[0]?.documentosAprovadosEm,
      documents: userDocuments.map(doc => ({
        id: doc.id,
        tipo: doc.tipo,
        status: doc.status,
        motivoRejeicao: doc.motivoRejeicao,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }))
    };

    res.json(kycStatus);
  } catch (error) {
    console.error('Error getting KYC status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Upload document
router.post('/upload', isAuthenticated, (req, res, next) => {
  upload.single('documento')(req, res, (err) => {
    if (err) {
      // Tratar erros específicos do multer
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          message: 'Arquivo muito grande. O tamanho máximo permitido é 5MB.' 
        });
      }
      
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ 
          message: err.message 
        });
      }
      
      // Outros erros do multer
      if (err.code && err.code.startsWith('LIMIT_')) {
        return res.status(400).json({ 
          message: 'Erro no upload do arquivo. Verifique o tipo e tamanho do arquivo.' 
        });
      }
      
      // Erro genérico
      console.error('Erro no upload de arquivo:', err);
      return res.status(500).json({ 
        message: 'Erro interno no upload do arquivo.' 
      });
    }
    
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }

    const { tipo } = req.body;
    const userId = (req as any).session.passport?.user;

    if (!userId) {
      // Limpar arquivo se usuário não autenticado
      try {
        const fs = await import('fs');
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up file after auth failure:', cleanupError);
      }
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    // Validate document type
    const allowedTypes = ['rg', 'cnh', 'comprovante'];
    if (!allowedTypes.includes(tipo)) {
      // Limpar arquivo se tipo inválido
      try {
        const fs = await import('fs');
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up file after type validation:', cleanupError);
      }
      return res.status(400).json({ message: 'Tipo de documento inválido' });
    }

    // Check if user already has a pending/approved document of this type
    const existingDoc = await db
      .select()
      .from(documentos)
      .where(and(eq(documentos.userId, userId), eq(documentos.tipo, tipo)))
      .limit(1);

    // If exists and is approved, don't allow reupload
    if (existingDoc.length > 0 && existingDoc[0].status === 'aprovado') {
      return res.status(400).json({ 
        message: 'Este documento já foi aprovado. Entre em contato com o suporte se necessário.' 
      });
    }

    let documentResult;

    // Se existe documento, atualizar; senão, criar novo (lógica upsert)
    if (existingDoc.length > 0) {
      // Deletar arquivo antigo antes de atualizar
      try {
        const fs = await import('fs');
        if (fs.existsSync(existingDoc[0].arquivo)) {
          fs.unlinkSync(existingDoc[0].arquivo);
        }
      } catch (fileError) {
        console.error('Error deleting old file:', fileError);
      }

      // Atualizar documento existente
      await db
        .update(documentos)
        .set({
          arquivo: req.file.path,
          status: 'pendente',
          motivoRejeicao: null,
          aprovadoPor: null,
          aprovadoEm: null,
          updatedAt: new Date().toISOString()
        })
        .where(eq(documentos.id, existingDoc[0].id));

      documentResult = existingDoc[0];
    } else {
      // Criar novo documento
      const newDocument = {
        userId,
        tipo,
        arquivo: req.file.path,
        status: 'pendente' as const
      };

      const [createdDoc] = await db
        .insert(documentos)
        .values(newDocument)
        .returning();

      documentResult = createdDoc;
    }

    // Buscar dados do usuário para notificação WhatsApp
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (user.length > 0) {
        // Enviar notificação WhatsApp para o administrador sobre documento enviado
        try {
          await whatsappService.sendDocumentUploadNotification(user[0], tipo);
        } catch (whatsappError) {
          console.error('⚠️ Erro ao enviar notificação WhatsApp (documento enviado):', whatsappError);
          // Não falha o upload se a notificação WhatsApp falhar
        }
      }
    } catch (userError) {
      console.error('⚠️ Erro ao buscar dados do usuário para notificação WhatsApp:', userError);
    }

    res.json({
      message: 'Documento enviado com sucesso! Aguarde a análise.',
      document: {
        id: documentResult.id,
        tipo: documentResult.tipo,
        status: 'pendente'
      }
    });

  } catch (error) {
    console.error('Error uploading document:', error);
    
    // Clean up uploaded file if there was an error
    if (req.file) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    res.status(500).json({ message: 'Erro ao enviar documento' });
  }
});

// Get document file (for viewing)
router.get('/document/:documentId', isAuthenticated, async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = (req as any).session.passport?.user;

    // Get document
    const document = await db
      .select()
      .from(documentos)
      .where(eq(documentos.id, documentId))
      .limit(1);

    if (document.length === 0) {
      return res.status(404).json({ message: 'Documento não encontrado' });
    }

    // Check if user owns this document or is admin
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const adminEmail = process.env.ADMIN_EMAIL || 'vfdiogoseg@gmail.com';
    const isAdmin = user[0]?.email === adminEmail;
    const isOwner = document[0].userId === userId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    // Serve file
    const filePath = document[0].arquivo;
    
    try {
      const fs = await import('fs');
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Arquivo não encontrado' });
      }

      res.sendFile(path.resolve(filePath));
    } catch (fileError) {
      console.error('Error serving file:', fileError);
      res.status(500).json({ message: 'Erro ao acessar arquivo' });
    }

  } catch (error) {
    console.error('Error getting document:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

export default router;