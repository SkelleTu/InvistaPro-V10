import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { whatsappService } from "./whatsappService";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db";
import { initializeMarketingSystem } from "./marketingEmailService";
import { errorTracker } from "./services/error-tracker";
import { globalErrorHandler, requestLogger } from "./middleware/error-handler";
import cron from "node-cron";
import fetch from "node-fetch";
import { autoTradingScheduler } from "./services/auto-trading-scheduler";
import { resilienceSupervisor } from "./services/resilience-supervisor";
import { derivAPI } from "./services/deriv-api";
import { createDatabaseBackup } from "./database-backup";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Sistema avançado de error tracking
// Validação crítica da ENCRYPTION_KEY no boot do servidor (com retry para Replit)
console.log('🔐 Validando configuração de criptografia...');
const validateEncryption = () => {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn('⚠️ ENCRYPTION_KEY não encontrada, aguardando carregamento das secrets...');
    return false;
  }
  
  const trimmedKey = encryptionKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
    console.warn(`⚠️ ENCRYPTION_KEY inválida: ${trimmedKey.length} caracteres, esperado 64`);
    return false;
  }
  
  console.log('✅ ENCRYPTION_KEY validada com sucesso!');
  return true;
};

// Validação bloqueante com polling para ambiente Replit
const waitForEncryption = async () => {
  const maxWaitTime = 15000; // 15 segundos máximo (aumentado para Replit)
  const pollInterval = 500; // Check a cada 500ms
  const startTime = Date.now();
  
  while ((Date.now() - startTime) < maxWaitTime) {
    if (validateEncryption()) {
      return true;
    }
    console.log('🔄 Aguardando carregamento das environment variables...');
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  console.warn('⚠️ AVISO: ENCRYPTION_KEY não validada após 15s - continuando em modo degradado');
  console.warn('⚠️ Algumas funcionalidades de criptografia podem não funcionar corretamente');
  return false; // Permite continuar sem exit
};

console.log('🔍 Inicializando sistema avançado de error tracking...');
console.log('🔥 Configurando handlers globais para exceções não tratadas...');
// Os handlers globais já foram configurados automaticamente no constructor do errorTracker
app.use(requestLogger);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Validação bloqueante da ENCRYPTION_KEY antes de tudo
  if (!validateEncryption()) {
    await waitForEncryption();
  }
  // Inicializar banco de dados local
  initializeDatabase();
  
  // 🛡️ SISTEMA DE BACKUP AUTOMÁTICO DO BANCO DE DADOS
  console.log('💾 Configurando sistema de backup automático...');
  
  // Backup inicial ao iniciar
  createDatabaseBackup();
  
  // Backup automático a cada 6 horas
  cron.schedule('0 */6 * * *', () => {
    console.log('⏰ Executando backup automático programado...');
    createDatabaseBackup();
  });
  
  // Backup diário às 03:00 AM
  cron.schedule('0 3 * * *', () => {
    console.log('🌙 Executando backup diário noturno...');
    createDatabaseBackup();
  });
  
  console.log('✅ Sistema de backup automático ativado!');
  console.log('   📦 Backups a cada 6 horas + diário às 03:00');
  console.log('   📁 Backups salvos em: database-backups/');
  console.log('   🗑️ Mantendo últimos 30 backups');
  
  // Inicializar ResilienceSupervisor antes de tudo
  console.log('🛡️ Inicializando ResilienceSupervisor...');
  await resilienceSupervisor.start();
  
  // Conectar eventos de restart aos componentes
  resilienceSupervisor.on('restart_scheduler', async () => {
    console.log('🔄 Reiniciando AutoTradingScheduler por solicitação do ResilienceSupervisor...');
    try {
      autoTradingScheduler.stopScheduler();
      await autoTradingScheduler.startScheduler();
      console.log('✅ AutoTradingScheduler reiniciado com sucesso');
    } catch (error) {
      console.error('❌ Erro ao reiniciar AutoTradingScheduler:', error);
    }
  });
  
  resilienceSupervisor.on('restart_websocket', async () => {
    console.log('🔄 Reiniciando WebSocket por solicitação do ResilienceSupervisor...');
    // O DerivAPI já tem reconexão automática, apenas logar
    console.log('ℹ️ WebSocket tem reconexão automática integrada');
  });
  
  console.log('✅ ResilienceSupervisor ativo e monitorando componentes');
  
  // Inicializar serviço WhatsApp (não bloqueia a inicialização do servidor)
  console.log('🤖 Inicializando serviço de notificações WhatsApp...');
  
  // Inicializar sistema de marketing automático
  console.log('📧 Inicializando sistema de marketing por email...');
  initializeMarketingSystem();
  
  // 🔍 SISTEMA DE DEBUG/MONITORAMENTO INTERNO (Apenas para logs)
  // NOTA: Keep-alive interno NÃO impede hibernação no Replit!
  // Apenas tráfego HTTP EXTERNO mantém o servidor ativo.
  
  const keepWorkspaceAlive = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/status', {
        method: 'GET',
        headers: { 'X-Internal-Debug': 'true' }
      });
      
      if (response.ok) {
        const data = await response.json() as any;
        const uptimeHours = Math.floor((data.uptime || process.uptime()) / 3600);
        const uptimeMinutes = Math.floor(((data.uptime || process.uptime()) % 3600) / 60);
        console.log(`💚 [DEBUG] Sistema ativo | ⏱️  ${uptimeHours}h ${uptimeMinutes}m | ${new Date().toLocaleTimeString('pt-BR')}`);
      }
    } catch (error) {
      console.log(`💛 [DEBUG] Sistema operando... | ${new Date().toLocaleTimeString('pt-BR')}`);
    }
  };
  
  const server = await registerRoutes(app);

  // Middleware avançado de error handling (deve ser o último middleware)
  app.use(globalErrorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  console.log(`🚀 [DEBUG] Iniciando servidor na porta ${port}...`);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, async () => {
    log(`serving on port ${port}`);
    
    // Inicializar Auto Trading Scheduler DEPOIS que o servidor estiver rodando
    console.log('🤖 Inicializando Auto Trading Scheduler...');
    autoTradingScheduler.startScheduler().then(() => {
      console.log('✅ Sistema de trades automáticos ativo e RODANDO!');
      console.log('📊 Monitora configurações ativas a cada 5 segundos');
      console.log('🔥 Sistema iniciará automaticamente sempre que o app for executado!');
    }).catch((error) => {
      console.error('❌ Erro ao iniciar Auto Trading Scheduler:', error);
    });
    
    // 🔍 SISTEMA DE DEBUG INTERNO (Apenas para logs e monitoramento)
    // ⚠️  IMPORTANTE: Keep-alive interno NÃO impede hibernação no Replit!
    
    // Ping de debug básico a cada 60 segundos (apenas para logs)
    setInterval(keepWorkspaceAlive, 60000);
    
    // Ping inicial após 5 segundos
    setTimeout(keepWorkspaceAlive, 5000);
    
    log('\n' + '='.repeat(80));
    log('⚠️  AVISO IMPORTANTE - CONFIGURAÇÃO ANTI-HIBERNAÇÃO:');
    log('');
    log('❌ O sistema de debug interno NÃO impede hibernação no Replit');
    log('❌ Tráfego localhost é detectado como "auto-tráfego" e ignorado');
    log('');
    log('✅ Para manter o sistema SEMPRE ativo (24/7):');
    log('   1. Acesse: /setup/keepalive na aplicação');
    log('   2. Configure UptimeRobot, Freshping ou similar');
    log('   3. Use qualquer endpoint: /api/ping, /api/status, etc');
    log('   4. Apenas TRÁFEGO EXTERNO impede hibernação');
    log('');
    log('📊 Sistema de debug interno ativo (60s):');
    log('   • Monitora uptime e saúde do sistema');
    log('   • Gera logs para debug');
    log('   • NÃO previne hibernação');
    log('');
    log('🚀 Para 100% de uptime: CONFIGURE PING EXTERNO obrigatório!');
    log('='.repeat(80) + '\n');
  });
})();
