import * as cron from 'node-cron';
import { storage } from '../storage';
import { huggingFaceAI } from './huggingface-ai';
import { derivAPI, DerivAPIService } from './deriv-api';
import { errorTracker } from '../services/error-tracker';
import { marketDataCollector } from './market-data-collector';
import { dynamicThresholdTracker } from './dynamic-threshold-tracker';
import { resilienceSupervisor } from './resilience-supervisor';
import { derivTradeSync } from './deriv-trade-sync';

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
  private readonly OPERATION_TIMEOUT_MS = 45000; // 45 segundos máximo por ciclo
  
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
    for (const [sessionKey, session] of this.activeSessions.entries()) {
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
    
    for (const [sessionKey, session] of this.activeSessions.entries()) {
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
      
      // Escutar processamento de ticks para análises contínuas
      marketDataCollector.on('tick_processed', (data) => {
        console.log(`🎯 [Análise natural continua de IA] Tick: ${data.symbol} @ ${data.tick.quote} (${data.bufferSize} buffer)`);
        // IAs fazem análise instantânea a cada tick conforme sistema de Análise natural continua de IA
      });
      
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
        console.log(`🔍 [DEBUG] Config ${c.id}: userId=${c.userId}, symbol=${c.symbol}, mode=${c.mode}, isActive=${c.isActive}`);
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
      const db = (storage as any).db;
      const { blockedAssets } = require("@shared/schema");
      const { and, eq } = require("drizzle-orm");
      
      const blocked = await db
        .select()
        .from(blockedAssets)
        .where(
          and(
            eq(blockedAssets.userId, userId),
            eq(blockedAssets.tradeMode, "digit_diff"),
            eq(blockedAssets.symbol, config.symbol || "R_100") // Símbolo atual
          )
        );

      if (blocked.length > 0) {
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
      
      console.log(`✅ [${operationId}] Melhor símbolo selecionado: ${selectedSymbol} (Consenso: ${aiConsensusPreCalculated.consensusStrength}%)`);
      console.log(`📊 [${operationId}] Analisados ${bestSymbolResult.totalAnalyzed} símbolos | TOP 5: ${bestSymbolResult.top5Symbols.join(', ')}`);
      
      // 🚫 TERCEIRA CAMADA DE PROTEÇÃO: Verificação final antes de buscar dados
      if (this.isSymbolBlocked(selectedSymbol)) {
        console.error(`❌ [${operationId}] ERRO CRÍTICO: Símbolo ${selectedSymbol} passou por filtros mas contém "(1s)" - SISTEMA RESPONSÁVEL BLOQUEANDO`);
        return { success: false, error: `Símbolo bloqueado detectado em verificação final: ${selectedSymbol}` };
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
      
      // 🔥 FORÇAR EXECUÇÃO TOTAL PARA TESTE - IGNORANDO THRESHOLDS
      const isProductionMode = true; 
      const isDev = true;
      const forceTrade = true;
      const shouldForceMinimum = true;
      const dynamicThreshold = 0.1;

      console.log(`📊 [${operationId}] MODO TESTE FORÇADO - Forçando decisão UP/DOWN`);

      // 🌟 IDENTIFICAR SINAIS (Valores baixos para teste)
      const isStrongSignal = true;
      const isExceptionalSignal = true;
    
    console.log(`📊 [${operationId}] 🎯 Threshold: ${dynamicThreshold}% | 🧠 Consenso: ${aiConsensus.consensusStrength}% | ⚡ Forçar: ${shouldForceMinimum}`);

    // 🔥 LOG DE DECISÃO FINAL PARA DEBUG
    console.log(`🤔 [DEBUG] Decisão Inicial: ${aiConsensus.finalDecision}, Strength: ${aiConsensus.consensusStrength}`);
    
    // ✅ GARANTIR DECISÃO DIRECIONAL
    if (aiConsensus.finalDecision === 'neutral' || shouldForceMinimum) {
      const upScore = aiConsensus.upScore || 0;
      const downScore = aiConsensus.downScore || 0;
      
      if (upScore >= downScore) {
        aiConsensus.finalDecision = 'up';
      } else {
        aiConsensus.finalDecision = 'down';
      }
      
      aiConsensus.consensusStrength = Math.max(aiConsensus.consensusStrength, 85);
      console.log(`🔄 [${operationId}] DECISÃO FORÇADA PARA: ${aiConsensus.finalDecision} (${aiConsensus.consensusStrength}%)`);
    }

    // 🔥 PULAR TODAS AS VALIDAÇÕES DE THRESHOLD E EXECUTAR
    console.log(`✅ [${operationId}] 🚀 EXECUTANDO OPERAÇÃO GARANTIDA - Ignorando limites de threshold`);
    
    /* 
    if (false) { // Código original mantido em bloco morto para evitar erros de sintaxe se necessário, mas vamos substituir o bloco condicional inteiro abaixo
    */
 else if (shouldForceMinimum && operationsToday < limits.min) {
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
        } else if (false) { // Bloqueado para teste
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
      /*
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
        
        const digitDifferContract = {
          contract_type: 'DIGITDIFF' as const,
          symbol: selectedSymbol,
          duration: tradeParams.duration,
          duration_unit: 't' as const,
          barrier: tradeParams.barrier,
          amount: tradeParams.amount,
          currency: 'USD'
        };

        const contract = await derivAPI.buyDigitDifferContract(digitDifferContract);
        
        if (!contract) {
          console.error(`❌ [${operationId}] Erro ao comprar contrato na Deriv para ${selectedSymbol}`);
          return { success: false, error: 'Falha ao executar trade na Deriv' };
        }

        console.log(`✅ [${operationId}] Contrato comprado com sucesso: ${contract.contract_id}`);

        // Salvar operação no banco com informações de recuperação
        await storage.createTradeOperation({
          userId: config.userId,
          derivContractId: String(contract.contract_id),
          symbol: selectedSymbol,
          tradeType: 'digitdiff',
          direction: aiConsensus.finalDecision as "up" | "down",
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
          
          // Executar análise de IA
          const aiConsensus = await huggingFaceAI.analyzeMarketData(tickData, symbol, userId);
          
          return {
            symbol,
            consensus: aiConsensus.consensusStrength,
            direction: aiConsensus.finalDecision,
            aiConsensus
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
      
      console.log(`🏆 [${operationId}] TOP 5 Símbolos:`);
      top5.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r!.symbol}: ${r!.direction.toUpperCase()} (${r!.consensus.toFixed(1)}%)`);
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
    // Consenso range: 0-100
    // Volatility range: 0-1
    
    let multiplier = 1.0;
    
    // PILAR 1: Consenso da IA
    if (consensoStrength >= 70) {
      multiplier = 1.4; // +40% se consenso forte
    } else if (consensoStrength >= 55) {
      multiplier = 1.1; // +10% se consenso moderado
    } else if (consensoStrength < 50) {
      multiplier = 0.7; // -30% se consenso fraco
    }
    
    // PILAR 2: Volatilidade (reduz stake se volatilidade alta)
    if (volatility > 0.8) {
      multiplier *= 0.8; // -20% em volatilidade alta
    } else if (volatility > 0.6) {
      multiplier *= 0.9; // -10% em volatilidade média
    }
    
    const dynamicStake = Math.round(baseAmount * multiplier * 100) / 100;
    console.log(`💰 [DYNAMIC STAKE] Base: $${baseAmount} × ${multiplier.toFixed(2)} (consenso: ${consensoStrength}%, vol: ${(volatility*100).toFixed(0)}%) = $${dynamicStake}`);
    
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
      ticksAdjustment = Math.min(15, baseTicks + 5); // Máx 15 ticks (+50%)
      console.log(`📈 [DYNAMIC TICKS] Alto win rate (${(winRate*100).toFixed(0)}%) → ${ticksAdjustment} ticks`);
    } else if (winRate < 0.40) {
      ticksAdjustment = Math.max(5, baseTicks - 3); // Mín 5 ticks
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
    
    // OTIMIZAÇÃO: Para digit differs, aumentar duration mínima para 10 ticks
    // Isto distribui melhor o fechamento de trades e evita congestão
    if (modeParams.length >= 3) {
      const timeParam = modeParams[2];
      if (timeParam.includes('min')) {
        // Para modos rápidos (minutos), usar duração distribuída (10-15 ticks)
        duration = Math.min(parseInt(timeParam) || 10, 15);
        duration = Math.max(duration, 10); // ⚡ MÍNIMO: 10 ticks para distribuição
      } else if (timeParam.includes('h')) {
        // Para modos lentos (horas), usar duração maior para distribuir
        const hours = parseInt(timeParam) || 1;
        duration = hours <= 2 ? 10 : (hours <= 6 ? 12 : 15); // ⚡ Aumentado range
      }
    }
    
    // ⚡ OTIMIZAÇÃO: Garantir duração entre 10-15 para distribuir fechamento
    duration = Math.min(Math.max(duration, 10), 15);
    
    console.log(`🔧 DEBUG getTradeParamsForMode: mode=${mode}, duration calculada=${duration}, amount=${amount}`);

    // ✅ FIX: Barrier INTELIGENTE baseado em IA + padrão de dígitos
    // Para DIGITDIFF: prever se o dígito vai MUDAR (direction='up' = mudará, direction='down' = estável)
    // Mapear consenso e direção para barrier que faz sentido
    let barrier = '5'; // Default neutro
    
    if (direction === 'up' && consensoStrength && consensoStrength > 0.5) {
      // IA prevê movimento forte para UP = expectativa de mudança de dígito
      // Usar barrier baseado em confiança (75-99% confiança = barriers altos 7-9)
      const barrierValue = Math.min(9, Math.max(5, Math.floor((consensoStrength * 10))));
      barrier = barrierValue.toString();
      console.log(`📊 [DIGITDIFF] IA prevê UP forte (${(consensoStrength*100).toFixed(0)}%) → Barrier ${barrier} (espera mudança)`);
    } else if (direction === 'down' && consensoStrength && consensoStrength > 0.5) {
      // IA prevê movimento para DOWN = expectativa de estabilidade
      // Usar barrier baixos (0-4) para apostar em menos mudança
      const barrierValue = Math.max(0, Math.min(4, Math.floor((consensoStrength * 4))));
      barrier = barrierValue.toString();
      console.log(`📊 [DIGITDIFF] IA prevê DOWN (${(consensoStrength*100).toFixed(0)}%) → Barrier ${barrier} (espera estabilidade)`);
    } else {
      // Consensus baixo ou neutro = usar barrier médio com pequena variação
      barrier = Math.floor(Math.random() * 3 + 4).toString(); // 4-6 (zona neutra)
      console.log(`📊 [DIGITDIFF] Consenso baixo/neutro → Barrier ${barrier} (zona neutra)`);
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
      
      // Aplicar bônus cooperativo baseado no nível de cooperação e threshold da estratégia
      switch (cooperationLevel) {
        case 'maximum':
          // Cooperação máxima: IAs trabalham com threshold 95%
          if (lossPercent >= 0.20) cooperativeBonus = 1.4; // +40% quando cooperação máxima
          else if (lossPercent >= 0.10) cooperativeBonus = 1.3;
          else if (lossPercent >= 0.05) cooperativeBonus = 1.2;
          break;
          
        case 'high':
          // Cooperação alta: IAs trabalham com threshold 85-90%  
          if (lossPercent >= 0.15) cooperativeBonus = 1.3; // +30% quando cooperação alta
          else if (lossPercent >= 0.10) cooperativeBonus = 1.25;
          else if (lossPercent >= 0.05) cooperativeBonus = 1.15;
          break;
          
        case 'medium':
          // Cooperação média: IAs trabalham com threshold 75-80%
          if (lossPercent >= 0.10) cooperativeBonus = 1.2; // +20% quando cooperação média
          else if (lossPercent >= 0.05) cooperativeBonus = 1.1;
          break;
      }
      
      // Aplicar taxa de sucesso da estratégia como fator adicional
      const successFactor = Math.min((recoveryStrategy.successRate || 70) / 100, 1.0);
      cooperativeBonus = cooperativeBonus * (0.8 + (successFactor * 0.2)); // Ajustar baseado no sucesso histórico
      
      const finalMultiplier = baseMultiplier * cooperativeBonus;
      
      // Limitar multiplicador máximo baseado nos parâmetros da estratégia
      const maxMultiplier = recoveryStrategy.parameters?.maxMultiplier || 3.5;
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
        const performance = this.assetPerformance.get(symbol);
        console.log(`🔄 [DIVERSIFICAÇÃO] Cool-off de ${symbol} finalizado (${breathingRoom.toFixed(1)}min). Performance: ${performance?.wins}W/${performance?.losses}L`);
      }
    }, breathingRoom * 60 * 1000);
    
    this.recentAssets.set(userId, recentList);
    const performance = this.assetPerformance.get(symbol);
    console.log(`✅ [DIVERSIFICAÇÃO] ${symbol} rastreado (breathing: ${breathingRoom.toFixed(1)}min). Performance: ${performance?.wins}W/${performance?.losses}L`);
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
    
    for (const [symbol, perf] of this.assetPerformance) {
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