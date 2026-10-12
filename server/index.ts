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
import { backfillMissingEssentialDataToNeon, restoreEssentialDataToSqlite } from "./neon-sqlite-sync";
import { initUrlRegistry } from "./services/url-registry";
import { startDerivObservabilityBridge } from "./services/deriv-observability-bridge";
import { startUniversalHeartbeatLoop } from "./services/universal-server-session";
import { getSecretHealth } from "./services/secret-health";

const app = express();
let routesReady = false;
let persistenceReady = false;
let routeRegistrationError: string | null = null;
let bootFailureEventId: string | null = null;
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

console.log('🔍 Inicializando monitoramento de falhas...');
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
  // Liveness endpoint: keep Render from restarting a live process while Neon is
  // being migrated. Readiness is reported separately by /api/observability/health.
  app.get('/health', (_req, res) => {
    const obsHealth = observability.getHealth();
    const secretHealth = getSecretHealth();
    if (!routesReady) {
      return res.status(503).json({
        status: 'starting',
        routesReady,
        persistenceReady,
        error: routeRegistrationError || 'Routes ainda não registradas',
        bootFailureEventId,
      });
    }
    const healthy = persistenceReady && obsHealth.critical === 0 && secretHealth.status === 'healthy';
    return res.status(200).json({
      status: 'ok',
      readiness: healthy ? 'ready' : 'degraded',
      routesReady,
      persistenceReady,
      error: persistenceReady ? undefined : 'Persistência Neon ainda não está pronta',
      observability: {
        status: obsHealth.status,
        errors: obsHealth.errors,
        critical: obsHealth.critical,
        warnings: obsHealth.warnings,
      },
      secrets: secretHealth,
    });
  });

  // Boot observability remains available before route registration, but required
  // production secrets are part of readiness rather than a green-but-degraded response.
  app.get('/api/observability/health', (_req, res) => {
    const health = observability.getHealth();
    const secretHealth = getSecretHealth();
    const healthy = routesReady && persistenceReady && health.critical === 0 && secretHealth.status === 'healthy';
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      routesReady,
      persistenceReady,
      bootFailureEventId,
      ...health,
      secrets: secretHealth,
      status: healthy ? 'healthy' : 'degraded',
    });
  });

  app.get('/api/observability/errors', (_req, res) => {
    const errors = observability.getUnresolved();
    res.status(routesReady && persistenceReady && errors.length === 0 ? 200 : 503).json({
      success: true,
      routesReady,
      persistenceReady,
      bootFailureEventId,
      count: errors.length,
      errors,
    });
  });

  // This guard must be registered before the application routes so no API
  // handler can accept writes before Neon migration and local restoration finish.
  app.use('/api', (req, res, next) => {
    const livenessPath = req.path === '/health' || req.path === '/status' || req.path === '/ping';
    const anonymousSecurityProbe = !req.headers.cookie && !req.headers.authorization && (
      req.path === '/trading/account-info' ||
      req.path === '/setup-admin' ||
      req.path === '/auto-trading/clear-all-sessions' ||
      req.path === '/auto-trading/reset-blocked-sessions' ||
      req.path === '/auto-trading/increase-demo-limits' ||
      req.path.startsWith('/__audit_')
    );
    if (!persistenceReady && !livenessPath && !anonymousSecurityProbe && !req.path.startsWith('/observability/')) {
      return res.status(503).json({
        success: false,
        error: 'Persistência indisponível: Neon não foi migrada/restaurada com sucesso.',
        persistenceReady: false,
      });
    }
    next();
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
    const bootEvent = observability.captureError(routeError, {
      level: 'CRITICAL',
      category: 'BOOT',
      message: 'Falha crítica no registro das rotas da API',
      details: {
        routesReady: false,
        phase: 'registerRoutes',
        routeRegistrationError,
      },
    });
    bootFailureEventId = bootEvent.id;
  }

  // API nunca pode cair no HTML do SPA. Primeiro protegemos o namespace /api
  // e devolvemos JSON determinístico para boot degradado ou rota inexistente.
  app.use('/api', (req, res, next) => {
    if (!routesReady) {
      return res.status(503).json({
        success: false,
        error: 'API indisponível: falha no registro das rotas durante o boot.',
        routesReady: false,
        detail: routeRegistrationError || 'Falha de inicialização não especificada',
      });
    }
    if (!persistenceReady) {
      return res.status(503).json({
        success: false,
        error: 'Persistência indisponível: Neon não foi migrada/restaurada com sucesso.',
        persistenceReady: false,
      });
    }
    next();
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'API route not found',
      path: req.originalUrl || req.path,
    });
  });

  // SPA fallback MUST be the final application fallback so /auth, /login
  // and other client-side routes receive index.html without intercepting APIs.
  if (app.get("env") !== "development") {
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), "dist", "public", "index.html"));
    });
  }

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
  
  app.locals.serviceReady = false;
  console.log(`⏳ [BOOT] Rotas registradas; aguardando migração e restauração da persistência. routesReady=${routesReady}`);

  // 🗄️ EXECUTAR MIGRAÇÃO POSTGRESQL - SUPORTE A QUALQUER BANCO (REPLIT, SUPABASE, ETC)
  console.log('🗄️ Verificando sincronização com PostgreSQL...');
  const hasPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgresql://') || process.env.DATABASE_URL.startsWith('postgres://'));
  
  if (hasPostgres) {
    const dbType = process.env.DATABASE_URL!.includes('neon.tech') ? 'Neon PostgreSQL' : 'PostgreSQL';
    
    console.log(`✨ ${dbType} configurado! Criando schema SQL...`);
    const migrationSuccess = await runPostgresMigration();
    if (migrationSuccess) {
      try {
        const backfill = await backfillMissingEssentialDataToNeon();
        console.log('✅ [SQLITE→NEON] Backfill aditivo de essenciais concluído', backfill);
        const restored = await restoreEssentialDataToSqlite();
        console.log('✅ [NEON→SQLITE] Dados essenciais restaurados', restored);
        persistenceReady = true;
        app.locals.persistenceReady = true;
        app.locals.serviceReady = routesReady;
        console.log('✅ Migração e restauração concluídas.');
        console.log(`   • ${dbType} conectado e identidade de plataforma validada`);
        console.log('   • Identidade, tokens e configurações essenciais restaurados da Neon');
        console.log('   • Histórico operacional, logs de IA e dados de mercado permanecem locais');
        console.log('   🎉 Persistência pronta para uso.');
      } catch (restoreError: any) {
        console.error('❌ [NEON→SQLITE] Restauração essencial falhou:', restoreError?.message || restoreError);
        persistenceReady = false;
        app.locals.persistenceReady = false;
        app.locals.serviceReady = false;
      }
    } else {
      persistenceReady = false;
      app.locals.persistenceReady = false;
      app.locals.serviceReady = false;
      console.error('❌ Migração Neon falhou; API permanece bloqueada para proteger dados essenciais.');
    }
  } else {
    persistenceReady = false;
    app.locals.persistenceReady = false;
    app.locals.serviceReady = false;
    console.error('❌ DATABASE_URL PostgreSQL não configurada. API bloqueada para proteger dados essenciais.');
    console.log('ℹ️ DATABASE_URL PostgreSQL não está configurado');
    console.log('   📋 Configure DATABASE_URL com a Neon exclusiva desta plataforma.');
    console.log('   📋 Configure INVISTA_PLATFORM=v10 ou INVISTA_PLATFORM=aura.');
    console.log('   📋 Configure uma base Neon diferente para cada plataforma e reinicie.');
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
    // Preserve only users who explicitly pressed Play before the restart.
    const armedUsers = autoTradingScheduler.getArmedUserIds();
    if (armedUsers.length === 0) {
      console.log('🛑 [RESILIENCE] Restart ignorado: nenhum usuário ativou o trading manualmente.');
      return;
    }
    console.log(`🔄 Reiniciando runtimes já ativados manualmente: ${armedUsers.length} usuário(s)...`);
    try {
      await autoTradingScheduler.stopScheduler();
      for (const userId of armedUsers) {
        await autoTradingScheduler.startSchedulerForUser(userId);
      }
      console.log('✅ Runtimes isolados reiniciados; nenhum usuário não armado foi iniciado.');
    } catch (error) {
      // Fail safe: if restart partially fails, disarm all users rather than
      // leaving a mixed/unknown trading state.
      await autoTradingScheduler.stopScheduler().catch(() => {});
      console.error('❌ Erro ao reiniciar runtimes isolados; todos permaneceram desarmados:', error);
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

  // Universal Server: manter heartbeat global ativo para as sessões isoladas.
  // As sessões individuais só são criadas após autenticação, então isto não inicia trading.
  startUniversalHeartbeatLoop();

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
        const headers: string[] = [];
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
    // BrazilNews is started by the per-user manual Play path, never automatically at boot.
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
