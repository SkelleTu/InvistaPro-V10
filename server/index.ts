import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import net from "net";
import path from "path";
import { registerRoutes } from "./routes";
import { whatsappService } from "./whatsappService";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db";
import { initializeMarketingSystem } from "./marketingEmailService";
import { errorTracker } from "./services/error-tracker";
import { observability, observabilityRequestMiddleware } from "./services/production-observability";
import { globalErrorHandler, requestLogger } from "./middleware/error-handler";
import cron from "node-cron";
import fetch from "node-fetch";
import { isolatedAutoTradingScheduler as autoTradingScheduler } from "./services/isolated-auto-trading-scheduler";
import { resilienceSupervisor } from "./services/resilience-supervisor";
import { marketDataCollector } from "./services/market-data-collector";
import { derivAPI } from "./services/deriv-api";
import { createDatabaseBackup } from "./database-backup";
import { dualStorage as storage } from "./storage-dual";
import { derivTradeSync } from "./services/deriv-trade-sync";
import { realStatsTracker } from "./services/real-stats-tracker";
import { runPostgresMigration } from "./migrate-postgres";
import { initUrlRegistry } from "./services/url-registry";
import { brazilNewsService } from "./services/brazil-news-service";
import { startDerivObservabilityBridge } from "./services/deriv-observability-bridge";
import { startUniversalHeartbeatLoop } from "./services/universal-server-session";

const app = express();
let routesReady = false;
let routeRegistrationError: string | null = null;
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
app.use(observabilityRequestMiddleware);

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
  // REGRA CRÍTICA DE PRODUÇÃO:
  // O servidor HTTP precisa abrir ANTES de qualquer inicialização pesada.
  // O Render pode reiniciar uma instância que demora para aceitar a porta.
  // Por isso /health é registrado primeiro e o servidor é criado/listening agora.
  app.get('/health', (_req, res) => {
    if (!routesReady) return res.status(503).json({ status: 'degraded', routesReady: false, error: routeRegistrationError || 'Routes ainda não registradas' });
    res.status(200).json({ status: 'ok', routesReady: true });
  });

  const server = createServer(app);
  const port = parseInt(process.env.PORT || '5000', 10);
  console.log(`🚀 [BOOT] Abrindo servidor HTTP imediatamente na porta ${port}...`);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({
      port,
      host: "0.0.0.0",
    }, () => { resolve(); });
  });

  log(`serving on port ${port}`);
  app.locals.serviceReady = false;
  console.log('✅ [BOOT] Servidor HTTP online ANTES do registro das rotas. Continuando inicializações...');

  // O frontend estático também precisa estar montado antes das inicializações pesadas.
  // Assim / e /assets continuam respondendo mesmo se algum módulo de backend demorar.
  if (app.get("env") === "development") {
    setupVite(app, server).catch((e: any) => console.warn("⚠️ Vite setup error:", e));
  } else {
    serveStatic(app);
  }

  // Registrar as rotas somente depois que a porta já está aberta.
  // Isso evita que imports, banco, Deriv e outros serviços atrasem o health check do Render.
  try {
    await registerRoutes(app, server);
    routesReady = true;
    app.locals.routesReady = true;
    console.log('✅ [BOOT] Todas as rotas da API foram registradas com sucesso.');
  } catch (routeError: any) {
    routesReady = false;
    app.locals.routesReady = false;
    routeRegistrationError = routeError instanceof Error ? routeError.message : String(routeError);
    console.error('❌ [BOOT] Falha ao registrar rotas após abrir a porta:', routeError);
    observability.captureError(routeError, { level: 'CRITICAL', category: 'BOOT', message: 'Falha crítica no registro das rotas da API', details: { routesReady: false } });
  }

  // SPA fallback MUST come after API routes so /auth, /login and other
  // client-side routes receive index.html without intercepting backend APIs.
  if (app.get("env") !== "development") {
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), "dist", "public", "index.html"));
    });
  }

  // Nunca deixe uma falha de boot de rotas parecer um simples 404/HTML.
  app.use('/api', (req, res, next) => {
    if (!routesReady) {
      return res.status(503).json({
        success: false,
        error: 'API indisponível: falha no registro das rotas durante o boot.',
        routesReady: false,
        detail: routeRegistrationError || 'Falha de inicialização não especificada',
      });
    }
    next();
  });

  // Servir arquivos públicos antes do handler global de erros.
  const rootPublicPath = path.resolve(process.cwd(), 'public');
  app.use(express.static(rootPublicPath));

  // Middleware avançado de error handling.
  app.use(globalErrorHandler);

  // Validação de criptografia não deve bloquear o boot do servidor.
  if (!validateEncryption()) {
    console.warn('⚠️ [BOOT] ENCRYPTION_KEY ainda não está disponível/validada. O servidor continuará online e os recursos que dependem dela poderão aguardar a configuração.');
  }
  
  // Inicializar banco de dados local
  try {
    initializeDatabase();
  } catch (dbError: any) {
    console.error("❌ [BOOT] Banco local não pôde ser inicializado; servidor HTTP continuará ativo:", dbError?.message || dbError);
  }
  
  app.locals.serviceReady = true;
  console.log("✅ [BOOT] Serviço HTTP/rotas/banco local prontos para o Render.");

  // 🗄️ EXECUTAR MIGRAÇÃO POSTGRESQL - SUPORTE A QUALQUER BANCO (REPLIT, SUPABASE, ETC)
  console.log('🗄️ Verificando sincronização com PostgreSQL...');
  const hasPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgresql://') || process.env.DATABASE_URL.startsWith('postgres://'));
  
  if (hasPostgres) {
    const isReplit = process.env.DATABASE_URL!.includes('helium') || process.env.DATABASE_URL!.includes('replit');
    const dbType = isReplit ? 'Replit PostgreSQL (Neon)' : 'PostgreSQL';
    
    console.log(`✨ ${dbType} configurado! Criando schema SQL...`);
    const migrationSuccess = await runPostgresMigration();
    if (migrationSuccess) {
      console.log('✅ ✅ ✅ SINCRONIZAÇÃO COMPLETA!');
      console.log(`   • ${dbType} conectado`);
      console.log('   • Tabelas SQL criadas');
      console.log('   • Dados sincronizados (users, trades, sessions, etc)');
      console.log('   • 2 bancos harmônicos: SQLite (local) + Neon PostgreSQL');
      console.log('   🎉 Sistema Dual-Database 100% OPERACIONAL');
    } else {
      console.warn('⚠️ Não foi possível criar tabelas no PostgreSQL - continuando com SQLite');
    }
  } else {
    console.log('ℹ️ DATABASE_URL PostgreSQL não está configurado');
    console.log('   ⚠️ Sistema funcionando apenas em MODO LOCAL (SQLite)');
    console.log('');
    console.log('   📋 PARA ATIVAR NEON POSTGRESQL:');
    console.log('      1. Obtenha a URL de conexão do Replit Database');
    console.log('      2. Acesse Replit > Secrets (cadeado no painel esquerdo)');
    console.log('      3. Clique em "Create Secret"');
    console.log('      4. Nome: DATABASE_URL');
    console.log('      5. Valor: (cole a URL PostgreSQL)');
    console.log('      6. Clique em "Add Secret"');
    console.log('      7. Reinicie o app');
    console.log('');
    console.log('   ✅ Sistema sincronizará automaticamente SQLite + Neon!');
  }
  
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
  
  // Inicializar ResilienceSupervisor sem bloquear o servidor HTTP.
  console.log('🛡️ Inicializando ResilienceSupervisor em segundo plano...');
  resilienceSupervisor.start().catch((error: any) => {
    console.warn('⚠️ ResilienceSupervisor não iniciou corretamente:', error?.message || error);
  });
  
  // Conectar eventos de restart aos componentes
  resilienceSupervisor.on('restart_scheduler', async () => {
    // Nunca iniciar trading automaticamente por ação do supervisor.
    const status = autoTradingScheduler.getSchedulerStatus();
    if (!status.isRunning) {
      console.log('🛑 [RESILIENCE] Restart do scheduler ignorado: trading está inativo por política de segurança.');
      return;
    }
    console.log('🔄 Reiniciando AutoTradingScheduler de uma sessão já manualmente ativada...');
    try {
      await autoTradingScheduler.stopScheduler();
      await autoTradingScheduler.startScheduler();
      console.log('✅ AutoTradingScheduler reiniciado');
    } catch (error) {
      console.error('❌ Erro ao reiniciar AutoTradingScheduler:', error);
    }
  });
  
  resilienceSupervisor.on('restart_websocket', async () => {
    if (!autoTradingScheduler.getSchedulerStatus().isRunning) {
      console.log('🛑 [RESILIENCE] Restart do WebSocket ignorado: trading inativo.');
      return;
    }
    console.log('🔄 Reiniciando WebSocket por solicitação do ResilienceSupervisor...');
    try {
      // Reiniciar o market data collector (que contém o WebSocket público de ticks)
      const symbols = marketDataCollector.getSupportedSymbols();
      await marketDataCollector.stopCollection();
      await new Promise(r => setTimeout(r, 2000)); // aguardar limpeza
      await marketDataCollector.startCollection(symbols.length > 0 ? symbols : undefined);
      console.log('✅ WebSocket (market data collector) reiniciado com sucesso');
    } catch (error) {
      console.error('❌ Erro ao reiniciar WebSocket:', error);
    }
  });

  resilienceSupervisor.on('restart_market_collector', async () => {
    if (!autoTradingScheduler.getSchedulerStatus().isRunning) {
      console.log('🛑 [RESILIENCE] Restart do MarketDataCollector ignorado: trading inativo.');
      return;
    }
    console.log('🔄 Reiniciando MarketDataCollector por solicitação do ResilienceSupervisor...');
    try {
      await marketDataCollector.stopCollection();
      const symbols = marketDataCollector.getSupportedSymbols();
      await marketDataCollector.startCollection(symbols.length > 0 ? symbols : undefined);
      console.log('✅ MarketDataCollector reiniciado com sucesso');
    } catch (error) {
      console.error('❌ Erro ao reiniciar MarketDataCollector:', error);
    }
  });
  
  console.log('✅ ResilienceSupervisor ativo e monitorando componentes');

  // 🌐 INICIALIZAR URL REGISTRY — Registra URL atual para o EA MT5 auto-descobrir
  console.log('🌐 Inicializando URL Registry para o EA do MT5...');
  initUrlRegistry().catch(err => console.warn('⚠️ URL Registry falhou (não crítico):', err));
  
  // Inicializar serviço WhatsApp (não bloqueia a inicialização do servidor)
  console.log('🤖 Inicializando serviço de notificações WhatsApp...');
  
  // Inicializar sistema de marketing automático
  console.log('📧 Inicializando sistema de marketing por email...');
  initializeMarketingSystem();
  
  // 🔍 SISTEMA DE DEBUG/MONITORAMENTO INTERNO (Apenas para logs)
  // NOTA: Keep-alive interno NÃO impede hibernação no Replit!
  // Apenas tráfego HTTP EXTERNO mantém o servidor ativo.
  
  const publicDomain = process.env.REPLIT_DEV_DOMAIN;
  const keepWorkspaceAlive = async () => {
    const now = new Date().toLocaleTimeString('pt-BR');
    try {
      // Ping externo via URL pública (impede hibernação do Replit)
      if (publicDomain) {
        await fetch(`https://${publicDomain}/api/status`, {
          method: 'GET',
          headers: { 'X-Keep-Alive': 'true' },
          signal: AbortSignal.timeout(8000),
        });
        const upH = Math.floor(process.uptime() / 3600);
        const upM = Math.floor((process.uptime() % 3600) / 60);
        console.log(`💚 [KEEP-ALIVE] Ping externo OK | ⏱️  ${upH}h ${upM}m | ${now}`);
      } else {
        // Fallback: localhost (funciona apenas para log)
        await fetch('http://localhost:5000/api/status', { headers: { 'X-Internal-Debug': 'true' } });
        console.log(`💛 [KEEP-ALIVE] Ping interno | ${now}`);
      }
    } catch (_) {
      console.log(`💛 [KEEP-ALIVE] Sistema operando... | ${now}`);
    }
  };
  
  // WebSocket proxy for noVNC virtual desktop
  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/api/desktop/vnc-ws')) {
      const target = net.connect(6080, 'localhost', () => {
        const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        const headers = [];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
        target.write(reqLine + headers.join('\r\n') + '\r\n\r\n');
        if (head && head.length > 0) target.write(head);
        socket.pipe(target);
        target.pipe(socket);
      });
      target.on('error', () => socket.destroy());
      socket.on('error', () => target.destroy());
    }
  });

  // Executar inicializações pós-listen de forma assíncrona
  (async () => {
    // 🇧🇷 INICIAR MONITORAMENTO DE NOTICIÁRIO BRASILEIRO
    try {
      brazilNewsService.startAutoUpdate();
    } catch (brazilErr: any) {
      console.warn('⚠️ [BrazilNews] Falha ao iniciar serviço de notícias BR:', brazilErr?.message);
    }

    // 🛑 TRADING NÃO INICIA NO BOOT.
    // Scheduler, coleta Deriv e sincronização só podem ser ativados por ação manual
    // de um usuário autenticado. Isso impede processos órfãos e tempestades de dados.
    console.log('🛑 [TRADING] Boot concluído com trading DESATIVADO. Aguardando login + ativação manual.');
    
    // 🔍 KEEP-ALIVE: Ping externo via URL pública a cada 2 minutos
    // Replit hiberna após ~5 min sem tráfego externo — 2 min garante margem segura
    setInterval(keepWorkspaceAlive, 2 * 60 * 1000);
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
    log('📊 Sistema de keep-alive ativo (2 min):');
    log('   • Monitora uptime e saúde do sistema');
    log('   • Gera logs para debug');
    log('   • NÃO previne hibernação');
    log('');
    log('🚀 Para 100% de uptime: CONFIGURE PING EXTERNO obrigatório!');
    log('='.repeat(80) + '\n');
  })();
})();
