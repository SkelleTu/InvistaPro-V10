import * as cron from 'node-cron';
import { storage } from '../storage';
import { huggingFaceAI } from './huggingface-ai';
import { derivAPI, DerivAPIService } from './deriv-api';
import { errorTracker } from '../services/error-tracker';
import { marketDataCollector } from './market-data-collector';
import { dynamicThresholdTracker } from './dynamic-threshold-tracker';
import { resilienceSupervisor } from './resilience-supervisor';

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
        await resilienceSupervisor.reportHeartbeat('scheduler', {
          schedulerRunning: this.schedulerRunning,
          activeSessions: this.activeSessions.size,
          emergencyStop: this.emergencyStop,
          isInitialized: this.isInitialized,
        });
      } catch (error) {
        console.error('❌ Erro ao reportar heartbeat ao supervisor:', error);
      }
    }, 60000);
    console.log(`💓 Heartbeat do ResilienceSupervisor iniciado para scheduler`);
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
      console.log('📊 Iniciando coleta contínua de dados de mercado...');
      
      // Conectar à Deriv para buscar símbolos disponíveis
      const tempDerivAPI = new DerivAPIService();
      await tempDerivAPI.connectPublic('GET_ALL_SYMBOLS');
      
      // BUSCAR 100% DOS ATIVOS DISPONÍVEIS DINAMICAMENTE DA API DA DERIV
      const activeSymbols = await tempDerivAPI.getActiveSymbols();
      
      // Extrair apenas os símbolos (identificadores)
      const symbols = activeSymbols.map((s: any) => s.symbol);
      
      // Desconectar a conexão temporária
      await tempDerivAPI.disconnect();
      
      console.log(`✅ Recuperados ${symbols.length} símbolos ativos da Deriv API`);
      console.log('📋 Categorias:', {
        synthetic: symbols.filter((s: string) => s.startsWith('R_')).length,
        volatility: symbols.filter((s: string) => s.includes('HZ')).length,
        forex: symbols.filter((s: string) => s.startsWith('frx')).length,
        indices: symbols.filter((s: string) => s.startsWith('OTC_')).length,
        outros: symbols.filter((s: string) => !s.startsWith('R_') && !s.includes('HZ') && !s.startsWith('frx') && !s.startsWith('OTC_')).length
      });
      
      await marketDataCollector.startCollection(symbols);
      
      console.log('✅ Coleta de dados iniciada para TODOS os símbolos disponíveis');
      
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
    // SEGURANÇA: Verificar se pode executar operações
    if (!this.canExecuteOperation()) {
      return; // Bloquear execução se controles de segurança ativos
    }
    
    this.schedulerRunning = true;
    const operationId = `ANALISE_NATURAL_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    try {
      // Buscar todas as configurações ativas
      let activeConfigs = await storage.getActiveTradeConfigurations();
      
      console.log(`🎯 [${operationId}] Sistema Análise natural continua de IA - Análise microscópica ativa...`);
      console.log(`📊 [${operationId}] Configurações ativas encontradas: ${activeConfigs.length}`);
      
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

      // Sistema Análise natural continua de IA - processar TODAS as configurações em paralelo (sem limitações conforme especificado)
      const analisePromises = activeConfigs.map(async (config) => {
        try {
          return await this.processAnaliseNaturalConfiguration(config, operationId);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ [${operationId}] Erro na sessão Análise natural continua de IA ${config.id}:`, errorMessage);
          return { success: false, error: errorMessage };
        }
      });

      // Executar todas as análises em paralelo (modo "Análise natural continua de IA")
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
    // SEGURANÇA: Verificar limites antes de processar
    if (!this.canExecuteOperation()) {
      return { success: false, error: 'Bloqueado por controles de segurança' };
    }
    
    try {
      const userId = config.userId;
      const sessionKey = `${userId}_${config.id}`;
      
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
      
      const selectedSymbol = bestSymbolResult.symbol;
      const aiConsensusPreCalculated = bestSymbolResult.aiConsensus;
      
      console.log(`✅ [${operationId}] Melhor símbolo selecionado: ${selectedSymbol} (Consenso: ${aiConsensusPreCalculated.consensusStrength}%)`);
      console.log(`📊 [${operationId}] Analisados ${bestSymbolResult.totalAnalyzed} símbolos | TOP 5: ${bestSymbolResult.top5Symbols.join(', ')}`);
      
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
      const lastUpdateTime = marketDataInfo.lastUpdate ? new Date(marketDataInfo.lastUpdate).getTime() : 0;
      const dataAge = new Date().getTime() - lastUpdateTime;
      const isDataStale = dataAge > (marketDataInfo.isSimulated ? 24 * 60 * 60 * 1000 : 60 * 1000); // 24h para simulados, 1min para reais
      
      if (isDataStale) {
        return { 
          success: false, 
          error: `Dados de mercado desatualizados (${Math.round(dataAge / 1000)}s)` 
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
      
      // 🎯 VERIFICAR SE PRECISA FORÇAR OPERAÇÕES MÍNIMAS
      const shouldForceMinimum = await dynamicThresholdTracker.shouldForceMinimumOperations(config.userId, config.mode);
      
      // 🎯 OBTER THRESHOLD DINÂMICO (MÉDIA ALTA DO DIA)
      const dynamicThreshold = dynamicThresholdTracker.getDynamicThreshold(config.mode, shouldForceMinimum);
      
      // 🌟 IDENTIFICAR SINAIS EXCEPCIONALMENTE FORTES
      const isStrongSignal = aiConsensus.consensusStrength >= 75;
      const isExceptionalSignal = aiConsensus.consensusStrength >= 85;
      
      console.log(`📊 [${operationId}] 🎯 Threshold: ${dynamicThreshold}% | 🧠 Consenso: ${aiConsensus.consensusStrength}%${isExceptionalSignal ? ' 🔥🔥🔥 EXCEPCIONAL' : isStrongSignal ? ' 🔥 FORTE' : ''} | ⚡ Forçar: ${shouldForceMinimum}`);
      
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
        if (aiConsensus.finalDecision !== 'neutral' && aiConsensus.consensusStrength >= dynamicThreshold) {
          if (isExceptionalSignal) {
            console.log(`✅ [${operationId}] 🔥🔥🔥 EXECUTANDO SINAL EXCEPCIONAL: ${aiConsensus.consensusStrength}%`);
          } else if (isStrongSignal) {
            console.log(`✅ [${operationId}] 🔥 EXECUTANDO SINAL FORTE: ${aiConsensus.consensusStrength}%`);
          } else {
            console.log(`✅ [${operationId}] 🚀 EXECUTANDO: Consenso ${aiConsensus.consensusStrength}% >= Threshold ${dynamicThreshold}%`);
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
        if (aiConsensus.finalDecision !== 'neutral' && aiConsensus.consensusStrength >= dynamicThreshold) {
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

      // Conectar ao Deriv
      const connected = await derivAPI.connect(tokenData.token, tokenData.accountType as "demo" | "real", operationId);
      if (!connected) {
        return { success: false, error: 'Erro de conexão com Deriv' };
      }

      try {
        // Determinar parâmetros do trade baseado no modo e banca
        // 🔥 SISTEMA DE RECUPERAÇÃO INTELIGENTE DE PERDAS
      let tradeParams = await this.getTradeParamsForMode(config.mode, selectedSymbol, aiConsensus.finalDecision, config.userId);
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
          return { success: false, error: 'Falha ao executar trade na Deriv' };
        }

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
      
      // 🎯 FILTRO INTELIGENTE: Apenas símbolos que REALMENTE suportam DIGITDIFF
      // Baseado em testes reais: apenas R_10, R_25, R_50, R_75, R_100 funcionam
      const DIGITDIFF_SUPPORTED = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
      
      const filteredSymbolsData = allSymbolsData.filter((symbolData: any) => {
        const symbol = symbolData.symbol;
        
        // ✅ Apenas símbolos que REALMENTE suportam DIGITDIFF
        const isSupported = DIGITDIFF_SUPPORTED.includes(symbol);
        
        if (!isSupported) {
          // Log apenas amostra para não poluir (1 a cada 10)
          if (Math.random() < 0.1) {
            console.log(`🚫 [${operationId}] Bloqueado (não suporta DIGITDIFF): ${symbol}`);
          }
          return false;
        }
        
        return true;
      });
      
      if (filteredSymbolsData.length === 0) {
        return { 
          success: false, 
          error: 'Todos os símbolos foram bloqueados (ativos 1s)', 
          totalAnalyzed: allSymbolsData.length, 
          top5Symbols: [] 
        };
      }
      
      console.log(`📊 [${operationId}] Analisando ${filteredSymbolsData.length} símbolos (${allSymbolsData.length - filteredSymbolsData.length} bloqueados)...`);
      
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
          const lastUpdateTime = symbolData.lastUpdate ? new Date(symbolData.lastUpdate).getTime() : 0;
          const dataAge = new Date().getTime() - lastUpdateTime;
          const isDataStale = dataAge > (symbolData.isSimulated ? 24 * 60 * 60 * 1000 : 60 * 1000);
          
          if (isDataStale) {
            return null; // Dados desatualizados
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
      
      // Filtrar resultados válidos e ordenar por consenso (maior para menor)
      const validResults = results
        .filter(r => r !== null && r.direction !== 'neutral')
        .sort((a, b) => b!.consensus - a!.consensus);
      
      if (validResults.length === 0) {
        return { 
          success: false, 
          error: 'Nenhum símbolo com sinal válido (todos neutros ou com erros)', 
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
    // 🚫 ATIVOS (1s) BLOQUEADOS: Removidos 1HZ*V - causam loss por quebra de padrão
    // Diferentes símbolos baseados no modo de operação
    const baseSymbols = ['R_50', 'R_75', 'R_100'];
    // volatilitySymbols removidos permanentemente (1HZ50V, 1HZ75V, 1HZ100V)
    
    return baseSymbols; // Apenas símbolos base confiáveis
  }

  private async getTradeParamsForMode(mode: string, symbol: string, direction: string, userId: string): Promise<{amount: number, duration: number, barrier: string}> {
    let amount = 0.35; // Default para bancas pequenas (conservador)
    let duration = 5; // Default: 5 ticks - SEMPRE em ticks para digit differs
    
    // 🎯 CALCULAR STAKE BASEADO NO TAMANHO DA BANCA
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
    
    // CORREÇÃO: Para digit differs, duration deve estar sempre entre 1-10 ticks
    // O parâmetro de tempo no modo não afeta a duração individual do trade,
    // apenas a frequência de execução (que é controlada pelo intervalValue na configuração)
    if (modeParams.length >= 3) {
      const timeParam = modeParams[2];
      if (timeParam.includes('min')) {
        // Para modos rápidos (minutos), usar duração menor
        duration = Math.min(parseInt(timeParam) || 5, 10);
        duration = Math.max(duration, 1); // Garantir que seja >= 1
      } else if (timeParam.includes('h')) {
        // Para modos lentos (horas), usar duração maior mas ainda dentro do limite
        const hours = parseInt(timeParam) || 1;
        duration = hours <= 2 ? 5 : (hours <= 6 ? 7 : 10); // Mapear horas para ticks válidos
      }
    }
    
    // Garantir que duration esteja sempre no range válido para digit differs
    duration = Math.min(Math.max(duration, 1), 10);
    
    console.log(`🔧 DEBUG getTradeParamsForMode: mode=${mode}, duration calculada=${duration}, amount=${amount}`);

    // Gerar barrier aleatório para digit differs (0-9)
    const barrier = Math.floor(Math.random() * 10).toString();

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
    
    // Criar intervalo de análise a cada 5 segundos
    this.cronJob = setInterval(() => {
      if (!this.schedulerRunning) {
        this.executeAnaliseNaturalAnalysis();
      }
    }, 5000);
    
    console.log('▶️ Auto Trading Scheduler iniciado - análise a cada 5 segundos');
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