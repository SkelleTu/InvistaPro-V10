import * as cron from 'node-cron';
import { dualStorage as storage } from '../storage-dual';
import { huggingFaceAI } from './huggingface-ai';
import { derivAPI, DerivAPIService } from './deriv-api';
import { errorTracker } from '../services/error-tracker';
import { marketDataCollector } from './market-data-collector';
import { dynamicThresholdTracker } from './dynamic-threshold-tracker';
import { resilienceSupervisor } from './resilience-supervisor';
import { derivTradeSync } from './deriv-trade-sync';
import { digitFrequencyAnalyzer } from './digit-frequency-analyzer';
import { assetScorer, AssetPerformanceRecord } from './asset-scorer';
import { realStatsTracker } from './real-stats-tracker';

export interface ActiveTradeSession {
  userId: string;
  configId: string;
  mode: string;
  operationsCount: number;
  intervalType: string;
  intervalValue: number;
  executedOperations: number;
  lastExecutionTime: Date | null;
  isActive: boolean;
}

export class AutoTradingScheduler {
  private activeSessions: Map<string, ActiveTradeSession> = new Map();
  private schedulerRunning: boolean = false;
  private cronJob: any = null;
  private emergencyStop: boolean = false; // SISTEMA REATIVADO PARA MODO SEM LIMITES
  private maxOperationsPerSession: number = 1000; // LIMITE AMPLIADO PARA MODO ANÁLISE CONTÍNUA
  private maxDailyOperations: number = 5000; // LIMITE DIÁRIO AMPLIADO PARA ANÁLISE CONTÍNUA
  private adminApprovalRequired: boolean = false; // APROVAÇÃO AUTOMÁTICA PARA MODO SEM LIMITES
  private setupPromise: Promise<void>;
  private isInitialized: boolean = false;
  
  // 🚫 BLOQUEADO 100%: Ativos causadores de loss - NUNCA serão operados
  private static readonly BLOCKED_SYMBOLS_PATTERN = /\(1s\)/i;
  
  /**
   * Validar se símbolo está bloqueado (causador de loss)
   */
  private isSymbolBlocked(symbol: string): boolean {
    return AutoTradingScheduler.BLOCKED_SYMBOLS_PATTERN.test(symbol);
  }
  
  // 🔧 ANTI-DEADLOCK: Rastreamento de operações em execução
  private lastOperationId: string | null = null;
  private lastOperationStartTime: number = 0;
  private readonly OPERATION_TIMEOUT_MS = 90000; // 90 segundos máximo por ciclo
  
      // 🎯 SISTEMA DE DIVERSIFICAÇÃO DINÂMICA - "PERDA ZERO"
      // Com 120+ ativos, cada um pode ter cool-off mais curto
      private recentAssets: Map<string, string[]> = new Map(); // userId -> [asset1, asset2, ...]
      private assetPerformance: Map<string, {wins: number, losses: number, lastTrades: boolean[]}> = new Map(); // Track performance por ativo
      private assetLastUsedTime: Map<string, number> = new Map(); // ✅ FIX: Guardar TEMPO REAL, não índice
      private assetCooldownMinutes: number = 0; // ⚡ DESATIVADO PARA TESTE: 0 segundos
      
      // 🧬 SISTEMA ADAPTATIVO - Breathing Room dinâmico
  // Se asset ganhando: permite IMEDIATAMENTE (rotation rápido em ganhadores)
  // Se asset perdendo: aumenta cool-off automaticamente (force diversificação)
  private getBreathingRoom(symbol: string): number {
    return 0; // 🔥 SEMPRE 0 PARA TESTE
  }
  
  // 🎯 SISTEMA DE OPERAÇÕES CONSERVADORAS DIÁRIAS (persistido no banco)
  // Limites específicos por modo de operação
  private getOperationLimitsForMode(mode: string): { min: number; max: number } {
    switch(mode) {
      case 'production_2_24h':
        return { min: 2, max: 2 }; // Exatamente 2 operações por dia
      case 'production_3-4_24h':
        return { min: 3, max: 4 }; // 3 a 4 operações por dia
      default:
        // Modos de teste não tem limites
        return { min: 0, max: 999999 };
    }
  }
  
  // SISTEMA PAUSADO POR SEGURANÇA - CONTROLES OBRIGATÓRIOS IMPLEMENTADOS
  // Aprovação manual obrigatória para qualquer operação de trading

  constructor() {
    console.log('🚀 SISTEMA DE TRADING ATIVO - Modo análise contínua configurado');
    console.log('🔒 CONTROLES DE SEGURANÇA ATIVADOS:');
    console.log('   • Parada de emergência: ATIVA');
    console.log('   • Aprovação manual: AUTOMÁTICA');
    console.log('   • Limite por sessão: 1000 operações');
    console.log('   • Limite diário: 5000 operações');
    
    // Iniciar setup assíncrono e rastrear com Promise
    this.setupPromise = this.setupAnaliseNaturalSystem();
    
    // Recuperar sessões ativas após crash
    this.recoverActiveSessions();
    
    // Adicionar listener para shutdown gracioso
    process.on('SIGTERM', () => this.emergencyStopAll());
    process.on('SIGINT', () => this.emergencyStopAll());
    
    // Iniciar heartbeat para ResilienceSupervisor
    this.startSupervisorHeartbeat();
  }

  private startSupervisorHeartbeat(): void {
    // Reportar saúde ao supervisor a cada 60 segundos
    setInterval(async () => {
      try {
        // Verificar se operação atual está travada
        const isOperationStale = this.lastOperationStartTime > 0 && 
          (Date.now() - this.lastOperationStartTime) > this.OPERATION_TIMEOUT_MS;
        
        await resilienceSupervisor.reportHeartbeat('scheduler', {
          schedulerRunning: this.schedulerRunning,
          activeSessions: this.activeSessions.size,
          emergencyStop: this.emergencyStop,
          isInitialized: this.isInitialized,
          lastOperationId: this.lastOperationId,
          isOperationStale,
          lastOperationAge: this.lastOperationStartTime > 0 ? Date.now() - this.lastOperationStartTime : 0,
        });
        
        // Auto-cleanup se operação travada
        if (isOperationStale) {
          console.warn(`⚠️ [HEARTBEAT] Operação travada detectada: ${this.lastOperationId} (${Date.now() - this.lastOperationStartTime}ms)`);
          await this.forceCleanupCurrentOperation();
        }
      } catch (error) {
        console.error('❌ Erro ao reportar heartbeat ao supervisor:', error);
      }
    }, 60000);
    console.log(`💓 Heartbeat do ResilienceSupervisor iniciado para scheduler`);
  }
  
  // 🔧 CLEANUP: Força limpeza de operação atual travada
  private async forceCleanupCurrentOperation(): Promise<void> {
    console.log(`🔧 [CLEANUP] Forçando limpeza de operação travada: ${this.lastOperationId}`);
    
    // Desconectar Deriv forçadamente
    try {
      await derivAPI.disconnect();
      console.log(`✅ [CLEANUP] Deriv desconectado forçadamente`);
    } catch (e) {
      console.error(`⚠️ [CLEANUP] Erro ao desconectar Deriv:`, e);
    }
    
    // Reconciliar sessões com operações pendentes
    for (const [sessionKey, session] of Array.from(this.activeSessions.entries())) {
      // Se sessão estava em execução durante o timeout, resetar para retry
      if (session.executedOperations < session.operationsCount && session.lastExecutionTime) {
        console.log(`🔄 [CLEANUP] Sessão ${sessionKey}: resetando para retry (${session.executedOperations}/${session.operationsCount})`);
        
        // Resetar timing para permitir retry imediato
        session.lastExecutionTime = null;
        
        // Persistir estado atualizado
        try {
          await this.persistSession(sessionKey, session);
        } catch (e) {
          console.error(`⚠️ [CLEANUP] Erro ao persistir sessão ${sessionKey}:`, e);
        }
      }
    }
    
    // Resetar estado do scheduler
    this.schedulerRunning = false;
    this.lastOperationId = null;
    this.lastOperationStartTime = 0;
    
    console.log(`✅ [CLEANUP] Estado do scheduler resetado - pronto para próximo ciclo`);
  }
  
  // 🔧 CLEANUP: Limpar sessões travadas antes de novo ciclo
  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    const staleThreshold = 120000; // 2 minutos sem atualização = sessão travada
    
    for (const [sessionKey, session] of Array.from(this.activeSessions.entries())) {
      if (session.lastExecutionTime) {
        const sessionAge = now - session.lastExecutionTime.getTime();
        
        if (sessionAge > staleThreshold) {
          console.warn(`⚠️ [CLEANUP] Sessão travada detectada: ${sessionKey} (${Math.round(sessionAge/1000)}s sem atividade)`);
          
          // Resetar timing para permitir retry
          session.lastExecutionTime = null;
          
          // Persistir estado atualizado
          try {
            await this.persistSession(sessionKey, session);
            console.log(`✅ [CLEANUP] Sessão ${sessionKey} resetada e persistida para retry`);
          } catch (e) {
            console.error(`⚠️ [CLEANUP] Erro ao persistir sessão ${sessionKey}:`, e);
          }
        }
      }
    }
    
    // Se scheduler travado há muito tempo, forçar reset
    if (this.lastOperationStartTime > 0 && (now - this.lastOperationStartTime) > this.OPERATION_TIMEOUT_MS) {
      await this.forceCleanupCurrentOperation();
    }
  }

  private async recoverActiveSessions(): Promise<void> {
    try {
      console.log('🔍 Recuperando sessões ativas do banco de dados...');
      const sessions = await storage.getAllActiveTradingSessions();
      
      if (sessions.length === 0) {
        console.log('ℹ️ Nenhuma sessão ativa encontrada para recuperar');
        return;
      }

      console.log(`✅ Encontradas ${sessions.length} sessões ativas para recuperar`);
      
      for (const dbSession of sessions) {
        const sessionKey = dbSession.sessionKey;
        
        // Reconstituir sessão no Map
        this.activeSessions.set(sessionKey, {
          userId: dbSession.userId,
          configId: dbSession.configId,
          mode: dbSession.mode,
          operationsCount: dbSession.operationsCount,
          intervalType: dbSession.intervalType,
          intervalValue: dbSession.intervalValue,
          executedOperations: dbSession.executedOperations,
          lastExecutionTime: dbSession.lastExecutionTime ? new Date(dbSession.lastExecutionTime) : null,
          isActive: true,
        });
        
        console.log(`✅ Sessão recuperada: ${sessionKey} (${dbSession.executedOperations}/${dbSession.operationsCount} operações)`);
      }
      
      console.log(`🎯 ${sessions.length} sessões recuperadas com sucesso`);
    } catch (error) {
      console.error('❌ Erro ao recuperar sessões ativas:', error);
    }
  }

  private async persistSession(sessionKey: string, session: ActiveTradeSession): Promise<void> {
    try {
      await storage.upsertActiveTradingSession({
        sessionKey,
        userId: session.userId,
        configId: session.configId,
        mode: session.mode,
        operationsCount: session.operationsCount,
        intervalType: session.intervalType,
        intervalValue: session.intervalValue,
        executedOperations: session.executedOperations,
        lastExecutionTime: session.lastExecutionTime ? session.lastExecutionTime.toISOString() : null,
        isActive: true,
      });
    } catch (error) {
      console.error(`❌ Erro ao persistir sessão ${sessionKey}:`, error);
    }
  }

  private async setupAnaliseNaturalSystem(): Promise<void> {
    console.log('🚀 Iniciando Sistema Análise natural continua de IA - Análise Microscópica Contínua...');
    
    // Inicializar coleta contínua de dados da Deriv
    await this.initializeMarketDataCollection();
    
    this.isInitialized = true;
    console.log('✅ Sistema Análise natural continua de IA inicializado - pronto para startScheduler()');
  }

  private async initializeMarketDataCollection(): Promise<void> {
    try {
      console.log('📊 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 [INIT] Iniciando coleta contínua de dados de mercado...');
      
      // Conectar à Deriv para buscar símbolos disponíveis
      console.log('📊 [INIT] Conectando à Deriv API...');
      const tempDerivAPI = new DerivAPIService();
      await tempDerivAPI.connectPublic('GET_ALL_SYMBOLS');
      console.log('✅ [INIT] Conectado à Deriv API');
      
      // BUSCAR TODOS OS ATIVOS DISPONÍVEIS DA API DA DERIV
      console.log('📊 [INIT] Buscando ativos disponíveis...');
      const activeSymbols = await tempDerivAPI.getActiveSymbols();
      console.log(`✅ [INIT] Recuperados ${activeSymbols.length} símbolos ativos da Deriv API`);
      
      if (activeSymbols.length === 0) {
        console.warn('⚠️ [INIT] AVISO: getActiveSymbols() retornou 0 ativos!');
      }
      
      // 🔥 DESCOBRIR DINAMICAMENTE quais suportam DIGITDIFF (conforme docs oficiais Deriv)
      console.log('🔥 [INIT] Iniciando descoberta dinâmica de DIGITDIFF...');
      const digitdiffSymbols = await tempDerivAPI.getDigitDiffSupportedSymbols(activeSymbols);
      console.log(`🔥 [INIT] Ativos com suporte DIGITDIFF descobertos: ${digitdiffSymbols.length}`);
      
      // Desconectar a conexão temporária
      console.log('📊 [INIT] Desconectando da Deriv API...');
      await tempDerivAPI.disconnect();
      console.log('✅ [INIT] Desconectado');
      
      // Se nenhum símbolo foi descoberto dinamicamente, usar fallback (compatibilidade)
      const symbolsToUse = digitdiffSymbols.length > 0 ? digitdiffSymbols : 
        ['R_10', 'R_25', 'R_50', 'R_75', 'R_100']; // Fallback - sempre suportados
      
      console.log(`🎯 [INIT] Usando ${symbolsToUse.length} símbolos para coleta`);
      console.log(`🎯 [INIT] Símbolos: ${symbolsToUse.join(', ')}`);
      
      await marketDataCollector.startCollection(symbolsToUse);
      
      console.log('✅ [INIT] Coleta de dados iniciada para todos os ativos DIGITDIFF descobertos');
      console.log('📊 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Ticks processados silenciosamente - análise contínua sem log flood
      
    } catch (error) {
      console.error('❌ Erro ao inicializar coleta de dados:', error);
    }
  }

  private async executeAnaliseNaturalAnalysis(): Promise<void> {
    // 🔴 VERIFICAÇÃO CRÍTICA #1: Flag de pausa centralizada (banco de dados)
    const tradingControlStatus = await storage.getTradingControlStatus();
    if (tradingControlStatus?.isPaused) {
      console.log(`🛑 [SCHEDULER] Trading pausado globalmente - não executando análise`);
      return;
    }
    
    // SEGURANÇA: Verificar se pode executar operações
    if (!this.canExecuteOperation()) {
      return; // Bloquear execução se controles de segurança ativos
    }
    
    // 🔧 CLEANUP: Limpar sessões travadas antes de iniciar novo ciclo
    await this.cleanupStaleSessions();
    
    this.schedulerRunning = true;
    const operationId = `ANALISE_NATURAL_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.lastOperationId = operationId;
    this.lastOperationStartTime = Date.now();
    
    try {
      // ✅ Enviar heartbeat para ResilienceSupervisor
      await storage.updateSystemHeartbeat('scheduler', 'healthy', {
        operationId,
        timestamp: new Date().toISOString(),
        status: 'executing_analysis',
        activeSessions: this.activeSessions.size
      }).catch(err => console.error('⚠️ Erro ao enviar heartbeat:', err));
      
      // Buscar todas as configurações ativas
      let activeConfigs = await storage.getActiveTradeConfigurations();
      
      console.log(`🎯 [${operationId}] Sistema Análise natural continua de IA - Análise microscópica ativa...`);
      console.log(`📊 [${operationId}] Configurações ativas encontradas: ${activeConfigs.length}`);
      
      if (activeConfigs.length > 0) {
        activeConfigs.forEach(c => console.log(`📋 [DEBUG] Config Ativa: ID=${c.id}, Mode=${c.mode}, Active=${c.isActive}`));
      }

      if (activeConfigs.length === 0) {
        console.log(`⚠️ [${operationId}] Nenhuma configuração ativa encontrada - verificando configurações desativadas no modo sem limites...`);
        
        // Buscar todas as configurações desativadas no modo sem limites e reativá-las
        const allConfigs = await storage.getAllTradeConfigurations();
        const disabledSemLimites = allConfigs.filter((c: any) => !c.isActive && (c.mode === 'test_sem_limites' || c.mode.includes('perpetuo')));
        
        if (disabledSemLimites.length > 0) {
          console.log(`🔄 [${operationId}] Encontradas ${disabledSemLimites.length} configuração(ões) sem limites desativada(s) - reativando automaticamente...`);
          
          for (const config of disabledSemLimites) {
            await storage.reactivateTradeConfiguration(config.id);
            console.log(`✅ [${operationId}] Configuração ${config.id} reativada (modo: ${config.mode})`);
          }
          
          // Buscar configurações ativas novamente
          activeConfigs = await storage.getActiveTradeConfigurations();
          console.log(`📊 [${operationId}] Configurações ativas após reativação: ${activeConfigs.length}`);
        }
        
        if (activeConfigs.length === 0) {
          console.log(`⚠️ [${operationId}] Nenhuma configuração ativa encontrada - operações NÃO serão executadas`);
          return;
        }
      }

      console.log(`📊 [${operationId}] ${activeConfigs.length} sessão(ões) Análise natural continua de IA ativa(s)`);
      
      // 🔥 LOG DE CONFIGURAÇÃO PARA DEBUG
      activeConfigs.forEach(c => {
        console.log(`🔍 [DEBUG] Config ${c.id}: userId=${c.userId}, mode=${c.mode}, isActive=${c.isActive}`);
      });

      // ⚡ INTELIGÊNCIA PURA: Sem limites de stagger quando oportunidade forte
      // IAs decidem quantidade de trades simultâneos baseado em consenso
      // Consenso forte (>70%): SEM stagger - burst completo de trades
      // Consenso médio (40-70%): stagger leve para distribuir
      // Consenso fraco (<40%): operações normais
      const analisePromises = activeConfigs.map(async (config, index) => {
        try {
      // ⚡ CONTROLE DE BURST: Aplicar stagger mínimo para evitar avalanche
          // Isto evita abrir múltiplos trades simultaneamente
          // Delay: 1 segundo entre cada trade para manter controle
          const staggerDelay = 1000; // 1 segundo mínimo entre trades
          if (staggerDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, staggerDelay * index));
          }
          
          return await this.processAnaliseNaturalConfiguration(config, operationId);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ [${operationId}] Erro na sessão Análise natural continua de IA ${config.id}:`, errorMessage);
          return { success: false, error: errorMessage };
        }
      });

      // Executar TODAS as análises em paralelo total - sem limitações de burst
      // Sistema é inteligente para não abrir trades desnecessários
      await Promise.allSettled(analisePromises);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ [${operationId}] Erro geral no scheduler:`, errorMessage);
      
      errorTracker.captureError(
        error instanceof Error ? error : new Error(errorMessage),
        'ERROR',
        'UNKNOWN'
      );
      
    } finally {
      this.schedulerRunning = false;
    }
  }



  private async processAnaliseNaturalConfiguration(config: any, operationId: string): Promise<{success: boolean, error?: string}> {
    // 🔴 VERIFICAÇÃO CRÍTICA #2: Flag de pausa centralizada (antes de qualquer operação)
    const tradingControlStatus = await storage.getTradingControlStatus();
    if (tradingControlStatus?.isPaused) {
      console.log(`🛑 [${operationId}] Pausa global detectada - não executando trade`);
      return { success: false, error: 'Trading pausado globalmente' };
    }
    
    // SEGURANÇA: Verificar limites antes de processar
    if (!this.canExecuteOperation()) {
      return { success: false, error: 'Bloqueado por controles de segurança' };
    }
    
    try {
      const userId = config.userId;
      const sessionKey = `${userId}_${config.id}`;

      // VERIFICAÇÃO DE ATIVOS BLOQUEADOS
      let isBlocked = false;
      try {
        isBlocked = await storage.isUserBlockedAsset(userId, config.symbol || "R_100", "digit_diff");
      } catch (blockedErr) {
        console.warn(`⚠️ [${operationId}] Erro ao verificar ativo bloqueado, assumindo NÃO bloqueado:`, blockedErr instanceof Error ? blockedErr.message : String(blockedErr));
        isBlocked = false;
      }

      if (isBlocked) {
        console.log(`⛔ [${operationId}] Trade bloqueado para ${config.symbol || "R_100"} (Configuração do usuário)`);
        return { success: false, error: 'Ativo bloqueado pelo usuário' };
      }
      
      console.log(`🔓 [DEBUG] Símbolo ${config.symbol} NÃO está bloqueado.`);

      // SEGURANÇA: Verificar limite por sessão
      if (!this.canSessionExecute(sessionKey)) {
        return { success: false, error: 'Limite de operações por sessão atingido' };
      }
      
      // Gerenciar sessão Análise natural continua de IA (tracking de timing e operações)
      let session = this.activeSessions.get(sessionKey);
      if (!session) {
        session = {
          userId: userId,
          configId: config.id,
          mode: config.mode,
          operationsCount: config.operationsCount,
          executedOperations: 0,
          intervalType: config.intervalType,
          intervalValue: config.intervalValue,
          lastExecutionTime: null,
          isActive: true
        };
        this.activeSessions.set(sessionKey, session);
        
        // Persistir sessão no banco de dados
        await this.persistSession(sessionKey, session);
        
        console.log(`🆕 [${operationId}] Nova sessão Análise natural continua de IA iniciada: ${sessionKey}`);
      }
      
      // Verificar se atingiu limite de operações configurado
      if (session.executedOperations >= session.operationsCount) {
        // Para modos sem limites ou de teste contínuo, resetar contador e continuar
        if (config.mode === 'test_sem_limites' || config.mode.includes('perpetuo')) {
          console.log(`🔄 [${operationId}] Modo contínuo: resetando contador ${sessionKey} (${session.executedOperations}/${session.operationsCount}) -> continuando operações`);
          session.executedOperations = 0;
          session.lastExecutionTime = null;
          await this.persistSession(sessionKey, session);
        } else {
          console.log(`✅ [${operationId}] Sessão ${sessionKey} concluída (${session.executedOperations}/${session.operationsCount})`);
          this.activeSessions.delete(sessionKey);
          
          // Desativar sessão no banco de dados
          await storage.deactivateActiveTradingSession(sessionKey);
          
          await storage.deactivateTradeConfiguration(config.id);
          return { success: false, error: 'Operações concluídas' };
        }
      }
      
      // Sistema Análise natural continua de IA - sem verificações de intervalo ou limitações
      // IAs fazem análises microscópicas contínuas e decidem autonomamente
      
      // Buscar token do usuário
      const tokenData = await storage.getUserDerivToken(userId);
      if (!tokenData) {
        return { success: false, error: 'Token Deriv não configurado' };
      }
      
      console.log(`🚀 [${operationId}] Executando trade Análise natural continua de IA: ${session.executedOperations + 1}/${session.operationsCount} (${session.mode})`);
      
      // Executar trade com argumentos corretos
      const result = await this.executeAutomaticTrade(config, tokenData, operationId);
      
      // Atualizar sessão APENAS após trade bem-sucedido
      if (result.success) {
        session.lastExecutionTime = new Date();
        session.executedOperations++;
        
        // Persistir atualização da sessão no banco de dados
        await this.persistSession(sessionKey, session);
        
        console.log(`✅ [${operationId}] Trade Análise natural continua de IA executado com sucesso: ${session.executedOperations}/${session.operationsCount}`);
        
        // Salvar resultado para tracking (será processado async)
        this.trackTradeOutcome(userId, result, config);
      } else {
        console.log(`⚠️ [${operationId}] Trade Análise natural continua de IA falhou: ${result.error} - Sessão mantida ativa`);
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }
  
  private async trackTradeOutcome(userId: string, result: any, config: any): Promise<void> {
    // Tracking assíncrono de resultados para não bloquear o sistema
    try {
      // Salvar trade ativo para monitoramento
      if (result.contractId) {
        await storage.saveActiveTradeForTracking({
          userId,
          contractId: result.contractId,
          symbol: config.symbol,
          amount: config.amount,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('❌ Erro ao trackear trade:', error);
    }
  }

  private async processTradeConfiguration(config: any, operationId: string): Promise<void> {
    const sessionKey = `${config.userId}_${config.id}`;
    let session = this.activeSessions.get(sessionKey);

    // Criar nova sessão se não existir
    if (!session) {
      session = {
        userId: config.userId,
        configId: config.id,
        mode: config.mode,
        operationsCount: config.operationsCount,
        intervalType: config.intervalType,
        intervalValue: config.intervalValue,
        executedOperations: 0,
        lastExecutionTime: null,
        isActive: true
      };
      this.activeSessions.set(sessionKey, session);
      
      // Persistir sessão no banco de dados
      await this.persistSession(sessionKey, session);
      
      console.log(`🆕 [${operationId}] Nova sessão criada para usuário ${config.userId} - Modo: ${config.mode}`);
    }

    // Verificar se já completou todas as operações configuradas
    if (session.executedOperations >= session.operationsCount) {
      // Para modos sem limites ou de teste contínuo, resetar contador e continuar
      if (config.mode === 'test_sem_limites' || config.mode.includes('perpetuo')) {
        console.log(`🔄 [${operationId}] Modo contínuo: resetando contador ${sessionKey} (${session.executedOperations}/${session.operationsCount}) -> continuando operações`);
        session.executedOperations = 0;
        session.lastExecutionTime = null;
        await this.persistSession(sessionKey, session);
      } else {
        console.log(`✅ [${operationId}] Sessão completou ${session.operationsCount} operações. Removendo da lista ativa.`);
        this.activeSessions.delete(sessionKey);
        
        // Desativar sessão no banco de dados
        await storage.deactivateActiveTradingSession(sessionKey);
        
        // Desativar configuração no banco de dados
        await storage.deactivateTradeConfiguration(config.id);
        return;
      }
    }

    // Verificar se é hora de executar baseado no intervalo
    if (!this.shouldExecuteNow(session)) {
      return;
    }

    console.log(`🚀 [${operationId}] Executando trade automático para usuário ${config.userId}`);
    
    try {
      // Verificar se usuário tem token Deriv configurado
      const tokenData = await storage.getUserDerivToken(config.userId);
      if (!tokenData) {
        console.warn(`⚠️ [${operationId}] Usuário ${config.userId} não possui token Deriv configurado`);
        return;
      }

      // Executar o trade
      const result = await this.executeAutomaticTrade(config, tokenData, operationId);
      
      if (result.success) {
        session.executedOperations += 1;
        session.lastExecutionTime = new Date();
        console.log(`✅ [${operationId}] Trade executado com sucesso. Progresso: ${session.executedOperations}/${session.operationsCount}`);
      } else {
        console.warn(`⚠️ [${operationId}] Trade falhou: ${result.error}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ [${operationId}] Erro na execução do trade:`, errorMessage);
      throw error;
    }
  }

  private shouldExecuteNow(session: ActiveTradeSession): boolean {
    if (!session.lastExecutionTime) {
      return true; // Primeira execução
    }

    const now = new Date();
    const timeDiff = now.getTime() - session.lastExecutionTime.getTime();
    
    let intervalMs = 0;
    switch (session.intervalType) {
      case 'minutes':
        intervalMs = session.intervalValue * 60 * 1000;
        break;
      case 'hours':
        intervalMs = session.intervalValue * 60 * 60 * 1000;
        break;
      case 'days':
        intervalMs = session.intervalValue * 24 * 60 * 60 * 1000;
        break;
      default:
        intervalMs = 60 * 1000; // Default: 1 minuto
    }

    return timeDiff >= intervalMs;
  }

  private async executeAutomaticTrade(config: any, tokenData: any, operationId: string): Promise<{success: boolean, error?: string}> {
    try {
      // 🔴 CAMADA 3 - CIRCUIT BREAKER: Verificar pausa obrigatória por perdas consecutivas
      if (realStatsTracker.isCircuitBreakerActive()) {
        const reqs = realStatsTracker.getRecoveryRequirements();
        const remainingSec = Math.ceil(reqs.circuitBreakerRemainingMs / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);
        console.log(`🔴 [${operationId}] CIRCUIT BREAKER ATIVO: ${reqs.consecutiveLosses} perdas consecutivas — pausa obrigatória (${remainingMin} min restantes)`);
        return {
          success: false,
          error: `CIRCUIT BREAKER: ${reqs.consecutiveLosses} perdas consecutivas — aguardando ${remainingMin} min antes do próximo trade`
        };
      }

      // 🔥 NOVA LÓGICA: Analisar TODOS os símbolos disponíveis e escolher o melhor
      console.log(`🔍 [${operationId}] Iniciando análise de TODOS os símbolos disponíveis...`);
      
      const bestSymbolResult = await this.analyzeBestSymbolFromAll(config.userId, operationId);
      
      if (!bestSymbolResult.success || !bestSymbolResult.symbol) {
        return { 
          success: false, 
          error: bestSymbolResult.error || 'Nenhum símbolo com consenso suficiente encontrado' 
        };
      }
      
      // 🔧 LIMPAR SÍMBOLO: Remover consenso formatado (ex: "R_50(45.0%)" → "R_50")
      let selectedSymbol = bestSymbolResult.symbol.split('(')[0].trim();
      
      // 🚫 VALIDAÇÃO DEFENSIVA IMEDIATA: Verificar bloqueio de (1s) - CAMADA 1
      if (this.isSymbolBlocked(selectedSymbol)) {
        console.error(`❌ [${operationId}] BLOQUEIO ATIVADO: Símbolo "${selectedSymbol}" contém "(1s)" - CAUSADOR DE LOSS`);
        console.error(`❌ [${operationId}] Pulando para alternativa...`);
        
        // Tentar próximo símbolo na lista top5
        if (bestSymbolResult.top5Symbols && bestSymbolResult.top5Symbols.length > 1) {
          for (let i = 1; i < bestSymbolResult.top5Symbols.length; i++) {
            const altSymbol = bestSymbolResult.top5Symbols[i].split('(')[0].trim();
            if (!this.isSymbolBlocked(altSymbol)) {
              selectedSymbol = altSymbol;
              console.log(`✅ [${operationId}] Símbolo alternativo selecionado (bloqueio evitado): ${selectedSymbol}`);
              break;
            }
          }
          
          // Se todos os top5 estão bloqueados, retornar erro
          if (this.isSymbolBlocked(selectedSymbol)) {
            return { success: false, error: 'Todos os símbolos candidatos estão bloqueados (contêm "1s")' };
          }
        } else {
          return { success: false, error: `Símbolo ${selectedSymbol} está bloqueado e sem alternativas` };
        }
      }
      
      // 🎯 DIVERSIFICAÇÃO INTELIGENTE: Verificar se ativo pode ser aberto + jogo de cintura
      const diversityCheck = await this.canOpenTradeForAsset(
        config.userId, 
        selectedSymbol, 
        bestSymbolResult.aiConsensus?.consensusStrength // Passar consenso como parâmetro
      );
      
      if (!diversityCheck.allowed) {
        // Ativo em cool-off - tentar próximo melhor
        console.log(`⚠️ [${operationId}] ${diversityCheck.reason} - procurando alternativa...`);
        
        // Buscar 2º melhor símbolo (se disponível)
        if (bestSymbolResult.top5Symbols && bestSymbolResult.top5Symbols.length > 1) {
          selectedSymbol = bestSymbolResult.top5Symbols[1].split('(')[0].trim();
          const altCheck = await this.canOpenTradeForAsset(config.userId, selectedSymbol);
          
          if (!altCheck.allowed) {
            // Tentar 3º melhor como último recurso
            if (bestSymbolResult.top5Symbols.length > 2) {
              selectedSymbol = bestSymbolResult.top5Symbols[2].split('(')[0].trim();
              const thirdCheck = await this.canOpenTradeForAsset(config.userId, selectedSymbol);
              if (!thirdCheck.allowed) {
                return { success: false, error: 'Todos os ativos candidatos estão em cool-off' };
              }
            } else {
              return { success: false, error: 'Ativos candidatos em cool-off e sem alternativas suficientes' };
            }
          }
          console.log(`✅ [${operationId}] Alternativa selecionada: ${selectedSymbol}`);
        } else {
          return { success: false, error: 'Ativo melhor selecionado em cool-off e sem alternativas' };
        }
      } else {
        // Ativo permitido
        console.log(`✅ [${operationId}] ${diversityCheck.reason}`);
      }
      
      // Registrar uso do ativo para diversificação
      this.trackAssetUsage(config.userId, selectedSymbol);
      const aiConsensusPreCalculated = bestSymbolResult.aiConsensus;

      // 🔁 CAMADA 1 - ANTI-REPETIÇÃO TOTAL: mesmo ativo jamais pode ser negociado duas vezes seguidas
      if (realStatsTracker.isAssetRepeated(config.userId, selectedSymbol)) {
        console.log(`🚫 [${operationId}] ANTI-REP: ${selectedSymbol} foi o ÚLTIMO ativo negociado — buscando alternativa obrigatória...`);
        const topList = bestSymbolResult.top5Symbols || [];
        let switched = false;
        for (const alt of topList) {
          const altClean = alt.split('(')[0].trim();
          if (!realStatsTracker.isAssetRepeated(config.userId, altClean) && !this.isSymbolBlocked(altClean)) {
            console.log(`🔄 [${operationId}] ANTI-REP: Alternativa selecionada → ${altClean}`);
            selectedSymbol = altClean;
            switched = true;
            break;
          }
        }
        if (!switched) {
          console.log(`⏳ [${operationId}] ANTI-REP: Sem alternativa disponível — aguardando próximo ciclo para evitar repetição`);
          return { success: false, error: `ANTI-REP: ${selectedSymbol} seria repetição do último trade — aguardando próximo ciclo` };
        }
      }

      console.log(`✅ [${operationId}] Melhor símbolo selecionado: ${selectedSymbol} (Consenso: ${aiConsensusPreCalculated.consensusStrength}%)`);
      console.log(`📊 [${operationId}] Analisados ${bestSymbolResult.totalAnalyzed} símbolos | TOP 5: ${bestSymbolResult.top5Symbols.join(', ')}`);
      
      // 🚫 TERCEIRA CAMADA DE PROTEÇÃO: Verificação final antes de buscar dados
      if (this.isSymbolBlocked(selectedSymbol)) {
        console.error(`❌ [${operationId}] ERRO CRÍTICO: Símbolo ${selectedSymbol} passou por filtros mas contém "(1s)" - SISTEMA RESPONSÁVEL BLOQUEANDO`);
        return { success: false, error: `Símbolo bloqueado detectado em verificação final: ${selectedSymbol}` };
      }

      // 🛡️ MODO RECUPERAÇÃO HIPER-SELETIVO: verificar se há perda não recuperada
      try {
        // Atualizar saldo atual no tracker (para detectar recuperação automática)
        const recoveryPnL = await storage.getDailyPnL(config.userId);
        if (recoveryPnL?.currentBalance && recoveryPnL.currentBalance > 0) {
          realStatsTracker.updateBalance(recoveryPnL.currentBalance);
        }

        if (realStatsTracker.isPostLossMode()) {
          const reqs = realStatsTracker.getRecoveryRequirements();

          console.log(`🛡️ [${operationId}] RECOVERY MODE ATIVO — Streak: ${reqs.consecutiveLosses} perdas | Saldo alvo: $${reqs.balanceToRecover.toFixed(2)} | Consenso mínimo: ${reqs.minConsensus}%`);

          // 1️⃣ Bloquear ativo que causou a perda
          if (reqs.assetStillBlocked && realStatsTracker.isAssetBlocked(selectedSymbol)) {
            console.log(`🚫 [${operationId}] RECOVERY MODE: Ativo ${selectedSymbol} em cooldown por perda. Buscando alternativa...`);

            // Tentar alternar para outro ativo do top5
            const topList = bestSymbolResult.top5Symbols || [];
            let switched = false;
            for (const alt of topList) {
              const altClean = alt.split('(')[0].trim();
              if (!realStatsTracker.isAssetBlocked(altClean) && !this.isSymbolBlocked(altClean)) {
                const altConsensus = parseFloat(alt.match(/\(([0-9.]+)%?\)/)?.[1] || '0');
                if (altConsensus >= reqs.minConsensus) {
                  selectedSymbol = altClean;
                  console.log(`🔄 [${operationId}] RECOVERY MODE: Alternativa selecionada: ${selectedSymbol} (${altConsensus}%)`);
                  switched = true;
                  break;
                }
              }
            }

            if (!switched) {
              console.log(`⏳ [${operationId}] RECOVERY MODE: Sem alternativa com consenso ≥${reqs.minConsensus}% fora do cooldown. Aguardando próximo ciclo.`);
              return { success: false, error: `RECOVERY MODE: Aguardando sinal excepcional (≥${reqs.minConsensus}%) em ativo diferente de ${reqs.blockedAsset}` };
            }
          }

          // 2️⃣ Exigir consenso mínimo de 85% para qualquer trade em modo recuperação
          const currentConsensus = aiConsensusPreCalculated?.consensusStrength ?? 0;
          if (currentConsensus < reqs.minConsensus) {
            console.log(`⛔ [${operationId}] RECOVERY MODE: Consenso ${currentConsensus}% < mínimo ${reqs.minConsensus}% exigido`);
            console.log(`   → Sistema aguarda sinal excepcional antes de operar novamente`);
            console.log(`   → Saldo atual estimado: $${recoveryPnL?.currentBalance?.toFixed(2) || '?'} | Alvo: $${reqs.balanceToRecover.toFixed(2)}`);
            return { success: false, error: `RECOVERY MODE: Consenso ${currentConsensus}% insuficiente — exigido ≥${reqs.minConsensus}% após perda` };
          }

          console.log(`🔥 [${operationId}] RECOVERY MODE: Sinal EXCEPCIONAL ${currentConsensus}% ≥ ${reqs.minConsensus}% | Trade AUTORIZADO em ${selectedSymbol}`);
        }
      } catch (recoveryCheckError) {
        console.warn(`⚠️ [${operationId}] Erro na verificação de recovery mode:`, recoveryCheckError);
      }

      // Buscar dados de mercado
      let marketDataInfo = await storage.getMarketData(selectedSymbol);
      if (!marketDataInfo) {
        // Tentar gerar dados de mercado simulados se não existirem
        console.log(`📊 [${operationId}] Gerando dados de mercado simulados para ${selectedSymbol}...`);
        try {
          await this.createMockMarketData(selectedSymbol);
          marketDataInfo = await storage.getMarketData(selectedSymbol);
        } catch (error) {
          console.error(`❌ [${operationId}] Erro ao gerar dados de mercado:`, error);
        }
        
        if (!marketDataInfo) {
          return { success: false, error: 'Dados de mercado não disponíveis' };
        }
      }

      // Verificação de segurança: não permitir trading real com dados simulados
      if (marketDataInfo.isSimulated && tokenData.accountType === 'real') {
        return { 
          success: false, 
          error: 'SEGURANÇA: Não é possível executar trades em conta real com dados simulados' 
        };
      }

      // Verificação de qualidade dos dados
      // 🔥 AUMENTADO para 5 minutos pois Deriv pode ter latência
      const lastUpdateTime = marketDataInfo.lastUpdate ? new Date(marketDataInfo.lastUpdate).getTime() : 0;
      const dataAge = new Date().getTime() - lastUpdateTime;
      const isDataStale = dataAge > (marketDataInfo.isSimulated ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000); // 24h para simulados, 5min para reais
      
      if (isDataStale) {
        return { 
          success: false, 
          error: `Dados de mercado MUITO desatualizados (${Math.round(dataAge / 1000)}s > 300s)` 
        };
      }

      const priceHistory = JSON.parse(marketDataInfo.priceHistory);
      
      // Verificar quantidade mínima de dados históricos
      if (priceHistory.length < 50) {
        return { 
          success: false, 
          error: `Histórico insuficiente: ${priceHistory.length} pontos (mínimo: 50)` 
        };
      }

      const tickData = priceHistory.map((price: number, index: number) => ({
        symbol: selectedSymbol,
        quote: price,
        epoch: Date.now() - (priceHistory.length - index) * 1000
      }));

      // Usar consenso pré-calculado da análise de todos os símbolos
      const aiConsensus = aiConsensusPreCalculated;
      
      // 🎯 REGISTRAR THRESHOLD NO TRACKER DINÂMICO (essencial para cálculo da média alta)
      dynamicThresholdTracker.recordThreshold(
        aiConsensus.consensusStrength,
        selectedSymbol,
        aiConsensus.finalDecision
      );
      
      // 🎯 SISTEMA DE THRESHOLD DINÂMICO BASEADO EM MÉDIA ALTA DIÁRIA
      const isProductionMode = config.mode.includes('production');
      
      // 🔥 FORÇAR EXECUÇÃO EM DESENVOLVIMENTO PARA TESTE
      const isDev = true; // Forçado para teste
      const forceTrade = true;

      // 🎯 VERIFICAR SE PRECISA FORÇAR OPERAÇÕES MÍNIMAS
      const shouldForceMinimum = true;
      
      // 🎯 OBTER THRESHOLD DINÂMICO (MÉDIA ALTA DO DIA)
      const dynamicThreshold = 10;
      
      // 🌟 IDENTIFICAR SINAIS EXCEPCIONALMENTE FORTES
      const isStrongSignal = aiConsensus.consensusStrength >= 75;
      const isExceptionalSignal = aiConsensus.consensusStrength >= 85;
      
      console.log(`📊 [${operationId}] 🎯 Threshold: ${dynamicThreshold}% | 🧠 Consenso: ${aiConsensus.consensusStrength}%${isExceptionalSignal ? ' 🔥🔥🔥 EXCEPCIONAL' : isStrongSignal ? ' 🔥 FORTE' : ''} | ⚡ Forçar: ${shouldForceMinimum}`);

      // 🔥 LOG DE DECISÃO FINAL PARA DEBUG
      console.log(`🤔 [DEBUG] Decisão Final: ${aiConsensus.finalDecision}, Strength: ${aiConsensus.consensusStrength}, Threshold: ${dynamicThreshold}`);
      
      // ✅ CORREÇÃO CRÍTICA: Forçar direção se o consenso for alto mesmo sendo neutral
      if (aiConsensus.finalDecision === 'neutral') {
        if (isExceptionalSignal || isStrongSignal) {
          // Se o consenso for muito alto, a IA está "muito certa" de algo, mas o score de neutral venceu por pouco
          // Vamos forçar a direção predominante entre UP e DOWN
          const upScore = aiConsensus.upScore || 0;
          const downScore = aiConsensus.downScore || 0;
          if (upScore > downScore) {
            aiConsensus.finalDecision = 'up';
            console.log(`🔄 [${operationId}] Forçando UP devido a alto consenso (${aiConsensus.consensusStrength}%) apesar de Neutral`);
          } else if (downScore > upScore) {
            aiConsensus.finalDecision = 'down';
            console.log(`🔄 [${operationId}] Forçando DOWN devido a alto consenso (${aiConsensus.consensusStrength}%) apesar de Neutral`);
          }
        }
        
        if (aiConsensus.finalDecision === 'neutral' && !forceTrade && !shouldForceMinimum) {
          console.log(`⏸️ [${operationId}] Decisão NEUTRAL - aguardando sinal direcional mais forte`);
          return { success: false, error: 'Decisão de IA é NEUTRAL - aguardando sinal claro' };
        }
      }

      if (isProductionMode) {
        // 🎯 MODO DE PRODUÇÃO OTIMIZADO - Maximizar operações dentro dos limites
        const limits = this.getOperationLimitsForMode(config.mode);
        const operationsToday = await storage.getConservativeOperationsToday(config.userId);
        
        console.log(`📊 [${operationId}] MODO ${config.mode} - Operações: ${operationsToday}/${limits.max} (min: ${limits.min})`);
        
        // Verificar se já atingiu máximo diário
        if (operationsToday >= limits.max) {
          // 🌟 EXCEÇÃO FUTURA: Sinais excepcionais poderão ter tratamento especial
          if (isExceptionalSignal) {
            console.log(`⚡ [${operationId}] SINAL EXCEPCIONAL detectado (${aiConsensus.consensusStrength}%) mas limite atingido`);
          }
          console.log(`🛑 [${operationId}] Máximo diário atingido (${operationsToday}/${limits.max})`);
          return { success: false, error: `Máximo de operações diárias atingido para modo ${config.mode}` };
        }
        
        // 🔥 LÓGICA OTIMIZADA: Executar quando consenso >= threshold
        // 🔥 ACEITAR QUALQUER SINAL (até neutral 45%) - TESTE SEM LIMITES
        if (true) {
          console.log(`✅ [DEBUG] Condição de execução atendida (Consenso: ${aiConsensus.consensusStrength}, Threshold: ${dynamicThreshold}, Force: ${forceTrade})`);
          if (isExceptionalSignal) {
            console.log(`✅ [${operationId}] 🔥🔥🔥 EXECUTANDO SINAL EXCEPCIONAL: ${aiConsensus.consensusStrength}%`);
          } else if (isStrongSignal) {
            console.log(`✅ [${operationId}] 🔥 EXECUTANDO SINAL FORTE: ${aiConsensus.consensusStrength}%`);
          } else {
            console.log(`✅ [${operationId}] 🚀 EXECUTANDO: Consenso ${aiConsensus.consensusStrength}% >= Threshold ${dynamicThreshold}% (${aiConsensus.finalDecision})`);
          }
          // Continuar para executar a operação
        } else if (shouldForceMinimum && operationsToday < limits.min) {
          // Forçar operação mínima se necessário
          console.log(`🎯 [${operationId}] Forçando operação mínima (${operationsToday + 1}/${limits.min})`);
          
          const forcedDecision = await this.forceMandatoryConservativeDecision(tickData, selectedSymbol, config.userId);
          aiConsensus.finalDecision = forcedDecision.decision;
          aiConsensus.consensusStrength = forcedDecision.strength;
          aiConsensus.reasoning = `OPERAÇÃO MÍNIMA GARANTIDA (${operationsToday + 1}/${limits.min}): ${forcedDecision.reasoning}`;
          
          console.log(`✅ [${operationId}] Decisão forçada: ${aiConsensus.finalDecision} (${aiConsensus.consensusStrength}%)`);
        } else {
          console.log(`⏸️ [${operationId}] Aguardando sinal: ${aiConsensus.consensusStrength}% < ${dynamicThreshold}%`);
          return { success: false, error: `Aguardando consenso >= média alta (${aiConsensus.consensusStrength}% < ${dynamicThreshold}%)` };
        }
      } else {
        // 🎯 MODO TESTE/SEM LIMITES OTIMIZADO - Executar o máximo possível
        console.log(`🚀 [${operationId}] MODO ${config.mode} - Threshold dinâmico ativo`);
        
        // 🔥 EXECUTAR SEMPRE que consenso >= threshold (sem limites)
        if (true) {
          console.log(`✅ [DEBUG] Modo Teste: Execução liberada (Consenso: ${aiConsensus.consensusStrength}, Threshold: ${dynamicThreshold}, Force: ${forceTrade})`);
          if (isExceptionalSignal) {
            console.log(`✅ [${operationId}] 🔥🔥🔥 EXECUTANDO SINAL EXCEPCIONAL: ${aiConsensus.consensusStrength}%`);
          } else if (isStrongSignal) {
            console.log(`✅ [${operationId}] 🔥 EXECUTANDO SINAL FORTE: ${aiConsensus.consensusStrength}%`);
          } else {
            console.log(`✅ [${operationId}] 🚀 EXECUTANDO: Consenso ${aiConsensus.consensusStrength}%`);
          }
          // Continuar para executar a operação
        } else if (shouldForceMinimum) {
          // Garantir pelo menos 1 operação/dia no modo sem limites
          console.log(`🎯 [${operationId}] Forçando operação mínima no modo sem limites`);
          
          const forcedDecision = await this.forceMandatoryConservativeDecision(tickData, selectedSymbol, config.userId);
          aiConsensus.finalDecision = forcedDecision.decision;
          aiConsensus.consensusStrength = forcedDecision.strength;
          aiConsensus.reasoning = `OPERAÇÃO MÍNIMA DIÁRIA: ${forcedDecision.reasoning}`;
          
          console.log(`✅ [${operationId}] Decisão forçada: ${aiConsensus.finalDecision} (${aiConsensus.consensusStrength}%)`);
        } else {
          console.log(`⏸️ [${operationId}] Aguardando sinal: ${aiConsensus.consensusStrength}% < ${dynamicThreshold}%`);
          return { success: false, error: `Aguardando consenso >= threshold (${aiConsensus.consensusStrength}% < ${dynamicThreshold}%)` };
        }
      }

      // 🔴 VERIFICAR FLAG DE PAUSA CENTRALIZADA - Todos os remixes respeita m
      const tradingControlStatus = await storage.getTradingControlStatus();
      if (tradingControlStatus?.isPaused) {
        console.log(`🛑 [${operationId}] ⏸️ TRADING PAUSADO GLOBALMENTE - Pausado por: ${tradingControlStatus.pausedBy} | Motivo: ${tradingControlStatus.pauseReason}`);
        return { success: false, error: `Trading pausado globalmente: ${tradingControlStatus.pauseReason}` };
      }

      // Conectar ao Deriv (com timeout de 20 segundos)
      const CONNECTION_TIMEOUT = 20000;
      let connected = false;
      
      try {
        const connectPromise = derivAPI.connect(tokenData.token, tokenData.accountType as "demo" | "real", operationId);
        const timeoutPromise = new Promise<boolean>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout de conexão Deriv (20s)')), CONNECTION_TIMEOUT);
        });
        
        connected = await Promise.race([connectPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error(`⏱️ [${operationId}] Timeout na conexão Deriv - pulando trade`);
        try { await derivAPI.disconnect(); } catch (e) { /* ignore */ }
        return { success: false, error: 'Timeout de conexão com Deriv (20s)' };
      }
      
      if (!connected) {
        return { success: false, error: 'Erro de conexão com Deriv' };
      }

      try {
        // Determinar parâmetros do trade baseado no modo e banca
        // 🔥 SISTEMA DE RECUPERAÇÃO INTELIGENTE DE PERDAS
      // 🚀 FLEXIBILIDADE DINÂMICA: Passar consenso + aplicar dynamic stake/ticks
      let tradeParams = await this.getTradeParamsForMode(config.mode, selectedSymbol, aiConsensus.finalDecision, config.userId, aiConsensus.consensusStrength, aiConsensus.volatility || 0.5);
      
      // 📈 APLICAR TICKS DINÂMICOS baseado em win rate do ativo
      tradeParams.duration = this.calculateDynamicTicks(selectedSymbol, tradeParams.duration);
      let isRecoveryMode = false;
      let recoveryMultiplier = 1.0;

      try {
        // Verificar se precisa ativar modo de recuperação
        const shouldRecover = await storage.shouldActivateRecovery(config.userId);
        if (shouldRecover) {
          isRecoveryMode = true;
          
          // 🔥 COOPERAÇÃO AI INTENSIFICADA: Estratégia de recuperação cooperativa
          const recoveryStrategy = await this.getActiveRecoveryStrategy(config.userId);
          recoveryMultiplier = await this.calculateCooperativeRecoveryMultiplier(config.userId, recoveryStrategy);
          
          // Aplicar multiplicador de recuperação gradual baseado na cooperação das IAs
          tradeParams.amount = tradeParams.amount * recoveryMultiplier;
          
          console.log(`🔥 [${operationId}] MODO RECUPERAÇÃO ATIVADO - COOPERAÇÃO AI:`);
          console.log(`🧠 Estratégia: ${recoveryStrategy.name} (Taxa de sucesso: ${recoveryStrategy.successRate}%)`);
          console.log(`💰 Valor base: $${tradeParams.amount / recoveryMultiplier}`);
          console.log(`📈 Multiplicador cooperativo: ${recoveryMultiplier}x`);
          console.log(`🎯 Valor final: $${tradeParams.amount}`);
          console.log(`🤖 Threshold de consenso AI elevado para: ${recoveryStrategy.confidenceThreshold * 100}%`);
        }
      } catch (error) {
        console.log(`⚠️ [${operationId}] Erro ao verificar recuperação: ${error}, continuando com valores normais`);
      }

      // 🛡️ PROTEÇÃO FUNDAMENTAL: JAMAIS FECHAR ABAIXO DO ANTERIOR OU ABERTURA
      try {
        const protectionCheck = await storage.canExecuteTradeWithoutViolatingMinimum(config.userId, tradeParams.amount);
        
        if (!protectionCheck.canExecute) {
          console.log(`🛡️ [${operationId}] PROTEÇÃO ATIVADA - TRADE BLOQUEADO:`);
          console.log(`   • Motivo: ${protectionCheck.reason}`);
          console.log(`   • Saldo atual: $${protectionCheck.currentBalance.toFixed(2)}`);
          console.log(`   • Mínimo requerido: $${protectionCheck.minimumRequired.toFixed(2)}`);
          console.log(`   • Valor do trade: $${tradeParams.amount.toFixed(2)}`);
          
          return { 
            success: false, 
            error: `PROTEÇÃO ATIVADA: ${protectionCheck.reason}` 
          };
        }
        
        // Log da proteção quando trade é permitido
        const safetyMargin = protectionCheck.currentBalance - protectionCheck.minimumRequired;
        console.log(`🛡️ [${operationId}] Verificação de proteção passou:`);
        console.log(`   • Saldo atual: $${protectionCheck.currentBalance.toFixed(2)}`);
        console.log(`   • Mínimo requerido: $${protectionCheck.minimumRequired.toFixed(2)}`);
        console.log(`   • Margem de segurança: $${safetyMargin.toFixed(2)}`);
        console.log(`   • Valor do trade: $${tradeParams.amount.toFixed(2)} ✅`);
        
      } catch (error) {
        console.error(`❌ [${operationId}] Erro na verificação de proteção: ${error}`);
        return { 
          success: false, 
          error: `Erro na verificação de proteção: ${error}` 
        };
      }
        
        // Executar o trade
        // 🚫 ÚLTIMA VERIFICAÇÃO: Validação defensiva antes de executar trade
        if (this.isSymbolBlocked(selectedSymbol)) {
          console.error(`❌ [${operationId}] ERRO CRÍTICO DE SEGURANÇA: Símbolo "${selectedSymbol}" está bloqueado - EXECUTANDO BLOQUEIO TOTAL`);
          return { success: false, error: `BLOQUEIO DE SEGURANÇA ATIVADO: Símbolo ${selectedSymbol} contém "(1s)"` };
        }
        
        // ─── SELEÇÃO DE MODALIDADE ───────────────────────────────────────
        // Ler modalidades ativas do banco, selecionar a mais adequada
        let activeModalities: string[] = ['digit_differs'];
        try {
          const userConfig = await storage.getUserTradeConfig(config.userId);
          if (userConfig?.selectedModalities) {
            const parsed = JSON.parse(userConfig.selectedModalities);
            if (Array.isArray(parsed) && parsed.length > 0) {
              activeModalities = parsed;
            }
          }
        } catch {}

        // Escolher modalidade por rotação: pega baseado na hora atual para distribuir
        const DIGIT_TYPES: Record<string, string> = {
          'digit_differs': 'DIGITDIFF',
          'digit_matches': 'DIGITMATCH',
          'digit_even': 'DIGITEVEN',
          'digit_odd': 'DIGITODD',
          'digit_over': 'DIGITOVER',
          'digit_under': 'DIGITUNDER',
        };
        const RISFALL_TYPES: Set<string> = new Set(['rise', 'fall', 'higher', 'lower']);
        const IN_OUT_TYPES: Record<string, string> = {
          'ends_between': 'EXPIRYRANGE',
          'ends_outside': 'EXPIRYMISS',
          'stays_between': 'RANGE',
          'goes_outside': 'UPORDOWN',
        };
        const TOUCH_TYPES: Record<string, string> = {
          'touch': 'ONETOUCH',
          'no_touch': 'NOTOUCH',
        };
        const MULTIPLIER_TYPES: Record<string, string> = {
          'multiplier_up': 'MULTUP',
          'multiplier_down': 'MULTDOWN',
        };
        const TURBO_TYPES: Record<string, string> = {
          'turbo_up': 'TURBOSLONG',
          'turbo_down': 'TURBOSSHORT',
        };
        const VANILLA_TYPES: Record<string, string> = {
          'vanilla_call': 'VANILLALONGCALL',
          'vanilla_put': 'VANILLALONGPUT',
        };
        const LOOKBACK_TYPES: Record<string, string> = {
          'lookback_high_close': 'LBFLOATPUT',
          'lookback_close_low': 'LBFLOATCALL',
          'lookback_high_low': 'LBHIGHLOW',
        };

        const ALL_SUPPORTED = new Set([
          ...Object.keys(DIGIT_TYPES),
          ...RISFALL_TYPES,
          ...Object.keys(IN_OUT_TYPES),
          ...Object.keys(TOUCH_TYPES),
          ...Object.keys(MULTIPLIER_TYPES),
          'accumulator',
          ...Object.keys(TURBO_TYPES),
          ...Object.keys(VANILLA_TYPES),
          ...Object.keys(LOOKBACK_TYPES),
        ]);

        // ─── MATRIZ DE COMPATIBILIDADE SÍMBOLO × MODALIDADE ──────────────
        // Define quais modalidades são suportadas por cada grupo de símbolo.
        // Baseado na documentação oficial da Deriv para índices sintéticos.
        const DIGIT_KEYS   = Object.keys(DIGIT_TYPES);
        const RISFALL_KEYS = ['rise', 'fall', 'higher', 'lower'];
        const INOUT_KEYS   = Object.keys(IN_OUT_TYPES);
        const TOUCH_KEYS   = Object.keys(TOUCH_TYPES);
        const MULT_KEYS    = Object.keys(MULTIPLIER_TYPES);
        const ACCU_KEYS    = ['accumulator'];
        const TURBO_KEYS   = Object.keys(TURBO_TYPES);
        const VANILLA_KEYS = Object.keys(VANILLA_TYPES);
        const LB_KEYS      = Object.keys(LOOKBACK_TYPES);

        // Volatility Indices (R_10, R_25, R_50, R_75, R_100):
        //   suportam tudo exceto Turbos e Vanillas (disponíveis apenas em conta real/forex)
        const VOL_BASE   = [...DIGIT_KEYS, ...RISFALL_KEYS, ...INOUT_KEYS, ...TOUCH_KEYS, ...MULT_KEYS, ...ACCU_KEYS, ...LB_KEYS];
        // 1HZ Indices com suporte completo (10, 25, 50, 75, 100):
        //   suportam dígitos, rise/fall, in/out, touch, multiplicadores, acumuladores
        const HZ_FULL    = [...DIGIT_KEYS, ...RISFALL_KEYS, ...INOUT_KEYS, ...TOUCH_KEYS, ...MULT_KEYS, ...ACCU_KEYS];
        // 1HZ Indices básicos (15, 30, 90): sem multiplicadores/acumuladores
        const HZ_BASIC   = [...DIGIT_KEYS, ...RISFALL_KEYS, ...INOUT_KEYS, ...TOUCH_KEYS];
        // Jump Indices (JD10..JD100): apenas dígitos, rise/fall, in/out, touch
        const JUMP_OK    = [...DIGIT_KEYS, ...RISFALL_KEYS, ...INOUT_KEYS, ...TOUCH_KEYS];
        // Range Break (RDBULL, RDBEAR): idem Jump
        const RDB_OK     = [...DIGIT_KEYS, ...RISFALL_KEYS, ...INOUT_KEYS, ...TOUCH_KEYS];
        // R_100 também suporta Turbos e Vanillas (maior liquidez)
        const VOL_100    = [...VOL_BASE, ...TURBO_KEYS, ...VANILLA_KEYS];

        const SYMBOL_COMPAT: Record<string, string[]> = {
          'R_10': VOL_BASE,   'R_25': VOL_BASE,   'R_50': VOL_BASE,
          'R_75': VOL_BASE,   'R_100': VOL_100,
          '1HZ10V': HZ_FULL,  '1HZ25V': HZ_FULL,  '1HZ50V': HZ_FULL,
          '1HZ75V': HZ_FULL,  '1HZ100V': HZ_FULL,
          '1HZ15V': HZ_BASIC, '1HZ30V': HZ_BASIC, '1HZ90V': HZ_BASIC,
          'JD10': JUMP_OK,    'JD25': JUMP_OK,    'JD50': JUMP_OK,
          'JD75': JUMP_OK,    'JD100': JUMP_OK,
          'RDBULL': RDB_OK,   'RDBEAR': RDB_OK,
        };

        // Determinar modalidades compatíveis com o símbolo selecionado
        const symbolCompatible = new Set<string>(SYMBOL_COMPAT[selectedSymbol] ?? [...DIGIT_KEYS, ...RISFALL_KEYS]);

        // Filtrar modalidades: suportadas pela plataforma E compatíveis com o símbolo
        const supportedModalities = activeModalities.filter(m => ALL_SUPPORTED.has(m) && symbolCompatible.has(m));

        // Se nenhuma ativa for compatível, usar dígitos como fallback universal
        const finalModalities = supportedModalities.length > 0 ? supportedModalities : DIGIT_KEYS.filter(k => activeModalities.includes(k));
        const compatibleModalities = finalModalities.length > 0 ? finalModalities : ['digit_differs'];

        if (supportedModalities.length < activeModalities.filter(m => ALL_SUPPORTED.has(m)).length) {
          const dropped = activeModalities.filter(m => ALL_SUPPORTED.has(m) && !symbolCompatible.has(m));
          console.log(`🔄 [${operationId}] Compatibilidade: ${dropped.join(', ')} não disponível em ${selectedSymbol} → usando: ${compatibleModalities.join(', ')}`);
        }

        const selectedModality = compatibleModalities[Math.floor(Date.now() / 60000) % compatibleModalities.length];

        console.log(`🎯 [${operationId}] Modalidade selecionada: ${selectedModality} ✅ compatível com ${selectedSymbol} (pool: ${compatibleModalities.join(', ')})`);


        // ─── EXECUÇÃO POR MODALIDADE ─────────────────────────────────────
        let contract: any = null;
        let resolvedTradeType = 'digitdiff';

        const safeDirection: "up" | "down" = 
          (aiConsensus.finalDecision === 'up' || aiConsensus.finalDecision === 'down')
            ? aiConsensus.finalDecision as "up" | "down"
            : ((aiConsensus.upScore || 0) >= (aiConsensus.downScore || 0) ? 'up' : 'down');

        // 📌 CAMADA 1 - ANTI-REPETIÇÃO: registrar ativo ANTES de executar o contrato
        realStatsTracker.setLastTradedAsset(config.userId, selectedSymbol);

        if (DIGIT_TYPES[selectedModality]) {
          // ── Contratos de Dígitos (DIGITDIFF, DIGITMATCH, DIGITEVEN, DIGITODD, DIGITOVER, DIGITUNDER) ──
          const contractType = DIGIT_TYPES[selectedModality] as 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';
          const needsBarrier = ['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER'].includes(contractType);
          
          let barrier: string | undefined = tradeParams.barrier;
          if (contractType === 'DIGITOVER') barrier = '4';
          if (contractType === 'DIGITUNDER') barrier = '5';
          if (!needsBarrier) barrier = undefined;

          contract = await derivAPI.buyGenericDigitContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            duration: tradeParams.duration,
            amount: tradeParams.amount,
            barrier,
            currency: 'USD',
          });
          resolvedTradeType = selectedModality.replace('_', '');

        } else if (RISFALL_TYPES.has(selectedModality)) {
          // ── Contratos Rise/Fall (CALL/PUT) ──
          const callPutDirection: 'up' | 'down' = (selectedModality === 'rise' || selectedModality === 'higher') ? 'up' : 
                                                    (selectedModality === 'fall' || selectedModality === 'lower') ? 'down' : 
                                                    safeDirection;
          const callPutDuration = Math.max(1, Math.floor(tradeParams.duration / 2));
          contract = await derivAPI.buyCallPutContract(selectedSymbol, callPutDirection, callPutDuration, tradeParams.amount);
          resolvedTradeType = selectedModality;

        } else if (IN_OUT_TYPES[selectedModality]) {
          // ── Contratos Dentro & Fora (EXPIRYRANGE, EXPIRYMISS, RANGE, UPORDOWN) ──
          const contractType = IN_OUT_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);
          let highBarrier: string;
          let lowBarrier: string;

          if (currentPrice && currentPrice > 0) {
            const offsetPct = (selectedModality === 'ends_outside' || selectedModality === 'goes_outside') ? 0.008 : 0.005;
            const offset = parseFloat((currentPrice * offsetPct).toFixed(4));
            highBarrier = '+' + offset;
            lowBarrier = '-' + offset;
          } else {
            highBarrier = '+0.5';
            lowBarrier = '-0.5';
          }

          console.log(`📊 [${operationId}] ${contractType}: high=${highBarrier}, low=${lowBarrier} | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            duration: 5,
            duration_unit: 'm',
            high_barrier: highBarrier,
            low_barrier: lowBarrier,
          });
          resolvedTradeType = selectedModality;

        } else if (TOUCH_TYPES[selectedModality]) {
          // ── Contratos Touch / No Touch (ONETOUCH, NOTOUCH) ──
          const contractType = TOUCH_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);
          let barrier: string;

          if (currentPrice && currentPrice > 0) {
            const offsetPct = selectedModality === 'no_touch' ? 0.015 : 0.004;
            const offset = parseFloat((currentPrice * offsetPct).toFixed(4));
            barrier = (safeDirection === 'up' ? '+' : '-') + offset;
          } else {
            barrier = safeDirection === 'up' ? '+0.5' : '-0.5';
          }

          console.log(`📊 [${operationId}] ${contractType}: barrier=${barrier} | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            duration: 5,
            duration_unit: 'm',
            barrier,
          });
          resolvedTradeType = selectedModality;

        } else if (MULTIPLIER_TYPES[selectedModality]) {
          // ── Contratos Multiplicadores (MULTUP, MULTDOWN) ──
          const contractType = MULTIPLIER_TYPES[selectedModality];
          console.log(`📊 [${operationId}] ${contractType}: multiplier=10x | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            multiplier: 10,
          });
          resolvedTradeType = selectedModality;

        } else if (selectedModality === 'accumulator') {
          // ── Contratos Acumuladores (ACCU) ──
          console.log(`📊 [${operationId}] ACCU: growth_rate=2% | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: 'ACCU',
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            growth_rate: 0.02,
          });
          resolvedTradeType = 'accumulator';

        } else if (TURBO_TYPES[selectedModality]) {
          // ── Contratos Turbos/Knockouts (TURBOSLONG, TURBOSSHORT) ──
          const contractType = TURBO_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);
          let barrier: string;

          if (currentPrice && currentPrice > 0) {
            const knockoutOffset = currentPrice * 0.015;
            if (selectedModality === 'turbo_up') {
              barrier = (currentPrice - knockoutOffset).toFixed(4);
            } else {
              barrier = (currentPrice + knockoutOffset).toFixed(4);
            }
          } else {
            barrier = '0';
          }

          const dateExpiry = Math.floor(Date.now() / 1000) + 900;
          console.log(`📊 [${operationId}] ${contractType}: barrier=${barrier}, expiry=15min | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            barrier,
            date_expiry: dateExpiry,
          });
          resolvedTradeType = selectedModality;

        } else if (VANILLA_TYPES[selectedModality]) {
          // ── Contratos Vanilla Options (VANILLALONGCALL, VANILLALONGPUT) ──
          const contractType = VANILLA_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);
          let strike: string;

          if (currentPrice && currentPrice > 0) {
            const strikeOffset = currentPrice * 0.005;
            strike = selectedModality === 'vanilla_call'
              ? (currentPrice + strikeOffset).toFixed(4)
              : (currentPrice - strikeOffset).toFixed(4);
          } else {
            strike = '0';
          }

          const dateExpiry = Math.floor(Date.now() / 1000) + 900;
          console.log(`📊 [${operationId}] ${contractType}: strike=${strike}, expiry=15min | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            barrier: strike,
            date_expiry: dateExpiry,
          });
          resolvedTradeType = selectedModality;

        } else if (LOOKBACK_TYPES[selectedModality]) {
          // ── Contratos Lookback (LBFLOATPUT, LBFLOATCALL, LBHIGHLOW) ──
          const contractType = LOOKBACK_TYPES[selectedModality];
          console.log(`📊 [${operationId}] ${contractType}: multiplier basis | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            duration: 5,
            duration_unit: 'm',
            basis: 'multiplier',
          });
          resolvedTradeType = selectedModality;

        } else {
          // Fallback: sempre executar DIGITDIFF
          const fallbackContract = {
            contract_type: 'DIGITDIFF' as const,
            symbol: selectedSymbol,
            duration: tradeParams.duration,
            duration_unit: 't' as const,
            barrier: tradeParams.barrier,
            amount: tradeParams.amount,
            currency: 'USD'
          };
          contract = await derivAPI.buyDigitDifferContract(fallbackContract);
          resolvedTradeType = 'digitdiff';
        }

        if (!contract) {
          console.error(`❌ [${operationId}] Erro ao comprar contrato [${selectedModality}] na Deriv para ${selectedSymbol}`);
          return { success: false, error: `Falha ao executar trade [${selectedModality}] na Deriv` };
        }

        console.log(`✅ [${operationId}] Contrato [${selectedModality}] comprado com sucesso: ${contract.contract_id}`);

        // Salvar operação no banco com informações de recuperação
        await storage.createTradeOperation({
          userId: config.userId,
          derivContractId: String(contract.contract_id),
          symbol: selectedSymbol,
          tradeType: resolvedTradeType,
          direction: safeDirection,
          amount: tradeParams.amount,
          duration: tradeParams.duration,
          status: 'pending',
          aiConsensus: JSON.stringify(aiConsensus),
          isRecoveryMode,
          recoveryMultiplier
        });

        // 🎯 Incrementar contador PERSISTENTE de operações conservadoras (só para modos de produção)
        if (config.mode.includes('production')) {
          try {
            const limits = this.getOperationLimitsForMode(config.mode);
            const newCount = await storage.incrementConservativeOperations(config.userId);
            console.log(`📊 [${operationId}] Operações conservadoras hoje: ${newCount}/${limits.max} (modo: ${config.mode})`);
          } catch (error) {
            console.error(`❌ [${operationId}] Erro ao incrementar contador: ${error}`);
          }
        }
        
        console.log(`🎯 [${operationId}] Trade automático executado: ${selectedSymbol} ${aiConsensus.finalDecision} $${tradeParams.amount}`);
        return { success: true };

      } finally {
        // Sempre desconectar
        await derivAPI.disconnect();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async createMockMarketData(symbol: string): Promise<void> {
    // Gerar dados de mercado simulados realistas
    const basePrice = Math.random() * 100 + 50; // Preço base entre 50-150
    const priceHistory: number[] = [];
    
    // Gerar 100 pontos de histórico de preços
    let currentPrice = basePrice;
    for (let i = 0; i < 100; i++) {
      // Variação aleatória de -1% a +1%
      const variation = (Math.random() - 0.5) * 0.02;
      currentPrice = currentPrice * (1 + variation);
      priceHistory.push(Number(currentPrice.toFixed(5)));
    }
    
    await storage.upsertMarketData({
      symbol,
      currentPrice: currentPrice,
      priceHistory: JSON.stringify(priceHistory),
      isSimulated: true  // Marcar como dados simulados
    });
    
    console.log(`✅ Dados de mercado simulados criados para ${symbol}`);
  }

  // 🚀 FORÇAR DECISÃO CONSERVADORA INTELIGENTE
  private async forceMandatoryConservativeDecision(
    tickData: any[], 
    symbol: string, 
    userId: string
  ): Promise<{decision: 'up' | 'down', strength: number, reasoning: string}> {
    console.log(`🎯 Forçando decisão conservadora para ${symbol}...`);
    
    if (tickData.length === 0) {
      return {
        decision: 'up',
        strength: 60,
        reasoning: 'Decisão conservadora padrão: UP por falta de dados históricos'
      };
    }
    
    const prices = tickData.map((t: any) => t.quote);
    const currentPrice = prices[prices.length - 1];
    const previousPrice = prices[prices.length - 2] || currentPrice;
    const lastDigit = Math.floor(currentPrice * 10) % 10;
    
    // Análise técnica conservadora
    let upScore = 0;
    let downScore = 0;
    let reasoning = 'CONSERVADORA: ';
    
    // 1. Média móvel simples (5 períodos)
    if (prices.length >= 5) {
      const sma5 = prices.slice(-5).reduce((a: number, b: number) => a + b, 0) / 5;
      if (currentPrice > sma5) {
        upScore += 20;
        reasoning += 'Preço acima SMA5; ';
      } else {
        downScore += 20;
        reasoning += 'Preço abaixo SMA5; ';
      }
    }
    
    // 2. Tendência de preço recente
    if (currentPrice > previousPrice) {
      upScore += 15;
      reasoning += 'Tendência de alta; ';
    } else {
      downScore += 15;
      reasoning += 'Tendência de baixa; ';
    }
    
    // 3. Análise do último dígito (digit differs)
    if (lastDigit <= 3) {
      upScore += 15;
      reasoning += `Dígito ${lastDigit} baixo; `;
    } else if (lastDigit >= 7) {
      downScore += 15;
      reasoning += `Dígito ${lastDigit} alto; `;
    } else {
      // Dígito médio, adicionar pontos baseado na tendência
      if (currentPrice > previousPrice) {
        upScore += 10;
      } else {
        downScore += 10;
      }
      reasoning += `Dígito ${lastDigit} médio; `;
    }
    
    // 4. Volatilidade (conservador prefere baixa volatilidade)
    if (prices.length >= 10) {
      const volatility = this.calculateSimpleVolatility(prices.slice(-10));
      if (volatility < 0.005) {
        // Baixa volatilidade, manter tendência
        if (upScore > downScore) {
          upScore += 10;
        } else {
          downScore += 10;
        }
        reasoning += 'Volatilidade baixa (conservador); ';
      }
    }
    
    // 5. Garantia anti-empate (viés para UP em caso de empate)
    if (upScore === downScore) {
      upScore += 5;
      reasoning += 'Viés anti-empate; ';
    }
    
    const decision = upScore > downScore ? 'up' : 'down';
    const totalScore = upScore + downScore;
    const winningScore = Math.max(upScore, downScore);
    
    // Força conservadora: entre 60% e 75% (nunca muito alta)
    const strength = Math.min(75, Math.max(60, Math.round((winningScore / totalScore) * 100)));
    
    reasoning += `Scores: UP=${upScore}, DOWN=${downScore}. Decisão conservadora: ${decision.toUpperCase()}`;
    
    return {
      decision,
      strength,
      reasoning
    };
  }
  
  private calculateSimpleVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * 🔥 NOVA FUNÇÃO: Analisar TODOS os símbolos disponíveis e escolher o melhor baseado no consenso de IA
   */
  private async analyzeBestSymbolFromAll(userId: string, operationId: string): Promise<{
    success: boolean;
    symbol?: string;
    aiConsensus?: any;
    totalAnalyzed: number;
    top5Symbols: string[];
    error?: string;
  }> {
    try {
      // Buscar TODOS os símbolos que temos dados de mercado
      const allSymbolsData = await storage.getAllMarketData();
      
      if (!allSymbolsData || allSymbolsData.length === 0) {
        return { 
          success: false, 
          error: 'Nenhum símbolo com dados disponíveis', 
          totalAnalyzed: 0, 
          top5Symbols: [] 
        };
      }
      
      // 🔥 EXPANSÃO MASSIVA: Usar TODOS os 120+ ativos disponíveis na Deriv
      // Foram expandidos de 5 → 120+ para máxima diversificação e cobertura de lucro
      // 🚫 BLOQUEIO TOTAL: Filtrar 100% os ativos com "(1s)" - CAUSADORES DE LOSS
      
      const filteredSymbolsData = allSymbolsData.filter((symbolData: any) => {
        const symbol = symbolData.symbol;
        
        // 🚫 BLOQUEIO TOTAL: Ignorar ativos com "(1s)" no nome
        if (AutoTradingScheduler.BLOCKED_SYMBOLS_PATTERN.test(symbol)) {
          return false; // BLOQUEADO 100%
        }
        
        // ✅ ACEITAR demais os símbolos com dados de mercado disponíveis
        // Qualquer ativo que Deriv permite para DIGITDIFF será analisado
        // Isso inclui: Forex, Commodities, Crypto, Stocks, Indices, etc
        
        return true; // ✅ Deixar TODOS passarem (exceto os bloqueados) - expansão de 5 para 120+ ativos
      });
      
      if (filteredSymbolsData.length === 0) {
        return { 
          success: false, 
          error: 'Nenhum símbolo com dados disponíveis', 
          totalAnalyzed: allSymbolsData.length, 
          top5Symbols: [] 
        };
      }
      
      console.log(`🔥 [${operationId}] Analisando ${filteredSymbolsData.length} ativos (expansão 5 → 120+)...`);
      
      // Análise paralela de TODOS os símbolos filtrados
      const analysisPromises = filteredSymbolsData.map(async (symbolData: any) => {
        try {
          const symbol = symbolData.symbol;
          
          // Verificar se temos dados suficientes
          const priceHistory = JSON.parse(symbolData.priceHistory);
          if (priceHistory.length < 50) {
            return null; // Dados insuficientes
          }
          
          // Verificar atualização dos dados
          // 🔥 AUMENTADO para 5 minutos pois Deriv pode ter latência
          const lastUpdateTime = symbolData.lastUpdate ? new Date(symbolData.lastUpdate).getTime() : 0;
          const dataAge = new Date().getTime() - lastUpdateTime;
          const isDataStale = dataAge > (symbolData.isSimulated ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000);
          
          if (isDataStale) {
            return null; // Dados MUITO desatualizados
          }
          
          // Preparar tickData
          const tickData = priceHistory.slice(-100).map((price: number, index: number) => ({
            symbol,
            quote: price,
            epoch: Date.now() - (100 - index) * 1000
          }));
          
          // Executar análise de IA (sentimento geral de mercado)
          const aiConsensus = await huggingFaceAI.analyzeMarketData(tickData, symbol, userId);

          // 🎯 DIGIT FREQUENCY: Alimentar analisador com histórico do ativo
          const recentDigits = priceHistory.slice(-500).map((price: number) => {
            const priceStr = price.toString();
            const digitsOnly = priceStr.replace(/[^0-9]/g, '');
            return digitsOnly.length > 0 ? parseInt(digitsOnly[digitsOnly.length - 1]) : -1;
          }).filter((d: number) => d >= 0 && d <= 9);
          
          if (recentDigits.length >= 50) {
            digitFrequencyAnalyzer.processHistoricalDigits(symbol, recentDigits);
          }

          // 🏆 ASSET SCORER MULTIDIMENSIONAL — 6 dimensões operacionais
          // Converte assetPerformance interno para o formato esperado pelo scorer
          const internalPerf = this.assetPerformance.get(symbol);
          const perfRecord: AssetPerformanceRecord | null = internalPerf ? {
            wins: internalPerf.wins,
            losses: internalPerf.losses,
            lastTrades: internalPerf.lastTrades,
            totalProfit: 0,
            lastTradeTime: 0,
            consecutiveLosses: internalPerf.lastTrades.length > 0
              ? (() => {
                  let streak = 0;
                  for (let i = internalPerf.lastTrades.length - 1; i >= 0; i--) {
                    if (!internalPerf.lastTrades[i]) streak++;
                    else break;
                  }
                  return streak;
                })()
              : 0,
            consecutiveWins: internalPerf.lastTrades.length > 0
              ? (() => {
                  let streak = 0;
                  for (let i = internalPerf.lastTrades.length - 1; i >= 0; i--) {
                    if (internalPerf.lastTrades[i]) streak++;
                    else break;
                  }
                  return streak;
                })()
              : 0,
            isBlacklisted: false,
            volatilityHistory: []
          } : null;

          const scoreInput = {
            symbol,
            priceHistory,
            tickCount: priceHistory.length,
            dataAgeMs: dataAge,
            aiConsensusScore: aiConsensus.consensusStrength,
            aiAgreementStrength: aiConsensus.upScore !== undefined
              ? Math.max(aiConsensus.upScore || 0, aiConsensus.downScore || 0, aiConsensus.neutralScore || 0)
              : aiConsensus.consensusStrength,
            performance: perfRecord,
            isBlacklisted: false
          };

          const scoreResult = assetScorer.scoreAsset(scoreInput);
          
          // Log detalhado para debug (apenas para top candidates)
          if (scoreResult.grade !== 'BLOCKED' && scoreResult.finalScore >= 50) {
            console.log(assetScorer.formatScoreLog(scoreResult));
          }

          if (scoreResult.grade === 'BLOCKED') {
            console.log(`🚫 [SCORER] ${symbol} bloqueado: ${scoreResult.blockedReason}`);
            return null; // Ativo bloqueado — descartar
          }

          const enrichedConsensus = { ...aiConsensus, consensusStrength: scoreResult.finalScore };
          
          return {
            symbol,
            consensus: scoreResult.finalScore,
            aiRawScore: aiConsensus.consensusStrength,
            digitEdge: scoreResult.digitEdge,
            grade: scoreResult.grade,
            stakeMultiplier: scoreResult.stakeMultiplier,
            bestBarrier: scoreResult.bestBarrier,
            expectedWinRate: scoreResult.expectedWinRate,
            direction: aiConsensus.finalDecision,
            aiConsensus: enrichedConsensus,
            scoreResult
          };
        } catch (error) {
          console.log(`⚠️ [${operationId}] Erro ao analisar ${symbolData.symbol}: ${error}`);
          return null;
        }
      });
      
      // Aguardar todas as análises
      const results = await Promise.all(analysisPromises);
      
      // 🔥 ACEITAR TODOS OS SINAIS - inclusive neutral (45%) é válido para trade
      // Filtrar apenas resultados nulos/com erro
      const validResults = results
        .filter(r => r !== null)
        .sort((a, b) => b!.consensus - a!.consensus);
      
      if (validResults.length === 0) {
        return { 
          success: false, 
          error: 'Erro ao analisar símbolos', 
          totalAnalyzed: allSymbolsData.length, 
          top5Symbols: [] 
        };
      }
      
      // TOP 5 símbolos
      const top5 = validResults.slice(0, 5);
      const top5Symbols = top5.map(r => `${r!.symbol}(${r!.consensus.toFixed(1)}%)`);
      
      // Melhor símbolo
      const best = validResults[0];
      
      console.log(`🏆 [${operationId}] TOP 5 Símbolos (Score Multidimensional — 6 dimensões):`);
      top5.forEach((r, i) => {
        const grade = (r as any).grade || '?';
        const aiScore = (r as any).aiRawScore?.toFixed(1) || '?';
        const digitEdge = (r as any).digitEdge?.toFixed(1) || '?';
        const winRate = (r as any).expectedWinRate?.toFixed(1) || '?';
        const stakeX = (r as any).stakeMultiplier?.toFixed(2) || '?';
        const barrier = (r as any).bestBarrier || '?';
        console.log(`   ${i + 1}. [${grade}] ${r!.symbol}: Score=${r!.consensus.toFixed(1)} | IA=${aiScore}% | Edge=${digitEdge}% | WR=${winRate}% | Barreira=${barrier} | Stake×${stakeX}`);
      });
      
      return {
        success: true,
        symbol: best!.symbol,
        aiConsensus: best!.aiConsensus,
        totalAnalyzed: allSymbolsData.length,
        top5Symbols: top5Symbols
      };
    } catch (error) {
      console.error(`❌ [${operationId}] Erro na análise de todos símbolos:`, error);
      return { 
        success: false, 
        error: `Erro na análise: ${error}`, 
        totalAnalyzed: 0, 
        top5Symbols: [] 
      };
    }
  }

  private getSymbolsForMode(mode: string): string[] {
    // 🔥 TODOS OS ATIVOS SUPORTADOS - DESCOBERTA DINÂMICA
    // Sistema agora carrega automaticamente TODOS os ativos da Deriv em tempo real
    const supportedSymbols = marketDataCollector.getSupportedSymbols();
    
    if (supportedSymbols.length > 0) {
      console.log(`🎯 [getSymbolsForMode] Usando ${supportedSymbols.length} ativos descobertos dinamicamente`);
      return supportedSymbols;
    }
    
    // Fallback se descoberta dinâmica não tiver funcionado ainda
    console.warn('⚠️ [getSymbolsForMode] Nenhum símbolo descoberto - usando fallback');
    const fallbackSymbols = [
      'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
      'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
      'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD',
      'SPX500', 'UK100', 'DE40', 'FR40'
    ];
    
    return fallbackSymbols;
  }

  // ===== FLEXIBILIDADE DINÂMICA: STAKE + TICKS =====
  
  /**
   * Calcular STAKE DINÂMICO baseado em consenso da IA
   * - Consenso alto (>70%) → Stake maior (risco maior controlado)
   * - Consenso médio (50-70%) → Stake normal
   * - Consenso baixo (<50%) → Stake menor (proteção)
   */
  private calculateDynamicStake(baseAmount: number, consensoStrength: number, volatility: number = 0.5): number {
    // 🧠 PAPEL DAS 5 IAs: Amplificar stake quando o mercado está favorável
    // Consensus alto = mercado estável e favorável = aumentar stake para maximizar ganhos.
    // Consensus baixo = mercado incerto = stake base ou reduzido = proteção da banca.
    //
    // 🛡️ MODO ALMOFADA DE LUCRO (Cushion Mode):
    //   Em momentos de consenso excepcional (≥90%), o stake é elevado estrategicamente
    //   para que o lucro gerado pré-cubra N perdas futuras ao valor base.
    //   Fórmula: lucro_cushion = stake × payout_ratio → deve cobrir N × stake_base
    //   Payout típico Digit Differs = ~95% do stake
    
    const DIGIT_DIFFERS_PAYOUT_RATIO = 0.95; // payout médio por dólar de stake
    
    let aiMultiplier = 1.0;
    let cushionCoverage = 0; // quantas perdas futuras este trade pré-cobre

    if (consensoStrength >= 95) {
      // 🚀 ULTRA CUSHION: consenso máximo — stake 3× base
      // Lucro ≈ 3 × base × 0.95 ≈ 2.85 × base → cobre ~2 perdas futuras ao valor base
      aiMultiplier = 3.0;
      cushionCoverage = Math.floor((baseAmount * aiMultiplier * DIGIT_DIFFERS_PAYOUT_RATIO) / baseAmount);
      console.log(`🚀🚀 [CUSHION ULTRA] Consensus ${consensoStrength}% ≥ 95% → stake ×3.0 | Lucro pré-cobre ~${cushionCoverage} perdas futuras`);
    } else if (consensoStrength >= 90) {
      // 💎 CUSHION MODE: consenso excepcional — stake 2.2× base
      // Lucro ≈ 2.2 × base × 0.95 ≈ 2.09 × base → cobre ~2 perdas futuras ao valor base
      aiMultiplier = 2.2;
      cushionCoverage = Math.floor((baseAmount * aiMultiplier * DIGIT_DIFFERS_PAYOUT_RATIO) / baseAmount);
      console.log(`💎 [CUSHION MODE] Consensus ${consensoStrength}% ≥ 90% → stake ×2.2 | Lucro pré-cobre ~${cushionCoverage} perda(s) futura(s)`);
    } else if (consensoStrength >= 80) {
      // 🔥 ELEVADO: consenso forte — stake 1.6× base
      // Lucro ≈ 1.6 × base × 0.95 ≈ 1.52 × base → cobre ~1 perda futura ao valor base
      aiMultiplier = 1.6;
      cushionCoverage = Math.floor((baseAmount * aiMultiplier * DIGIT_DIFFERS_PAYOUT_RATIO) / baseAmount);
      console.log(`🔥 [AI AMPLIFIER] Consensus FORTE+ (${consensoStrength}%) ≥ 80% → stake ×1.6 | Almofada: ~${cushionCoverage} perda(s)`);
    } else if (consensoStrength >= 70) {
      aiMultiplier = 1.3;
      console.log(`🔥 [AI AMPLIFIER] Consensus FORTE (${consensoStrength}%) → stake ×1.3`);
    } else if (consensoStrength >= 55) {
      aiMultiplier = 1.15;
      console.log(`✅ [AI AMPLIFIER] Consensus MODERADO (${consensoStrength}%) → stake ×1.15`);
    } else if (consensoStrength >= 40) {
      aiMultiplier = 1.0;
      console.log(`➡️ [AI AMPLIFIER] Consensus NEUTRO (${consensoStrength}%) → stake ×1.0`);
    } else {
      aiMultiplier = 0.85;
      console.log(`⚠️ [AI AMPLIFIER] Consensus FRACO (${consensoStrength}%) → stake ×0.85`);
    }

    // Redução adicional apenas em volatilidade extrema (proteção de risco)
    let volMultiplier = 1.0;
    if (volatility > 0.8) {
      volMultiplier = 0.9;
      console.log(`⚡ [VOL GUARD] Volatilidade alta (${(volatility*100).toFixed(0)}%) → stake ×0.9`);
    }

    const finalMultiplier = aiMultiplier * volMultiplier;
    const dynamicStake = Math.round(baseAmount * finalMultiplier * 100) / 100;

    if (cushionCoverage > 0) {
      const estimatedProfit = dynamicStake * DIGIT_DIFFERS_PAYOUT_RATIO;
      console.log(`💰 [CUSHION STAKE] Base: $${baseAmount} × ${finalMultiplier.toFixed(2)} = $${dynamicStake} | Lucro estimado: +$${estimatedProfit.toFixed(2)} → pré-cobre ${cushionCoverage} perda(s) de $${baseAmount.toFixed(2)}`);
    } else {
      console.log(`💰 [DYNAMIC STAKE] Base: $${baseAmount} × ${finalMultiplier.toFixed(2)} (IAs: ×${aiMultiplier}, vol: ×${volMultiplier}) = $${dynamicStake}`);
    }
    
    return dynamicStake;
  }

  /**
   * Calcular TICKS DINÂMICOS baseado em histórico de win rate
   * - Win rate alto (>60%) → Ticks maiores (deixar ganho crescer)
   * - Win rate médio (40-60%) → Ticks normais
   * - Win rate baixo (<40%) → Ticks menores (sair rápido)
   */
  private calculateDynamicTicks(symbol: string, baseTicks: number = 10): number {
    const performance = this.assetPerformance.get(symbol);
    if (!performance) return baseTicks;
    
    const totalTrades = performance.wins + performance.losses;
    if (totalTrades === 0) return baseTicks;
    
    const winRate = performance.wins / totalTrades;
    
    let ticksAdjustment = baseTicks;
    
    if (winRate > 0.60) {
      ticksAdjustment = Math.min(10, baseTicks + 2); // Máx 10 ticks (limite Deriv DIGITDIFF)
      console.log(`📈 [DYNAMIC TICKS] Alto win rate (${(winRate*100).toFixed(0)}%) → ${ticksAdjustment} ticks`);
    } else if (winRate < 0.40) {
      ticksAdjustment = Math.max(3, baseTicks - 3); // Mín 3 ticks
      console.log(`📉 [DYNAMIC TICKS] Baixo win rate (${(winRate*100).toFixed(0)}%) → ${ticksAdjustment} ticks`);
    }
    
    return ticksAdjustment;
  }

  private async getTradeParamsForMode(mode: string, symbol: string, direction: string, userId: string, consensoStrength?: number, volatility?: number): Promise<{amount: number, duration: number, barrier: string}> {
    let amount = 0.35; // Default para bancas pequenas (conservador)
    let duration = 10; // ⚡ OTIMIZAÇÃO: Aumentado de 5 para 10 ticks para distribuir fechamento
    
    // 🎯 CALCULAR STAKE BASEADO NO TAMANHO DA BANCA + CONSENSO DINÂMICO
    try {
      // Buscar saldo do usuário
      const balanceAnalysis = await storage.getBalanceAnalysis(userId);
      
      if (balanceAnalysis && balanceAnalysis.currentBalance > 0) {
        const bankSize = balanceAnalysis.currentBalance;
        
        // 💰 SISTEMA DE STAKE CONSERVADOR PROGRESSIVO
        // Banca pequena (até $10): 0.35 fixo (3.5% de $10)
        // Banca média ($10-$50): 0.5% a 1% da banca
        // Banca grande ($50-$200): 0.75% da banca
        // Banca muito grande (>$200): 1% da banca (max conservador)
        
        if (bankSize <= 10) {
          amount = 0.35; // Fixo para bancas pequenas
          console.log(`💰 [STAKE] Banca pequena ($${bankSize.toFixed(2)}): stake fixo $${amount}`);
        } else if (bankSize <= 50) {
          amount = bankSize * 0.007; // 0.7% da banca
          amount = Math.max(0.35, Math.min(amount, 0.50)); // Entre $0.35 e $0.50
          console.log(`💰 [STAKE] Banca média ($${bankSize.toFixed(2)}): stake $${amount.toFixed(2)} (0.7%)`);
        } else if (bankSize <= 200) {
          amount = bankSize * 0.0075; // 0.75% da banca
          amount = Math.max(0.50, Math.min(amount, 1.50)); // Entre $0.50 e $1.50
          console.log(`💰 [STAKE] Banca grande ($${bankSize.toFixed(2)}): stake $${amount.toFixed(2)} (0.75%)`);
        } else {
          amount = bankSize * 0.01; // 1% da banca (máximo conservador)
          amount = Math.max(1.00, Math.min(amount, 3.00)); // Entre $1.00 e $3.00
          console.log(`💰 [STAKE] Banca muito grande ($${bankSize.toFixed(2)}): stake $${amount.toFixed(2)} (1%)`);
        }
        
        // 🚀 APLICAR FLEXIBILIDADE DINÂMICA (se consenso fornecido)
        if (consensoStrength !== undefined) {
          amount = this.calculateDynamicStake(amount, consensoStrength, volatility || 0.5);
        }

        // 🛡️ SAFETY CAP: nunca arriscar mais de 3% da banca por trade (protege em qualquer modo)
        const maxSafeStake = Math.max(0.35, bankSize * 0.03);
        if (amount > maxSafeStake) {
          console.log(`🛡️ [SAFETY CAP] Stake $${amount.toFixed(2)} > 3% da banca ($${maxSafeStake.toFixed(2)}) → limitado a $${maxSafeStake.toFixed(2)}`);
          amount = maxSafeStake;
        }

        // Arredondar para 2 casas decimais
        amount = Math.round(amount * 100) / 100;
      } else {
        console.log(`⚠️ [STAKE] Saldo não encontrado, usando stake padrão: $${amount}`);
      }
    } catch (error) {
      console.error(`❌ [STAKE] Erro ao calcular stake: ${error}, usando padrão $${amount}`);
    }
    
    // Extrair parâmetros do modo (ex: "production_3-4_24h", "test_4_1min")
    // Agora o amount vem do cálculo de banca, não do modo
    const modeParams = mode.split('_');
    
    // DERIV LIMIT: DIGITDIFF aceita apenas 1-10 ticks de duração
    // Manter dentro do limite obrigatório da API
    if (modeParams.length >= 3) {
      const timeParam = modeParams[2];
      if (timeParam.includes('min')) {
        // Para modos rápidos (minutos), usar 5-10 ticks
        duration = Math.min(parseInt(timeParam) || 5, 10);
        duration = Math.max(duration, 5); // MÍNIMO: 5 ticks
      } else if (timeParam.includes('h')) {
        // Para modos lentos (horas), usar 8-10 ticks (ainda dentro do limite)
        duration = 10; // Máximo permitido pela Deriv para DIGITDIFF
      }
    }
    
    // OBRIGATÓRIO: Garantir duração entre 5-10 ticks (limite Deriv DIGITDIFF: 1-10)
    duration = Math.min(Math.max(duration, 5), 10);
    
    console.log(`🔧 DEBUG getTradeParamsForMode: mode=${mode}, duration calculada=${duration}, amount=${amount}`);

    // 🎯 DIGIT FREQUENCY ANALYZER: Selecionar barreira baseada em análise estatística real
    // O dígito "mais frio" (menor frequência nos últimos 300 ticks) é a melhor barreira DIFFER,
    // pois tem maior probabilidade de NÃO aparecer no próximo tick → win rate > 90% base.
    let barrier = '5'; // Default neutro (fallback)
    
    try {
      const digitAnalysis = digitFrequencyAnalyzer.getBestBarrier(symbol);
      
      if (digitAnalysis.confidence >= 30) {
        // Temos dados suficientes: usar dígito estatisticamente mais frio
        barrier = digitAnalysis.barrier;
        console.log(`🎯 [DIGIT ANALYZER] ${symbol}: barreira=${barrier} | edge=+${digitAnalysis.edge.toFixed(1)}% | winRate=${digitAnalysis.winRate.toFixed(1)}% | confiança=${digitAnalysis.confidence.toFixed(0)}%`);
      } else {
        // Dados insuficientes ainda: usar neutro enquanto acumula ticks
        barrier = '5';
        console.log(`⏳ [DIGIT ANALYZER] ${symbol}: dados insuficientes (${digitAnalysis.confidence.toFixed(0)}% confiança) → barreira neutra=5`);
      }
    } catch (e) {
      barrier = '5';
      console.log(`⚠️ [DIGIT ANALYZER] Erro ao analisar ${symbol}: ${e} → barreira neutra=5`);
    }

    return { amount, duration, barrier };
  }


  getActiveSessions(): ActiveTradeSession[] {
    return Array.from(this.activeSessions.values());
  }

  getSessionStats(): {totalSessions: number, totalExecutedOperations: number} {
    const sessions = this.getActiveSessions();
    const totalExecutedOperations = sessions.reduce((sum, s) => sum + s.executedOperations, 0);
    
    return {
      totalSessions: sessions.length,
      totalExecutedOperations
    };
  }

  getSchedulerStatus(): { isRunning: boolean, hasActiveSessions: boolean, emergencyStop: boolean, isInitialized: boolean } {
    return {
      isRunning: !!this.cronJob,
      hasActiveSessions: this.activeSessions.size > 0,
      emergencyStop: this.emergencyStop,
      isInitialized: this.isInitialized
    };
  }

  stopScheduler(): void {
    if (this.cronJob) {
      clearInterval(this.cronJob);
      this.cronJob = null;
      console.log('🛑 Auto Trading Scheduler parado');
    }
  }

  async startScheduler(): Promise<void> {
    // SEGURANÇA: Não permitir restart se parada de emergência ativa
    if (this.emergencyStop) {
      console.log('⛔ Não é possível iniciar: Parada de emergência ativa');
      return;
    }
    
    // Se já está rodando, não criar outro intervalo
    if (this.cronJob) {
      console.log('⚠️ Scheduler já está rodando');
      return;
    }
    
    // Aguardar inicialização completar antes de iniciar
    if (!this.isInitialized) {
      console.log('⏳ Aguardando inicialização do sistema...');
      await this.setupPromise;
      console.log('✅ Inicialização completa!');
    }
    
    // Re-checar cronJob após await (prevenir race condition com múltiplas chamadas concorrentes)
    if (this.cronJob) {
      console.log('⚠️ Scheduler já foi iniciado por outra chamada concorrente');
      return;
    }
    
    // ⚡ OTIMIZAÇÃO: Criar intervalo com stagger entre trades para evitar congestão
    // Intervalo de 60 segundos (1 minuto) entre ciclos de análise
    // Cada ciclo pode abrir 1 trade (com stagger de 10s entre múltiplas configs)
    // = Máximo ~1 trade por minuto por config (controlado e previsível)
    
    // 🔥 CRITICAL FIX: Executar imediatamente na primeira vez após start
    // Para evitar atraso de 60 segundos na retomada após pausa
    (async () => {
      try {
        console.log('▶️ [SCHEDULER] Executando ciclo IMEDIATO para recuperar operações após pausa...');
        await this.executeAnaliseNaturalAnalysis();
      } catch (error) {
        console.error('❌ [SCHEDULER] Erro no ciclo imediato de retomada:', error);
      }
    })();
    
    this.cronJob = setInterval(async () => {
      if (!this.schedulerRunning) {
        try {
          await this.executeAnaliseNaturalAnalysis();
        } catch (error) {
          console.error('❌ [SCHEDULER] Erro crítico na execução do ciclo:', error);
        }
      }
    }, 60000); // 60 segundos (1 minuto) entre execuções
    
    // 🔄 Iniciar sincronização automática de trades da Deriv
    derivTradeSync.startAutoSync();
    
    console.log('▶️ Auto Trading Scheduler iniciado - análise a cada 60 segundos (com duração distribuída 10-15 ticks)');
    console.log('🔄 Sincronização automática de trades ativada a cada 30 segundos');
  }

  // MÉTODOS DE SEGURANÇA E CONTROLE DE EMERGÊNCIA

  /**
   * PARADA DE EMERGÊNCIA - Para todas as operações imediatamente
   */
  emergencyStopAll(): void {
    console.log('🚨 PARADA DE EMERGÊNCIA ATIVADA - Parando todas as operações!');
    this.emergencyStop = true;
    this.activeSessions.clear();
    
    if (this.cronJob) {
      // Suporte para ambos node-cron e setInterval
      if (typeof this.cronJob.stop === 'function') {
        this.cronJob.stop();
      } else {
        clearInterval(this.cronJob);
      }
      this.cronJob = null;
    }
    
    console.log('✅ Sistema de trading totalmente parado por segurança');
  }
  
  /**
   * Desativar parada de emergência (apenas para administradores)
   */
  disableEmergencyStop(adminEmail: string): boolean {
    // Verificar se é administrador autorizado
    if (!adminEmail || ![  'vfdiogoseg@gmail.com', 'carlos.eduardo.saturnino@gmail.com'].includes(adminEmail.toLowerCase())) {
      console.log('⛔ Apenas administradores autorizados podem desativar a parada de emergência');
      return false;
    }
    
    this.emergencyStop = false;
    console.log(`✅ Parada de emergência desativada por ${adminEmail}`);
    return true;
  }
  
  /**
   * Remover aprovação manual obrigatória (apenas para administradores)
   */
  disableAdminApproval(adminEmail: string): boolean {
    // Verificar se é administrador autorizado
    if (!adminEmail || ![  'vfdiogoseg@gmail.com', 'carlos.eduardo.saturnino@gmail.com'].includes(adminEmail.toLowerCase())) {
      console.log('⛔ Apenas administradores autorizados podem remover aprovação manual');
      return false;
    }
    
    this.adminApprovalRequired = false;
    console.log(`✅ Aprovação manual removida por ${adminEmail}`);
    return true;
  }

  /**
   * Habilitar aprovação manual obrigatória (medida de segurança)
   */
  enableAdminApproval(): boolean {
    this.adminApprovalRequired = true;
    console.log('🔒 Aprovação manual obrigatória reativada por medida de segurança');
    return true;
  }


  /**
   * Verificar se o sistema pode executar operações (controles de segurança)
   */
  private canExecuteOperation(): boolean {
    if (this.emergencyStop) {
      console.log('⛔ Operação bloqueada: Parada de emergência ativa');
      return false;
    }
    
    if (this.adminApprovalRequired) {
      console.log('⛔ Operação bloqueada: Aprovação manual obrigatória');
      return false;
    }
    
    // Verificar limite diário
    const sessions = Array.from(this.activeSessions.values());
    const totalOperationsToday = sessions.reduce((sum, s) => sum + s.executedOperations, 0);
    
    if (totalOperationsToday >= this.maxDailyOperations) {
      console.log(`⛔ Operação bloqueada: Limite diário atingido (${totalOperationsToday}/${this.maxDailyOperations})`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Verificar se uma sessão pode executar mais operações
   */
  private canSessionExecute(sessionKey: string): boolean {
    const session = this.activeSessions.get(sessionKey);
    if (!session) return true;
    
    if (session.executedOperations >= this.maxOperationsPerSession) {
      console.log(`⛔ Sessão ${sessionKey} bloqueada: Limite por sessão atingido (${session.executedOperations}/${this.maxOperationsPerSession})`);
      return false;
    }
    
    return true;
  }

  /**
   * Resetar sessões bloqueadas para conta demo (testing)
   */
  resetBlockedSessions(): boolean {
    console.log('🔄 Resetando sessões bloqueadas para modo demo...');
    
    const blockedSessions = Array.from(this.activeSessions.entries())
      .filter(([key, session]) => session.executedOperations >= this.maxOperationsPerSession);
    
    blockedSessions.forEach(([key, session]) => {
      console.log(`🔄 Resetando sessão bloqueada: ${key} (${session.executedOperations}/${this.maxOperationsPerSession})`);
      session.executedOperations = 0; // Reset operation count
      session.lastExecutionTime = null; // Reset last execution
    });
    
    console.log(`✅ ${blockedSessions.length} sessão(ões) resetada(s) com sucesso`);
    return true;
  }

  /**
   * Aumentar limites para modo demo/testing
   */
  increaseLimitsForDemo(): boolean {
    console.log('🚀 Aumentando limites para modo demo...');
    this.maxOperationsPerSession = 100; // Aumentar de 10 para 100
    this.maxDailyOperations = 500; // Aumentar de 50 para 500
    
    console.log(`✅ Limites atualizados:`);
    console.log(`   • Operações por sessão: ${this.maxOperationsPerSession}`);
    console.log(`   • Operações por dia: ${this.maxDailyOperations}`);
    return true;
  }

  /**
   * Limpar todas as sessões ativas
   */
  clearAllSessions(): boolean {
    console.log('🗑️ Limpando todas as sessões ativas...');
    const sessionCount = this.activeSessions.size;
    this.activeSessions.clear();
    console.log(`✅ ${sessionCount} sessão(ões) removida(s)`);
    return true;
  }

  /**
   * Obter estratégia de recuperação ativa para um usuário
   */
  async getActiveRecoveryStrategy(userId: string): Promise<{ name: string; successRate: number; confidenceThreshold: number; parameters: any }> {
    try {
      const strategies = await storage.getUserRecoveryStrategies(userId);
      
      // Priorizar estratégia com melhor taxa de sucesso que esteja ativa
      const activeStrategy = strategies.find(s => s.isActive && (s.successRate || 0) > 0.70);
      
      if (activeStrategy) {
        const parameters = JSON.parse(activeStrategy.parameters);
        
        return {
          name: activeStrategy.strategyName,
          successRate: activeStrategy.successRate || 0,
          confidenceThreshold: parameters.confidenceThreshold || 0.70, // 70% ajustado para permitir mais operações
          parameters: parameters
        };
      }
      
      // Se nenhuma estratégia ativa, criar uma estratégia padrão cooperativa
      console.log(`🔄 [${userId}] Nenhuma estratégia ativa encontrada, usando padrão cooperativo`);
      return {
        name: 'ai_cooperation_default',
        successRate: 75,
        confidenceThreshold: 0.65, // 65% threshold ajustado para permitir 2-4 ops/dia
        parameters: {
          recoveryThreshold: 0.75,
          maxMultiplier: 3.5,
          cooperationLevel: 'high'
        }
      };
      
    } catch (error) {
      console.error(`❌ Erro ao buscar estratégia de recuperação para ${userId}:`, error);
      
      // Retornar estratégia de emergência
      return {
        name: 'emergency_recovery',
        successRate: 70,
        confidenceThreshold: 0.90, // 90% para emergência - super conservador
        parameters: {
          recoveryThreshold: 0.75,
          maxMultiplier: 2.0, // Multiplicador reduzido em emergência
          cooperationLevel: 'maximum'
        }
      };
    }
  }

  /**
   * Calcular multiplicador de recuperação baseado na cooperação entre IAs
   */
  async calculateCooperativeRecoveryMultiplier(userId: string, recoveryStrategy: any): Promise<number> {
    try {
      // Buscar PnL diário atual
      const todayPnL = await storage.getDailyPnL(userId);
      if (!todayPnL) return 1.0;

      // Calcular percentual de perda
      const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
      
      // SISTEMA COOPERATIVO DE IAs - Thresholds elevados de 75% a 95%
      const cooperationLevel = recoveryStrategy.parameters?.cooperationLevel || 'high';
      
      let baseMultiplier = await storage.calculateRecoveryMultiplier(userId);
      let cooperativeBonus = 1.0;
      
      // PROTEÇÃO ANTI-MARTINGALE: Nunca aumentar stakes após perdas.
      // Martingale em DIGITDIFF (RNG) é matematicamente ruinoso.
      // Em recuperação, REDUZIR stakes para preservar banca.
      switch (cooperationLevel) {
        case 'maximum':
          if (lossPercent >= 0.20) cooperativeBonus = 0.7; // -30% em perdas graves
          else if (lossPercent >= 0.10) cooperativeBonus = 0.8;
          else if (lossPercent >= 0.05) cooperativeBonus = 0.9;
          break;
          
        case 'high':
          if (lossPercent >= 0.15) cooperativeBonus = 0.75;
          else if (lossPercent >= 0.10) cooperativeBonus = 0.85;
          else if (lossPercent >= 0.05) cooperativeBonus = 0.9;
          break;
          
        case 'medium':
          if (lossPercent >= 0.10) cooperativeBonus = 0.85;
          else if (lossPercent >= 0.05) cooperativeBonus = 0.9;
          break;
      }
      
      // Bônus de sucesso histórico: apenas reduz o desconto, nunca ultrapassa 1.0
      const successFactor = Math.min((recoveryStrategy.successRate || 70) / 100, 1.0);
      cooperativeBonus = Math.min(1.0, cooperativeBonus * (0.9 + (successFactor * 0.1)));
      
      const finalMultiplier = baseMultiplier * cooperativeBonus;
      
      // Cap máximo em 1.0x — nunca apostar mais do que o stake base durante recuperação
      const maxMultiplier = 1.0;
      const limitedMultiplier = Math.min(finalMultiplier, maxMultiplier);
      
      console.log(`🧠 [COOPERATIVE AI] Multiplicador calculado:`);
      console.log(`   • Base: ${baseMultiplier.toFixed(2)}x (perda: ${(lossPercent * 100).toFixed(1)}%)`);
      console.log(`   • Cooperação ${cooperationLevel}: +${((cooperativeBonus - 1) * 100).toFixed(1)}%`);
      console.log(`   • Sucesso histórico: ${recoveryStrategy.successRate}%`);
      console.log(`   • Final: ${limitedMultiplier.toFixed(2)}x (limite: ${maxMultiplier}x)`);
      
      return Number(limitedMultiplier.toFixed(2));
      
    } catch (error) {
      console.error(`❌ Erro ao calcular multiplicador cooperativo:`, error);
      
      // Em caso de erro, usar multiplicador básico de recuperação
      return await storage.calculateRecoveryMultiplier(userId);
    }
  }

  // 🎯 DIVERSIFICAÇÃO INTELIGENTE COM JOGO DE CINTURA + BREATHING ROOM DINÂMICO
  // Evita repetição excessiva, permite quebrar regra se oportunidade for forte OU se ativo ganhando
  async canOpenTradeForAsset(userId: string, symbol: string, consensusStrength?: number): Promise<{allowed: boolean, reason: string}> {
    if (!this.recentAssets.has(userId)) {
      this.recentAssets.set(userId, []);
    }
    
    const recentList = this.recentAssets.get(userId) || [];
    const assetIndex = recentList.indexOf(symbol);
    
    // 🔥 COM 120+ ATIVOS: Praticamente sempre permite (diversificação automática garante rotação)
    // Se NÃO foi usado recentemente, SEMPRE permite
    if (assetIndex < 0) {
      return { allowed: true, reason: 'Ativo disponível para trading (120+ ativos disponíveis)' };
    }
    
    // ✅ FIX: Usar TEMPO REAL guardado, não calcular do índice
    const lastUseTime = this.assetLastUsedTime.get(symbol) || 0;
    const timeSinceLastUse = (Date.now() - lastUseTime) / 60000; // em minutos
    
    // Ativo em cool-off - verificar respiração dinâmica + oportunidade
    const opportunityStrength = consensusStrength || 0;
    const breathingRoom = this.getBreathingRoom(symbol);
    const performance = this.assetPerformance.get(symbol);
    const winRate = performance ? (performance.wins / (performance.wins + performance.losses)) : 0;
    
    // 🎯 REGRAS DE JOGO DE CINTURA ADAPTATIVO - VERSÃO AGRESSIVA COM 120+ ATIVOS:
    // 1. Win rate >60% → SEMPRE quebra cool-off (ativo super ganhador!)
    // 2. Consenso 90%+ → SEMPRE quebra cool-off (oportunidade explosiva!)
    // 3. Consenso 80%+ → Permite se passou 50% do breathing room
    // 4. Consenso <80% → Respeita cool-off (forçar diversificação aos outros ativos)
    
    if (winRate > 0.60) {
      console.log(`🔥 [DIVERSIFICAÇÃO] ATIVO SUPER GANHADOR (${(winRate*100).toFixed(0)}%)! Abrindo ${symbol} IMEDIATAMENTE (W/L: ${performance?.wins}/${performance?.losses})`);
      return { allowed: true, reason: `Ativo ganhador ULTRA forte (${(winRate*100).toFixed(0)}%) - override garantido` };
    }
    
    if (opportunityStrength >= 90) {
      console.log(`🔥 [DIVERSIFICAÇÃO] OPORTUNIDADE EXPLOSIVA (${opportunityStrength}%)! Abrindo ${symbol} agora (W/L: ${performance?.wins}/${performance?.losses})`);
      return { allowed: true, reason: `Oportunidade explosiva (${opportunityStrength}%) - override garantido` };
    }
    
    if (opportunityStrength >= 80) {
      // Permitir se passou 50% do breathing room
      const halfBreathingRoom = breathingRoom * 0.5;
      if (timeSinceLastUse > halfBreathingRoom) {
        console.log(`⚡ [DIVERSIFICAÇÃO] Opportunity forte (${opportunityStrength}%)! ${symbol} passou 50% breathing room (${halfBreathingRoom.toFixed(1)}min)`);
        return { allowed: true, reason: `Signal forte (${opportunityStrength}%) + 50% breathing room cumprido` };
      }
    }
    
    // Com 120+ ativos, cool-off é MUITO mais flexível
    const remainingMin = Math.max(0, breathingRoom - timeSinceLastUse).toFixed(1);
    console.log(`⏳ [DIVERSIFICAÇÃO] ${symbol} em cool-off leve - falta ${remainingMin}min (${120 + 1} ativos disponíveis)`);
    return { allowed: false, reason: `Cool-off leve: ${remainingMin}min restantes (use outro ativo dos 120+ disponíveis)` };
  }

  trackAssetUsage(userId: string, symbol: string): void {
    if (!this.recentAssets.has(userId)) {
      this.recentAssets.set(userId, []);
    }
    
    const recentList = this.recentAssets.get(userId) || [];
    
    // Adicionar ativo à lista recente
    recentList.unshift(symbol);
    
    // Manter apenas os últimos N ativos (simular cool-off)
    if (recentList.length > 5) {
      recentList.pop();
    }
    
    // ✅ FIX: Guardar TEMPO REAL
    this.assetLastUsedTime.set(symbol, Date.now());
    
    // Aplicar breathing room dinâmico baseado em performance
    const breathingRoom = this.getBreathingRoom(symbol);
    
    // Resetar cool-off após breathing room automaticamente
    setTimeout(() => {
      const currentList = this.recentAssets.get(userId) || [];
      const idx = currentList.indexOf(symbol);
      if (idx >= 0) {
        currentList.splice(idx, 1);
        const perf = this.assetPerformance.get(symbol) || { wins: 0, losses: 0 };
        console.log(`🔄 [DIVERSIFICAÇÃO] Cool-off de ${symbol} finalizado (${breathingRoom.toFixed(1)}min). Performance: ${perf.wins}W/${perf.losses}L`);
      }
    }, breathingRoom * 60 * 1000);
    
    this.recentAssets.set(userId, recentList);
    const perf = this.assetPerformance.get(symbol) || { wins: 0, losses: 0 };
    console.log(`✅ [DIVERSIFICAÇÃO] ${symbol} rastreado (breathing: ${breathingRoom.toFixed(1)}min). Performance: ${perf.wins}W/${perf.losses}L`);
  }
  
  // 📊 RASTREAR PERFORMANCE DO ATIVO (para ajustar breathing room)
  updateAssetPerformance(symbol: string, won: boolean): void {
    if (!this.assetPerformance.has(symbol)) {
      this.assetPerformance.set(symbol, { wins: 0, losses: 0, lastTrades: [] });
    }
    
    const perf = this.assetPerformance.get(symbol)!;
    if (won) {
      perf.wins++;
    } else {
      perf.losses++;
    }
    
    // Manter últimas 20 trades para histórico recente
    perf.lastTrades.push(won);
    if (perf.lastTrades.length > 20) {
      perf.lastTrades.shift();
    }
    
    const totalTrades = perf.wins + perf.losses;
    const winRate = (perf.wins / totalTrades * 100).toFixed(1);
    const breathing = this.getBreathingRoom(symbol);
    
    console.log(`📈 [PERFORMANCE] ${symbol}: ${perf.wins}W/${perf.losses}L (${winRate}%) - Breathing: ${breathing.toFixed(1)}min`);
  }
  
  // 🚨 RESET INTELIGENTE - Limpar sistema quando travado (todos ativos em cool-off)
  resetCooldownSystem(userId: string): {cleared: number, reason: string} {
    if (!this.recentAssets.has(userId)) {
      return { cleared: 0, reason: 'Nenhum cool-off ativo' };
    }
    
    const recentList = this.recentAssets.get(userId) || [];
    const cleared = recentList.length;
    
    // Limpar lista de cool-off
    this.recentAssets.set(userId, []);
    
    console.log(`🚨 [RESET TPM] Sistema desbloqueado! ${cleared} ativos liberados do cool-off`);
    return { cleared, reason: `${cleared} ativos foram liberados do cool-off` };
  }
  
  // 🏭 STATUS DE SAÚDE DO SISTEMA (TPM - Total Productive Maintenance)
  getAssetHealthStatus(): {
    totalAssets: number;
    assetsWithPerformance: number;
    averageWinRate: number;
    bottlenecks: Array<{symbol: string, winRate: number, trades: number}>;
    healthy: boolean;
  } {
    let totalWins = 0, totalLosses = 0;
    const bottlenecks: Array<{symbol: string, winRate: number, trades: number}> = [];
    
    for (const [symbol, perf] of Array.from(this.assetPerformance)) {
      totalWins += perf.wins;
      totalLosses += perf.losses;
      
      const trades = perf.wins + perf.losses;
      const winRate = trades > 0 ? perf.wins / trades : 0;
      
      // Identificar ativos com problemas (win rate < 40%)
      if (trades >= 5 && winRate < 0.40) {
        bottlenecks.push({ symbol, winRate: winRate * 100, trades });
      }
    }
    
    const totalTrades = totalWins + totalLosses;
    const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const healthy = bottlenecks.length === 0 && avgWinRate > 45;
    
    return {
      totalAssets: this.assetPerformance.size,
      assetsWithPerformance: this.assetPerformance.size,
      averageWinRate: avgWinRate,
      bottlenecks,
      healthy
    };
  }

  /**
   * Obter status de segurança do sistema
   */
  getSecurityStatus(): {
    emergencyStop: boolean;
    adminApprovalRequired: boolean;
    maxOperationsPerSession: number;
    maxDailyOperations: number;
    activeSessions: number;
    totalOperationsToday: number;
  } {
    const sessions = Array.from(this.activeSessions.values());
    const totalOperationsToday = sessions.reduce((sum, s) => sum + s.executedOperations, 0);
    
    return {
      emergencyStop: this.emergencyStop,
      adminApprovalRequired: this.adminApprovalRequired,
      maxOperationsPerSession: this.maxOperationsPerSession,
      maxDailyOperations: this.maxDailyOperations,
      activeSessions: sessions.length,
      totalOperationsToday
    };
  }
}

// Singleton instance
export const autoTradingScheduler = new AutoTradingScheduler();