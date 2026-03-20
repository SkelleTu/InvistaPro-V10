import type { Express } from "express";
import { createServer, type Server } from "http";
import { dualStorage as dbStorage } from "./storage-dual";
import { setupAuth, isAuthenticated, isApproved, hashPassword, comparePasswords, generateVerificationCode } from "./auth";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { registerUserSchema, loginSchema, phoneVerificationSchema, insertMovimentoSchema, updateUserSchema, uploadDocumentSchema, withdrawalRequestSchema, users, movimentos, documentos } from "@shared/schema";
import { notificationService } from "./notifications";
// import { internalEmailService } from "./internalEmailService"; // Sistema removido
import { autonomousEmailService } from "./autonomousEmailService";
import { sendPasswordResetWithNodemailer } from './nodemailerService';
import { sendPasswordResetEmail } from "./sendgridService";
import { whatsappService } from "./whatsappService";
import { marketingManager, addUserToMarketing, removeUserFromMarketing } from './marketingEmailService';
import { validateUserData, ValidationError } from "./validators";
import passport from "passport";
import QRCode from "qrcode";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import kycRoutes from "./routes/kyc";
import adminRoutes from "./routes/admin";
import monitorRoutes from "./routes/monitor-routes";
import learningRoutes from "./routes/learning-routes";
import metaTraderRoutes from "./routes/metatrader-routes";
import fetch from "node-fetch";
import express from "express";
import { keepAliveSystem } from "./services/keep-alive-system";
import { marketDataCollector } from "./services/market-data-collector";
import { 
  derivTokenConfigSchema, 
  tradeModeConfigSchema, 
  manualTradeSchema,
  type DerivToken,
  type TradeConfiguration,
  type TradeOperation,
  type AiLog,
  blockedAssets
} from "@shared/schema";
import { and } from "drizzle-orm";
import { derivAPI, DerivAPIService } from './services/deriv-api';
import { huggingFaceAI } from './services/huggingface-ai';
import { autoTradingScheduler } from './services/auto-trading-scheduler';
import { realStatsTracker } from './services/real-stats-tracker';
import { isAuthorizedEmail, ACCESS_DENIED_MESSAGE } from './config/access';
import { errorTracker } from './services/error-tracker';
import { contractMonitor } from './services/contract-monitor';
import { asyncErrorHandler } from './middleware/error-handler';
import { tpmSystem } from './services/tpm-system';
import { getRegistryInfo } from './services/url-registry';

// PIX payload generator compatível com Santander
function generatePixPayload(data: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount: number;
  transactionId: string;
}): string {
  const { pixKey, merchantName, merchantCity, amount, transactionId } = data;
  
  // Formatação correta EMV para compatibilidade bancária
  const formattedAmount = amount.toFixed(2);
  
  // Construir seção 26 (Merchant Account Information) corretamente
  const pixKeyField = "01" + pixKey.length.toString().padStart(2, '0') + pixKey;
  const merchantAccountInfo = "26" + (14 + pixKeyField.length).toString().padStart(2, '0') + "0014br.gov.bcb.pix" + pixKeyField;
  
  // Construir seção 62 (Additional Data Field Template) corretamente
  const txIdField = "05" + transactionId.length.toString().padStart(2, '0') + transactionId;
  const additionalData = "62" + txIdField.length.toString().padStart(2, '0') + txIdField;
  
  const payload = [
    "000201", // Payload Format Indicator
    "010212", // Point of Initiation Method (12 = Static)
    merchantAccountInfo, // Merchant Account Information
    "52040000", // Merchant Category Code (0000 = não especificado)
    "5303986", // Transaction Currency (986 = BRL)
    "54" + formattedAmount.length.toString().padStart(2, '0') + formattedAmount, // Transaction Amount
    "5802BR", // Country Code
    "59" + merchantName.length.toString().padStart(2, '0') + merchantName, // Merchant Name
    "60" + merchantCity.length.toString().padStart(2, '0') + merchantCity, // Merchant City
    additionalData, // Additional Data
    "6304" // CRC placeholder
  ].join('');
  
  // Calcular CRC16 CCITT
  const crc = calculateCRC16(payload);
  return payload + crc.toUpperCase();
}

// CRC16 CCITT para PIX (padrão bancário brasileiro)
function calculateCRC16(data: string): string {
  let crc = 0xFFFF;
  
  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) << 8) & 0xFF00;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  
  return crc.toString(16).padStart(4, '0').toUpperCase();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // API de Trading
  app.get("/api/trading/assets", isAuthenticated, async (req, res) => {
    const { mode } = req.query;

    console.log(`🔍 [API] Buscando ativos para o modo: ${mode}`);

    try {
      // Usar conexão autenticada se disponível, senão pública
      if (!derivAPI.getIsConnected()) {
        await derivAPI.connectPublic('FETCH_ASSETS_API');
      }
      
      const assets = await derivAPI.getAvailableSymbolsByTradeMode(String(mode || "digit_diff"));
      console.log(`✅ [API] Retornados ${assets?.length || 0} ativos para o modo ${mode}`);
      
      // Cache-Control: no-cache para evitar que o frontend pegue dados antigos
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json(assets || []);
    } catch (error) {
      console.error("❌ Erro ao buscar ativos:", error);
      res.status(500).json({ error: "Erro ao buscar ativos da Deriv" });
    }
  });

  app.get("/api/trading/blocked-assets", isAuthenticated, async (req, res) => {
    const userId = (req.user as any).id;
    const { mode } = req.query;

    const blocked = await db
      .select()
      .from(blockedAssets)
      .where(
        and(
          eq(blockedAssets.userId, userId),
          eq(blockedAssets.tradeMode, String(mode || "digit_diff"))
        )
      );

    res.json(blocked.map(b => b.symbol));
  });

  app.post("/api/trading/block-assets", isAuthenticated, async (req, res) => {
    const { tradeMode, symbols } = req.body;
    const userId = (req.user as any).id;

    console.log(`🚫 [API] Bloqueando ativos para usuário ${userId}, modo ${tradeMode}:`, symbols);

    if (!tradeMode || !Array.isArray(symbols)) {
      return res.status(400).json({ error: "Dados inválidos" });
    }

    try {
      // Usar transação para garantir atomicidade
      await db.transaction(async (tx) => {
        // Remove bloqueios antigos da modalidade
        await tx.delete(blockedAssets)
          .where(
            and(
              eq(blockedAssets.userId, userId),
              eq(blockedAssets.tradeMode, tradeMode)
            )
          );

        // Insere novos bloqueios se houver
        if (symbols.length > 0) {
          for (const symbol of symbols) {
            await tx.insert(blockedAssets).values({
              userId,
              tradeMode,
              symbol
            });
          }
        }
      });

      console.log(`✅ [API] Bloqueio atualizado com sucesso para ${symbols.length} ativos`);
      res.json({ success: true, count: symbols.length });
    } catch (error) {
      console.error("❌ Erro ao atualizar bloqueio de ativos:", error);
      res.status(500).json({ error: "Erro ao salvar bloqueio de ativos" });
    }
  });

  // Setup authentication
  setupAuth(app);

  // Servir arquivos estáticos (incluindo logo para emails)
  app.use('/public', express.static(path.join(process.cwd(), 'server/public')));

  // Servir downloads (EA do MT5, etc.)
  app.use('/downloads', express.static(path.join(process.cwd(), 'public/downloads')));

  // =========================== KEEP-ALIVE SYSTEM 24/7 ===========================
  
  // Iniciar sistema de keep-alive
  keepAliveSystem.start();

  // Endpoint de ping simples (para serviços externos como cron-job.org, UptimeRobot)
  app.get('/api/ping', (req, res) => {
    const source = req.headers['x-ping-from'] as string || req.query.source as string || 'external';
    const result = keepAliveSystem.receivePing(source);
    res.json({
      pong: true,
      timestamp: new Date().toISOString(),
      source,
      ...result.status
    });
  });

  // Endpoint de ping via POST (para Vercel e outros serviços)
  app.post('/api/ping', (req, res) => {
    const source = req.headers['x-ping-from'] as string || req.body?.source || 'vercel';
    const result = keepAliveSystem.receivePing(source);
    res.json({
      pong: true,
      timestamp: new Date().toISOString(),
      source,
      ...result.status
    });
  });

  // Endpoint de status completo do sistema
  app.get('/api/status', (req, res) => {
    const status = keepAliveSystem.getStatus();
    res.json({
      status: 'online',
      server: 'replit',
      ...status,
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
      }
    });
  });

  // Endpoint para configurar URL do Vercel
  app.post('/api/keepalive/config', (req, res) => {
    const { vercelUrl } = req.body;
    if (vercelUrl) {
      keepAliveSystem.setVercelUrl(vercelUrl);
      res.json({ success: true, message: 'Vercel URL configurada', vercelUrl });
    } else {
      res.status(400).json({ success: false, message: 'vercelUrl é obrigatório' });
    }
  });

  // Endpoint de health check (compatível com uptime monitors)
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // =========================== END KEEP-ALIVE SYSTEM ===========================

  // Endpoint temporário para criar conta de administrador
  app.post('/api/setup-admin', async (req, res) => {
    try {
      const { email, password, nomeCompleto } = req.body;

      // Verificar se já existe um usuário administrador
      const existingAdmin = await dbStorage.getUserByEmail(email);
      if (existingAdmin) {
        // Se já existe, atualizar privilégios
        await db
          .update(users)
          .set({
            isAdmin: true,
            contaAprovada: true,
            telefoneVerificado: true,
            documentosVerificados: true,
            updatedAt: new Date().toISOString()
          })
          .where(eq(users.id, existingAdmin.id));
        
        return res.json({
          success: true,
          message: 'Privilégios de administrador atualizados com sucesso!',
          user: {
            email: existingAdmin.email,
            nomeCompleto: existingAdmin.nomeCompleto,
            isAdmin: true
          }
        });
      }

      // Hash da senha
      const passwordHash = await hashPassword(password);

      // Criar usuário administrador
      const adminData = {
        email,
        passwordHash,
        nomeCompleto,
        cpf: '00000000000', // CPF temporário para admin
        telefone: '11999999999', // Telefone temporário para admin
        endereco: 'Endereço Administrativo',
        cidade: 'São Paulo',
        estado: 'SP',
        cep: '01000000',
        chavePix: email,
        tipoChavePix: 'email',
        telefoneVerificado: true,
        contaAprovada: true,
        isAdmin: true,
        documentosVerificados: true,
        saldo: 0.00,
      };

      const newAdmin = await dbStorage.createUser(adminData);

      console.log('✅ Conta de administrador criada:', newAdmin.email);

      res.json({
        success: true,
        message: 'Conta de administrador criada com sucesso!',
        user: {
          email: newAdmin.email,
          nomeCompleto: newAdmin.nomeCompleto,
          isAdmin: true
        }
      });
    } catch (error) {
      console.error('❌ Erro ao criar administrador:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao criar conta de administrador',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });

  // Endpoint temporário para alterar senha
  app.post('/api/change-password-admin', async (req, res) => {
    try {
      const { email, newPassword } = req.body;

      if (!email || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Email e nova senha são obrigatórios'
        });
      }

      // Buscar usuário
      const user = await dbStorage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Usuário não encontrado'
        });
      }

      // Hash da nova senha
      const passwordHash = await hashPassword(newPassword);

      // Atualizar senha
      await db
        .update(users)
        .set({
          passwordHash,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, user.id));

      console.log('✅ Senha atualizada para:', user.email);

      res.json({
        success: true,
        message: 'Senha atualizada com sucesso!',
        user: {
          email: user.email,
          nomeCompleto: user.nomeCompleto
        }
      });
    } catch (error) {
      console.error('❌ Erro ao alterar senha:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao alterar senha',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });

  // Endpoint temporário para verificar status de conta
  app.post('/api/check-account-status', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email é obrigatório'
        });
      }

      const user = await dbStorage.getUserByEmail(email);
      
      if (!user) {
        return res.json({
          success: false,
          exists: false,
          message: 'Conta não encontrada no sistema'
        });
      }

      return res.json({
        success: true,
        exists: true,
        accountStatus: {
          email: user.email,
          nomeCompleto: user.nomeCompleto,
          contaAprovada: user.contaAprovada,
          telefoneVerificado: user.telefoneVerificado,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt
        }
      });
    } catch (error) {
      console.error('❌ Erro ao verificar conta:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao verificar conta',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });


  // Configure multer for file uploads
  const fileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/documents/')
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
  });

  const upload = multer({ 
    storage: fileStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Tipo de arquivo não permitido. Use JPEG, PNG ou PDF.'));
      }
    }
  });

  // Registration route
  app.post('/api/register', async (req, res) => {
    try {
      console.log('Registration request body:', req.body);
      const validatedData = registerUserSchema.parse(req.body);
      console.log('Validated data:', validatedData);
      
      // Perform real data validation
      const validation = await validateUserData(validatedData);
      if (!validation.valid) {
        return res.status(400).json({ 
          message: validation.errors[0],
          errors: validation.errors
        });
      }
      
      // Check if email or CPF already exists
      const existingEmail = await dbStorage.getUserByEmail(validatedData.email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email já cadastrado" });
      }

      const existingCpf = await dbStorage.getUserByCpf(validatedData.cpf);
      if (existingCpf) {
        return res.status(400).json({ message: "CPF já cadastrado" });
      }

      // Hash password
      const passwordHash = await hashPassword(validatedData.password);

      // Prepare user data - but DON'T save to database yet
      const userData = {
        ...validatedData,
        passwordHash,
        telefoneVerificado: true, // Auto-verify since we're removing verification requirement
        contaAprovada: true, // Auto-approve for easier testing/demo
      };
      
      // Remove password fields before inserting
      delete (userData as any).password;
      delete (userData as any).confirmPassword;

      // TRY to create user - this is wrapped in try/catch
      // If ANY error occurs, the user will NOT be saved to database
      let user;
      try {
        user = await dbStorage.createUser(userData);
        
        // CRITICAL: Verify user was actually created successfully
        const verifyUser = await dbStorage.getUserByEmail(validatedData.email);
        if (!verifyUser || !verifyUser.id) {
          throw new Error("Falha na verificação: usuário não foi salvo corretamente");
        }
        
        console.log("✅ Usuário criado com sucesso:", verifyUser.email, "ID:", verifyUser.id);
        
        // Adicionar automaticamente à lista de marketing
        try {
          addUserToMarketing(verifyUser.email);
          console.log(`📧 Email ${verifyUser.email} adicionado automaticamente ao marketing`);
        } catch (marketingError) {
          console.error('⚠️ Erro ao adicionar ao marketing:', marketingError);
          // Não falha o cadastro se o marketing falhar
        }
        
        // Enviar notificação WhatsApp para o administrador sobre novo usuário
        try {
          await whatsappService.sendNewUserNotification(verifyUser);
        } catch (whatsappError) {
          console.error('⚠️ Erro ao enviar notificação WhatsApp (usuário criado com sucesso):', whatsappError);
          // Não falha o cadastro se a notificação WhatsApp falhar
        }
        
        // Only respond with success if user was actually created AND verified
        res.status(201).json({ 
          message: "Conta criada com sucesso! Você já pode fazer login.",
          userId: user.id,
          needsEmailVerification: false
        });
      } catch (dbError: any) {
        console.error("❌ Erro durante criação do usuário:", dbError);
        
        // If user creation failed, try to clean up any partial data
        try {
          const existingUser = await dbStorage.getUserByEmail(validatedData.email);
          if (existingUser) {
            console.log("🧹 Limpando dados parciais do usuário:", validatedData.email);
            // Note: We would need a deleteUser method in storage for complete cleanup
          }
        } catch (cleanupError) {
          console.error("Erro na limpeza:", cleanupError);
        }
        
        // Throw error to be caught by outer catch block
        throw new Error("Erro ao criar conta no banco de dados - nenhum dado foi salvo");
      }
    } catch (error: any) {
      console.error("Registration error:", error);
      if (error.issues) {
        console.error("Validation issues:", error.issues);
        return res.status(400).json({ 
          message: error.issues[0].message,
          field: error.issues[0].path?.[0] || 'unknown',
          issues: error.issues 
        });
      }
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Login route
  app.post('/api/login', async (req, res, next) => {
    try {
      console.log('🔐 Tentativa de login:', { email: req.body.email });
      const validatedData = loginSchema.parse(req.body);
      
      passport.authenticate('local', (err: any, user: any, info: any) => {
        if (err) {
          console.error('❌ Erro no passport authenticate:', err);
          return res.status(500).json({ message: "Erro interno do servidor" });
        }
        
        if (!user) {
          console.log('🚫 Login falhado:', info?.message);
          return res.status(401).json({ message: info.message || "Credenciais inválidas" });
        }

        console.log('✅ Usuário autenticado, fazendo login:', user.email);

        req.logIn(user, (err) => {
          if (err) {
            console.error('❌ Erro no req.logIn:', err);
            return res.status(500).json({ message: "Erro ao fazer login" });
          }
          
          console.log('🎉 Login bem-sucedido para:', user.email);
          const { passwordHash, codigoVerificacao, ...userWithoutSensitiveData } = user;
          res.json({ 
            message: "Login realizado com sucesso",
            user: userWithoutSensitiveData
          });
        });
      })(req, res, next);
    } catch (error: any) {
      console.error('❌ Erro geral no login:', error);
      if (error.issues) {
        return res.status(400).json({ message: error.issues[0].message });
      }
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Password Recovery - Request reset
  app.post('/api/password-recovery/request', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email é obrigatório" });
      }

      // Find user by email
      const user = await dbStorage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if email exists or not for security
        return res.json({ 
          message: "Se o email estiver cadastrado, você receberá um link de recuperação.",
          success: true 
        });
      }

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Save token to database
      await db.update(users)
        .set({
          passwordResetToken: resetToken,
          passwordResetTokenExpiresAt: resetTokenExpiresAt.toISOString(),
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, user.id));

      // Generate reset URL
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;

      // Send email using autonomous email service
      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0a0a0a; color: #ffffff;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ffffff; margin-bottom: 10px;">InvistaPRO</h1>
            <p style="color: #999999; margin: 0;">Plataforma de Investimentos</p>
          </div>
          
          <div style="background-color: #1a1a1a; padding: 30px; border-radius: 8px; border: 1px solid #333333;">
            <h2 style="color: #ffffff; margin-bottom: 20px;">Recuperação de Senha</h2>
            
            <p style="color: #cccccc; margin-bottom: 20px;">
              Recebemos uma solicitação para redefinir a senha da sua conta InvistaPRO.
            </p>
            
            <p style="color: #cccccc; margin-bottom: 30px;">
              Clique no botão abaixo para criar uma nova senha:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Redefinir Senha
              </a>
            </div>
            
            <p style="color: #999999; font-size: 14px; margin-bottom: 10px;">
              Este link expira em 1 hora por segurança.
            </p>
            
            <p style="color: #999999; font-size: 14px; margin-bottom: 20px;">
              Se você não solicitou a recuperação de senha, ignore este email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #333333; margin: 30px 0;">
            
            <p style="color: #666666; font-size: 12px; text-align: center;">
              InvistaPRO - Invista com Risco Zero<br>
              Este é um email automático, não responda.
            </p>
          </div>
        </div>
      `;

      try {
        console.log('🚀 Tentando enviar email de recuperação para:', user.email);
        
        // 1º Tentativa: SendGrid
        let emailSent = await sendPasswordResetEmail(user.email, resetUrl);
        
        if (emailSent) {
          console.log('✅ Email de recuperação SendGrid enviado com sucesso!');
        } else {
          console.log('⚠️ Falha no SendGrid, tentando Nodemailer...');
          
          // 2º Tentativa: Nodemailer (Gmail SMTP)
          emailSent = await sendPasswordResetWithNodemailer(user.email, resetUrl);
          
          if (emailSent) {
            console.log('✅ Email de recuperação Nodemailer enviado com sucesso!');
          } else {
            console.log('⚠️ Falha no Nodemailer, tentando serviço autônomo...');
            
            // 3º Tentativa: Autonomous service (apenas para log local)
            await autonomousEmailService.sendEmail(
              user.email,
              'InvistaPRO - Recuperação de Senha',
              emailBody
            );
            console.log('✅ Email salvo no sistema autônomo local');
          }
        }
      } catch (emailError) {
        console.error('❌ Erro ao enviar email de recuperação:', emailError);
        // Continue anyway - user should get success message
      }

      res.json({ 
        message: "Se o email estiver cadastrado, você receberá um link de recuperação.",
        success: true 
      });

    } catch (error) {
      console.error('❌ Erro na solicitação de recuperação:', error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Password Recovery - Reset password with token
  app.post('/api/password-recovery/reset', async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token e nova senha são obrigatórios" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Nova senha deve ter pelo menos 6 caracteres" });
      }

      // Find user by reset token
      const [user] = await db.select()
        .from(users)
        .where(eq(users.passwordResetToken, token))
        .limit(1);

      if (!user) {
        return res.status(400).json({ message: "Token inválido ou expirado" });
      }

      // Check if token is expired
      if (!user.passwordResetTokenExpiresAt || new Date() > new Date(user.passwordResetTokenExpiresAt)) {
        return res.status(400).json({ message: "Token expirado" });
      }

      // Hash new password
      const newPasswordHash = await hashPassword(newPassword);

      // Update password and clear reset token
      await db.update(users)
        .set({
          passwordHash: newPasswordHash,
          passwordResetToken: null,
          passwordResetTokenExpiresAt: null,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, user.id));

      console.log('✅ Senha redefinida com sucesso para:', user.email);

      res.json({ 
        message: "Senha redefinida com sucesso! Você já pode fazer login.",
        success: true 
      });

    } catch (error) {
      console.error('❌ Erro ao redefinir senha:', error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Verify phone route
  app.post('/api/verify-phone', async (req, res) => {
    try {
      const { userId, codigo } = phoneVerificationSchema.parse(req.body);
      
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      if (user.telefoneVerificado) {
        return res.status(400).json({ message: "Telefone já verificado" });
      }

      if (!user.codigoVerificacao || user.codigoVerificacao !== codigo) {
        return res.status(400).json({ message: "Código inválido" });
      }

      if (!user.codigoExpiresAt || new Date() > new Date(user.codigoExpiresAt)) {
        return res.status(400).json({ message: "Código expirado" });
      }

      // Verify phone
      await dbStorage.verifyPhone(userId);

      res.json({ 
        message: "Telefone verificado com sucesso! Aguarde aprovação do administrador.",
        phoneVerified: true
      });
    } catch (error: any) {
      console.error("Phone verification error:", error);
      if (error.issues) {
        return res.status(400).json({ message: error.issues[0].message });
      }
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Resend verification code
  app.post('/api/resend-code', async (req, res) => {
    try {
      const { userId } = req.body;
      
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      if (user.telefoneVerificado) {
        return res.status(400).json({ message: "Telefone já verificado" });
      }

      // Generate new code
      const code = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      await dbStorage.updateVerificationCode(user.id, code, expiresAt);
      await notificationService.sendVerificationCode(user.email, code, 'email');

      res.json({ message: "Novo código enviado!" });
    } catch (error) {
      console.error("Resend code error:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Development only: Get verification code for email
  app.post('/api/dev/get-verification-code', async (req, res) => {
    // Only allow in development
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      const { userId } = req.body;
      
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      // Check if notification service has the method (MockNotificationService)
      const code = notificationService.getLastCodeForDev?.(user.email) || user.codigoVerificacao;
      
      res.json({ 
        email: user.email,
        codigo: code,
        message: "Código de verificação (apenas em desenvolvimento)"
      });
    } catch (error) {
      console.error("Dev get code error:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Development only: Auto-login as admin for agent screenshot access
  app.get('/dev-login', async (req: any, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).send('Not found');
    }
    try {
      const allUsers = await dbStorage.getAllUsers();
      const admin = allUsers.find((u: any) => u.isAdmin) || allUsers[0];
      if (!admin) {
        return res.status(404).send('Nenhum usuário encontrado. Crie um admin primeiro.');
      }
      req.logIn(admin, (err: any) => {
        if (err) {
          console.error('[DEV-LOGIN] Erro ao fazer login:', err);
          return res.status(500).send('Erro ao criar sessão: ' + err.message);
        }
        console.log(`[DEV-LOGIN] Login automático como: ${admin.email} (admin: ${admin.isAdmin})`);
        res.redirect('/dashboard');
      });
    } catch (error: any) {
      console.error('[DEV-LOGIN] Erro:', error);
      res.status(500).send('Erro: ' + error.message);
    }
  });

  // Development only: Reset user data for testing
  app.post('/api/dev/reset-user', async (req, res) => {
    // Only allow in development
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ message: "Not found" });
    }

    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email é obrigatório" });
      }

      // Find and delete user
      const user = await dbStorage.getUserByEmail(email);
      if (user) {
        // Delete related data first
        await db.delete(movimentos).where(eq(movimentos.userId, user.id));
        await db.delete(documentos).where(eq(documentos.userId, user.id));
        await db.delete(users).where(eq(users.id, user.id));
        
        res.json({ 
          message: `Usuário ${email} removido com sucesso. Pode cadastrar novamente.`,
          removed: true
        });
      } else {
        res.json({ 
          message: `Usuário ${email} não encontrado`,
          removed: false
        });
      }
    } catch (error) {
      console.error("Dev reset user error:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  // Logout routes (both GET and POST for compatibility)
  const handleLogout = (req: any, res: any) => {
    console.log('🚪 Logout solicitado');
    req.logout((err: any) => {
      if (err) {
        console.error('❌ Erro no logout:', err);
        return res.status(500).json({ message: "Erro ao fazer logout" });
      }
      console.log('✅ Logout realizado com sucesso');
      res.json({ message: "Logout realizado com sucesso", success: true });
    });
  };

  app.post('/api/logout', handleLogout);
  app.get('/api/logout', handleLogout);

  // Get current user
  // Get current user route (both /api/user and /api/auth/user for compatibility)
  const getCurrentUser = async (req: any, res: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Não autenticado" });
      }
      const { passwordHash, codigoVerificacao, ...userWithoutSensitiveData } = req.user;
      res.json(userWithoutSensitiveData);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  };

  app.get('/api/user', getCurrentUser);
  app.get('/api/auth/user', getCurrentUser);

  // Get available deposit amounts
  app.get('/api/deposit/amounts', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      // Valores predefinidos: 130, 350, 825, 1000, depois incrementos de 10.000
      const baseAmounts = [130, 350, 825, 1000];
      const incrementalAmounts = [];
      
      // Gerar valores incrementais a partir de 10.000
      for (let i = 10000; i <= 100000; i += 10000) {
        incrementalAmounts.push(i);
      }
      
      const allAmounts = [...baseAmounts, ...incrementalAmounts];
      
      res.json({
        amounts: allAmounts,
        message: "Valores de depósito disponíveis"
      });
    } catch (error) {
      console.error("Error getting deposit amounts:", error);
      res.status(500).json({ message: "Failed to get deposit amounts" });
    }
  });

  // Generate PIX for deposit with predefined amounts
  app.post('/api/pix/generate', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { valor } = req.body;
      
      const valorNum = parseFloat(valor);
      
      if (!valor || valorNum < 130) {
        return res.status(400).json({ message: "Valor mínimo de depósito é R$ 130,00" });
      }

      const user = await dbStorage.getUser(userId);
      if (!user || !user.cpf) {
        return res.status(400).json({ message: "CPF não cadastrado" });
      }

      // Validar se é um valor permitido
      const baseAmounts = [130, 350, 825, 1000];
      const isBaseAmount = baseAmounts.includes(valorNum);
      const isIncrementalAmount = valorNum >= 10000 && valorNum <= 100000 && valorNum % 10000 === 0;
      
      if (!isBaseAmount && !isIncrementalAmount) {
        return res.status(400).json({ 
          message: "Valor não permitido. Use um dos valores disponíveis." 
        });
      }

      let pixString;
      let qrCodeDataURL;
      
      if (valorNum === 130) {
        // Usar o PIX code exato fornecido para R$ 130
        pixString = "00020126580014br.gov.bcb.pix013605f6ace9-d21c-43f2-8fb9-40e7da3009a827600016BR.COM.PAGSEGURO01360A3DF8F0-D509-4AF4-A5CE-5602D46FB8C45204899953039865406130.005802BR5919Victor Felipe Diogo6006Araras62290525PAGS00001300025081513148863042DA0";
      } else {
        // Para outros valores, gerar PIX com as mesmas informações do merchant
        const pixKey = "05f6ace9-d21c-43f2-8fb9-40e7da3009a8";
        const empresaNome = "Victor Felipe Diogo";
        const empresaCidade = "Araras";
        
        pixString = generatePixPayload({
          pixKey: pixKey,
          merchantName: empresaNome,
          merchantCity: empresaCidade,
          amount: valorNum,
          transactionId: `DEP-${userId.substring(0, 8)}-${Date.now()}`
        });
      }
      
      qrCodeDataURL = await QRCode.toDataURL(pixString);
      
      res.json({
        qrCode: qrCodeDataURL,
        pixString: pixString,
        valor: valorNum.toFixed(2),
        chavePix: "05f6ace9-d21c-43f2-8fb9-40e7da3009a8",
        empresa: "Victor Felipe Diogo",
        observacao: `Depósito InvistaPRO R$ ${valorNum.toFixed(2)} - Invista com Risco Zero`
      });
    } catch (error) {
      console.error("Error generating PIX:", error);
      res.status(500).json({ message: "Failed to generate PIX" });
    }
  });

  // Process deposit (simulate PIX payment confirmation)
  app.post('/api/deposit/confirm', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { valor, pixString } = req.body;
      
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const valorNum = parseFloat(valor);
      const novoSaldo = Number(user.saldo) + valorNum;
      
      // Update user balance and deposit date
      await dbStorage.updateUser(userId, {
        saldo: novoSaldo,
        depositoData: new Date().toISOString(),
      });

      // Create movement record
      await dbStorage.createMovimento({
        userId,
        tipo: 'deposito',
        valor: valorNum,
        descricao: 'Depósito via PIX',
        pixString,
      });

      res.json({ message: "Depósito confirmado com sucesso", novoSaldo });
    } catch (error) {
      console.error("Error confirming deposit:", error);
      res.status(500).json({ message: "Failed to confirm deposit" });
    }
  });

  // Calculate current yield
  app.get('/api/yield/current', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await dbStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const rendimento = await dbStorage.calcularRendimento(Number(user.saldo));
      res.json({ rendimento });
    } catch (error) {
      console.error("Error calculating yield:", error);
      res.status(500).json({ message: "Failed to calculate yield" });
    }
  });

  // Complete variable income dashboard data
  app.get('/api/dashboard/variable-income', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await dbStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const saldo = Number(user.saldo) || 0;
      const rendimento = await dbStorage.calcularRendimento(saldo);
      const ultimoDiaMes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      
      // Get trading statistics directly from database
      const stats = await dbStorage.getTradingStats(userId);
      const movimentos = await dbStorage.getUserMovimentos(userId, 10);

      console.log('📊 [DASHBOARD] Stats completos:', {
        totalTrades: stats?.totalTrades,
        wonTrades: stats?.wonTrades,
        winRate: stats?.winRate,
        totalProfit: stats?.totalProfit
      });

      const responseData = {
        saldo: Math.round(saldo * 100) / 100,
        rendimento: Math.round(rendimento * 100) / 100,
        proximoSaque: ultimoDiaMes,
        totalTrades: Math.max(0, parseInt(String(stats?.totalTrades || 0))),
        wonTrades: Math.max(0, parseInt(String(stats?.wonTrades || 0))),
        winRate: Math.max(0, parseFloat(String(stats?.winRate || 0))),
        totalPnL: Math.max(0, parseFloat(String(stats?.totalProfit || 0))),
        investidoMesAtual: movimentos.filter(m => m.tipo === 'deposito').reduce((sum, m) => sum + Number(m.valor), 0),
        movimentos: movimentos.map(m => ({
          tipo: m.tipo,
          valor: m.valor,
          data: m.createdAt
        }))
      };

      console.log('✅ [DASHBOARD] Resposta enviada:', responseData);
      res.json(responseData);
    } catch (error) {
      console.error("❌ Error fetching variable income dashboard:", error);
      res.status(500).json({ message: "Failed to fetch dashboard data", error: (error as any).message });
    }
  });

  // 🔐 SISTEMA HÍBRIDO: Configurar senha de fallback para PCs
  app.post('/api/security/setup-password-fallback', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { senha, usarSenhaFallback } = req.body;
      
      if (!senha || senha.length < 6) {
        return res.status(400).json({ message: "Senha deve ter pelo menos 6 caracteres" });
      }
      
      // Hash da senha para segurança
      const senhaHash = crypto.createHash('sha256')
        .update(senha + userId + process.env.SESSION_SECRET)
        .digest('hex');
      
      await dbStorage.updateUser(userId, {
        senhaFallback: senhaHash,
        usarSenhaFallback: usarSenhaFallback || false,
      });
      
      res.json({ 
        message: "Senha de fallback configurada com sucesso",
        senhaFallbackConfigurada: true 
      });
    } catch (error) {
      console.error("Error setting up password fallback:", error);
      res.status(500).json({ message: "Erro ao configurar senha de fallback" });
    }
  });

  // 🔐 SISTEMA HÍBRIDO: Verificação por senha (para PCs sem biometria)
  app.post('/api/security/verify-password', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { senha, valor } = req.body;
      
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }
      
      if (!user.senhaFallback) {
        return res.status(400).json({ message: "Senha de fallback não configurada" });
      }
      
      // Verificar senha
      const senhaHash = crypto.createHash('sha256')
        .update(senha + userId + process.env.SESSION_SECRET)
        .digest('hex');
        
      if (senhaHash !== user.senhaFallback) {
        return res.status(401).json({ message: "Senha incorreta" });
      }
      
      // Log da verificação de segurança
      console.log(`✅ Verificação por senha - Usuário ${userId} - Valor: R$${valor}`);
      
      res.json({ 
        verified: true, 
        method: 'password',
        message: "Verificação por senha realizada com sucesso" 
      });
    } catch (error) {
      console.error("Error verifying password:", error);
      res.status(500).json({ message: "Erro na verificação por senha" });
    }
  });

  // Withdraw yield (only on last day of month)
  app.post('/api/yield/withdraw', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await dbStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const hoje = new Date();
      const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
      
      if (hoje.getDate() !== ultimoDiaMes) {
        return res.status(400).json({ 
          message: "Saque de rendimento só disponível no último dia do mês" 
        });
      }

      const rendimento = await dbStorage.calcularRendimento(Number(user.saldo));
      
      // Create movement record
      await dbStorage.createMovimento({
        userId,
        tipo: 'rendimento',
        valor: rendimento,
        descricao: 'Saque de rendimento - até 130% dos melhores bancos',
      });

      res.json({ 
        message: `Rendimento de R$${rendimento.toFixed(2)} sacado!`,
        rendimento 
      });
    } catch (error) {
      console.error("Error withdrawing yield:", error);
      res.status(500).json({ message: "Failed to withdraw yield" });
    }
  });

  // Total withdrawal (after 95 days)
  app.post('/api/withdraw/total', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await dbStorage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!user.depositoData) {
        return res.status(400).json({ message: "Nenhum depósito encontrado" });
      }

      const hoje = new Date();
      const depositoDate = new Date(user.depositoData);
      const diasPassados = Math.floor(
        (hoje.getTime() - depositoDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      if (diasPassados < 95 || hoje.getDate() > 5) {
        return res.status(400).json({ 
          message: "Saque total só disponível após 95 dias e até o 5º dia útil do mês." 
        });
      }

      const valorTotal = Number(user.saldo);
      
      // Update user balance to 0
      await dbStorage.updateUser(userId, {
        saldo: 0,
      });

      // Create movement record
      await dbStorage.createMovimento({
        userId,
        tipo: 'saque',
        valor: valorTotal,
        descricao: 'Saque total do investimento',
      });

      res.json({ 
        message: `Saque total de R$${valorTotal.toFixed(2)} realizado!`,
        valorTotal 
      });
    } catch (error) {
      console.error("Error processing total withdrawal:", error);
      res.status(500).json({ message: "Failed to process total withdrawal" });
    }
  });

  // Investment simulation
  app.post('/api/simulation', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const { depositoInicial, meses, depositoExtra = 0 } = req.body;
      
      const taxaMensal = 0.00835; // 0.835% mensal = 10.63% anual composto exato
      let saldo = parseFloat(depositoInicial);
      const historico = [];
      
      for (let m = 1; m <= meses; m++) {
        const rendimento = saldo * taxaMensal;
        saldo += rendimento + parseFloat(depositoExtra);
        
        historico.push({
          mes: m,
          rendimento: Math.round(rendimento * 100) / 100,
          saldoAcumulado: Math.round(saldo * 100) / 100
        });
      }

      const totalInvestido = parseFloat(depositoInicial) + (parseFloat(depositoExtra) * meses);
      const totalRendimentos = saldo - totalInvestido;
      
      res.json({
        historico,
        resumo: {
          totalInvestido: Math.round(totalInvestido * 100) / 100,
          totalRendimentos: Math.round(totalRendimentos * 100) / 100,
          valorFinal: Math.round(saldo * 100) / 100
        }
      });
    } catch (error) {
      console.error("Error running simulation:", error);
      res.status(500).json({ message: "Failed to run simulation" });
    }
  });

  // Get user movements
  app.get('/api/movements', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 10;
      
      const movements = await dbStorage.getUserMovimentos(userId, limit);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching movements:", error);
      res.status(500).json({ message: "Failed to fetch movements" });
    }
  });

  // Document upload route
  app.post('/api/documents/upload', isAuthenticated, upload.single('documento'), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { tipo } = req.body;
      
      if (!req.file) {
        return res.status(400).json({ message: "Arquivo é obrigatório" });
      }

      // Validate document type
      const validTypes = ['cpf', 'rg', 'cnh', 'comprovante'];
      if (!validTypes.includes(tipo)) {
        return res.status(400).json({ message: "Tipo de documento inválido" });
      }

      // Create document record
      const documento = await dbStorage.createDocumento({
        userId,
        tipo,
        arquivo: req.file.path,
        status: 'pendente'
      });

      res.json({ 
        message: "Documento enviado com sucesso",
        documentoId: documento.id,
        status: 'pendente'
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Erro ao enviar documento" });
    }
  });

  // Get user documents
  app.get('/api/documents', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const documentos = await dbStorage.getUserDocumentos(userId);
      res.json(documentos);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Erro ao buscar documentos" });
    }
  });



  // Enhanced withdrawal route with document requirements
  app.post('/api/withdraw', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { valor, tipo } = withdrawalRequestSchema.parse(req.body);
      
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      // Check for total withdrawal requirements
      if (tipo === 'total') {
        // Check if user has uploaded required documents
        const documentos = await dbStorage.getUserDocumentos(userId);
        const requiredDocs = ['cpf', 'rg', 'comprovante'];
        const uploadedDocs = documentos.filter(doc => doc.status === 'aprovado').map(doc => doc.tipo);
        const missingDocs = requiredDocs.filter(doc => !uploadedDocs.includes(doc));
        
        if (missingDocs.length > 0) {
          return res.status(400).json({ 
            message: `Documentos pendentes: ${missingDocs.join(', ')}`,
            missingDocuments: missingDocs
          });
        }

        // Check 95-day waiting period
        if (user.depositoData) {
          const daysSinceDeposit = Math.floor((Date.now() - new Date(user.depositoData).getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceDeposit < 95) {
            return res.status(400).json({ 
              message: `Saque total disponível após 95 dias. Faltam ${95 - daysSinceDeposit} dias.`
            });
          }
        }
      }

      // Sistema híbrido: verificação de segurança para saques > R$300
      let securityVerified = false;
      let verificacaoUsada = 'nenhuma';
      
      if (valor > 300) {
        const temBiometria = user.biometriaConfigurada;
        const temSenhaFallback = !!user.senhaFallback;
        
        if (!temBiometria && !temSenhaFallback) {
          return res.status(400).json({ 
            message: "Configure biometria ou senha de segurança para saques acima de R$300",
            requiresSecuritySetup: true
          });
        }
        
        // Verificar se alguma verificação foi passada
        const { biometriaVerificada, senhaVerificada } = req.body;
        
        if (biometriaVerificada && temBiometria) {
          securityVerified = true;
          verificacaoUsada = 'biometria';
        } else if (senhaVerificada && temSenhaFallback) {
          securityVerified = true;
          verificacaoUsada = 'senha';
        } else {
          return res.status(400).json({ 
            message: "Verificação de segurança obrigatória para saques acima de R$300",
            metodosDisponiveis: {
              biometria: temBiometria,
              senhaFallback: temSenhaFallback
            }
          });
        }
      }

      let novoSaldo: number;
      let descricao: string;

      if (tipo === 'rendimento') {
        const rendimento = await dbStorage.calcularRendimento(Number(user.saldo));
        if (valor > rendimento) {
          return res.status(400).json({ message: "Valor solicitado maior que o rendimento disponível" });
        }
        novoSaldo = Number(user.saldo) - valor;
        descricao = `Saque de rendimento - R$${valor.toFixed(2)}`;
      } else {
        if (valor > Number(user.saldo)) {
          return res.status(400).json({ message: "Saldo insuficiente" });
        }
        novoSaldo = Number(user.saldo) - valor;
        descricao = `Saque total - R$${valor.toFixed(2)}`;
      }

      // Update user balance
      await dbStorage.updateUser(userId, {
        saldo: novoSaldo,
      });

      // Create movement record
      await dbStorage.createMovimento({
        userId,
        tipo: 'saque',
        valor,
        descricao,
        biometriaVerificada: valor > 300 && securityVerified,
      });

      res.json({ 
        message: "Saque realizado com sucesso!",
        valorSacado: valor,
        novoSaldo
      });
    } catch (error: any) {
      console.error("Error processing withdrawal:", error);
      if (error.issues) {
        return res.status(400).json({ message: error.issues[0].message });
      }
      res.status(500).json({ message: "Erro ao processar saque" });
    }
  });

  // Rotas do sistema interno de emails removidas - sistema desnecessário

  // Autonomous Email System Routes
  app.get('/api/autonomous-emails', (req, res) => {
    try {
      const emails = autonomousEmailService.getAllDeliveredEmails();
      res.json({
        domain: autonomousEmailService.generateEmailDomain(),
        total: emails.length,
        emails: emails.slice(0, 50) // Últimos 50 emails
      });
    } catch (error) {
      console.error('Erro ao buscar emails autônomos:', error);
      res.status(500).json({ message: "Erro ao buscar emails autônomos" });
    }
  });

  app.get('/api/email-status/:messageId', (req, res) => {
    try {
      const messageId = req.params.messageId;
      const status = autonomousEmailService.getEmailStatus(messageId);
      res.json({ messageId, status });
    } catch (error) {
      console.error('Erro ao buscar status do email:', error);
      res.status(500).json({ message: "Erro ao buscar status do email" });
    }
  });

  // CEP validation endpoint
  app.post('/api/validate-cep', async (req, res) => {
    try {
      const { cep } = req.body;
      
      if (!cep) {
        return res.status(400).json({ message: "CEP é obrigatório" });
      }
      
      const { validateCEP } = await import('./validators');
      const validation = await validateCEP(cep);
      
      if (validation.valid) {
        res.json({ 
          valid: true, 
          endereco: validation.data 
        });
      } else {
        res.status(400).json({ 
          valid: false, 
          message: validation.error 
        });
      }
    } catch (error) {
      console.error("Error validating CEP:", error);
      res.status(500).json({ message: "Erro ao validar CEP" });
    }
  });

  // Real CDI/CDB market data from HG Brasil Finance API
  app.get('/api/market/cdi-data', async (req, res) => {
    try {
      console.log('🔍 Buscando dados reais de CDI/CDB...');
      
      // HG Brasil Finance API (gratuita, 400 requests/dia)
      const response = await fetch('https://api.hgbrasil.com/finance');
      
      if (!response.ok) {
        throw new Error(`HG Brasil API error: ${response.status}`);
      }
      
      const data = await response.json() as any;
      
      if (!data.results || !data.results.taxes) {
        throw new Error('Invalid API response structure');
      }
      
      const { cdi, selic, date } = data.results.taxes;
      
      // Simular dados históricos baseados na taxa real atual
      const currentTime = Date.now();
      const realCDI = parseFloat(cdi) || 10.65;
      const realSelic = parseFloat(selic) || 10.75;
      
      // Gerar 240 pontos de dados históricos com variações mais visíveis e tendências
      const historicalData = [];
      let basePrice = realCDI;
      let trend = 0; // Tendência atual
      
      for (let i = 239; i >= 0; i--) {
        const time = currentTime - (i * 60000); // 1 ponto por minuto (4 horas de dados)
        
        // Criar micro-tendências que mudam a cada 20-30 pontos
        if (i % 25 === 0) {
          trend = (Math.random() - 0.5) * 0.3; // Tendência entre -0.15% e +0.15%
        }
        
        // Variação mais ampla: ±0.2% + tendência
        const randomVariation = (Math.random() - 0.5) * 0.4; // ±0.2%
        const trendInfluence = trend * (1 - i / 240); // Tendência diminui com o tempo
        
        const variation = randomVariation + trendInfluence;
        const price = Math.max(0.1, realCDI + variation); // Nunca vai abaixo de 0.1%
        
        historicalData.push({
          time,
          price: parseFloat(price.toFixed(3))
        });
      }
      
      console.log(`✅ Dados reais obtidos: CDI ${realCDI}%, Selic ${realSelic}%`);
      
      res.json({
        success: true,
        date,
        realRates: {
          cdi: realCDI,
          selic: realSelic
        },
        assets: [
          {
            name: 'CDI',
            symbol: 'CDI',
            currentRate: realCDI,
            color: '#00bcd4',
            data: historicalData
          },
          {
            name: 'CDB',
            symbol: 'CDB',
            currentRate: realCDI * 1.30, // 130% do CDI
            color: '#ff9800',
            data: historicalData.map(point => ({
              ...point,
              price: parseFloat((point.price * 1.30).toFixed(3))
            }))
          },
          {
            name: 'Selic',
            symbol: 'SELIC',
            currentRate: realSelic,
            color: '#4caf50',
            data: historicalData.map((point, index) => ({
              ...point,
              price: parseFloat((realSelic + (Math.random() - 0.5) * 0.35).toFixed(3))
            }))
          }
        ],
        source: 'HG Brasil Finance API',
        message: 'Dados de mercado em tempo real obtidos com sucesso'
      });
      
    } catch (error) {
      console.error('❌ Erro ao buscar dados de CDI:', error);
      
      // Fallback para dados simulados se a API falhar
      const fallbackData = {
        success: false,
        fallback: true,
        date: new Date().toISOString().split('T')[0],
        realRates: {
          cdi: 10.65,
          selic: 10.75
        },
        assets: [
          {
            name: 'CDI (Simulado)',
            symbol: 'CDI_FALLBACK',
            currentRate: 10.65,
            color: '#00bcd4',
            data: []
          }
        ],
        error: error instanceof Error ? error.message : String(error),
        message: 'Usando dados simulados devido à falha na API'
      };
      
      res.json(fallbackData);
    }
  });

  // USD/BRL Exchange Rate - AwesomeAPI (oficial e gratuita)
  app.get('/api/market/exchange-rate', async (req, res) => {
    try {
      const response = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL');
      if (!response.ok) throw new Error(`AwesomeAPI error: ${response.status}`);
      const data = await response.json() as any;

      const usdBrl = parseFloat(data.USDBRL?.bid || '0');
      const eurBrl = parseFloat(data.EURBRL?.bid || '0');

      if (!usdBrl) throw new Error('Invalid exchange rate data');

      res.json({
        success: true,
        rates: {
          USD_BRL: usdBrl,
          EUR_BRL: eurBrl || null,
        },
        source: 'AwesomeAPI',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      // Fallback: tentar HG Brasil API
      try {
        const hgRes = await fetch('https://api.hgbrasil.com/finance?fields=only_results');
        const hgData = await hgRes.json() as any;
        const usdBrl = parseFloat(hgData?.results?.currencies?.USD?.buy || '0');
        if (usdBrl) {
          return res.json({
            success: true,
            rates: { USD_BRL: usdBrl, EUR_BRL: null },
            source: 'HGBrasil',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (_) {}

      res.status(500).json({
        success: false,
        error: error.message,
        rates: { USD_BRL: 5.20, EUR_BRL: null },
        source: 'fallback',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // KYC routes
  app.use('/api/kyc', kycRoutes);

  // Admin routes  
  app.use('/api/admin', adminRoutes);
  
  // Auto Trading Routes
  const { autoTradingRoutes } = await import('./routes/auto-trading-routes');
  app.use('/api/auto-trading', autoTradingRoutes);

  // Monitor Universal de Contratos IA
  app.use('/api/monitor', monitorRoutes);

  // Motor de Aprendizado Persistente Real
  app.use('/api/learning', learningRoutes);
  app.use('/api/mt5', metaTraderRoutes);
  app.use('/api/metatrader', metaTraderRoutes);

  // 🌐 ENDPOINT PÚBLICO — Retorna URL atual do servidor para o EA MT5 auto-descobrir
  app.get('/api/url', (req, res) => {
    const info = getRegistryInfo();
    const serverUrl = info.currentServerUrl || `https://${process.env.REPLIT_DEV_DOMAIN || req.hostname}`;
    res.json({
      serverUrl,
      discoveryUrl: info.discoveryUrl,
      blobId: info.blobId,
      timestamp: new Date().toISOString(),
    });
  });

  // Marketing Email Routes
  app.post('/api/marketing/add-email', isAuthenticated, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: 'Email é obrigatório' });
      }
      
      addUserToMarketing(email);
      res.json({ message: 'Email adicionado à lista de marketing', email });
    } catch (error) {
      console.error('❌ Erro ao adicionar email ao marketing:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  });

  app.delete('/api/marketing/remove-email', isAuthenticated, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: 'Email é obrigatório' });
      }
      
      removeUserFromMarketing(email);
      res.json({ message: 'Email removido da lista de marketing', email });
    } catch (error) {
      console.error('❌ Erro ao remover email do marketing:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  });

  app.post('/api/marketing/campaign', isAuthenticated, async (req, res) => {
    try {
      await marketingManager.runMarketingCampaign();
      res.json({ message: 'Campanha de marketing iniciada com sucesso' });
    } catch (error) {
      console.error('❌ Erro ao executar campanha de marketing:', error);
      res.status(500).json({ message: 'Erro ao executar campanha' });
    }
  });

  app.get('/api/marketing/stats', isAuthenticated, async (req, res) => {
    try {
      const stats = marketingManager.getStats();
      res.json(stats);
    } catch (error) {
      console.error('❌ Erro ao obter estatísticas de marketing:', error);
      res.status(500).json({ message: 'Erro ao obter estatísticas' });
    }
  });

  // Health check endpoint ULTRA-ROBUSTO para keep-alive 24/7
  // Este endpoint garante que o sistema nunca hiberne
  app.get('/api/health', async (req, res) => {
    try {
      // Informações detalhadas do sistema para monitoramento
      const autoTradingStats = autoTradingScheduler.getSessionStats();
      const activeSessions = autoTradingScheduler.getActiveSessions();
      
      res.json({ 
        status: 'online',
        system: 'InvestPro Trading System',
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
        uptimeSeconds: Math.floor(process.uptime()),
        workspace: 'active',
        trading: {
          active: activeSessions.length > 0,
          sessions: activeSessions.length,
          totalExecuted: autoTradingStats.totalExecutedOperations,
          scheduler: 'running'
        },
        memory: {
          used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`
        },
        message: '🚀 Sistema operando 24/7 - Trading ativo e autônomo'
      });
    } catch (error) {
      res.status(500).json({ 
        status: 'error', 
        message: 'Health check failed',
        timestamp: new Date().toISOString() 
      });
    }
  });

  // 🔥 ENDPOINTS ANTI-HIBERNAÇÃO OTIMIZADOS PARA SERVIÇOS EXTERNOS
  // Múltiplos endpoints com respostas variadas para simular tráfego real
  
  // Endpoint 1: Ultra-leve para ping externo (UptimeRobot, cron-job.org)
  app.get('/api/ping', (req, res) => {
    res.status(200).send('OK');
  });

  // Endpoint 2: JSON com informações de uptime
  app.get('/api/keepalive', (req, res) => {
    const uptime = Math.floor(process.uptime());
    const activeSessions = autoTradingScheduler.getActiveSessions();
    
    res.json({ 
      ok: true,
      uptime: uptime,
      trading: activeSessions.length > 0,
      sessions: activeSessions.length,
      timestamp: Date.now()
    });
  });

  // Endpoint 3: Status simples
  app.get('/api/status', (req, res) => {
    res.json({ 
      status: 'online',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  // Endpoint 4: Alive check
  app.get('/api/alive', (req, res) => {
    res.json({ 
      alive: true,
      service: 'InvestPro',
      time: Date.now()
    });
  });

  // Endpoint 5: Heartbeat
  app.get('/api/heartbeat', (req, res) => {
    res.json({ 
      heartbeat: '💓',
      healthy: true,
      uptime: Math.floor(process.uptime())
    });
  });

  // Error tracking health endpoint
  app.get('/api/system/error-health', async (req, res) => {
    try {
      const healthReport = errorTracker.getSystemHealthReport();
      res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        errorTracking: healthReport
      });
    } catch (error) {
      res.status(500).json({ 
        status: 'error', 
        message: 'Error health check failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // =================== TRADING SYSTEM ROUTES ===================

  // Using centralized access control imported at top

  // Middleware to check trading access (only for authorized users)
  const isTradingAuthorized = (req: any, res: any, next: any) => {
    const userEmail = req.user?.email;
    const envAdminEmail = process.env.ADMIN_EMAIL;
    
    // Check if authorized via predefined list OR via ADMIN_EMAIL env variable
    const isAuthorized = isAuthorizedEmail(userEmail) || 
                         (envAdminEmail && userEmail?.toLowerCase() === envAdminEmail.toLowerCase());
    
    if (!req.user || !userEmail || !isAuthorized) {
      return res.status(403).json({ 
        message: ACCESS_DENIED_MESSAGE
      });
    }
    next();
  };

  // =========================== DERIV TOKEN MANAGEMENT ===========================
  
  app.post('/api/trading/deriv-token', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const operationId = `DERIV_TOKEN_CONFIG_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();
    
    console.log('\n' + '🔧'.repeat(60));
    console.log(`🚀 INÍCIO: Configuração Token Deriv - ID: ${operationId}`);
    console.log('🔧'.repeat(60));
    console.log(`👤 Usuário: ${req.user?.email} (ID: ${req.user?.id})`);
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log(`📦 Request Body: ${JSON.stringify(req.body, null, 2)}`);
    console.log('🔧'.repeat(60));

    try {
      // PASSO 1: Validação dos dados
      console.log(`📝 PASSO 1: Validando dados de entrada...`);
      const validation = derivTokenConfigSchema.safeParse(req.body);
      if (!validation.success) {
        const errorId = errorTracker.captureError(
          new Error('Dados de entrada inválidos'), 
          'WARNING', 
          'VALIDATION',
          {
            ...errorTracker.createContextFromRequest(req),
            requestBody: { 
              validationErrors: validation.error.format(),
              operationId,
              step: 'VALIDATION'
            }
          }
        );
        
        console.log(`❌ PASSO 1 FALHOU: Validação de dados - Error ID: ${errorId}`);
        return res.status(400).json({ 
          message: 'Dados inválidos', 
          errors: validation.error.format(),
          errorId,
          operationId
        });
      }
      console.log(`✅ PASSO 1 SUCESSO: Dados validados`);

      // PASSO 2: Verificação de autenticação
      console.log(`🔐 PASSO 2: Verificando autenticação do usuário...`);
      const { token, accountType } = validation.data;
      if (!req.user?.id) {
        const errorId = errorTracker.captureError(
          new Error('Usuário não autenticado'), 
          'WARNING', 
          'AUTH',
          {
            ...errorTracker.createContextFromRequest(req),
            requestBody: { operationId, step: 'AUTHENTICATION' }
          }
        );
        
        console.log(`❌ PASSO 2 FALHOU: Usuário não autenticado - Error ID: ${errorId}`);
        return res.status(401).json({ 
          message: 'Usuário não autenticado',
          errorId,
          operationId 
        });
      }
      const userId = req.user.id;
      console.log(`✅ PASSO 2 SUCESSO: Usuário autenticado - ID: ${userId}`);

      // PASSO 3: Teste de conexão com Deriv
      console.log(`🌐 PASSO 3: Testando conexão com Deriv API...`);
      console.log(`   Token: ${token.substring(0, 5)}... (parcial)`);
      console.log(`   Account Type: ${accountType}`);
      
      let connected = false;
      try {
        // Garantir que não há conexão pendente antes de tentar uma nova
        await derivAPI.disconnect();
        
        // Tentar conectar com timeout curto para feedback rápido
        connected = await derivAPI.connect(token, accountType, operationId);
        console.log(`   Resultado da conexão: ${connected}`);
      } catch (connectionError: any) {
        console.log(`❌ PASSO 3 FALHOU: Erro na conexão - ${connectionError.message}`);
        return res.status(400).json({ 
          message: `Erro de conexão: ${connectionError.message}`,
          operationId
        });
      }
      
      if (!connected) {
        const errorId = errorTracker.captureError(
          new Error('Falha na conexão - conexão retornou false'), 
          'ERROR', 
          'WEBSOCKET',
          {
            ...errorTracker.createContextFromRequest(req),
            requestBody: { 
              token: token.substring(0, 10) + '...',
              accountType,
              operationId, 
              step: 'DERIV_CONNECTION_FAILED'
            }
          }
        );
        
        console.log(`❌ PASSO 3 FALHOU: Conexão retornou false - Error ID: ${errorId}`);
        return res.status(400).json({ 
          message: 'Token inválido ou erro de conexão com Deriv',
          errorId,
          operationId
        });
      }
      console.log(`✅ PASSO 3 SUCESSO: Conectado à Deriv API`);

      // PASSO 4: Verificação do saldo da conta
      console.log(`💰 PASSO 4: Verificando saldo da conta...`);
      let balance;
      try {
        balance = await derivAPI.getBalance();
        console.log(`   Saldo obtido: ${JSON.stringify(balance, null, 2)}`);
      } catch (balanceError) {
        const errorId = errorTracker.captureError(
          balanceError, 
          'ERROR', 
          'API_EXTERNAL',
          {
            ...errorTracker.createContextFromRequest(req),
            requestBody: { 
              operationId, 
              step: 'BALANCE_VERIFICATION',
              connectionStatus: 'connected'
            }
          }
        );
        
        console.log(`❌ PASSO 4 FALHOU: Erro ao obter saldo - Error ID: ${errorId}`);
        console.log(`   Detalhes do erro: ${balanceError instanceof Error ? balanceError.message : String(balanceError)}`);
        
        await derivAPI.disconnect();
        console.log(`🔌 Desconectado da Deriv API após erro`);
        
        return res.status(400).json({ 
          message: 'Não foi possível verificar a conta Deriv',
          errorId,
          operationId,
          details: balanceError instanceof Error ? balanceError.message : String(balanceError)
        });
      }
      
      if (!balance) {
        const errorId = errorTracker.captureError(
          new Error('Saldo retornado é null/undefined'), 
          'ERROR', 
          'API_EXTERNAL',
          {
            ...errorTracker.createContextFromRequest(req),
            requestBody: { 
              operationId, 
              step: 'BALANCE_NULL'
            }
          }
        );
        
        console.log(`❌ PASSO 4 FALHOU: Saldo é null - Error ID: ${errorId}`);
        await derivAPI.disconnect();
        console.log(`🔌 Desconectado da Deriv API após saldo null`);
        
        return res.status(400).json({ 
          message: 'Não foi possível verificar a conta Deriv',
          errorId,
          operationId
        });
      }
      console.log(`✅ PASSO 4 SUCESSO: Saldo verificado - ${balance.balance} ${balance.currency}`);

      // PASSO 5: Salvar token no banco de dados
      console.log(`💾 PASSO 5: Salvando token no banco de dados...`);
      let derivTokenData;
      try {
        derivTokenData = await dbStorage.updateDerivToken(userId, token, accountType);
        console.log(`   Token salvo com sucesso`);
      } catch (saveError) {
        const errorId = errorTracker.captureError(
          saveError, 
          'ERROR', 
          'DATABASE',
          {
            ...errorTracker.createContextFromRequest(req),
            requestBody: { 
              operationId, 
              step: 'DATABASE_SAVE',
              userId,
              accountType
            }
          }
        );
        
        console.log(`❌ PASSO 5 FALHOU: Erro ao salvar no banco - Error ID: ${errorId}`);
        console.log(`   Detalhes do erro: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
        
        await derivAPI.disconnect();
        console.log(`🔌 Desconectado da Deriv API após erro de BD`);
        
        // Check if it's an encryption configuration error
        if (saveError instanceof Error && saveError.message.includes('ENCRYPTION_KEY')) {
          return res.status(400).json({ 
            message: 'Configuração de criptografia ausente ou inválida',
            errorId,
            operationId,
            details: 'Entre em contato com o administrador do sistema para configurar a chave de criptografia.'
          });
        }
        
        throw saveError; // Re-throw para ser capturado pelo error handler global
      }
      console.log(`✅ PASSO 5 SUCESSO: Token salvo no banco de dados`);

      // PASSO 6: Desconexão limpa
      console.log(`🔌 PASSO 6: Desconectando da Deriv API...`);
      try {
        await derivAPI.disconnect();
        console.log(`✅ PASSO 6 SUCESSO: Desconectado da Deriv API`);
      } catch (disconnectError) {
        console.log(`⚠️ PASSO 6 AVISO: Erro na desconexão: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`);
        // Não é crítico, continuamos
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log('\n' + '🎉'.repeat(60));
      console.log(`🎉 SUCESSO TOTAL: Token Deriv configurado - ID: ${operationId}`);
      console.log(`⏱️ Duração total: ${duration}ms`);
      console.log(`👤 Usuário: ${req.user.email}`);
      console.log(`💰 Saldo: ${balance.balance} ${balance.currency}`);
      console.log(`📊 Tipo de conta: ${accountType}`);
      console.log('🎉'.repeat(60) + '\n');

      res.json({
        message: 'Token Deriv configurado com sucesso',
        accountType,
        balance: balance.balance,
        currency: balance.currency,
        tokenConfigured: true,
        operationId,
        duration: `${duration}ms`
      });

    } catch (error) {
      const errorId = errorTracker.captureError(
        error, 
        'CRITICAL', 
        'UNKNOWN',
        {
          ...errorTracker.createContextFromRequest(req),
          requestBody: { 
            operationId, 
            step: 'UNEXPECTED_ERROR',
            duration: `${Date.now() - startTime}ms`
          }
        }
      );
      
      console.log('\n' + '💥'.repeat(60));
      console.log(`💥 ERRO CRÍTICO: Configuração Token Deriv - ID: ${operationId}`);
      console.log(`❌ Error ID: ${errorId}`);
      console.log(`⏱️ Duração até erro: ${Date.now() - startTime}ms`);
      console.log(`📝 Mensagem: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`📍 Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
      console.log('💥'.repeat(60) + '\n');
      
      // Garantir desconexão em caso de erro
      try {
        await derivAPI.disconnect();
        console.log(`🔌 Desconectado da Deriv API após erro crítico`);
      } catch (disconnectError) {
        console.log(`⚠️ Erro adicional na desconexão: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ 
        message: 'Erro interno do servidor', 
        error: errorMessage,
        errorId,
        operationId
      });
    }
  }));

  app.get('/api/trading/deriv-token', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      const tokenData = await dbStorage.getUserDerivToken(userId);
      
      if (!tokenData) {
        return res.json({ tokenConfigured: false });
      }

      // Return masked token for display (first 8 chars + ****)
      const maskedToken = tokenData.token.substring(0, 8) + '****';
      
      res.json({
        tokenConfigured: true,
        token: maskedToken,
        accountType: tokenData.accountType,
        isActive: tokenData.isActive,
        createdAt: tokenData.createdAt
      });

    } catch (error) {
      console.error('❌ Erro ao buscar token Deriv:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  // DELETE route to remove Deriv token
  app.delete('/api/trading/deriv-token', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const operationId = `DERIV_TOKEN_DELETE_${Date.now()}`;
    
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      
      const userId = req.user.id;
      console.log(`🗑️ Deletando token Deriv - Usuário: ${userId} - ID: ${operationId}`);
      
      // Check if token exists
      const tokenData = await dbStorage.getUserDerivToken(userId);
      if (!tokenData) {
        return res.status(404).json({ message: 'Nenhum token configurado para deletar' });
      }
      
      // Deactivate the token
      await dbStorage.deactivateDerivToken(userId);
      
      console.log(`✅ Token Deriv removido com sucesso - Usuário: ${userId}`);
      
      res.json({
        message: 'Token Deriv removido com sucesso',
        tokenConfigured: false,
        operationId
      });
      
    } catch (error) {
      console.error(`❌ Erro ao deletar token: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ 
        message: 'Erro ao remover token',
        error: error instanceof Error ? error.message : String(error),
        operationId
      });
    }
  }));

  // =========================== TRADE CONFIGURATION ===========================

  app.post('/api/trading/config', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const validation = tradeModeConfigSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: 'Modo inválido', 
          errors: validation.error.format() 
        });
      }

      const { mode } = validation.data;
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;

      const config = await dbStorage.updateTradeConfig(userId, mode);

      res.json({
        message: 'Configuração de trading atualizada',
        mode: config.mode,
        operationsCount: config.operationsCount,
        interval: `${config.intervalValue} ${config.intervalType}`,
        isActive: config.isActive
      });

    } catch (error) {
      console.error('❌ Erro ao configurar trading:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  app.get('/api/trading/config', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      const config = await dbStorage.getUserTradeConfig(userId);
      
      if (!config) {
        return res.json({ configured: false });
      }

      res.json({
        configured: true,
        mode: config.mode,
        operationsCount: config.operationsCount,
        intervalType: config.intervalType,
        intervalValue: config.intervalValue,
        isActive: config.isActive,
        createdAt: config.createdAt
      });

    } catch (error) {
      console.error('❌ Erro ao buscar configuração:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  // =========================== MODALIDADES SELECIONADAS ===========================

  app.get('/api/trading/modalities', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const config = await dbStorage.getUserTradeConfig(userId);
    if (!config) {
      return res.json({ modalities: [] });
    }
    let modalities: string[] = [];
    try {
      if (config.selectedModalities) {
        const parsed = JSON.parse(config.selectedModalities);
        if (Array.isArray(parsed)) modalities = parsed;
        else {
          // Fallback para string legada separada por vírgula
          const split = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
          modalities = split;
        }
      }
    } catch {
      if (config.selectedModalities) {
        const split = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
        modalities = split;
      }
    }
    res.json({ modalities });
  }));

  const handleUpdateModalities = asyncErrorHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { modalities } = req.body;
    if (!Array.isArray(modalities)) {
      return res.status(400).json({ message: 'modalities deve ser um array' });
    }
    const VALID = new Set([
      'digit_differs','digit_matches','digit_even','digit_odd','digit_over','digit_under',
      'rise','fall','higher','lower',
      'ends_between','ends_outside','stays_between','goes_outside',
      'touch','no_touch','multiplier_up','multiplier_down',
      'accumulator','turbo_up','turbo_down','vanilla_call','vanilla_put',
      'lookback_high_close','lookback_close_low','lookback_high_low'
    ]);
    const filtered = modalities.filter((m: string) => VALID.has(m));
    // Permite array vazio — significa "sem modalidade selecionada → sistema pausado"
    const finalModalities = filtered;
    await dbStorage.updateSelectedModalities(userId, finalModalities);
    console.log(`📋 [MODALITIES] Usuário ${userId} atualizou modalidades: ${finalModalities.join(', ')}`);
    res.json({ success: true, modalities: finalModalities });
  });

  app.put('/api/trading/modalities', isAuthenticated, isTradingAuthorized, handleUpdateModalities);
  app.post('/api/trading/modalities', isAuthenticated, isTradingAuthorized, handleUpdateModalities);

  // ── ACCU GROWTH RATES ──────────────────────────────────────────────────────────
  app.get('/api/trading/modality-settings', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const config = await dbStorage.getUserTradeConfig(req.user.id);
    let accuGrowthRates: string[] = ['1','2','3','4','5'];
    let modalityFrequency: Record<string, string> = {};
    let accuTicksPerRate: Record<string, number> = { '1': 10, '2': 7, '3': 5, '4': 4, '5': 3 };
    let modalityTicks: Record<string, number> = {};
    try {
      if (config?.accuGrowthRates) accuGrowthRates = JSON.parse(config.accuGrowthRates);
    } catch {}
    try {
      if (config?.modalityFrequency) modalityFrequency = JSON.parse(config.modalityFrequency);
    } catch {}
    try {
      if ((config as any)?.accuTicksPerRate) accuTicksPerRate = JSON.parse((config as any).accuTicksPerRate);
    } catch {}
    try {
      if ((config as any)?.modalityTicks) modalityTicks = JSON.parse((config as any).modalityTicks);
    } catch {}
    res.json({ accuGrowthRates, modalityFrequency, accuTicksPerRate, modalityTicks });
  }));

  app.put('/api/trading/accu-growth-rates', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { rates } = req.body;
    if (!Array.isArray(rates)) return res.status(400).json({ message: 'rates deve ser um array' });
    const VALID_RATES = new Set(['1','2','3','4','5']);
    const filtered = rates.filter((r: string) => VALID_RATES.has(String(r))).map(String);
    if (filtered.length === 0) return res.status(400).json({ message: 'Selecione pelo menos uma taxa de crescimento' });
    await dbStorage.updateAccuGrowthRates(req.user.id, filtered);
    console.log(`📈 [ACCU] Usuário ${req.user.id} atualizou growth rates: ${filtered.join(', ')}%`);
    res.json({ success: true, rates: filtered });
  }));

  app.put('/api/trading/modality-frequency', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { frequency } = req.body;
    if (typeof frequency !== 'object' || Array.isArray(frequency)) {
      return res.status(400).json({ message: 'frequency deve ser um objeto { modality_id: level }' });
    }
    const VALID_LEVELS = new Set(['low','normal','high']);
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(frequency)) {
      if (VALID_LEVELS.has(String(v))) cleaned[k] = String(v);
    }
    await dbStorage.updateModalityFrequency(req.user.id, cleaned);
    console.log(`⚡ [FREQ] Usuário ${req.user.id} atualizou frequência de modalidades`);
    res.json({ success: true, frequency: cleaned });
  }));

  app.put('/api/trading/accu-ticks-per-rate', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { ticks } = req.body;
    if (typeof ticks !== 'object' || Array.isArray(ticks)) {
      return res.status(400).json({ message: 'ticks deve ser um objeto { rate: number }' });
    }
    const VALID_RATES = new Set(['1','2','3','4','5']);
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(ticks)) {
      if (VALID_RATES.has(k)) {
        const n = Math.round(Number(v));
        if (n >= 1 && n <= 30) cleaned[k] = n;
      }
    }
    await dbStorage.updateAccuTicksPerRate(req.user.id, cleaned);
    console.log(`⏱️ [ACCU-TICKS] Usuário ${req.user.id} atualizou ticks por taxa: ${JSON.stringify(cleaned)}`);
    res.json({ success: true, ticks: cleaned });
  }));

  app.put('/api/trading/modality-ticks', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { ticks } = req.body;
    if (typeof ticks !== 'object' || Array.isArray(ticks)) {
      return res.status(400).json({ message: 'ticks deve ser um objeto { modality_id: number }' });
    }
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(ticks)) {
      const n = Math.round(Number(v));
      if (n >= 1 && n <= 10) cleaned[k] = n;
    }
    await dbStorage.updateModalityTicks(req.user.id, cleaned);
    console.log(`⏱️ [MOD-TICKS] Usuário ${req.user.id} atualizou ticks de modalidades: ${JSON.stringify(cleaned)}`);
    res.json({ success: true, ticks: cleaned });
  }));

  // =========================== MARKET DATA & REAL-TIME ===========================

  app.get('/api/trading/market-data/:symbol', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const { symbol } = req.params;
      const marketDataInfo = await dbStorage.getMarketData(symbol);
      
      if (!marketDataInfo) {
        return res.status(404).json({ message: 'Dados de mercado não encontrados' });
      }

      const priceHistory = JSON.parse(marketDataInfo.priceHistory);
      
      res.json({
        symbol: marketDataInfo.symbol,
        currentPrice: marketDataInfo.currentPrice,
        priceHistory: priceHistory,
        lastUpdate: marketDataInfo.lastUpdate
      });

    } catch (error) {
      console.error('❌ Erro ao buscar dados de mercado:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  // =========================== AI ANALYSIS ===========================

  app.get('/api/trading/ai-analysis', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      
      // Buscar logs de IA mais recentes
      const logs = await dbStorage.getUserAiLogs(userId, 5);
      
      res.json({
        available: logs.length > 0,
        latestAnalysis: logs.length > 0 ? {
          modelName: logs[0].modelName,
          decision: logs[0].decision,
          confidence: logs[0].confidence,
          timestamp: logs[0].createdAt
        } : null,
        totalAnalyses: logs.length
      });

    } catch (error) {
      console.error('❌ Erro ao buscar análises IA:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  });

  app.post('/api/trading/ai-analysis', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const { symbol, duration } = req.body;
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;

      if (!symbol || !duration) {
        return res.status(400).json({ message: 'Symbol e duration são obrigatórios' });
      }

      // Get market data for analysis
      const marketDataInfo = await dbStorage.getMarketData(symbol);
      if (!marketDataInfo) {
        return res.status(404).json({ message: 'Dados de mercado não disponíveis' });
      }

      const priceHistory = JSON.parse(marketDataInfo.priceHistory);
      
      // Prepare tick data for AI analysis
      const tickData = priceHistory.map((price: number, index: number) => ({
        symbol,
        quote: price,
        epoch: Date.now() - (priceHistory.length - index) * 1000
      }));

      // Run AI analysis
      console.log(`🤖 Iniciando análise IA para ${symbol} com ${tickData.length} dados`);
      const aiConsensus = await huggingFaceAI.analyzeMarketData(tickData, symbol);

      // Store AI logs
      const aiLogPromises = aiConsensus.analyses.map((analysis: any) => 
        dbStorage.createAiLog({
          userId,
          modelName: analysis.modelName,
          analysis: JSON.stringify({
            prediction: analysis.prediction,
            reasoning: analysis.reasoning,
            confidence: analysis.confidence
          }),
          decision: analysis.prediction,
          confidence: analysis.confidence / 100,
          marketData: JSON.stringify(tickData.slice(-10)) // Last 10 data points
        })
      );

      await Promise.all(aiLogPromises);

      res.json({
        consensus: {
          decision: aiConsensus.finalDecision,
          confidence: aiConsensus.consensusStrength,
          participatingModels: aiConsensus.participatingModels,
          reasoning: aiConsensus.reasoning
        },
        modelAnalyses: aiConsensus.analyses.map(a => ({
          model: a.modelName,
          prediction: a.prediction,
          confidence: a.confidence,
          reasoning: a.reasoning
        })),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erro na análise IA:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro na análise IA', error: errorMessage });
    }
  });

  // =========================== TRADE EXECUTION ===========================

  app.post('/api/trading/execute', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const validation = manualTradeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: 'Dados de trade inválidos', 
          errors: validation.error.format() 
        });
      }

      const { symbol, direction, amount, duration } = validation.data;
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;

      // Check if user has Deriv token configured
      const tokenData = await dbStorage.getUserDerivToken(userId);
      if (!tokenData) {
        return res.status(400).json({ 
          message: 'Token Deriv não configurado' 
        });
      }

      // Get AI analysis first
      const marketDataInfo = await dbStorage.getMarketData(symbol);
      if (!marketDataInfo) {
        return res.status(400).json({ 
          message: 'Dados de mercado não disponíveis para análise' 
        });
      }

      const priceHistory = JSON.parse(marketDataInfo.priceHistory);
      const tickData = priceHistory.map((price: number, index: number) => ({
        symbol,
        quote: price,
        epoch: Date.now() - (priceHistory.length - index) * 1000
      }));

      const aiConsensus = await huggingFaceAI.analyzeMarketData(tickData, symbol);

      // Connect to Deriv and execute trade
      const connected = await derivAPI.connect(tokenData.token, tokenData.accountType as "demo" | "real");
      if (!connected) {
        return res.status(500).json({ 
          message: 'Erro de conexão com Deriv' 
        });
      }

      try {
        // Execute the trade
        const digitDifferContract = {
          contract_type: 'DIGITDIFF' as const,
          symbol,
          duration,
          duration_unit: 't' as const,
          barrier: Math.floor(Math.random() * 10).toString(), // Random digit for digit differs
          amount,
          currency: 'USD'
        };

        const contract = await derivAPI.buyDigitDifferContract(digitDifferContract);
        
        if (!contract) {
          throw new Error('Falha ao executar trade na Deriv');
        }

        // Store trade operation
        const tradeOperation = await dbStorage.createTradeOperation({
          userId,
          derivContractId: contract.contract_id.toString(),
          symbol,
          tradeType: 'digitdiff',
          direction,
          amount,
          duration,
          status: 'active',
          entryPrice: marketDataInfo.currentPrice,
          aiConsensus: JSON.stringify(aiConsensus)
        });

        // 🎯 RASTREAR ATIVO PARA DIVERSIFICAÇÃO
        autoTradingScheduler.trackAssetUsage(userId, symbol);

        res.json({
          message: 'Trade executado com sucesso',
          tradeId: tradeOperation.id,
          contractId: contract.contract_id,
          entryPrice: marketDataInfo.currentPrice,
          aiDecision: aiConsensus.finalDecision,
          aiConfidence: aiConsensus.consensusStrength,
          status: 'active'
        });

      } finally {
        await derivAPI.disconnect();
      }

    } catch (error) {
      console.error('❌ Erro ao executar trade:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro ao executar trade', error: errorMessage });
    }
  });

  // =========================== TRADE MONITORING ===========================

  app.get('/api/trading/operations', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const operations = await dbStorage.getUserTradeOperations(userId, limit);
      
      const formattedOperations = operations.map((op: any) => ({
        id: op.id,
        symbol: op.symbol,
        direction: op.direction,
        amount: op.amount,
        duration: op.duration,
        status: op.status,
        entryPrice: op.entryPrice,
        exitPrice: op.exitPrice,
        profit: op.profit,
        createdAt: op.createdAt,
        completedAt: op.completedAt,
        tradeType: op.tradeType || op.trade_type || null,
        contractType: op.contractType || op.contract_type || null,
        barrier: op.barrier || null,
        aiConsensus: op.aiConsensus ? JSON.parse(op.aiConsensus) : null
      }));

      res.json({ operations: formattedOperations });

    } catch (error) {
      console.error('❌ Erro ao buscar operações:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  // =========================== TRADING ANALYTICS ===========================

  app.get('/api/trading/stats', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      const stats = await dbStorage.getTradingStats(userId);
      
      // activeTrades = apenas pendentes/ativos (não contar expired)
      const activeTrades = Math.max(0, stats.totalTrades - stats.wonTrades - stats.lostTrades - (stats.expiredTrades || 0));
      res.json({
        totalTrades: stats.totalTrades,
        wonTrades: stats.wonTrades,
        lostTrades: stats.lostTrades,
        totalProfit: stats.totalProfit,
        winRate: stats.winRate,
        activeTrades
      });

    } catch (error) {
      console.error('❌ Erro ao buscar estatísticas:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  // =========================== AI LOGS ===========================

  app.get('/api/trading/ai-logs', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const logs = await dbStorage.getUserAiLogs(userId, limit);
      
      const formattedLogs = logs.map((log: any) => {
        let analysis = log.analysis;
        try { analysis = JSON.parse(log.analysis); } catch { /* manter como string */ }
        return {
          id: log.id,
          modelName: log.modelName,
          decision: log.decision,
          confidence: Math.round(log.confidence * 100),
          analysis,
          createdAt: log.createdAt
        };
      });

      res.json(formattedLogs);

    } catch (error) {
      console.error('❌ Erro ao buscar logs IA:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro interno do servidor', error: errorMessage });
    }
  });

  // =========================== LIVE CONTRACT ANALYSIS ===========================

  app.get('/api/trading/live-analysis', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const liveData = contractMonitor.getLiveAnalysis();
      res.json({ contracts: liveData, ts: Date.now() });
    } catch (error) {
      res.json({ contracts: [], ts: Date.now() });
    }
  });

  // =========================== TRADING ASSETS - ALL AVAILABLE SYMBOLS ===========================

  app.get('/api/trading/assets', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }

      // Lista padrão de ativos Deriv DIGITDIFF
      const defaultAssets = [
        // Volatility Indices
        { symbol: 'R_10', displayName: 'Volatility 10', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_25', displayName: 'Volatility 25', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_50', displayName: 'Volatility 50', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_75', displayName: 'Volatility 75', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_100', displayName: 'Volatility 100', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_250', displayName: 'Volatility 250', category: 'Volatility Indices', supportsDigitDiff: true },
        
        // 1Hz Volatility
        { symbol: '1HZ10V', displayName: '1Hz Volatility 10', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ25V', displayName: '1Hz Volatility 25', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ50V', displayName: '1Hz Volatility 50', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ75V', displayName: '1Hz Volatility 75', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ100V', displayName: '1Hz Volatility 100', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ15V', displayName: '1Hz Volatility 15', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ30V', displayName: '1Hz Volatility 30', category: 'High Frequency', supportsDigitDiff: true },
        { symbol: '1HZ90V', displayName: '1Hz Volatility 90', category: 'High Frequency', supportsDigitDiff: true },
        
        // Crash/Boom Indices
        { symbol: 'Crash 300', displayName: 'Crash 300 Index', category: 'Crash/Boom', supportsDigitDiff: true },
        { symbol: 'Crash 500', displayName: 'Crash 500 Index', category: 'Crash/Boom', supportsDigitDiff: true },
        { symbol: 'Crash 1000', displayName: 'Crash 1000 Index', category: 'Crash/Boom', supportsDigitDiff: true },
        { symbol: 'Boom 300', displayName: 'Boom 300 Index', category: 'Crash/Boom', supportsDigitDiff: true },
        { symbol: 'Boom 500', displayName: 'Boom 500 Index', category: 'Crash/Boom', supportsDigitDiff: true },
        { symbol: 'Boom 1000', displayName: 'Boom 1000 Index', category: 'Crash/Boom', supportsDigitDiff: true },
        
        // Jump Indices ⚠️ (Bloqueados por padrão)
        { symbol: 'Jump 10', displayName: 'Jump 10 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
        { symbol: 'Jump 25', displayName: 'Jump 25 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
        { symbol: 'Jump 50', displayName: 'Jump 50 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
        { symbol: 'Jump 75', displayName: 'Jump 75 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
        { symbol: 'Jump 100', displayName: 'Jump 100 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
        
        // Drift Switch Indices
        { symbol: 'DSI 10', displayName: 'Drift Switch 10', category: 'Drift Switch', supportsDigitDiff: true },
        { symbol: 'DSI 20', displayName: 'Drift Switch 20', category: 'Drift Switch', supportsDigitDiff: true },
        { symbol: 'DSI 30', displayName: 'Drift Switch 30', category: 'Drift Switch', supportsDigitDiff: true },
        
        // Step Indices
        { symbol: 'Step 10', displayName: 'Step 10 Index', category: 'Step', supportsDigitDiff: true },
        { symbol: 'Step 25', displayName: 'Step 25 Index', category: 'Step', supportsDigitDiff: true },
        { symbol: 'Step 50', displayName: 'Step 50 Index', category: 'Step', supportsDigitDiff: true },
        
        // Range Break
        { symbol: 'Range Break 100', displayName: 'Range Break 100', category: 'Range Break', supportsDigitDiff: true },
        { symbol: 'Range Break 200', displayName: 'Range Break 200', category: 'Range Break', supportsDigitDiff: true },
        
        // RD Basket
        { symbol: 'RDBULL', displayName: 'RD Bull Index', category: 'RD Basket', supportsDigitDiff: true },
        { symbol: 'RDBEAR', displayName: 'RD Bear Index', category: 'RD Basket', supportsDigitDiff: true },
        
        // Japanese Indices
        { symbol: 'JD10', displayName: 'Japanese Index 10', category: 'Japanese', supportsDigitDiff: true },
        { symbol: 'JD25', displayName: 'Japanese Index 25', category: 'Japanese', supportsDigitDiff: true },
        { symbol: 'JD50', displayName: 'Japanese Index 50', category: 'Japanese', supportsDigitDiff: true },
        { symbol: 'JD75', displayName: 'Japanese Index 75', category: 'Japanese', supportsDigitDiff: true },
        { symbol: 'JD100', displayName: 'Japanese Index 100', category: 'Japanese', supportsDigitDiff: true },
      ];

      const allAssets = marketDataCollector.getAllAssets();
      const supportedSymbols = marketDataCollector.getSupportedSymbols();

      let assets: any[] = [];

      if (allAssets && allAssets.length > 0) {
        // Se temos dados do marketDataCollector, usar eles
        assets = allAssets.map((asset: any) => ({
          symbol: asset.symbol,
          displayName: asset.display_name || asset.symbol,
          category: asset.market_display_name || asset.submarket_display_name || 'Outros',
          supportsDigitDiff: supportedSymbols.includes(asset.symbol),
        }));
      } else {
        // Fallback: usar lista padrão
        assets = defaultAssets;
      }

      res.json(assets);

    } catch (error) {
      console.error('❌ Erro ao buscar ativos disponíveis:', error);
      // Em caso de erro, retornar lista padrão
      const defaultAssets = [
        { symbol: 'R_10', displayName: 'Volatility 10', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_25', displayName: 'Volatility 25', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'R_50', displayName: 'Volatility 50', category: 'Volatility Indices', supportsDigitDiff: true },
        { symbol: 'Jump 10', displayName: 'Jump 10 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
        { symbol: 'Jump 25', displayName: 'Jump 25 Index', category: 'Jump (Risco Alto)', supportsDigitDiff: true },
      ];
      res.json(defaultAssets);
    }
  });

  app.get('/api/trading/assets/discover', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }

      console.log('🔍 Iniciando descoberta de ativos a pedido do usuário...');
      const discovered = await marketDataCollector.discoverAndLoadAllAssets();
      
      const stats = marketDataCollector.getDiscoveryStats();

      res.json({
        success: true,
        message: `Descoberta completa! ${discovered.length} ativos com DIGITDIFF encontrados.`,
        discoveredAssets: discovered.length,
        stats: {
          totalAssetsDiscovered: stats.totalSymbols,
          digitDiffSupported: stats.digitDiffSupported,
          discoveredNow: discovered.length
        }
      });

    } catch (error) {
      console.error('❌ Erro ao descobrir ativos:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ 
        success: false,
        message: 'Erro ao descobrir ativos', 
        error: errorMessage 
      });
    }
  });

  // =========================== DERIV REAL-TIME DATA ===========================

  app.get('/api/trading/realtime-data', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      
      // Dados em tempo real simulados - pode ser integrado com WebSockets no futuro
      res.json({
        lastUpdate: new Date().toISOString(),
        balanceChanged: Math.random() > 0.7, // 30% chance de mudança detectada
        activeOperations: Math.floor(Math.random() * 5),
        marketStatus: 'active'
      });

    } catch (error) {
      console.error('❌ Erro ao buscar dados em tempo real:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  });

  // ── SINGLETON DE SALDO — uma única conexão persistente para consultas de balance ──
  // Separado do derivAPI de trading para não interferir nas operações
  const _balanceCache = new Map<string, { balance: number; currency: string; loginid: string; fetchedAt: number }>();
  const BALANCE_CACHE_TTL_MS = 90000; // 90s — reduz conexões de ~60x/min para ~1x/min
  const _balanceFetching = new Set<string>();
  let _balanceAPI: DerivAPIService | null = null;
  let _balanceAPIToken: string | null = null;

  async function fetchBalanceWithSingleton(token: string, accountType: string): Promise<{ balance: number; currency: string; loginid: string } | null> {
    // Reutilizar singleton se já autenticado com o mesmo token — zero novas conexões
    if (!_balanceAPI || _balanceAPIToken !== token) {
      if (_balanceAPI) {
        await _balanceAPI.disconnect().catch(() => {});
      }
      _balanceAPI = new DerivAPIService('BALANCE_SINGLETON');
      const ok = await _balanceAPI.connect(token, accountType as 'demo' | 'real');
      if (!ok) { _balanceAPI = null; _balanceAPIToken = null; return null; }
      _balanceAPIToken = token;
    }
    try {
      const b = await _balanceAPI.getBalance();
      return b ? { balance: b.balance, currency: b.currency, loginid: b.loginid } : null;
    } catch {
      // Conexão pode ter morrido — resetar singleton para próxima tentativa
      _balanceAPI = null; _balanceAPIToken = null;
      return null;
    }
  }

  app.get('/api/trading/live-balance', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;

      // Servir do cache se ainda válido (90s) — sem nenhuma conexão WebSocket
      const cached = _balanceCache.get(userId);
      if (cached && Date.now() - cached.fetchedAt < BALANCE_CACHE_TTL_MS) {
        return res.json({
          balance: cached.balance,
          currency: cached.currency,
          loginid: cached.loginid,
          connected: true,
          lastUpdate: new Date(cached.fetchedAt).toISOString(),
          cached: true
        });
      }

      // Já buscando? Retornar stale imediatamente para não empilhar conexões
      if (_balanceFetching.has(userId)) {
        const stale = _balanceCache.get(userId);
        return res.json({
          balance: stale?.balance || 0,
          currency: stale?.currency || 'USD',
          loginid: stale?.loginid || 'N/A',
          connected: !!stale,
          lastUpdate: stale ? new Date(stale.fetchedAt).toISOString() : new Date().toISOString(),
          cached: true
        });
      }

      const tokenData = await dbStorage.getUserDerivToken(userId);
      if (!tokenData) {
        return res.status(400).json({ message: 'Token Deriv não configurado', balance: 0, connected: false });
      }

      _balanceFetching.add(userId);
      try {
        const b = await fetchBalanceWithSingleton(tokenData.token, tokenData.accountType);
        const entry = {
          balance: b?.balance || 0,
          currency: b?.currency || 'USD',
          loginid: b?.loginid || 'N/A',
          fetchedAt: Date.now()
        };
        _balanceCache.set(userId, entry);
        _balanceFetching.delete(userId);

        res.json({
          balance: entry.balance,
          currency: entry.currency,
          loginid: entry.loginid,
          connected: !!b,
          lastUpdate: new Date(entry.fetchedAt).toISOString()
        });
      } catch (apiError) {
        _balanceFetching.delete(userId);
        console.error('❌ Erro de API Deriv (live-balance):', apiError);
        const stale = _balanceCache.get(userId);
        res.json({ balance: stale?.balance || 0, connected: !!stale, error: 'Erro de conexão com Deriv' });
      }

    } catch (error) {
      console.error('❌ Erro ao buscar saldo ao vivo:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  });

  // =========================== DAILY P&L HISTORY - DASHBOARD ===========================

  app.get('/api/trading/daily-history', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      
      const userId = req.user.id;
      const today = new Date().toISOString().split('T')[0];
      
      // Buscar PnL diário
      const dailyPnL = await dbStorage.createOrUpdateDailyPnL(userId, {
        openingBalance: 10000,
        currentBalance: 10000,
        dailyPnL: 0
      });
      
      // Buscar todas as operações de hoje
      const todayOperations = await dbStorage.getUserTradeOperations(userId);
      const todayTrades = todayOperations.filter((op: any) => 
        op.createdAt && op.createdAt.split('T')[0] === today
      );
      
      // Calcular stats de hoje
      const completedTrades = todayTrades.filter((t: any) => t.status !== 'pending' && t.profit !== null);
      const wonTrades = completedTrades.filter((t: any) => t.profit > 0).length;
      const lostTrades = completedTrades.filter((t: any) => t.profit < 0).length;
      const totalPnL = completedTrades.reduce((sum: number, t: any) => sum + (t.profit || 0), 0);
      const avgProfit = completedTrades.length > 0 ? totalPnL / completedTrades.length : 0;
      const winRate = completedTrades.length > 0 ? (wonTrades / completedTrades.length) * 100 : 0;
      
      // Agrupar trades por símbolo
      const tradesBySymbol: {[key: string]: any[]} = {};
      todayTrades.forEach((trade: any) => {
        if (!tradesBySymbol[trade.symbol]) {
          tradesBySymbol[trade.symbol] = [];
        }
        tradesBySymbol[trade.symbol].push({
          id: trade.id,
          direction: trade.direction,
          amount: trade.amount,
          profit: trade.profit,
          status: trade.status,
          createdAt: trade.createdAt,
          completedAt: trade.completedAt
        });
      });
      
      // Calcular P&L por símbolo
      const profitBySymbol: {[key: string]: {profit: number, count: number, winRate: number}} = {};
      Object.entries(tradesBySymbol).forEach(([symbol, trades]: [string, any[]]) => {
        const completed = trades.filter(t => t.status !== 'pending' && t.profit !== null);
        const symbolWins = completed.filter(t => t.profit > 0).length;
        const totalProfit = completed.reduce((sum, t) => sum + (t.profit || 0), 0);
        const symbolWinRate = completed.length > 0 ? (symbolWins / completed.length) * 100 : 0;
        
        profitBySymbol[symbol] = {
          profit: totalProfit,
          count: completed.length,
          winRate: symbolWinRate
        };
      });
      
      res.json({
        date: today,
        summary: {
          totalTrades: todayTrades.length,
          completedTrades: completedTrades.length,
          pendingTrades: todayTrades.filter((t: any) => t.status === 'pending').length,
          wonTrades,
          lostTrades,
          totalPnL: Math.round(totalPnL * 100) / 100,
          avgProfit: Math.round(avgProfit * 100) / 100,
          winRate: Math.round(winRate * 100) / 100,
          maxProfit: Math.max(...completedTrades.map(t => t.profit || 0), 0),
          maxLoss: Math.min(...completedTrades.map(t => t.profit || 0), 0)
        },
        dailyPnLRecord: dailyPnL ? {
          openingBalance: dailyPnL.openingBalance,
          currentBalance: dailyPnL.currentBalance,
          dailyPnL: dailyPnL.dailyPnL,
          maxDrawdown: dailyPnL.maxDrawdown,
          isRecoveryActive: dailyPnL.isRecoveryActive,
          recoveryOperations: dailyPnL.recoveryOperations
        } : null,
        profitBySymbol,
        recentTrades: todayTrades.slice(0, 20).map((t: any) => ({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          amount: t.amount,
          profit: t.profit,
          status: t.status,
          createdAt: t.createdAt,
          completedAt: t.completedAt
        }))
      });
      
    } catch (error) {
      console.error('❌ Erro ao buscar histórico diário:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro ao buscar histórico diário', error: errorMessage });
    }
  });

  // =========================== ASSET LOSS ANALYSIS - Verificar perdas por repetição ===========================

  app.get('/api/trading/asset-loss-analysis', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      
      const userId = req.user.id;
      
      // Buscar todas as operações fechadas do usuário
      const allOperations = await dbStorage.getUserTradeOperations(userId);
      const completedTrades = allOperations.filter((t: any) => t.status !== 'pending' && t.profit !== null);
      
      // Agrupar trades por símbolo para análise de repetição
      const assetStats: {[key: string]: {
        totalTrades: number;
        consecutiveOpens: number;
        totalPnL: number;
        wins: number;
        losses: number;
        avgProfit: number;
        winRate: number;
        recentTrades: any[];
      }} = {};
      
      completedTrades.forEach((trade: any, index: number) => {
        if (!assetStats[trade.symbol]) {
          assetStats[trade.symbol] = {
            totalTrades: 0,
            consecutiveOpens: 0,
            totalPnL: 0,
            wins: 0,
            losses: 0,
            avgProfit: 0,
            winRate: 0,
            recentTrades: []
          };
        }
        
        const stat = assetStats[trade.symbol];
        stat.totalTrades++;
        stat.totalPnL += trade.profit || 0;
        if (trade.profit > 0) stat.wins++;
        if (trade.profit < 0) stat.losses++;
        stat.recentTrades.push({
          profit: trade.profit,
          createdAt: trade.createdAt,
          completedAt: trade.completedAt
        });
      });
      
      // Calcular estatísticas e detectar padrão de repetição excessiva
      const analysis: {[key: string]: any} = {};
      let totalConsecutive = 0;
      
      Object.entries(assetStats).forEach(([symbol, stat]) => {
        stat.avgProfit = stat.totalTrades > 0 ? stat.totalPnL / stat.totalTrades : 0;
        stat.winRate = stat.totalTrades > 0 ? (stat.wins / stat.totalTrades) * 100 : 0;
        
        // Detectar trades consecutivos do MESMO ativo (indicador de repetição excessiva)
        const recentSortedTrades = stat.recentTrades.slice(-20).reverse(); // Últimos 20
        let consecutive = 0;
        
        recentSortedTrades.forEach((trade: any, idx: number) => {
          if (idx > 0) {
            const prevTrade = recentSortedTrades[idx - 1];
            const timeDiff = new Date(trade.createdAt).getTime() - new Date(prevTrade.createdAt).getTime();
            if (timeDiff < 5 * 60 * 1000) { // Menos de 5 minutos de diferença
              consecutive++;
            }
          }
        });
        
        stat.consecutiveOpens = consecutive;
        totalConsecutive += consecutive;
        
        analysis[symbol] = {
          totalTrades: stat.totalTrades,
          totalPnL: Math.round(stat.totalPnL * 100) / 100,
          wins: stat.wins,
          losses: stat.losses,
          winRate: Math.round(stat.winRate * 100) / 100,
          avgProfit: Math.round(stat.avgProfit * 100) / 100,
          consecutiveOpens: stat.consecutiveOpens,
          riskLevel: stat.consecutiveOpens > 3 ? 'HIGH - Repetição excessiva detectada!' : 
                     stat.consecutiveOpens > 1 ? 'MEDIUM - Alguma repetição' : 'LOW - Bem diversificado'
        };
      });
      
      // Encontrar ativo com MAIS perdas por repetição
      const assetsByLoss = Object.entries(analysis)
        .sort((a, b) => (a[1].totalPnL || 0) - (b[1].totalPnL || 0));
      
      res.json({
        summary: {
          totalAssets: Object.keys(analysis).length,
          totalTrades: completedTrades.length,
          totalConsecutiveOpens: totalConsecutive,
          overallPnL: Math.round(completedTrades.reduce((sum: number, t: any) => sum + (t.profit || 0), 0) * 100) / 100,
          recommendation: totalConsecutive > 5 ? '⚠️ REPETIÇÃO EXCESSIVA DETECTADA - Use diversificação entre ativos!' : 
                         '✅ Padrão de diversificação saudável'
        },
        assetPerformance: analysis,
        worstPerformer: assetsByLoss[0] ? {
          symbol: assetsByLoss[0][0],
          pnl: assetsByLoss[0][1].totalPnL,
          consecutiveOpens: assetsByLoss[0][1].consecutiveOpens,
          reason: assetsByLoss[0][1].consecutiveOpens > 3 ? 'Repetição excessiva causando perdas' : 'Taxa de ganho baixa'
        } : null,
        bestPerformer: assetsByLoss[assetsByLoss.length - 1] ? {
          symbol: assetsByLoss[assetsByLoss.length - 1][0],
          pnl: assetsByLoss[assetsByLoss.length - 1][1].totalPnL,
          winRate: assetsByLoss[assetsByLoss.length - 1][1].winRate
        } : null
      });
      
    } catch (error) {
      console.error('❌ Erro ao analisar perdas por ativo:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro ao analisar perdas por ativo', error: errorMessage });
    }
  });

  // =========================== RESET COOLDOWN SYSTEM (TPM - Total Productive Maintenance) ===========================

  app.post('/api/trading/reset-cooldown', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }

      const result = autoTradingScheduler.resetCooldownSystem(req.user.id);
      
      res.json({
        success: true,
        message: `Sistema desbloqueado! ${result.cleared} ativos liberados`,
        cleared: result.cleared,
        reason: result.reason,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erro ao resetar cool-off:', error);
      res.status(500).json({ message: 'Erro ao resetar sistema', error });
    }
  });

  // =========================== RESET TOTAL DE DADOS OPERACIONAIS ===========================

  app.post('/api/trading/reset-all-data', isAuthenticated, isTradingAuthorized, async (req: any, res: any) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: 'Usuário não autenticado' });

      // 1. Pausar o scheduler se estiver ativo
      autoTradingScheduler.clearAllSessions();

      // 2. Resetar memória em tempo real
      realStatsTracker.resetUserMemory(userId);

      // 3. Limpar dados do banco
      const result = await dbStorage.resetAllTradingData(userId);

      console.log(`🧹 [RESET] Usuário ${userId} executou reset completo: ${result.rowsDeleted} registros removidos de ${result.tablesCleared.length} tabelas`);

      res.json({
        success: true,
        message: `Reset concluído com sucesso`,
        rowsDeleted: result.rowsDeleted,
        tablesCleared: result.tablesCleared,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erro no reset de dados:', error);
      res.status(500).json({ message: 'Erro ao executar reset', error: String(error) });
    }
  });

  // =========================== SYSTEM HEALTH STATUS (TPM - Total Productive Maintenance) ===========================

  app.get('/api/trading/system-health', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const health = autoTradingScheduler.getAssetHealthStatus();
      
      res.json({
        health,
        message: health.healthy ? '✅ Sistema saudável' : '⚠️ Bottlenecks detectados',
        recommendation: health.bottlenecks.length > 0 
          ? `Ativos com problemas: ${health.bottlenecks.map(b => `${b.symbol} (${b.winRate.toFixed(1)}%)`).join(', ')}`
          : 'Todas os ativos operando normalmente',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erro ao verificar saúde do sistema:', error);
      res.status(500).json({ message: 'Erro ao verificar sistema', error });
    }
  });

  // =========================== AI HEALTH METRICS (TPM - Total Production Maintenance) ===========================

  app.get('/api/trading/ai-health', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const report = tpmSystem.getHealthReport();
      
      res.json({
        success: true,
        tpm: report,
        message: `🔧 TPM: ${report.healthSummary.healthy}✅ ${report.healthSummary.degraded}⚠️ ${report.healthSummary.critical}🔴 ${report.healthSummary.maintenance}🛠️`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erro ao buscar TPM:', error);
      res.status(500).json({ message: 'Erro ao buscar métricas TPM', error });
    }
  });

  // =========================== TPM TRADE FEEDBACK (Real-time integration) ===========================

  app.post('/api/trading/tpm-feedback', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      const { modelId, symbol, profit, won, responseTime, stake } = req.body;

      if (!modelId || !symbol) {
        return res.status(400).json({ message: 'modelId e symbol obrigatórios' });
      }

      tpmSystem.recordTradeResult(modelId, symbol, profit || 0, won || false, responseTime || 100, stake || 1);

      res.json({
        success: true,
        message: `📊 Feedback registrado para ${modelId}`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erro ao registrar feedback TPM:', error);
      res.status(500).json({ message: 'Erro ao registrar feedback', error });
    }
  });

  // Iniciar TPM monitoring
  tpmSystem.startMonitoring();

  // =========================== DERIV ACCOUNT INFO ===========================

  app.get('/api/trading/account-info', isAuthenticated, isTradingAuthorized, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Usuário não autenticado' });
      }
      const userId = req.user.id;
      const tokenData = await dbStorage.getUserDerivToken(userId);
      
      if (!tokenData) {
        return res.status(400).json({ 
          message: 'Token Deriv não configurado' 
        });
      }

      const connected = await derivAPI.connect(tokenData.token, tokenData.accountType as "demo" | "real");
      if (!connected) {
        return res.status(500).json({ 
          message: 'Erro de conexão com Deriv' 
        });
      }

      try {
        const balance = await derivAPI.getBalance();
        
        res.json({
          balance: balance?.balance || 0,
          currency: balance?.currency || 'USD',
          loginid: balance?.loginid || 'N/A',
          accountType: tokenData.accountType,
          connected: true
        });

      } finally {
        await derivAPI.disconnect();
      }

    } catch (error) {
      console.error('❌ Erro ao buscar info da conta:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: 'Erro ao conectar com Deriv', error: errorMessage });
    }
  });

  // =================== ASSET BLACKLIST & PAUSE CONFIG ROUTES ===================

  // Criar blacklist de ativos
  app.post('/api/trading/asset-blacklist', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { assetPattern, patternType, reason } = req.body;
    const userId = req.user.id;
    
    const blacklist = await dbStorage.createAssetBlacklist({
      userId,
      assetPattern,
      patternType,
      reason,
      isActive: true,
    });
    
    res.json({ success: true, blacklist });
  }));

  // Obter lista de blacklist do usuário
  app.get('/api/trading/asset-blacklist', isAuthenticated, isTradingAuthorized, async (req: any, res: any) => {
    const userId = req.user.id;
    const blacklists = await dbStorage.getUserAssetBlacklists(userId);
    res.json(blacklists);
  });

  // Remover item da blacklist
  app.delete('/api/trading/asset-blacklist/:id', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { id } = req.params;
    await dbStorage.deleteAssetBlacklist(id);
    res.json({ success: true, message: 'Removido da blacklist' });
  }));

  // Verificar se ativo está bloqueado
  app.get('/api/trading/asset-blocked/:symbol', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { symbol } = req.params;
    const userId = req.user.id;
    const isBlocked = await dbStorage.isAssetBlocked(userId, symbol);
    res.json({ isBlocked, symbol });
  }));

  // Obter configuração de pausas do usuário
  app.get('/api/trading/pause-config', isAuthenticated, isTradingAuthorized, async (req: any, res: any) => {
    const userId = req.user.id;
    let config = await dbStorage.getUserPauseConfig(userId);
    
    if (!config) {
      config = await dbStorage.createPauseConfig({
        userId,
        isEnabled: true,
        operatingDurationMinutes: 15,
        pauseDurationMinSeconds: 60,
        pauseDurationMaxSeconds: 180,
        useTechnicalAnalysisConsensus: true,
        minAIConsensusForPause: 0.7,
        isPausedNow: false,
      });
    }
    
    res.json(config);
  });

  // Atualizar configuração de pausas
  app.put('/api/trading/pause-config', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const config = await dbStorage.updatePauseConfig(userId, req.body);
    res.json(config);
  }));

  // Atualizar status de pausa (pausado agora ou não)
  app.post('/api/trading/pause-status', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
    const { isPausedNow } = req.body;
    const userId = req.user.id;
    await dbStorage.updatePausedNowStatus(userId, isPausedNow);
    res.json({ success: true, isPausedNow });
  }));

  // =================== END TRADING SYSTEM ROUTES ===================

  // Endpoint especial para inicializar conta de dono (apenas desenvolvimento)
  app.post('/api/admin/init-owner', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      // Verificar se o email é autorizado
      if (!isAuthorizedEmail(email)) {
        return res.status(403).json({ message: 'Email não autorizado para conta de dono' });
      }

      // Verificar se já existe
      const existing = await dbStorage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: 'Conta já existe! Use a página de login.' });
      }

      // Criar conta com dados padrão
      const passwordHash = await hashPassword(password);
      const user = await dbStorage.createUser({
        email,
        passwordHash,
        nomeCompleto: email === 'vfdiogoseg@gmail.com' ? 'Victor Felipe Diogo' : 'Carlos Eduardo Saturnino',
        cpf: email === 'vfdiogoseg@gmail.com' ? '12345678901' : '98765432100',
        telefone: '(11) 99999-9999',
        endereco: 'Rua Principal, 123',
        cidade: 'São Paulo',
        estado: 'SP',
        cep: '01000-000',
        chavePix: email,
        tipoChavePix: 'email',
        telefoneVerificado: true,
        contaAprovada: true,
        documentosVerificados: true,
        isAdmin: true,
        saldo: 0
      });

      console.log(`✅ Conta de dono criada: ${user.email}`);
      res.json({ 
        message: 'Conta de dono criada com sucesso! Faça login agora.',
        email: user.email 
      });
    } catch (error) {
      console.error('❌ Erro ao criar conta de dono:', error);
      res.status(500).json({ message: 'Erro ao criar conta de dono' });
    }
  });

  // ===== VIRTUAL DESKTOP / MT5 ROUTES =====
  const { virtualDesktop } = await import('./services/virtual-desktop');
  const { mkdirSync, writeFileSync, existsSync: fsExists, readdirSync, statSync } = await import('fs');
  const pathMod = await import('path');

  function findMT5ExeInUpload(dir: string): string | null {
    if (!fsExists(dir)) return null;
    const candidates = ['terminal64.exe', 'terminal.exe', 'metatrader5.exe', 'mt5.exe'];
    function walk(d: string): string | null {
      let entries: string[];
      try { entries = readdirSync(d); } catch { return null; }
      for (const entry of entries) {
        const full = pathMod.join(d, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            const found = walk(full);
            if (found) return found;
          } else if (candidates.includes(entry.toLowerCase())) {
            return full;
          }
        } catch {}
      }
      return null;
    }
    return walk(dir);
  }

  const MT5_UPLOAD_DIR = pathMod.resolve(process.cwd(), 'mt5-uploaded');

  // Multer setup for folder upload (memory storage to preserve paths)
  const mt5UploadStorage = multer.memoryStorage();
  const mt5Upload = multer({
    storage: mt5UploadStorage,
    limits: { fileSize: 500 * 1024 * 1024, files: 5000 }, // 500MB per file, up to 5000 files
  });

  app.get('/api/desktop/status', isAuthenticated, (req, res) => {
    const status = virtualDesktop.getStatus();
    // Check if MT5 was uploaded manually
    const uploadedExe = findMT5ExeInUpload(MT5_UPLOAD_DIR);
    res.json({ ...status, mt5Uploaded: !!uploadedExe, mt5UploadedExe: uploadedExe || null });
  });

  app.post('/api/desktop/start', isAuthenticated, async (req, res) => {
    const result = await virtualDesktop.start();
    res.json(result);
  });

  app.post('/api/desktop/stop', isAuthenticated, async (req, res) => {
    await virtualDesktop.stop();
    res.json({ success: true });
  });

  app.post('/api/desktop/install-mt5', isAuthenticated, async (req, res) => {
    const result = await virtualDesktop.startOrInstallMT5();
    res.json(result);
  });

  // Upload entire MT5 folder (files sent with their relative paths as originalname)
  app.post('/api/desktop/upload-mt5-folder', isAuthenticated, mt5Upload.array('files', 5000), async (req: any, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum arquivo recebido.' });
      }

      // Clear upload dir only on first chunk
      const isFirst = req.body?.isFirst === 'true';
      if (isFirst) {
        const { rmSync } = await import('fs');
        try { rmSync(MT5_UPLOAD_DIR, { recursive: true, force: true }); } catch {}
      }
      mkdirSync(MT5_UPLOAD_DIR, { recursive: true });

      let savedCount = 0;
      for (const file of files) {
        // originalname contains the relative path (e.g. "MetaTrader 5/terminal64.exe")
        const relativePath = file.originalname.replace(/\\/g, '/');
        const targetPath = pathMod.join(MT5_UPLOAD_DIR, relativePath);
        const targetDir = pathMod.dirname(targetPath);
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(targetPath, file.buffer);
        savedCount++;
      }

      const exePath = findMT5ExeInUpload(MT5_UPLOAD_DIR);
      res.json({ success: true, filesUploaded: savedCount, exeFound: exePath || null });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Launch uploaded MT5 folder exe via Wine
  app.post('/api/desktop/launch-uploaded-mt5', isAuthenticated, async (req, res) => {
    const exePath = findMT5ExeInUpload(MT5_UPLOAD_DIR);
    if (!exePath) {
      return res.status(400).json({ success: false, error: 'Nenhum executável MT5 encontrado na pasta enviada.' });
    }
    if (virtualDesktop.getStatus().status !== 'running') {
      return res.status(400).json({ success: false, error: 'Desktop virtual não está rodando. Inicie-o primeiro.' });
    }
    const result = await virtualDesktop.launchExe(exePath);
    res.json(result);
  });

  // Chunked archive upload — accepts ZIP/RAR/7z in 50MB pieces, assembles & extracts with 7z
  const CHUNK_TEMP_DIR = pathMod.resolve(process.cwd(), 'mt5-upload-chunks');
  const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per chunk
  });

  app.post('/api/desktop/upload-mt5-chunk', isAuthenticated, chunkUpload.single('chunk'), async (req: any, res) => {
    try {
      const chunk = req.file;
      if (!chunk) return res.status(400).json({ success: false, error: 'Nenhum chunk recebido.' });

      const chunkIndex = parseInt(req.body.chunkIndex || '0', 10);
      const totalChunks = parseInt(req.body.totalChunks || '1', 10);
      const fileName = (req.body.fileName || 'archive').replace(/[^a-zA-Z0-9._-]/g, '_');
      const { appendFileSync, rmSync: rmS, mkdirSync: mkD } = await import('fs');

      // On first chunk, clear previous temp & upload dirs
      if (chunkIndex === 0) {
        try { rmS(CHUNK_TEMP_DIR, { recursive: true, force: true }); } catch {}
        try { rmS(MT5_UPLOAD_DIR, { recursive: true, force: true }); } catch {}
        mkD(CHUNK_TEMP_DIR, { recursive: true });
      }

      const assembledPath = pathMod.join(CHUNK_TEMP_DIR, fileName);
      appendFileSync(assembledPath, chunk.buffer);

      // If this is the last chunk — extract with 7z
      if (chunkIndex === totalChunks - 1) {
        mkdirSync(MT5_UPLOAD_DIR, { recursive: true });
        const { execSync } = await import('child_process');
        try {
          // Extract to a temp subfolder first to detect top-level dir
          const tmpExtract = pathMod.join(CHUNK_TEMP_DIR, 'extracted');
          try { rmS(tmpExtract, { recursive: true, force: true }); } catch {}
          mkD(tmpExtract, { recursive: true });

          execSync(`7z x "${assembledPath}" -o"${tmpExtract}" -y`, { stdio: 'pipe', timeout: 120000 });

          // Check if everything is under one top-level folder
          const { readdirSync: rdSync, statSync: stSync } = await import('fs');
          const topEntries = rdSync(tmpExtract);
          let srcDir = tmpExtract;
          if (topEntries.length === 1 && stSync(pathMod.join(tmpExtract, topEntries[0])).isDirectory()) {
            srcDir = pathMod.join(tmpExtract, topEntries[0]);
          }

          // Move files from srcDir to MT5_UPLOAD_DIR
          execSync(`cp -r "${srcDir}/." "${MT5_UPLOAD_DIR}/"`, { stdio: 'pipe' });
          try { rmS(CHUNK_TEMP_DIR, { recursive: true, force: true }); } catch {}

          const count = (await import('fs')).readdirSync(MT5_UPLOAD_DIR, { recursive: true } as any).filter((f: any) => typeof f === 'string').length;
          const exePath = findMT5ExeInUpload(MT5_UPLOAD_DIR);
          return res.json({ success: true, done: true, filesExtracted: count, exeFound: exePath || null });
        } catch (extractErr: any) {
          return res.status(500).json({ success: false, error: `Erro ao extrair: ${extractErr.message}` });
        }
      }

      res.json({ success: true, done: false, chunkIndex });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get upload status
  app.get('/api/desktop/upload-status', isAuthenticated, (req, res) => {
    const exePath = findMT5ExeInUpload(MT5_UPLOAD_DIR);
    res.json({ uploaded: !!exePath, exePath: exePath || null, uploadDir: MT5_UPLOAD_DIR });
  });

  const INTERNAL_SECRET = 'internal-desktop-ctrl-9f3a';
  const isInternal = (req: any, res: any, next: any) => {
    if (req.headers['x-internal-key'] === INTERNAL_SECRET) return next();
    res.status(403).json({ error: 'forbidden' });
  };

  app.get('/api/internal/desktop/status', isInternal, (req, res) => {
    res.json(virtualDesktop.getStatus());
  });

  app.post('/api/internal/desktop/start', isInternal, async (req, res) => {
    const result = await virtualDesktop.start();
    res.json(result);
  });

  app.post('/api/internal/desktop/stop', isInternal, async (req, res) => {
    await virtualDesktop.stop();
    res.json({ success: true });
  });

  app.post('/api/internal/desktop/install-mt5', isInternal, async (req, res) => {
    const result = await virtualDesktop.startOrInstallMT5();
    res.json(result);
  });

  const httpServer = createServer(app);
  return httpServer;
}
