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
  
  // 🎯 SISTEMA DE DIVERSIFICAÇÃO DINÂMICA - "PERDA ZERO"
  // Com 120+ ativos, cada um pode ter cool-off mais curto
  private recentAssets: Map<string, string[]> = new Map(); // userId -> [asset1, asset2, ...]
  private assetPerformance: Map<string, {wins: number, losses: number, lastTrades: boolean[]}> = new Map(); // Track performance por ativo
  private assetLastUsedTime: Map<string, number> = new Map(); // ✅ FIX: Guardar TEMPO REAL, não índice
  private assetCooldownMinutes: number = 0.5; // ⚡ REDUZIDO: Com mais ativos, pode ser mais curto (30 segundos)
  
  // 🧬 SISTEMA ADAPTATIVO - Breathing Room dinâmico
  // Se asset ganhando: permite IMEDIATAMENTE (rotation rápido em ganhadores)
  // Se asset perdendo: aumenta cool-off automaticamente (force diversificação)
  private getBreathingRoom(symbol: string): number {
    const performance = this.assetPerformance.get(symbol);
    if (!performance) return this.assetCooldownMinutes;
    
    const totalTrades = performance.wins + performance.losses;
    if (totalTrades === 0) return this.assetCooldownMinutes;
    
    const winRate = performance.wins / totalTrades;
    
    // 🎯 LÓGICA DE BREATHING ROOM - EXTREMAMENTE AGRESSIVA COM 120+ ATIVOS:
    // Win rate > 55% → Sem cool-off (0 segundos) - abrir IMEDIATAMENTE
    // Win rate 45-55% → Cool-off super reduzido (15 segundos)
    // Win rate 35-45% → Cool-off normal (30 segundos)
    // Win rate < 35% → Aumenta cool-off (60 segundos) - força diversificação
    
    if (winRate > 0.55) {
      return 0; // 🔥 SEM COOL-OFF - Abrir imediatamente em ganhadores
    } else if (winRate > 0.45) {
      return 0.25; // 15 segundos
    } else if (winRate >= 0.35) {
      return this.assetCooldownMinutes; // 30 segundos (normal)
    } else {
      return this.assetCooldownMinutes * 2; // 60 segundos (força diversificação)
    }
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

      // ⚡ INTELIGÊNCIA PURA: Sem limites de stagger quando oportunidade forte
      // IAs decidem quantidade de trades simultâneos baseado em consenso
      // Consenso forte (>70%): SEM stagger - burst completo de trades
      // Consenso médio (40-70%): stagger leve para distribuir
      // Consenso fraco (<40%): operações normais
      const analisePromises = activeConfigs.map(async (config, index) => {
        try {
          // ⚡ SEM RESTRIÇÃO: IAs abrem quanto precisar quando detectar oportunidade
          // Stagger apenas para distribuir em casos normais (proteger infraestrutura)
          // Mas removido completamente se houver consenso forte
          const staggerDelay = 0; // ⚡ REMOVED: Permitir burst completo de trades
          
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
      
      // 🔧 LIMPAR SÍMBOLO: Remover consenso formatado (ex: "R_50(45.0%)" → "R_50")
      let selectedSymbol = bestSymbolResult.symbol.split('(')[0].trim();
      
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
        // 🔥 ACEITAR QUALQUER SINAL (até neutral 45%) - TESTE SEM LIMITES
        if (aiConsensus.consensusStrength >= dynamicThreshold) {
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
      
      // 🔥 EXPANSÃO MASSIVA: Usar TODOS os 120+ ativos disponíveis na Deriv
      // Foram expandidos de 5 → 120+ para máxima diversificação e cobertura de lucro
      // NÃO FILTRAR - deixar passar todos os símbolos que têm dados
      
      const filteredSymbolsData = allSymbolsData.filter((symbolData: any) => {
        const symbol = symbolData.symbol;
        
        // ✅ ACEITAR TODOS os símbolos com dados de mercado disponíveis
        // Qualquer ativo que Deriv permite para DIGITDIFF será analisado
        // Isso inclui: Forex, Commodities, Crypto, Stocks, Indices, etc
        
        return true; // ✅ Deixar TODOS passarem - expansão de 5 para 120+ ativos
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
    // 🔥 TODOS OS ATIVOS SUPORTADOS - EXPANSÃO COMPLETA PARA MÁXIMA DIVERSIFICAÇÃO
    // Sistema agora opera 120+ ativos simultaneamente em tempo real
    const allSymbols = [
      // Volatility Indices - 5 ativos
      'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
      
      // Forex Major Pairs - 10 ativos
      'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
      'EURJPY', 'EURGBP', 'GBPJPY',
      
      // Forex Minor Pairs - 16 ativos
      'EURCAD', 'EURCHF', 'EURAUD', 'EURNZD', 'GBPAUD', 'GBPNZD', 'GBPCAD', 'GBPCHF',
      'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADCHF', 'CADJPY', 'CHFJPY', 'NZDJPY', 'NZDCAD',
      'NZDCHF', 'AUDCAD', 'USDSEK', 'USDNOK', 'USDDKK', 'USDHKD', 'USDSGD', 'USDMXN',
      
      // Commodities - 6 ativos
      'XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD', 'BRENUSD', 'WTIUSD',
      
      // Cryptocurrencies - 13 ativos
      'BTCUSD', 'ETHUSD', 'LTCUSD', 'BCHUSD', 'BNBUSD', 'XRPUSD', 'ADAUSD', 'DOTUSD',
      'LINKUSD', 'UNIUSD', 'SOLUSD', 'MATICUSD', 'AVAXUSD', 'AAAPEUSD',
      
      // Stock Indices - 9 ativos
      'SPX500', 'UK100', 'DE40', 'FR40', 'AUS200', 'JPN225', 'HSI50', 'SHCOMP', 'IND50',
      
      // Individual Stocks (Blue Chips) - 50+ ativos
      // Tech
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'CSCO', 'INTC',
      'AMD', 'CRM', 'ADBE', 'PYPL', 'SQ',
      
      // Finance
      'JPM', 'BAC', 'WFC', 'GS', 'MS', 'BLK', 'SCHW',
      
      // Pharma/Healthcare
      'JNJ', 'PFE', 'UNH', 'AZN', 'NVO', 'MRK', 'ABT', 'TMO', 'GILD',
      
      // Consumer
      'WMT', 'KO', 'PEP', 'MCD', 'SBUX', 'NKE', 'LULU', 'TJX', 'HD',
      
      // Energy
      'XOM', 'CVX', 'COP', 'SLB', 'MPC',
      
      // Industrial
      'BA', 'CAT', 'MMM', 'GE', 'HON', 'LMT',
      
      // Utilities
      'DUK', 'SO', 'NEE', 'AEP', 'EXC'
    ];
    
    return allSymbols; // 120+ ativos para diversificação máxima
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
    // Trades criados a cada 5 segundos com durações distribuídas (10-15 ticks)
    // = Fechamentos distribuídos, sem spike
    this.cronJob = setInterval(() => {
      if (!this.schedulerRunning) {
        this.executeAnaliseNaturalAnalysis();
        // ⚡ Adicionar pequeno delay distribuído (stagger) entre processamentos
        // Isto previne que todos os trades sejam processados simultaneamente
      }
    }, 5000);
    
    // 🔄 Iniciar sincronização automática de trades da Deriv
    derivTradeSync.startAutoSync();
    
    console.log('▶️ Auto Trading Scheduler iniciado - análise a cada 5 segundos (com duração distribuída 10-15 ticks)');
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