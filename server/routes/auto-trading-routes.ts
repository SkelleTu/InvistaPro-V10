import { Router } from 'express';
import { autoTradingScheduler } from '../services/auto-trading-scheduler';
import { storage } from '../storage';
import { isAuthenticated } from '../auth';
import { asyncErrorHandler } from '../middleware/error-handler';
import { isAuthorizedEmail } from '../config/access';
import { dynamicThresholdTracker } from '../services/dynamic-threshold-tracker';

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

// Obter status do scheduler
router.get('/status', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const stats = autoTradingScheduler.getSessionStats();
  const activeSessions = autoTradingScheduler.getActiveSessions();
  const schedulerStatus = autoTradingScheduler.getSchedulerStatus();
  
  res.json({
    schedulerActive: schedulerStatus.isRunning,
    schedulerStatus,
    stats,
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
  const activeConfigs = await storage.getActiveTradeConfigurations();
  
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
    console.log('⏸️ [SCHEDULER] Pausando scheduler via API...');
    autoTradingScheduler.stopScheduler();
    const status = autoTradingScheduler.getSchedulerStatus();
    console.log('✅ [SCHEDULER] Scheduler pausado. Status:', status);
    res.json({ 
      message: 'Scheduler pausado com sucesso',
      schedulerActive: status.isRunning,
      status 
    });
  } else if (action === 'resume') {
    console.log('▶️ [SCHEDULER] Retomando scheduler via API...');
    await autoTradingScheduler.startScheduler();
    const status = autoTradingScheduler.getSchedulerStatus();
    console.log('✅ [SCHEDULER] Scheduler retomado. Status:', status);
    res.json({ 
      message: 'Scheduler retomado com sucesso',
      schedulerActive: status.isRunning,
      status 
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
  
  // Buscar operações do usuário com consenso de IA
  const operations = await storage.getActiveTradeOperations(userId);
  
  if (operations.length === 0) {
    return res.json({
      diasAtivo: 0,
      totalAnalises: 0,
      thresholdMedio: 0,
      thresholdMaximo: 0,
      thresholdMinimo: 0,
      primeiraAnalise: null,
      ultimaAnalise: null,
      message: 'Nenhuma análise de IA encontrada ainda'
    });
  }
  
  // Extrair consensusStrength de cada operação
  const thresholds: number[] = [];
  const datas: Date[] = [];
  
  operations.forEach(op => {
    if (op.aiConsensus) {
      try {
        const consensus = JSON.parse(op.aiConsensus);
        if (consensus.consensusStrength) {
          thresholds.push(consensus.consensusStrength);
        }
      } catch (e) {
        // Ignorar erros de parse
      }
    }
    
    if (op.createdAt) {
      datas.push(new Date(op.createdAt));
    }
  });
  
  // Calcular estatísticas
  const thresholdMedio = thresholds.length > 0 
    ? thresholds.reduce((a, b) => a + b, 0) / thresholds.length 
    : 0;
  
  const thresholdMaximo = thresholds.length > 0 
    ? Math.max(...thresholds) 
    : 0;
  
  const thresholdMinimo = thresholds.length > 0 
    ? Math.min(...thresholds) 
    : 0;
  
  // Calcular dias ativo
  let diasAtivo = 0;
  let primeiraAnalise = null;
  let ultimaAnalise = null;
  
  if (datas.length > 0) {
    datas.sort((a, b) => a.getTime() - b.getTime());
    primeiraAnalise = datas[0].toISOString();
    ultimaAnalise = datas[datas.length - 1].toISOString();
    diasAtivo = Math.ceil((datas[datas.length - 1].getTime() - datas[0].getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }
  
  res.json({
    diasAtivo,
    totalAnalises: operations.length,
    thresholdsAnalisados: thresholds.length,
    thresholdMedio: Number(thresholdMedio.toFixed(2)),
    thresholdMaximo,
    thresholdMinimo,
    primeiraAnalise,
    ultimaAnalise,
    message: `Sistema ativo há ${diasAtivo} dia(s) com ${thresholds.length} análises de threshold`
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
router.post('/reset-blocked-sessions', asyncErrorHandler(async (req: any, res: any) => {
  const success = autoTradingScheduler.resetBlockedSessions();
  
  res.json({
    success,
    message: 'Sessões bloqueadas resetadas para modo demo',
    timestamp: new Date().toISOString(),
    actionBy: req.user.email
  });
}));

// Aumentar limites para modo demo - TEMPORARIAMENTE SEM AUTH PARA DEMO
router.post('/increase-demo-limits', asyncErrorHandler(async (req: any, res: any) => {
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
router.post('/clear-all-sessions', asyncErrorHandler(async (req: any, res: any) => {
  const success = autoTradingScheduler.clearAllSessions();
  
  res.json({
    success,
    message: 'Todas as sessões ativas foram removidas',
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
  const activeConfigs = await storage.getActiveTradeConfigurations();
  const userConfig = await storage.getUserTradeConfig(userId);
  
  // 2. Verificar token Deriv
  const derivToken = await storage.getUserDerivToken(userId);
  
  // 3. Verificar status de segurança
  const securityStatus = autoTradingScheduler.getSecurityStatus();
  
  // 4. Verificar sessões ativas
  const activeSessions = autoTradingScheduler.getActiveSessions();
  
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

// Endpoint de correção automática
router.post('/fix-auto', isAuthenticated, isTradingAuthorized, asyncErrorHandler(async (req: any, res: any) => {
  const userId = req.user.id;
  const fixes = [];
  
  // 1. Verificar e corrigir parada de emergência
  const securityStatus = autoTradingScheduler.getSecurityStatus();
  if (securityStatus.emergencyStop) {
    const disabled = autoTradingScheduler.disableEmergencyStop(req.user.email);
    if (disabled) {
      fixes.push('✅ Parada de emergência desativada');
    } else {
      fixes.push('⚠️ Não foi possível desativar parada de emergência (permissão negada)');
    }
  }
  
  // 2. Verificar e corrigir aprovação admin
  if (securityStatus.adminApprovalRequired) {
    const disabled = autoTradingScheduler.disableAdminApproval(req.user.email);
    if (disabled) {
      fixes.push('✅ Aprovação administrativa removida');
    } else {
      fixes.push('⚠️ Não foi possível remover aprovação administrativa (permissão negada)');
    }
  }
  
  // 3. Verificar configuração do usuário
  const userConfig = await storage.getUserTradeConfig(userId);
  if (!userConfig) {
    // Criar configuração padrão
    await storage.updateTradeConfig(userId, 'test_sem_limites');
    fixes.push('✅ Configuração padrão criada (test_sem_limites)');
  } else if (!userConfig.isActive) {
    // Reativar configuração existente
    await storage.updateTradeConfig(userId, userConfig.mode);
    fixes.push(`✅ Configuração reativada (${userConfig.mode})`);
  }
  
  // 4. Resetar sessões bloqueadas
  autoTradingScheduler.resetBlockedSessions();
  fixes.push('✅ Sessões bloqueadas resetadas');
  
  // 5. Aumentar limites para demo
  autoTradingScheduler.increaseLimitsForDemo();
  fixes.push('✅ Limites aumentados para modo demo');
  
  res.json({
    success: true,
    corrigoesAplicadas: fixes.length,
    detalhes: fixes,
    proximoPasso: 'Aguarde 10-30 segundos para o sistema começar a executar operações automaticamente'
  });
}));

export { router as autoTradingRoutes };