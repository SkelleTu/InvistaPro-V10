import { Router } from 'express';
import { autoTradingScheduler } from '../services/auto-trading-scheduler';
import { dualStorage as storage } from '../storage-dual';
import { isAuthenticated } from '../auth';
import { asyncErrorHandler } from '../middleware/error-handler';
import { isAuthorizedEmail } from '../config/access';
import { dynamicThresholdTracker } from '../services/dynamic-threshold-tracker';
import { derivTradeSync } from '../services/deriv-trade-sync';

const router = Router();

// Middleware para verificar se o usuário tem permissão para acessar o sistema de trading
const isTradingAuthorized = (req: any, res: any, next: any) => {
  if (!req.user?.email || !isAuthorizedEmail(req.user.email)) {
    return res.status(403).json({ 
      message: 'Acesso negado: Sistema de trading restrito a usuários autorizados' 
    });
  }
  next();
};

// Global safety controls require the explicitly configured system administrator.
const isSystemAdmin = (req: any, res: any, next: any) => {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const userEmail = String(req.user?.email || '').trim().toLowerCase();
  if (!adminEmail || !userEmail || userEmail !== adminEmail) {
    return res.status(403).json({ message: 'Ação global restrita ao administrador do sistema.' });
  }
  next();
};

// Obter status do scheduler
router.get('/status', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  const activeSessions = autoTradingScheduler.getActiveSessions().filter((session: any) => String(session.userId) === String(userId));
  const globalSchedulerStatus = autoTradingScheduler.getSchedulerStatus();
  const schedulerActiveForUser = autoTradingScheduler.isUserTradingArmed(String(userId)) &&
    activeSessions.some((session: any) => session.isActive) &&
    !globalSchedulerStatus.emergencyStop;
  // Expose only this user's session state; never leak global activity logs or other users' totals.
  const schedulerStatus = {
    isRunning: schedulerActiveForUser,
    hasActiveSessions: activeSessions.some((session: any) => session.isActive),
    emergencyStop: globalSchedulerStatus.emergencyStop,
    isInitialized: globalSchedulerStatus.isInitialized,
    currentPhase: schedulerActiveForUser ? globalSchedulerStatus.currentPhase : 'AGUARDANDO_PLAY',
    currentPhaseDetail: schedulerActiveForUser ? globalSchedulerStatus.currentPhaseDetail : 'Nenhuma atividade ativa para este usuário',
  };

  // Verificar se o token Deriv está configurado para este usuário
  const derivToken = await storage.getUserDerivToken(userId);
  const derivTokenConfigured = !!derivToken && !!derivToken.isActive;

  // Verificar se há configurações ativas no banco
  const activeConfigs = await storage.getActiveTradeConfigurations();
  const userActiveConfigs = activeConfigs.filter((c: any) => String(c.userId) === String(userId));
  const activeConfigsCount = userActiveConfigs.length;

  // O sistema só está realmente operando se: scheduler rodando + token configurado + configurações ativas
  const canExecuteTrades = schedulerActiveForUser && derivTokenConfigured && activeConfigsCount > 0;

  // Bloqueios que impedem trading
  const tradingBlockers: string[] = [];
  if (!schedulerActiveForUser) tradingBlockers.push('Trading não ativado para esta sessão');
  if (!derivTokenConfigured) tradingBlockers.push('Token Deriv não configurado');
  if (activeConfigsCount === 0) tradingBlockers.push('Nenhuma configuração de trading ativa');

  res.json({
    schedulerActive: schedulerActiveForUser,
    canExecuteTrades,
    derivTokenConfigured,
    activeConfigsCount,
    tradingBlockers,
    schedulerStatus,
    stats: {
      totalSessions: activeSessions.length,
      totalExecutedOperations: activeSessions.reduce((sum: number, session: any) => sum + Number(session.executedOperations || 0), 0),
      activeSessions: activeSessions.length,
      isolatedUsers: activeSessions.length > 0 ? 1 : 0,
      armedUsers: schedulerActiveForUser ? 1 : 0,
    },
    activeSessions: activeSessions.map(session => ({
      userId: session.userId,
      configId: session.configId,
      mode: session.mode,
      progress: {
        executed: session.executedOperations,
        total: session.operationsCount,
        percentage: Math.round((session.executedOperations / session.operationsCount) * 100)
      },
      lastExecution: session.lastExecutionTime,
      nextEstimated: session.lastExecutionTime ? 
        new Date(session.lastExecutionTime.getTime() + (session.intervalValue * (session.intervalType === 'minutes' ? 60000 : session.intervalType === 'hours' ? 3600000 : 86400000))) : 
        new Date()
    }))
  });
}));

// Obter configurações ativas
router.get('/active-configs', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const allActiveConfigs = await storage.getActiveTradeConfigurations();
  // Never disclose other users' configuration records to an authenticated client.
  const activeConfigs = allActiveConfigs.filter((config: any) => String(config.userId) === String(req.user.id));

  res.json({
    count: activeConfigs.length,
    configurations: activeConfigs.map(config => ({
      id: config.id,
      userId: config.userId,
      mode: config.mode,
      operationsCount: config.operationsCount,
      intervalType: config.intervalType,
      intervalValue: config.intervalValue,
      createdAt: config.createdAt
    }))
  });
}));

// Obter operações recentes do sistema automático
router.get('/recent-operations', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const operations = await storage.getActiveTradeOperations(req.user.id);
  
  // Filtrar apenas operações do sistema automático (que não têm interação manual)
  const autoOperations = operations.filter(op => 
    op.aiConsensus && op.aiConsensus.includes('cooperativa')
  ).slice(0, 20); // Últimas 20 operações
  
  res.json({
    count: autoOperations.length,
    operations: autoOperations.map(op => ({
      id: op.id,
      symbol: op.symbol,
      direction: op.direction,
      amount: op.amount,
      status: op.status,
      profit: op.profit,
      createdAt: op.createdAt,
      aiConsensus: op.aiConsensus ? JSON.parse(op.aiConsensus) : null
    }))
  });
}));

// Pausar/retomar scheduler
router.post('/scheduler/:action', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const { action } = req.params;
  
  if (action === 'pause') {
    const userId = String(req.user.id);
    console.log(`⏸️ [SCHEDULER] Pausando somente a sessão do usuário ${userId}...`);
    await autoTradingScheduler.disarmUserTrading(userId);
    const status = autoTradingScheduler.getSchedulerStatus();
    res.json({
      message: 'Trading pausado para o usuário autenticado',
      schedulerActive: autoTradingScheduler.isUserTradingArmed(userId) && status.isRunning && !status.emergencyStop,
      status: {
        isRunning: autoTradingScheduler.isUserTradingArmed(userId) && status.isRunning && !status.emergencyStop,
        emergencyStop: status.emergencyStop,
        isInitialized: status.isInitialized,
      }
    });
  } else if (action === 'resume') {
    const userId = String(req.user.id);
    const [userConfig, derivToken] = await Promise.all([
      storage.getUserTradeConfig(userId),
      storage.getUserDerivToken(userId),
    ]);
    if (!userConfig || !userConfig.isActive || !derivToken || !derivToken.isActive) {
      return res.status(409).json({
        message: 'Play bloqueado: configure uma estratégia ativa e um token Deriv ativo para este usuário.',
        schedulerActive: false,
      });
    }
    console.log(`▶️ [SCHEDULER] Retomando somente a sessão do usuário ${userId}...`);
    autoTradingScheduler.armUserTrading(userId);
    await autoTradingScheduler.startScheduler();
    const status = autoTradingScheduler.getSchedulerStatus();
    res.json({
      message: 'Solicitação de Play processada para o usuário autenticado',
      schedulerActive: autoTradingScheduler.isUserTradingArmed(userId) && !status.emergencyStop,
      status: {
        isRunning: autoTradingScheduler.isUserTradingArmed(userId) && status.isRunning && !status.emergencyStop,
        emergencyStop: status.emergencyStop,
        isInitialized: status.isInitialized,
      }
    });
  } else {
    res.status(400).json({ message: 'Ação inválida. Use "pause" ou "resume"' });
  }
}));

// Obter estatísticas detalhadas
router.get('/detailed-stats', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  
  // Buscar estatísticas do usuário
  const tradingStats = await storage.getTradingStats(userId);
  
  // Configuração ativa do usuário
  const userConfig = await storage.getUserTradeConfig(userId);
  
  // Token Deriv do usuário
  const derivToken = await storage.getUserDerivToken(userId);
  
  res.json({
    userStats: tradingStats,
    activeConfiguration: userConfig,
    derivConnectionStatus: {
      configured: !!derivToken,
      accountType: derivToken?.accountType || null,
      tokenActive: derivToken?.isActive || false
    },
    systemStatus: {
      schedulerActive: true,
      lastCheck: new Date().toISOString()
    }
  });
}));

// Obter estatísticas históricas das análises de IA (threshold médio e tempo ativo)
router.get('/ai-threshold-stats', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  
  // Buscar TODAS as operações do usuário (não apenas ativas)
  const operations = await storage.getUserTradeOperations(userId, 10000);
  
  // Extrair consensusStrength de cada operação (inclui won, lost, expired, pending, active)
  const thresholds: number[] = [];
  const datas: Date[] = [];
  
  operations.forEach(op => {
    if (op.aiConsensus) {
      try {
        const consensus = JSON.parse(op.aiConsensus);
        const strength = consensus.consensusStrength ?? consensus.strength ?? consensus.confidence;
        if (typeof strength === 'number' && strength > 0) {
          thresholds.push(strength);
        }
      } catch (e) {
        // Ignorar erros de parse
      }
    }
    
    if (op.createdAt) {
      datas.push(new Date(op.createdAt));
    }
  });
  
  // Se não há operações alguma, retornar zeros mas com uptime do servidor
  const uptimeDias = Math.ceil(process.uptime() / 86400) || 1;

  if (operations.length === 0) {
    return res.json({
      diasAtivo: uptimeDias,
      totalAnalises: 0,
      thresholdsAnalisados: 0,
      thresholdMedio: 0,
      thresholdMaximo: 0,
      thresholdMinimo: 0,
      primeiraAnalise: null,
      ultimaAnalise: null,
      message: 'Nenhuma operação encontrada ainda'
    });
  }
  
  // Calcular estatísticas de threshold
  const thresholdMedio = thresholds.length > 0 
    ? thresholds.reduce((a, b) => a + b, 0) / thresholds.length 
    : 0;
  
  const thresholdMaximo = thresholds.length > 0 
    ? Math.max(...thresholds) 
    : 0;
  
  const thresholdMinimo = thresholds.length > 0 
    ? Math.min(...thresholds) 
    : 0;
  
  // Calcular dias ativo: da primeira operação até hoje
  let diasAtivo = uptimeDias;
  let primeiraAnalise: string | null = null;
  let ultimaAnalise: string | null = null;
  
  if (datas.length > 0) {
    datas.sort((a, b) => a.getTime() - b.getTime());
    primeiraAnalise = datas[0].toISOString();
    ultimaAnalise = datas[datas.length - 1].toISOString();
    // Dias desde a primeira operação até hoje
    diasAtivo = Math.ceil((Date.now() - datas[0].getTime()) / (1000 * 60 * 60 * 24)) || 1;
  }
  
  res.json({
    diasAtivo,
    totalAnalises: operations.length,
    thresholdsAnalisados: thresholds.length,
    thresholdMedio: Number(thresholdMedio.toFixed(2)),
    thresholdMaximo: Number(thresholdMaximo.toFixed(2)),
    thresholdMinimo: Number(thresholdMinimo.toFixed(2)),
    primeiraAnalise,
    ultimaAnalise,
    message: `Sistema ativo há ${diasAtivo} dia(s) com ${operations.length} operações e ${thresholds.length} análises de threshold`
  });
}));

// Endpoint para obter estatísticas do threshold dinâmico
router.get('/dynamic-threshold-stats', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const stats = dynamicThresholdTracker.getStats();
  const userConfig = await storage.getUserTradeConfig(req.user.id);
  const shouldForce = await dynamicThresholdTracker.shouldForceMinimumOperations(req.user.id, userConfig?.mode || 'test_sem_limites');
  const dynamicThreshold = dynamicThresholdTracker.getDynamicThreshold(userConfig?.mode || 'test_sem_limites', shouldForce);
  
  res.json({
    stats,
    currentThreshold: dynamicThreshold,
    shouldForceMinimum: shouldForce,
    mode: userConfig?.mode || 'test_sem_limites',
    message: stats ? 
      `Threshold dinâmico ativo: ${dynamicThreshold}% (média alta: ${stats.highAverageThreshold.toFixed(1)}%)` : 
      'Coletando dados iniciais para calcular threshold dinâmico'
  });
}));

// Endpoint para verificar se usuário tem acesso autorizado
router.get('/check-access', isAuthenticated, asyncErrorHandler(async (req: any, res: any) => {
  const hasAccess = req.user?.email && isAuthorizedEmail(req.user.email);
  
  res.json({
    hasAccess,
    userEmail: req.user?.email || null,
    message: hasAccess ? 
      'Usuário autorizado para Sistema de Renda Variável' : 
      'Acesso restrito a usuários autorizados'
  });
}));

// =================== CONTROLES ADMINISTRATIVOS DE SEGURANÇA ===================

// Obter status completo de segurança
router.get('/security-status', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const securityStatus = autoTradingScheduler.getSecurityStatus();
  
  res.json({
    ...securityStatus,
    message: 'Status de segurança do sistema',
    timestamp: new Date().toISOString()
  });
}));

// PARADA DE EMERGÊNCIA - Controle administrativo
router.post('/emergency-stop', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  autoTradingScheduler.emergencyStopAll();
  
  res.json({
    success: true,
    message: 'PARADA DE EMERGÊNCIA ATIVADA - Todas as operações foram interrompidas',
    timestamp: new Date().toISOString(),
    activatedBy: req.user.email
  });
}));

// Desabilitar parada de emergência (apenas para administradores específicos)
router.post('/disable-emergency-stop', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const success = autoTradingScheduler.disableEmergencyStop(req.user.email);
  
  if (!success) {
    return res.status(403).json({
      success: false,
      message: 'Apenas administradores específicos podem desativar a parada de emergência'
    });
  }
  
  res.json({
    success: true,
    message: 'Parada de emergência desativada com sucesso',
    timestamp: new Date().toISOString(),
    authorizedBy: req.user.email
  });
}));

// Controle de aprovação administrativa
router.post('/toggle-admin-approval', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const { enable } = req.body;
  
  if (enable === false) {
    const success = autoTradingScheduler.disableAdminApproval(req.user.email);
    
    if (!success) {
      return res.status(403).json({
        success: false,
        message: 'Apenas administradores específicos podem remover aprovação obrigatória'
      });
    }
    
    res.json({
      success: true,
      message: 'Aprovação administrativa removida',
      timestamp: new Date().toISOString(),
      authorizedBy: req.user.email
    });
  } else {
    // Sempre permitir habilitar aprovação obrigatória (medida de segurança)
    autoTradingScheduler.enableAdminApproval();
    
    res.json({
      success: true,
      message: 'Aprovação administrativa obrigatória reativada',
      timestamp: new Date().toISOString(),
      enabledBy: req.user.email
    });
  }
}));

// =================== CONTROLES PARA CONTA DEMO/TESTING ===================

// Resetar sessões bloqueadas (para testing) - TEMPORARIAMENTE SEM AUTH PARA DEMO
router.post('/reset-blocked-sessions', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const success = autoTradingScheduler.resetBlockedSessionsForUser(String(req.user.id));
  
  res.json({
    success,
    message: 'Somente as sessões bloqueadas do usuário autenticado foram resetadas',
    timestamp: new Date().toISOString(),
    actionBy: req.user.email
  });
}));

// Aumentar limites para modo demo - TEMPORARIAMENTE SEM AUTH PARA DEMO
router.post('/increase-demo-limits', isAuthenticated, isTradingAuthorized, isSystemAdmin, asyncErrorHandler(async (req: any, res: any) => {
  const success = autoTradingScheduler.increaseLimitsForDemo();
  const securityStatus = autoTradingScheduler.getSecurityStatus();
  
  res.json({
    success,
    message: 'Limites aumentados para modo demo',
    newLimits: {
      maxOperationsPerSession: securityStatus.maxOperationsPerSession,
      maxDailyOperations: securityStatus.maxDailyOperations
    },
    timestamp: new Date().toISOString(),
    actionBy: req.user.email
  });
}));

// Limpar todas as sessões ativas - TEMPORARIAMENTE SEM AUTH PARA DEMO
router.post('/clear-all-sessions', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = String(req.user.id);
  await autoTradingScheduler.disarmUserTrading(userId);
  
  res.json({
    success: true,
    message: 'Somente as sessões do usuário autenticado foram removidas',
    timestamp: new Date().toISOString(),
    actionBy: req.user.email
  });
}));

// Rota de teste sem autenticação
router.get('/test', (req: any, res: any) => {
  res.json({ message: 'Test route working without auth', timestamp: new Date().toISOString() });
});

// =================== DIAGNÓSTICO E CORREÇÃO AUTOMÁTICA ===================

// Endpoint de diagnóstico completo
router.get('/diagnose', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  
  // 1. Verificar configurações ativas
  const activeConfigs = (await storage.getActiveTradeConfigurations()).filter((config: any) => String(config.userId) === String(userId));
  const userConfig = await storage.getUserTradeConfig(userId);
  
  // 2. Verificar token Deriv
  const derivToken = await storage.getUserDerivToken(userId);
  
  // 3. Verificar status de segurança
  const securityStatus = autoTradingScheduler.getSecurityStatus();
  
  // 4. Verificar sessões ativas
  const activeSessions = autoTradingScheduler.getActiveSessions().filter((session: any) => String(session.userId) === String(userId));
  
  // 5. Buscar operações recentes
  const recentOps = await storage.getUserTradeOperations(userId, 10);
  
  const diagnosis: {
    problema: string | null;
    configuracoes: any;
    deriv: any;
    seguranca: any;
    sessoes: any;
    operacoesRecentes: any;
  } = {
    problema: null,
    configuracoes: {
      totalAtivas: activeConfigs.length,
      configUsuario: userConfig ? {
        modo: userConfig.mode,
        ativo: userConfig.isActive,
        operacoes: userConfig.operationsCount
      } : null
    },
    deriv: {
      tokenConfigurado: !!derivToken,
      tipoConta: derivToken?.accountType || null
    },
    seguranca: securityStatus,
    sessoes: {
      total: activeSessions.length,
      detalhes: activeSessions
    },
    operacoesRecentes: {
      total: recentOps.length,
      ultima: recentOps[0] || null
    }
  };
  
  // DIAGNÓSTICO
  if (activeConfigs.length === 0) {
    diagnosis.problema = 'NENHUMA_CONFIGURACAO_ATIVA';
  } else if (securityStatus.emergencyStop) {
    diagnosis.problema = 'PARADA_EMERGENCIA_ATIVA';
  } else if (securityStatus.adminApprovalRequired) {
    diagnosis.problema = 'APROVACAO_ADMIN_REQUERIDA';
  } else if (!derivToken) {
    diagnosis.problema = 'TOKEN_DERIV_NAO_CONFIGURADO';
  } else if (!userConfig || !userConfig.isActive) {
    diagnosis.problema = 'CONFIGURACAO_USUARIO_INATIVA';
  } else {
    diagnosis.problema = 'SISTEMA_OK_MAS_SEM_EXECUTAR';
  }
  
  res.json(diagnosis);
}));

// Endpoint de correção automática: somente diagnóstico, nunca remove travas nem reativa trading.
router.post('/fix-auto', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = String(req.user.id);
  const [userConfig, derivToken] = await Promise.all([
    storage.getUserTradeConfig(userId),
    storage.getUserDerivToken(userId),
  ]);
  const securityStatus = autoTradingScheduler.getSecurityStatus();
  const userArmed = autoTradingScheduler.isUserTradingArmed(userId);
  const blockers: string[] = [];
  if (securityStatus.emergencyStop) blockers.push('Parada de emergência ativa; exige revisão administrativa explícita.');
  if (securityStatus.adminApprovalRequired) blockers.push('Aprovação administrativa obrigatória.');
  if (!userConfig || !userConfig.isActive) blockers.push('Configuração do usuário ausente ou inativa.');
  if (!derivToken || !derivToken.isActive) blockers.push('Token Deriv do usuário ausente ou inativo.');
  if (!userArmed) blockers.push('Trading não foi ativado manualmente pelo usuário.');

  return res.status(409).json({
    success: false,
    automaticChangesApplied: 0,
    message: 'Correção automática desativada por segurança: este endpoint não pode remover travas, reativar configurações nem aumentar limites.',
    userArmed,
    blockers,
    nextStep: 'Corrija os bloqueios identificados e use o controle Play explicitamente. Nenhuma operação foi iniciada.',
    timestamp: new Date().toISOString(),
  });
}));

// =================== ENDPOINTS DE CONTROLE CENTRALIZADO ===================

// Pausar trading globalmente (afeta todos os remixes)
router.post('/pause-trading', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const { reason } = req.body;
  const pausedBy = req.user.email;

  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ message: 'Motivo da pausa é obrigatório' });
  }

  const control = await storage.pauseTrading(pausedBy, reason);
  
  console.log(`🛑 [GLOBAL] Trading pausado por ${pausedBy}: ${reason}`);
  
  res.json({
    message: 'Trading pausado globalmente para TODOS os remixes',
    status: 'paused',
    pausedBy,
    pausedAt: control.pausedAt,
    reason: control.pauseReason,
  });
}));

// Retomar trading globalmente (afeta todos os remixes)
router.post('/resume-trading', isAuthenticated, isTradingAuthorized, isSystemAdmin, asyncErrorHandler(async (req: any, res: any) => {
  const control = await storage.resumeTrading();
  
  console.log(`▶️ [GLOBAL] Trading retomado`);
  
  // ⚠️ CRITICAL FIX: Reiniciar o scheduler quando trading é retomado
  console.log('▶️ [SCHEDULER] Iniciando scheduler após resume...');
  try {
    await autoTradingScheduler.startScheduler();
  } catch (error) {
    console.error('❌ [SCHEDULER] Erro ao iniciar scheduler após resume:', error);
  }
  
  res.json({
    message: 'Trading retomado globalmente para TODOS os remixes - Scheduler iniciado',
    status: 'resumed',
    resumedAt: control.resumedAt,
  });
}));

// Obter status de pausa global
router.get('/trading-control-status', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const control = await storage.getTradingControlStatus();
  
  res.json({
    isPaused: control?.isPaused || false,
    pausedBy: control?.pausedBy || null,
    pausedAt: control?.pausedAt || null,
    pauseReason: control?.pauseReason || null,
    resumedAt: control?.resumedAt || null,
    message: control?.isPaused 
      ? `Trading pausado por ${control.pausedBy}: ${control.pauseReason}` 
      : 'Trading ativo',
  });
}));

// =================== ENDPOINTS DE SINCRONIZAÇÃO DERIV ===================

// Sincronizar trades do usuário com Deriv
router.post('/sync-trades', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  console.log(`🔄 [SYNC] Sincronizando trades para ${userId}...`);
  const result = await derivTradeSync.syncUserTrades(userId);
  
  res.json({
    message: 'Sincronização de trades concluída',
    synced: result.synced,
    updated: result.updated,
    errors: result.errors,
    timestamp: new Date().toISOString()
  });
}));

// Status da sincronização automática
router.get('/sync-status', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const stats = derivTradeSync.getStats();
  
  res.json({
    syncing: stats.syncing,
    lastSyncs: stats.lastSyncTimes,
    message: `${stats.syncing} sincronizações em progresso`,
    timestamp: new Date().toISOString()
  });
}));

// Forçar sincronização imediata
router.post('/force-sync', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  console.log(`⚡ [SYNC] Forçando sincronização imediata para ${userId}...`);
  await derivTradeSync.forceSyncNow(userId);
  
  res.json({
    message: 'Sincronização forçada concluída',
    timestamp: new Date().toISOString()
  });
}));

export { router as autoTradingRoutes };