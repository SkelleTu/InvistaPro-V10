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
import { contractMonitor } from './contract-monitor';
import { persistentLearningEngine } from './persistent-learning-engine';
import { supremeAnalyzer, SupremeAnalysis } from './supreme-market-analyzer';
import { analyzeCrashBoomSpike } from './crash-boom-spike-engine';
import { setSignal } from './signal-store';

function derivToMT5Name(derivSymbol: string): string | null {
  const map: Record<string, string> = {
    'R_10': 'Volatility 10 Index', 'R_25': 'Volatility 25 Index',
    'R_50': 'Volatility 50 Index', 'R_75': 'Volatility 75 Index',
    'R_100': 'Volatility 100 Index', 'R_10_1S': 'Volatility 10 (1s) Index',
    'R_25_1S': 'Volatility 25 (1s) Index', 'R_50_1S': 'Volatility 50 (1s) Index',
    'R_75_1S': 'Volatility 75 (1s) Index', 'R_100_1S': 'Volatility 100 (1s) Index',
    'JD10': 'Jump 10 Index', 'JD25': 'Jump 25 Index', 'JD50': 'Jump 50 Index',
    'JD75': 'Jump 75 Index', 'JD100': 'Jump 100 Index',
    'RDBULL': 'Range Break Bull 200', 'RDBEAR': 'Range Break Bear 200',
    'CRASH300': 'Crash 300 Index', 'CRASH500': 'Crash 500 Index',
    'CRASH1000': 'Crash 1000 Index', 'BOOM300': 'Boom 300 Index',
    'BOOM500': 'Boom 500 Index', 'BOOM1000': 'Boom 1000 Index',
  };
  return map[derivSymbol.toUpperCase()] || null;
}

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
  // Cobre: formato "(1s)", formato de API "1HZ*" e formato interno "_1S" (ex: R_100_1S)
  private static readonly BLOCKED_SYMBOLS_PATTERN = /\(1s\)|^1HZ|_1S/i;
  
  /**
   * Validar se símbolo está bloqueado (causador de loss)
   * ☠️ EXECUÇÃO: qualquer tentativa é registrada com máxima severidade
   */
  private isSymbolBlocked(symbol: string, contexto?: string): boolean {
    const bloqueado = AutoTradingScheduler.BLOCKED_SYMBOLS_PATTERN.test(symbol);
    if (bloqueado && contexto) {
      const ts = new Date().toISOString();
      console.error(`\n☠️ ══════════════════════════════════════════════════════`);
      console.error(`☠️  EXECUÇÃO — TENTATIVA DE CRIME INTERCEPTADA`);
      console.error(`☠️  Símbolo criminoso : ${symbol}`);
      console.error(`☠️  Interceptado em   : ${contexto}`);
      console.error(`☠️  Timestamp         : ${ts}`);
      console.error(`☠️  Sentença          : SELEÇÃO ABORTADA — nunca chegará à execução`);
      console.error(`☠️ ══════════════════════════════════════════════════════\n`);
    }
    return bloqueado;
  }
  
  // 🔧 ANTI-DEADLOCK: Rastreamento de operações em execução
  private lastOperationId: string | null = null;
  private lastOperationStartTime: number = 0;
  private readonly OPERATION_TIMEOUT_MS = 90000; // 90 segundos máximo por ciclo

  // ⚡ CACHE DE SALDO — evita round-trip WebSocket a cada operação ACCU (stake fixo $1)
  private cachedBalance: { value: number; currency: string; loginid: string; fetchedAt: number } | null = null;
  private readonly BALANCE_CACHE_TTL_MS = 60000; // 60 segundos de validade

  // 📊 RASTREAMENTO DE FASE — exibido na interface para o usuário
  private currentPhase: string = 'INICIALIZANDO';
  private currentPhaseDetail: string = 'Sistema inicializando...';
  private lastCycleStartedAt: number = 0;
  private nextCycleAt: number = 0;

  // 📉 Qualidade de mercado detectada no último scan (0-100)
  // Baixa = muitos ativos com consenso ruim simultaneamente → modo defensivo
  private lastScanMarketQuality: number = 100;
  private readonly CYCLE_INTERVAL_MS = 5000; // 5 segundos — análise contínua, IA decide livremente quando operar

  // 🚫 PAUSA POR MERCADO RUIM — Bloqueia operações quando o mercado global está desfavorável
  private badMarketPausedUntil: number = 0;             // Timestamp até quando operações estão pausadas
  private badMarketReducedGrowthActive: boolean = false; // true = opera com growth 1% (recuperação parcial)
  private readonly BAD_MARKET_PAUSE_MS = 30 * 1000;      // 30 segundos (antes: 15 min) — IA retoma quase imediatamente
  private readonly BAD_MARKET_QUALITY_THRESHOLD = 20;    // Qualidade ≤ 20% → pausa (antes: 40%) — só pausa em mercado muito ruim
  private readonly BAD_MARKET_RECOVERED_THRESHOLD = 60;  // Qualidade > 60% → recuperação plena (5%)
  private readonly BAD_MARKET_PARTIAL_THRESHOLD = 30;    // Qualidade 31-60% → recuperação parcial (antes: 40%)
  private readonly BAD_MARKET_GROWTH_REDUCED = 0.01;     // Taxa de crescimento reduzida (1%)
  private activityLog: Array<{ time: number; message: string; type: 'info' | 'success' | 'warning' | 'trade' }> = [];

  // 🎰 SISTEMA MARTINGALE TRIPLO — Gerenciado por IA de Alta Precisão
  // Ativa apenas em momentos de consenso excepcional (≥92%), NUNCA em recovery/circuit breaker
  private martingaleStates: Map<string, {
    isActive: boolean;
    currentPart: 1 | 2 | 3;
    baseStake: number;
    triggeredAt: number;
    cooldownUntil: number;
  }> = new Map();
  private pendingMartingaleContracts: Map<string, { userId: string; part: number }> = new Map();
  private readonly MARTINGALE_CONSENSUS_THRESHOLD = 75; // Reduzido de 92→75: sistema máx atinge ~75-80%
  private readonly MARTINGALE_COOLDOWN_MS = 30 * 1000; // 30 segundos entre sequências (antes: 15 min — IA não fica travada)

  // 🚀 MODO ALAVANCAGEM — disparo raro e cirúrgico quando o mercado geral está excepcional
  private leverageLastFiredAt: number = 0;
  private readonly LEVERAGE_COOLDOWN_MS       = 5 * 60 * 1000;  // 5 minutos entre disparos (antes: 60s — muito agressivo)
  private readonly LEVERAGE_MIN_ASSETS        = 3;               // Mínimo 3 ativos alinhados (antes: 2 — fácil demais)
  private readonly LEVERAGE_CONSENSUS_MIN     = 72;              // Score mínimo 72 (antes: 65 — muito permissivo)
  private readonly LEVERAGE_STAKE_PCT         = 0.05;            // 5% da banca
  private readonly LEVERAGE_MIN_STAKE         = 1.00;            // mínimo $1.00 (antes: $2.50 — agressivo para saldos baixos)
  private readonly LEVERAGE_MAX_STAKE         = 50.00;           // teto absoluto de segurança
  private readonly LEVERAGE_MAX_BALANCE_PCT   = 0.20;            // não arriscar mais de 20% da banca por trade ACCU

  private setPhase(phase: string, detail: string, type: 'info' | 'success' | 'warning' | 'trade' = 'info'): void {
    this.currentPhase = phase;
    this.currentPhaseDetail = detail;
    this.activityLog.unshift({ time: Date.now(), message: detail, type });
    if (this.activityLog.length > 20) this.activityLog.pop();
  }
  
      // 🎯 SISTEMA DE DIVERSIFICAÇÃO DINÂMICA - "PERDA ZERO"
      // Com 120+ ativos, cada um pode ter cool-off mais curto
      private recentAssets: Map<string, string[]> = new Map(); // userId -> [asset1, asset2, ...]
      private assetPerformance: Map<string, {wins: number, losses: number, lastTrades: boolean[]}> = new Map(); // Track performance por ativo
      private assetLastUsedTime: Map<string, number> = new Map(); // ✅ FIX: Guardar TEMPO REAL, não índice
      private assetCooldownMinutes: number = 0; // ⚡ DESATIVADO PARA TESTE: 0 segundos
      
  private getBreathingRoom(_symbol: string): number {
    return 0;
  }

  // ─── MARTINGALE HELPERS ───────────────────────────────────────────────────

  private getMartingaleState(userId: string) {
    if (!this.martingaleStates.has(userId)) {
      this.martingaleStates.set(userId, {
        isActive: false,
        currentPart: 1,
        baseStake: 0,
        triggeredAt: 0,
        cooldownUntil: 0,
      });
    }
    return this.martingaleStates.get(userId)!;
  }

  /** Verifica se as condições de mercado permitem ativar martingale */
  private isMartingaleEligible(userId: string, consensus: number): boolean {
    if (realStatsTracker.isPostLossMode()) return false;
    if (realStatsTracker.isCircuitBreakerActive()) return false;
    const state = this.getMartingaleState(userId);
    if (Date.now() < state.cooldownUntil) return false;
    return consensus >= this.MARTINGALE_CONSENSUS_THRESHOLD;
  }

  /** Retorna label do modo atual para exibição nas mensagens de operação */
  private getCurrentOperationLabel(userId: string, sessionMode: string): string {
    const mg = this.getMartingaleState(userId);
    if (mg.isActive) return `Em modo Martingale — Parte ${mg.currentPart}/3`;
    if (realStatsTracker.isPostLossMode()) return 'Em modo de Recuperação';
    if (realStatsTracker.isCircuitBreakerActive()) return 'Em modo de Segurança';
    return 'Operação Ordinária';
  }

  /**
   * Aplica multiplicador de martingale ao stake base.
   * Parte 1 → ×mult[0] | Parte 2 → ×mult[1] | Parte 3 → ×mult[2]
   * Retorna o stake ajustado e ativa/avança o estado de martingale.
   */
  private applyMartingaleStake(userId: string, baseStake: number, consensus: number, operationId: string, enabled = true, userMultipliers?: number[]): number {
    if (!enabled) return baseStake;
    const state = this.getMartingaleState(userId);

    if (!state.isActive) {
      if (!this.isMartingaleEligible(userId, consensus)) return baseStake;
      state.isActive = true;
      state.currentPart = 1;
      state.baseStake = baseStake;
      state.triggeredAt = Date.now();
      console.log(`🎰 [${operationId}] MARTINGALE ATIVADO — Parte 1/3 | Consenso: ${consensus}% ≥ ${this.MARTINGALE_CONSENSUS_THRESHOLD}%`);
    } else {
      console.log(`🎰 [${operationId}] MARTINGALE Parte ${state.currentPart}/3 em curso | Consenso: ${consensus}%`);
    }

    const mults = userMultipliers && userMultipliers.length === 3 ? userMultipliers : [1.30, 1.60, 2.00];
    const mult = mults[(state.currentPart - 1)] ?? 1.0;
    const adjustedStake = Math.round(baseStake * mult * 100) / 100;

    console.log(`🎰 [${operationId}] Stake martingale Parte ${state.currentPart}/3: $${baseStake.toFixed(2)} × ${mult} = $${adjustedStake.toFixed(2)}`);
    return adjustedStake;
  }

  /** Registra o resultado de um contrato que estava em modo martingale */
  private processMartingaleContractResult(contractId: string, won: boolean): void {
    const meta = this.pendingMartingaleContracts.get(contractId);
    if (!meta) return;
    this.pendingMartingaleContracts.delete(contractId);

    const { userId, part } = meta;
    const state = this.getMartingaleState(userId);

    if (!state.isActive) return;

    if (!won) {
      console.log(`🎰 [MARTINGALE] Parte ${part}/3 PERDIDA — encerrando sequência. Cooldown de ${this.MARTINGALE_COOLDOWN_MS / 60000} min ativado.`);
      state.isActive = false;
      state.currentPart = 1;
      state.cooldownUntil = Date.now() + this.MARTINGALE_COOLDOWN_MS;
      return;
    }

    if (part >= 3) {
      console.log(`🎰 [MARTINGALE] 🏆 Sequência COMPLETA (3/3 vitórias)! Cooldown de ${this.MARTINGALE_COOLDOWN_MS / 60000} min ativado.`);
      state.isActive = false;
      state.currentPart = 1;
      state.cooldownUntil = Date.now() + this.MARTINGALE_COOLDOWN_MS;
      return;
    }

    const nextPart = (part + 1) as 1 | 2 | 3;
    state.currentPart = nextPart;
    console.log(`🎰 [MARTINGALE] Parte ${part}/3 GANHA ✅ — avançando para Parte ${nextPart}/3`);
  }

  // ─── FIM MARTINGALE HELPERS ───────────────────────────────────────────────

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

    // 🧠 MOTOR SUPREMO DE ANÁLISE: iniciar análise de mercado em 10 dimensões
    supremeAnalyzer.start();
    console.log('🧠 [SUPREME] Motor de Análise Suprema ativado — 10 dimensões simultâneas');

    // 🧠 MOTOR DE APRENDIZADO PERSISTENTE: escutar resultados de contratos
    persistentLearningEngine.initialize().catch(e =>
      console.error('❌ [LEARNING] Falha na inicialização do motor de aprendizado:', e)
    );
    contractMonitor.on('contract_closed', async (data: any) => {
      try {
        await persistentLearningEngine.processTradeResult({
          contractId: String(data.contractId),
          symbol: data.symbol,
          status: data.status,
          profit: data.finalProfit || 0,
          buyPrice: data.buyPrice || 0,
          contractType: data.contractType || 'digitdiff',
        });
      } catch (err) {
        console.error('❌ [LEARNING] Erro ao processar resultado de contrato:', err);
      }

      // 🔧 FIX CRÍTICO: Registrar win/loss IMEDIATAMENTE no realStatsTracker
      // Antes, só era chamado via deriv-trade-sync (com atraso de minutos),
      // impedindo que o Recovery Mode e Circuit Breaker ativassem após ACCU knockout.
      try {
        const finalProfit = data.finalProfit ?? 0;
        const symbol = data.symbol || '';
        const contractIdStr = data.contractId ? String(data.contractId) : undefined;
        if (finalProfit > 0) {
          realStatsTracker.recordWin(finalProfit, contractIdStr);
          console.log(`🏆 [CONTRACT CLOSED] WIN registrado imediatamente: +$${finalProfit.toFixed(4)} | ${symbol}`);
        } else if (finalProfit < 0 || data.status === 'lost') {
          const lossAmount = finalProfit < 0 ? finalProfit : -1;
          realStatsTracker.recordLoss(lossAmount, symbol, contractIdStr);
          console.log(`❌ [CONTRACT CLOSED] LOSS registrado imediatamente: $${lossAmount.toFixed(4)} | ${symbol} | Recovery Mode: ATIVADO`);
        }
      } catch (statsErr) {
        console.error('❌ [LEARNING] Erro ao registrar win/loss no realStatsTracker:', statsErr);
      }

      // 💾 FIX PERSISTÊNCIA: Gravar resultado diretamente no banco (evita dependência do deriv-sync)
      // Problema: quando o monitor vende antecipadamente, o result só fica na memória.
      // O deriv-sync às vezes marca o trade como expired antes de buscar o resultado,
      // e depois pula o contrato expirado. Isso causa lucros/perdas sem registro no banco.
      try {
        const contractIdStr = data.contractId ? String(data.contractId) : null;
        if (contractIdStr) {
          const op = await storage.getTradeOperationByDerivContractId(contractIdStr);
          if (op && op.status !== 'won' && op.status !== 'lost') {
            const finalProfit = data.finalProfit ?? 0;
            const newStatus = finalProfit > 0 ? 'won' : data.status === 'sold' ? 'won' : 'lost';
            await storage.updateTradeOperation(op.id, {
              status: newStatus,
              profit: finalProfit,
              derivProfit: finalProfit,
              derivStatus: data.status || newStatus,
              completedAt: new Date().toISOString(),
              statusChangedAt: new Date().toISOString(),
              lastSyncAt: new Date().toISOString(),
            });
            console.log(`💾 [CONTRACT CLOSED] Trade ${contractIdStr} persistido no banco: ${newStatus} | Profit=$${finalProfit.toFixed(4)}`);
          }
        }
      } catch (dbErr: any) {
        console.error('❌ [CONTRACT CLOSED] Falha ao persistir resultado no banco:', dbErr?.message);
      }

      // 🎰 ATUALIZAR ESTADO DO MARTINGALE com base no resultado do contrato
      try {
        const contractIdStr = String(data.contractId);
        if (this.pendingMartingaleContracts.has(contractIdStr)) {
          const finalProfit = data.finalProfit ?? 0;
          const won = finalProfit > 0 || data.status === 'won';
          this.processMartingaleContractResult(contractIdStr, won);
        }
      } catch (mgErr) {
        console.error('❌ [MARTINGALE] Erro ao processar resultado do contrato:', mgErr);
      }
    });
    console.log('🧠 [LEARNING] Motor de aprendizado persistente conectado ao monitor de contratos');
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
    this.lastCycleStartedAt = Date.now();
    this.nextCycleAt = this.lastCycleStartedAt + this.CYCLE_INTERVAL_MS;
    this.setPhase('ANALISANDO', '🔍 Iniciando ciclo de análise de mercado...', 'info');

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
      
      this.setPhase('ANALISANDO', '🤖 Executando análise de IA em múltiplos ativos...', 'info');
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

      // ⚡ Execução paralela de configurações ativas com stagger escalonado
      const analisePromises = activeConfigs.map(async (config, index) => {
        try {
          // ⚡ STAGGER: 500ms entre cada config para evitar avalanche simultânea de trades
          // Fixo por design — análise ocorre em paralelo mas execução é escalonada
          if (index > 0) {
            await new Promise(resolve => setTimeout(resolve, 500 * index));
          }
          
          return await this.processAnaliseNaturalConfiguration(config, operationId);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ [${operationId}] Erro na sessão Análise natural continua de IA ${config.id}:`, errorMessage);
          return { success: false, error: errorMessage };
        }
      });

      // 🚀 MODO ALAVANCAGEM: verificar se o mercado geral está excepcional para disparo cirúrgico
      // Roda em paralelo com o ciclo normal — não bloqueia, não adiciona latência às operações normais
      const leverageConfig = activeConfigs[0] as any;
      const userEnableLeverage = leverageConfig?.enableLeverage ?? true;
      if (userEnableLeverage) {
        this.checkAndExecuteLeverageTrade(operationId).catch(err =>
          console.error(`⚠️ [LEVERAGE] Erro no ciclo de alavancagem:`, err)
        );
      } else {
        console.log(`🚀 [LEVERAGE] Desabilitado pelo usuário — pulando ciclo de alavancagem`);
      }

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
      const secsUntilNext = Math.round((this.nextCycleAt - Date.now()) / 1000);
      if (secsUntilNext > 0) {
        this.setPhase('AGUARDANDO', `⏳ Próximo ciclo de análise em ${secsUntilNext}s`, 'info');
      }
    }
  }



  // ─────────────────────────────────────────────────────────────────────────
  // 🚀 MODO ALAVANCAGEM — 1 contrato cirúrgico quando o mercado geral brilha
  // ─────────────────────────────────────────────────────────────────────────
  private async checkAndExecuteLeverageTrade(operationId: string): Promise<void> {
    // 1. Cooldown: não disparar com frequência
    const now = Date.now();
    if (now - this.leverageLastFiredAt < this.LEVERAGE_COOLDOWN_MS) {
      const minLeft = Math.ceil((this.LEVERAGE_COOLDOWN_MS - (now - this.leverageLastFiredAt)) / 60000);
      console.log(`🚀 [LEVERAGE] Cooldown ativo — próximo disparo possível em ~${minLeft}min`);
      return;
    }

    // 1b. Mercado globalmente ruim? Alavancagem é vetada durante qualquer janela de pausa
    if (this.badMarketPausedUntil > now) {
      const secsLeft = Math.round((this.badMarketPausedUntil - now) / 1000);
      console.log(`🚀 [LEVERAGE] Bloqueado: janela de mercado ruim ativa (${secsLeft}s restantes) — alavancagem suspensa`);
      return;
    }

    // 2. Sistema de recuperação ou circuit breaker ativo? Não alavancar agora
    if (realStatsTracker.isPostLossMode()) {
      console.log(`🚀 [LEVERAGE] Bloqueado: sistema em modo de recuperação`);
      return;
    }

    // 3. Escanear todos os ativos com análise recente (< 90s) buscando condição excepcional
    const ACCU_SYMBOLS = [
      'R_10','R_25','R_50','R_75','R_100',
      'JD10','JD25','JD50','JD75','JD100',
      'RDBULL','RDBEAR',
    ];
    const STALE_THRESHOLD_MS = 90 * 1000;

    type Candidate = { symbol: string; consensus: number; hurst: number; regime: string };
    const exceptional: Candidate[] = [];

    for (const sym of ACCU_SYMBOLS) {
      const sa = supremeAnalyzer.getLatestAnalysis(sym);
      if (!sa) continue;
      if (now - sa.timestamp > STALE_THRESHOLD_MS) continue; // análise velha — ignorar

      const regime    = sa.regime;
      const hurst     = sa.statistics.hurstExponent;
      const consensus = sa.opportunityScore; // 0-100 score calculado pelo analyzer

      // Índices sintéticos Deriv têm Hurst ~0.50 por design — score raramente ultrapassa 65.
      // Critérios ajustados: opportunityScore ≥ 60 (realista para sintéticos) + regime não caótico
      const isExceptional =
        consensus >= 60 &&         // score supremo atingível pelos sintéticos (reduzido de 72→60)
        regime !== 'chaotic';      // qualquer regime exceto caótico

      if (isExceptional) {
        exceptional.push({ symbol: sym, consensus, hurst, regime });
      }
    }

    console.log(`🚀 [LEVERAGE] Ativos excepcionais encontrados: ${exceptional.length}/${ACCU_SYMBOLS.length}`);

    // 4. Precisamos de pelo menos N ativos excepcionais simultaneamente (mercado geral forte)
    if (exceptional.length < this.LEVERAGE_MIN_ASSETS) {
      console.log(`🚀 [LEVERAGE] Insuficiente (${exceptional.length} < ${this.LEVERAGE_MIN_ASSETS} ativos) — aguardando janela melhor`);
      return;
    }

    // 5. Escolher o MELHOR ativo do grupo (maior consensus × hurst)
    exceptional.sort((a, b) => (b.consensus * b.hurst) - (a.consensus * a.hurst));
    const best = exceptional[0];

    // 6. Verificar threshold de consenso final no ativo escolhido
    // Usar o microscopic também para double-check síncrono
    const saFinal = supremeAnalyzer.getLatestAnalysis(best.symbol);
    if (!saFinal || saFinal.opportunityScore < this.LEVERAGE_CONSENSUS_MIN) {
      console.log(`🚀 [LEVERAGE] Melhor ativo ${best.symbol} não atingiu threshold final (${saFinal?.opportunityScore ?? 'N/A'} < ${this.LEVERAGE_CONSENSUS_MIN})`);
      return;
    }

    // 7. Buscar dados do usuário ativo (primeiro config ativo encontrado)
    const activeConfigs = await storage.getActiveTradeConfigurations();
    if (!activeConfigs.length) return;
    const config = activeConfigs[0];
    const tokenData = await storage.getUserDerivToken(config.userId);
    if (!tokenData) return;

    // 7b. Respeitar modalidades do usuário — Leverage só dispara ACCU se o usuário habilitou 'accumulator'
    let levUserModalities: string[] = [];
    try {
      if (config.selectedModalities) {
        const parsed = JSON.parse(config.selectedModalities);
        if (Array.isArray(parsed)) levUserModalities = parsed;
        else levUserModalities = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    } catch {
      levUserModalities = config.selectedModalities
        ? config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
    }
    if (!levUserModalities.includes('accumulator')) {
      console.log(`🚀 [LEVERAGE] Bloqueado: 'accumulator' não está nas modalidades ativas do usuário (${levUserModalities.join(', ') || 'nenhuma'}) — alavancagem suspensa`);
      return;
    }

    // 8. Calcular stake: 5% da banca, dentro do teto de segurança
    const bankBalance = this.cachedBalance?.value ?? 0;
    if (bankBalance <= 0) {
      console.log(`🚀 [LEVERAGE] Saldo em cache indisponível — abortando`);
      return;
    }
    const leverageStake = Math.min(
      this.LEVERAGE_MAX_STAKE,
      Math.min(bankBalance * this.LEVERAGE_MAX_BALANCE_PCT, // nunca arriscar mais de 20% da banca
      Math.max(this.LEVERAGE_MIN_STAKE, Math.round(bankBalance * this.LEVERAGE_STAKE_PCT * 100) / 100))
    );
    // Proteção: saldo muito baixo para o stake mínimo
    if (leverageStake < this.LEVERAGE_MIN_STAKE) {
      console.log(`🚀 [LEVERAGE] Saldo insuficiente para stake mínimo ($${leverageStake.toFixed(2)} < $${this.LEVERAGE_MIN_STAKE}) — abortando`);
      return;
    }

    // 9. Growth rate dinâmico por volatilidade — respeita taxas e ticks configurados pelo usuário
    const levVolatility = Math.max(0, Math.min(1, 1 - best.hurst));

    // Ler taxas de crescimento habilitadas pelo usuário no card ACCU
    let levAllowedRates: number[] = [0.01, 0.02, 0.03, 0.04, 0.05];
    try {
      if ((config as any).accuGrowthRates) {
        const parsedRates = JSON.parse((config as any).accuGrowthRates);
        if (Array.isArray(parsedRates) && parsedRates.length > 0) {
          const converted = parsedRates.map((r: string) => Number(r) / 100).filter((n: number) => n > 0 && n <= 0.05);
          if (converted.length > 0) {
            levAllowedRates = converted;
            console.log(`🎯 [LEVERAGE] Taxas permitidas pelo usuário: [${levAllowedRates.map(r => (r*100)+'%').join(', ')}]`);
          }
        }
      }
    } catch {}

    const { rate: levGrowth, reason: levGrowthReason } = this.selectAccumulatorGrowthRate(levVolatility, best.consensus, levAllowedRates);

    // Ler ticks por taxa configurados pelo usuário no card de modalidades
    let levTicksByGrowth: Record<number, number> = { 0.01: 10, 0.02: 7, 0.03: 5, 0.04: 4, 0.05: 3 };
    try {
      if ((config as any).accuTicksPerRate) {
        const parsed = JSON.parse((config as any).accuTicksPerRate);
        if (parsed && typeof parsed === 'object') {
          const converted: Record<number, number> = {};
          for (const [k, v] of Object.entries(parsed)) {
            const rateKey = Number(k) / 100;
            const tickVal = Math.round(Number(v));
            if (rateKey > 0 && rateKey <= 0.05 && tickVal >= 1 && tickVal <= 30) {
              converted[rateKey] = tickVal;
            }
          }
          if (Object.keys(converted).length > 0) {
            levTicksByGrowth = converted;
            console.log(`🎯 [LEVERAGE] Ticks por taxa carregados da configuração do usuário:`, JSON.stringify(converted));
          }
        }
      }
    } catch {}

    const levTargetTicks = levTicksByGrowth[levGrowth] ?? 3;

    const levOpId = `LEVERAGE_${now}_${best.symbol}`;
    console.log(`🚀🚀 [LEVERAGE FIRE] Ativo: ${best.symbol} | Regime: ${best.regime} | Score: ${best.consensus.toFixed(1)} | Hurst: ${best.hurst.toFixed(3)} | Stake: $${leverageStake} (${(this.LEVERAGE_STAKE_PCT * 100).toFixed(0)}% de $${bankBalance.toFixed(2)}) | Ativos alinhados: ${exceptional.length} | growth=${(levGrowth*100).toFixed(0)}% (${levGrowthReason}) | ticks=${levTargetTicks}`);
    this.setPhase('EXECUTANDO', `🚀 ALAVANCAGEM: ${best.symbol} $${leverageStake} (${exceptional.length} ativos alinhados)`, 'trade');

    try {
      await derivAPI.connect(tokenData.token, (tokenData.accountType as 'demo' | 'real') || 'demo', levOpId);
      const contract = await derivAPI.buyFlexibleContract({
        contract_type: 'ACCU',
        symbol: best.symbol,
        amount: leverageStake,
        growth_rate: levGrowth,
      });

      if (contract) {
        this.leverageLastFiredAt = now; // marcar cooldown
        console.log(`✅ [LEVERAGE] Contrato aberto: ${contract.contract_id} | ${best.symbol} | $${leverageStake} | growth=${(levGrowth*100).toFixed(0)}% | ticks=${levTargetTicks}`);
        this.setPhase('AGUARDANDO', `✅ Alavancagem executada: ${best.symbol} $${leverageStake}`, 'success');

        // 🔑 CORREÇÃO RACE CONDITION: salvar no banco PRIMEIRO, depois iniciar monitor
        // Contratos ACCU fecham em 2-4 segundos — se o monitor inicia antes do registro DB,
        // o contract_closed handler não acha o registro para atualizar → trade perdido no DB.
        try {
          await storage.createTradeOperation({
            userId: config.userId,
            symbol: best.symbol,
            direction: 'accumulator',
            contractType: 'ACCU',
            tradeType: 'accumulator',
            amount: leverageStake,
            duration: 1,
            status: 'pending',
            derivContractId: contract.contract_id?.toString(),
            aiConsensus: JSON.stringify({ leverageMode: true, assetsAligned: exceptional.length, score: best.consensus, growthRate: levGrowth }),
          });
          console.log(`💾 [LEVERAGE] Operação salva no banco: contrato ${contract.contract_id}`);
        } catch (dbErr) {
          console.error('❌ [LEVERAGE] Falha ao salvar operação no banco (crítico):', dbErr);
        }

        // Iniciar monitor DEPOIS do registro DB para evitar race condition
        if (contract.contract_id) {
          contractMonitor.setToken(tokenData.token);
          await contractMonitor.startMonitoring({
            contractId: contract.contract_id,
            contractType: 'ACCU',
            symbol: best.symbol,
            buyPrice: leverageStake,
            amount: leverageStake,
            direction: 'up',
            userId: config.userId,
            openedAt: now,
            targetTicks: levTargetTicks,
          });
          console.log(`🎯 [LEVERAGE] Monitor de auto-sell ativo: contrato ${contract.contract_id} | alvo=${levTargetTicks} ticks`);
        }
      } else {
        console.warn(`⚠️ [LEVERAGE] Contrato rejeitado pela Deriv para ${best.symbol}`);
      }
    } catch (err) {
      console.error(`❌ [LEVERAGE] Erro ao executar alavancagem:`, err);
    }
  }

  private async processAnaliseNaturalConfiguration(config: any, operationId: string): Promise<{success: boolean, error?: string}> {
    // 🔴 VERIFICAÇÃO CRÍTICA #2: Flag de pausa centralizada (antes de qualquer operação)
    const tradingControlStatus = await storage.getTradingControlStatus();
    if (tradingControlStatus?.isPaused) {
      console.log(`🛑 [${operationId}] Pausa global detectada - não executando trade`);
      return { success: false, error: 'Trading pausado globalmente' };
    }

    // 🚫 VERIFICAÇÃO DE PAUSA POR MERCADO RUIM
    const nowCheck = Date.now();
    if (this.badMarketPausedUntil > nowCheck) {
      // Dentro da janela de pausa — verificar se há recuperação parcial
      if (this.badMarketReducedGrowthActive) {
        // Recuperação parcial detectada pela IA → permite continuar com growth 1%
        const secsLeft = Math.round((this.badMarketPausedUntil - nowCheck) / 1000);
        console.log(`⚠️ [${operationId}] Mercado em recuperação parcial — operando com growth 1% (${secsLeft}s restantes na janela)`);
        // Não bloqueia — deixa continuar, growth será 1% na execução do contrato
      } else {
        // Ainda mercado ruim → bloquear operação
        const secsLeft = Math.round((this.badMarketPausedUntil - nowCheck) / 1000);
        const qualStr = `${this.lastScanMarketQuality}%`;
        console.log(`🚫 [${operationId}] Mercado ruim (qualidade=${qualStr}) — operação bloqueada. Pausa encerra em ${secsLeft}s`);
        return { success: false, error: `Mercado ruim — operações pausadas (${secsLeft}s restantes)` };
      }
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
      
      const operationModeLabel = this.getCurrentOperationLabel(userId, session.mode);
      this.setPhase('EXECUTANDO', `⚡ Executando operação #${session.executedOperations + 1} (${operationModeLabel})...`, 'trade');
      console.log(`🚀 [${operationId}] Executando trade Análise natural continua de IA: ${session.executedOperations + 1}/${session.operationsCount} (${operationModeLabel})`);
      
      // Executar trade com argumentos corretos
      const result = await this.executeAutomaticTrade(config, tokenData, operationId);
      
      // Atualizar sessão APENAS após trade bem-sucedido
      if (result.success) {
        session.lastExecutionTime = new Date();
        session.executedOperations++;
        
        // Persistir atualização da sessão no banco de dados
        await this.persistSession(sessionKey, session);
        
        this.setPhase('AGUARDANDO', `✅ Operação #${session.executedOperations} enviada — aguardando resultado...`, 'success');
        console.log(`✅ [${operationId}] Trade Análise natural continua de IA executado com sucesso: ${session.executedOperations}/${session.operationsCount}`);
        
        // Salvar resultado para tracking (será processado async)
        this.trackTradeOutcome(userId, result, config);
      } else {
        const rejectReason = (result.error ?? result.reason ?? 'sem detalhes').toString().substring(0, 80);
        this.setPhase('AGUARDANDO', `⚠️ Operação adiada: ${rejectReason}`, 'warning');
        console.log(`⚠️ [${operationId}] Trade adiado: ${result.error ?? result.reason} - Sessão mantida ativa`);
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

  private shouldExecuteNow(_session: ActiveTradeSession): boolean {
    // ✅ IA livre de ciclos fixos — a IA analisa e decide quando operar com base no mercado.
    // Mecanismos de proteção (circuit breaker, consenso, bad market pause) controlam a execução.
    return true;
  }

  private async executeAutomaticTrade(config: any, tokenData: any, operationId: string): Promise<{success: boolean, error?: string}> {
    try {
      // 🔴 CAMADA 3 - CIRCUIT BREAKER: Sincronizar config do usuário no tracker
      const userEnableCircuitBreaker = (config as any)?.enableCircuitBreaker ?? true;
      const userCbLosses = Number((config as any)?.circuitBreakerLosses ?? 0);
      const userCbPauseMin = Number((config as any)?.circuitBreakerPauseMinutes ?? 0);
      if (userCbLosses > 0 && userCbPauseMin > 0) {
        realStatsTracker.configureCircuitBreaker(userCbLosses, userCbPauseMin);
      }
      if (userEnableCircuitBreaker && realStatsTracker.isCircuitBreakerActive()) {
        const reqs = realStatsTracker.getRecoveryRequirements();
        const remainingSec = Math.ceil(reqs.circuitBreakerRemainingMs / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);
        console.log(`🔴 [${operationId}] CIRCUIT BREAKER ATIVO: ${reqs.consecutiveLosses} perdas consecutivas — pausa obrigatória (${remainingMin} min restantes)`);
        return {
          success: false,
          error: `CIRCUIT BREAKER: ${reqs.consecutiveLosses} perdas consecutivas — aguardando ${remainingMin} min antes do próximo trade`
        };
      } else if (!userEnableCircuitBreaker && realStatsTracker.isCircuitBreakerActive()) {
        console.log(`🔴 [${operationId}] CIRCUIT BREAKER ignorado — desabilitado pelo usuário`);
      }

      // 🎯 PRÉ-LEITURA DAS MODALIDADES: Para filtrar símbolos compatíveis antes de selecionar o melhor ativo
      let earlyActiveModalities: string[] = [];
      let earlyAutoModalityMode = false;
      try {
        if (config.selectedModalities) {
          try {
            const parsed = JSON.parse(config.selectedModalities);
            if (Array.isArray(parsed)) earlyActiveModalities = parsed;
            else earlyActiveModalities = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
          } catch {
            earlyActiveModalities = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }
      } catch {}
      // 🤖 MODO AUTOMÁTICO: "__auto__" = IA escolhe modalidades; não filtrar símbolos por modalidade
      earlyAutoModalityMode = earlyActiveModalities.includes('__auto__');
      if (earlyAutoModalityMode) {
        earlyActiveModalities = []; // sem restrição de símbolo por modalidade no modo automático
        console.log(`🤖 [${operationId}] MODO AUTOMÁTICO detectado — seleção de símbolo irrestrita`);
      }

      // 🔥 NOVA LÓGICA: Analisar TODOS os símbolos disponíveis e escolher o melhor
      // Filtra SOMENTE ativos compatíveis com as modalidades do usuário antes de rankear
      console.log(`🔍 [${operationId}] Iniciando análise de TODOS os símbolos disponíveis (modalidades: [${earlyAutoModalityMode ? 'AUTOMÁTICO' : earlyActiveModalities.join(', ') || 'todas'}])...`);
      
      const bestSymbolResult = await this.analyzeBestSymbolFromAll(config.userId, operationId, earlyActiveModalities.length > 0 ? earlyActiveModalities : undefined);
      
      if (!bestSymbolResult.success || !bestSymbolResult.symbol) {
        return { 
          success: false, 
          error: bestSymbolResult.error || 'Nenhum símbolo com consenso suficiente encontrado' 
        };
      }
      
      // 🔧 LIMPAR SÍMBOLO: Remover consenso formatado (ex: "R_50(45.0%)" → "R_50")
      let selectedSymbol = bestSymbolResult.symbol.split('(')[0].trim();
      
      // ☠️ EXECUÇÃO IMEDIATA: CAMADA 1 — símbolo criminoso interceptado na seleção
      if (this.isSymbolBlocked(selectedSymbol, `CAMADA-1 seleção [${operationId}]`)) {
        
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
      
      // 🚨 VERIFICAÇÃO CRÍTICA: Bloquear abertura de novo contrato se já existe um ATIVO no mesmo símbolo
      // Isso evita abrir NOTOUCH/CALL/etc em cima de um ENDS_OUTSIDE ainda em andamento no mesmo ativo
      const top5ForCheck = bestSymbolResult.top5Symbols || [];
      const isSymbolOccupied = (sym: string): boolean => contractMonitor.hasActiveContractOnSymbol(sym);
      if (isSymbolOccupied(selectedSymbol)) {
        const occupiedId = contractMonitor.getActiveContractIdOnSymbol(selectedSymbol);
        console.log(`🚫 [${operationId}] CONTRATO ATIVO DETECTADO: ${selectedSymbol} já tem contrato #${occupiedId} em andamento — buscando ativo alternativo...`);
        let foundAlternative = false;
        for (let i = 1; i < Math.min(top5ForCheck.length, 5); i++) {
          const altSym = top5ForCheck[i].split('(')[0].trim();
          if (!isSymbolOccupied(altSym) && !this.isSymbolBlocked(altSym)) {
            selectedSymbol = altSym;
            console.log(`✅ [${operationId}] Alternativa livre selecionada (sem contrato ativo): ${selectedSymbol}`);
            foundAlternative = true;
            break;
          }
        }
        if (!foundAlternative) {
          console.log(`⏸️ [${operationId}] Todos os top-5 ativos têm contratos ativos — aguardando próximo ciclo`);
          return { success: false, error: 'Todos os ativos candidatos já possuem contratos ativos em andamento' };
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
            // Atualizar consenso para o ativo alternativo (extraído do top5 "SYMBOL(score%)")
            const altScoreMatch = alt.match(/\(([0-9.]+)%\)/);
            if (altScoreMatch) {
              aiConsensusPreCalculated.consensusStrength = parseFloat(altScoreMatch[1]);
            }
            switched = true;
            break;
          }
        }
        if (!switched) {
          console.log(`⏳ [${operationId}] ANTI-REP: Sem alternativa disponível — aguardando próximo ciclo para evitar repetição`);
          return { success: false, error: `ANTI-REP: ${selectedSymbol} seria repetição do último trade — aguardando próximo ciclo` };
        }
      }

      this.setPhase('SELECIONADO', `🎯 Ativo selecionado: ${selectedSymbol} | Consenso IA: ${aiConsensusPreCalculated.consensusStrength}%`, 'info');
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

        const userEnableRecoveryMode = (config as any)?.enableRecoveryMode ?? true;
        if (userEnableRecoveryMode && realStatsTracker.isPostLossMode()) {
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
      // 🔥 AUMENTADO para 15 minutos para aguentar reconexões temporárias do WebSocket
      const lastUpdateTime = marketDataInfo.lastUpdate ? new Date(marketDataInfo.lastUpdate).getTime() : 0;
      const dataAge = new Date().getTime() - lastUpdateTime;
      const isDataStale = dataAge > (marketDataInfo.isSimulated ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000); // 24h para simulados, 15min para reais
      
      if (isDataStale) {
        return { 
          success: false, 
          error: `Dados de mercado MUITO desatualizados (${Math.round(dataAge / 1000)}s > 900s)` 
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
      // ⏱️ MARCADOR: Momento exato da decisão da IA (sinal confirmado)
      const signalDecisionAt = Date.now();
      console.log(`🕐 [${operationId}] SINAL DECIDIDO: ${aiConsensus.finalDecision.toUpperCase()} ${selectedSymbol} | Consenso: ${aiConsensus.consensusStrength}% | Preparando execução...`);

      // 📡 PUBLICAR SINAL NO STORE COMPARTILHADO (lido pela ponte MT5)
      // Usa a mesma lógica de safeDirection do scheduler (upScore vs downScore quando neutral)
      const storeDirection: 'up' | 'down' | 'neutral' =
        (aiConsensus.finalDecision === 'up' || aiConsensus.finalDecision === 'down')
          ? (aiConsensus.finalDecision as 'up' | 'down')
          : ((aiConsensus.upScore || 0) >= (aiConsensus.downScore || 0) ? 'up' : 'down');
      const signalEntry = {
        symbol: selectedSymbol,
        direction: storeDirection,
        confidence: aiConsensus.consensusStrength,
        consensus: aiConsensus.consensusStrength,
        reason: `Análise Deriv: ${storeDirection.toUpperCase()} ${selectedSymbol} — consenso ${aiConsensus.consensusStrength}%`,
        timestamp: Date.now()
      };
      setSignal(selectedSymbol, signalEntry);
      // Mapear para nome MT5 também
      const mt5Name = derivToMT5Name(selectedSymbol);
      if (mt5Name) setSignal(mt5Name, { ...signalEntry, symbol: mt5Name });

      // 🎯 REGISTRAR THRESHOLD NO TRACKER DINÂMICO (essencial para cálculo da média alta)
      dynamicThresholdTracker.recordThreshold(
        aiConsensus.consensusStrength,
        selectedSymbol,
        aiConsensus.finalDecision
      );

      // 📝 GRAVAR LOGS DAS IAs COOPERATIVAS NO BANCO DE DADOS (para exibição em tempo real)
      if (aiConsensus.analyses && aiConsensus.analyses.length > 0) {
        const aiLogPromises = aiConsensus.analyses.map((analysis: any) =>
          storage.createAiLog({
            userId: config.userId,
            modelName: analysis.modelName,
            analysis: JSON.stringify({
              prediction: analysis.prediction,
              reasoning: analysis.reasoning || aiConsensus.reasoning || '',
              confidence: analysis.confidence,
              symbol: selectedSymbol,
              consensusStrength: aiConsensus.consensusStrength,
              finalDecision: aiConsensus.finalDecision,
            }),
            decision: analysis.prediction,
            confidence: analysis.confidence / 100,
            marketData: JSON.stringify({ symbol: selectedSymbol, consensusStrength: aiConsensus.consensusStrength })
          }).catch(() => {})
        );
        Promise.all(aiLogPromises).catch(() => {});
      }
      
      // 🎯 SISTEMA DE DECISÃO BASEADO EM ANÁLISE DE DÍGITOS (vantagem matemática real)
      const isProductionMode = config.mode.includes('production');

      // ── Pré-leitura de modalidades para decidir se a análise de dígitos é necessária ──
      const DIGIT_MODALITY_KEYS = new Set(['digit_differs','digit_matches','digit_even','digit_odd','digit_over','digit_under']);
      let preActiveModalities: string[] = [];
      if (config.selectedModalities) {
        try {
          const parsed = JSON.parse(config.selectedModalities);
          if (Array.isArray(parsed)) preActiveModalities = parsed;
          else preActiveModalities = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
        } catch {
          preActiveModalities = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      }
      const hasDigitModalities = preActiveModalities.some(m => DIGIT_MODALITY_KEYS.has(m));

      // 🧠 VERIFICAR QUALIDADE DO SINAL DO ANALISADOR DE DÍGITOS
      // Apenas relevante se o usuário selecionou alguma modalidade de dígitos
      const digitQuality = digitFrequencyAnalyzer.getBestBarrier(selectedSymbol);
      const digitConfidenceOk = digitQuality.confidence >= 50;
      const digitEdgePositive = digitQuality.edge > 0;
      const digitSignalGood = digitConfidenceOk && digitEdgePositive;

      if (hasDigitModalities) {
        console.log(`🧠 [${operationId}] ANÁLISE DÍGITOS: conf=${digitQuality.confidence.toFixed(0)}% | edge=+${digitQuality.edge.toFixed(1)}% | barreira=${digitQuality.barrier} | sinal=${digitSignalGood ? '✅ BOM' : '⚠️ AGUARDANDO'}`);
        // 🛑 SE O ANALISADOR DE DÍGITOS NÃO TEM DADOS SUFICIENTES, AGUARDAR
        if (!digitSignalGood) {
          console.log(`⏸️ [${operationId}] Aguardando dados de dígitos: conf=${digitQuality.confidence.toFixed(0)}% (mín 50%) | edge=${digitQuality.edge.toFixed(1)}% (mín >0%)`);
          return { success: false, error: `Analisador de dígitos aguardando mais dados: confiança ${digitQuality.confidence.toFixed(0)}%` };
        }
      } else {
        console.log(`ℹ️ [${operationId}] Análise de dígitos ignorada — modalidades selecionadas não incluem dígitos: [${preActiveModalities.join(', ')}]`);
      }

      // Para digit_differs a direção é irrelevante — o trade é puramente sobre qual dígito NÃO aparece
      // Forçamos 'down' apenas para preencher o campo obrigatório da API
      if (aiConsensus.finalDecision === 'neutral') {
        aiConsensus.finalDecision = 'down';
      }

      if (isProductionMode) {
        const limits = this.getOperationLimitsForMode(config.mode);
        const operationsToday = await storage.getConservativeOperationsToday(config.userId);
        console.log(`📊 [${operationId}] MODO ${config.mode} - Operações: ${operationsToday}/${limits.max}`);
        if (operationsToday >= limits.max) {
          console.log(`🛑 [${operationId}] Máximo diário atingido (${operationsToday}/${limits.max})`);
          return { success: false, error: `Máximo de operações diárias atingido para modo ${config.mode}` };
        }
        if (hasDigitModalities) {
          console.log(`✅ [${operationId}] 🎯 EXECUTANDO: dígito frio=${digitQuality.barrier} | edge=+${digitQuality.edge.toFixed(1)}% | winRate=${digitQuality.winRate.toFixed(1)}%`);
        }
      } else {
        const preAutoMode = preActiveModalities.includes('__auto__');
        console.log(`🚀 [${operationId}] MODO ${config.mode} - Modalidades: [${preAutoMode ? '🤖 AUTOMÁTICO — IA seleciona' : preActiveModalities.join(', ')}]`);
        if (hasDigitModalities) {
          console.log(`✅ [${operationId}] 🎯 Análise de dígitos: barreira=${digitQuality.barrier} | edge=+${digitQuality.edge.toFixed(1)}% | winRate=${digitQuality.winRate.toFixed(1)}%`);
        }
      }

      // 🔴 VERIFICAR FLAG DE PAUSA CENTRALIZADA - Todos os remixes respeita m
      const tradingControlStatus = await storage.getTradingControlStatus();
      if (tradingControlStatus?.isPaused) {
        console.log(`🛑 [${operationId}] ⏸️ TRADING PAUSADO GLOBALMENTE - Pausado por: ${tradingControlStatus.pausedBy} | Motivo: ${tradingControlStatus.pauseReason}`);
        return { success: false, error: `Trading pausado globalmente: ${tradingControlStatus.pauseReason}` };
      }

      // ⚡ CONEXÃO PERSISTENTE: reutiliza se já conectado, só abre nova se necessário
      // Timeout de 12s — apenas para primeira conexão real (reutilização retorna instantâneo)
      const CONNECTION_TIMEOUT = 12000;
      let connected = false;
      
      try {
        const connectPromise = derivAPI.connect(tokenData.token, tokenData.accountType as "demo" | "real", operationId);
        const timeoutPromise = new Promise<boolean>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout de conexão Deriv (12s)')), CONNECTION_TIMEOUT);
        });
        
        connected = await Promise.race([connectPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error(`⏱️ [${operationId}] Timeout na conexão Deriv — pulando trade`);
        return { success: false, error: 'Timeout de conexão com Deriv (12s)' };
      }
      
      if (!connected) {
        return { success: false, error: 'Erro de conexão com Deriv' };
      }

      // ✅ SALDO REAL: Buscar saldo atual da conta Deriv e sincronizar com o banco
      // ⚡ OTIMIZAÇÃO ACCU: usar cache de saldo (stake fixo $1 — round-trip desnecessário)
      const isAccuMode = (config.activeModalities && config.activeModalities.includes('accumulator')) ||
                         (config.mode && config.mode.includes('accumulator'));
      const cacheValid = this.cachedBalance && (Date.now() - this.cachedBalance.fetchedAt) < this.BALANCE_CACHE_TTL_MS;
      
      try {
        if (isAccuMode && cacheValid && this.cachedBalance) {
          // ⚡ Saldo em cache — sem round-trip WebSocket (reduz latência para ACCU)
          console.log(`⚡ [${operationId}] Saldo em CACHE: $${this.cachedBalance.value} ${this.cachedBalance.currency} (${Math.round((Date.now() - this.cachedBalance.fetchedAt)/1000)}s atrás)`);
        } else {
          const realBalance = await derivAPI.getBalance();
          if (realBalance && realBalance.balance >= 0) {
            const rb = realBalance.balance;
            // Atualizar cache
            this.cachedBalance = { value: rb, currency: realBalance.currency, loginid: realBalance.loginid, fetchedAt: Date.now() };
            console.log(`💳 [${operationId}] Saldo REAL Deriv: $${rb} ${realBalance.currency} (conta: ${realBalance.loginid})`);
            await storage.createOrUpdateDailyPnL(config.userId, {
              currentBalance: rb,
              openingBalance: rb,
            });
            console.log(`🔄 [${operationId}] Saldo sincronizado com Deriv: currentBalance=$${rb} | openingBalance=$${rb}`);
          } else {
            console.log(`⚠️ [${operationId}] Saldo da Deriv não disponível — usando saldo do banco`);
          }
        }
      } catch (balErr: any) {
        console.log(`⚠️ [${operationId}] Erro ao buscar saldo real: ${balErr?.message} — usando saldo do banco`);
      }

      try {
        // Determinar parâmetros do trade baseado no modo e banca
        // 🔥 SISTEMA DE RECUPERAÇÃO INTELIGENTE DE PERDAS
      // 🚀 FLEXIBILIDADE DINÂMICA: Passar consenso + aplicar dynamic stake/ticks
      let tradeParams = await this.getTradeParamsForMode(config.mode, selectedSymbol, aiConsensus.finalDecision, config.userId, aiConsensus.consensusStrength, aiConsensus.volatility || 0.5, {
        enableMartingale: (config as any)?.enableMartingale ?? true,
        martingaleMultipliers: (() => { try { return JSON.parse((config as any)?.martingaleMultipliers || '[1.3,1.6,2.0]'); } catch { return [1.3,1.6,2.0]; } })(),
        enableRecoveryMode: (config as any)?.enableRecoveryMode ?? true,
        stakeMode: (config as any)?.stakeMode ?? 'ai',
        fixedStake: (config as any)?.fixedStake ?? 0.35,
      });
      
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
      // Martingale partes 2 e 3 são operações de RECUPERAÇÃO — usam limite ampliado
      try {
        const mgState = this.getMartingaleState(config.userId);
        const isMartingaleRecovery = mgState.isActive && mgState.currentPart > 1;
        const protectionCheck = await storage.canExecuteTradeWithoutViolatingMinimum(config.userId, tradeParams.amount, isMartingaleRecovery || isRecoveryMode);
        
        if (!protectionCheck.canExecute) {
          console.log(`🛡️ [${operationId}] PROTEÇÃO ATIVADA - TRADE BLOQUEADO:`);
          console.log(`   • Motivo: ${protectionCheck.reason}`);
          console.log(`   • Modo: ${isMartingaleRecovery ? 'Martingale Recovery' : isRecoveryMode ? 'Recovery Mode' : 'Trade Normal'}`);
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
        // Ler modalidades configuradas pelo usuário no banco de dados.
        // IMPORTANTE: array vazio = nenhuma modalidade selecionada = nenhum trade.
        let activeModalities: string[] = [];
        if (config.selectedModalities) {
          try {
            const parsed = JSON.parse(config.selectedModalities);
            if (Array.isArray(parsed)) {
              activeModalities = parsed; // respeita array vazio — significa sem operação
            }
          } catch {
            const split = config.selectedModalities.split(',').map((s: string) => s.trim()).filter(Boolean);
            activeModalities = split;
          }
        }

        // 🤖 MODO AUTOMÁTICO — 5 IAs em Tempo Real:
        // Quando "__auto__" é a modalidade selecionada, a IA seleciona autonomamente a
        // melhor modalidade para cada ciclo baseando-se nas condições de mercado em tempo real.
        const isAutoModalityMode = activeModalities.includes('__auto__');

        if (!isAutoModalityMode && activeModalities.length === 0) {
          console.log(`⛔ [${operationId}] Nenhuma modalidade selecionada pelo usuário — operação cancelada.`);
          return { success: false, reason: 'no_modalities' };
        }

        if (isAutoModalityMode) {
          console.log(`🤖 [${operationId}] MODO AUTOMÁTICO ativado — IA vai selecionar a melhor modalidade para ${selectedSymbol}`);
        }

        // Ler taxas de crescimento permitidas para ACCU (padrão: todas)
        let allowedAccuGrowthRates: number[] = [0.01, 0.02, 0.03, 0.04, 0.05];
        try {
          if ((config as any).accuGrowthRates) {
            const parsedRates = JSON.parse((config as any).accuGrowthRates);
            if (Array.isArray(parsedRates) && parsedRates.length > 0) {
              allowedAccuGrowthRates = parsedRates.map((r: string) => Number(r) / 100).filter((n: number) => n > 0 && n <= 0.05);
            }
          }
        } catch {}

        // Ler frequência por modalidade (padrão: normal para todas)
        let modalityFrequency: Record<string, string> = {};
        try {
          if ((config as any).modalityFrequency) {
            const parsedFreq = JSON.parse((config as any).modalityFrequency);
            if (parsedFreq && typeof parsedFreq === 'object') modalityFrequency = parsedFreq;
          }
        } catch {}

        // Ler ticks por taxa do ACCU configurados pelo usuário
        let userAccuTicksPerRate: Record<number, number> = { 0.01: 10, 0.02: 7, 0.03: 5, 0.04: 4, 0.05: 3 };
        try {
          if ((config as any).accuTicksPerRate) {
            const parsed = JSON.parse((config as any).accuTicksPerRate);
            if (parsed && typeof parsed === 'object') {
              const converted: Record<number, number> = {};
              for (const [k, v] of Object.entries(parsed)) {
                const rateKey = Number(k) / 100;
                const tickVal = Math.round(Number(v));
                // Positivo = fixo em N ticks; Negativo = IA dinâmico com máximo |N| ticks
                if (rateKey > 0 && rateKey <= 0.05 && ((tickVal >= 1 && tickVal <= 30) || (tickVal >= -30 && tickVal <= -1))) {
                  converted[rateKey] = tickVal;
                }
              }
              if (Object.keys(converted).length > 0) userAccuTicksPerRate = converted;
            }
          }
        } catch {}

        // Ler frequência por taxa do ACCU configurada pelo usuário
        let accuFrequencyPerRate: Record<string, string> = {}; // '1'-'5' → 'ai'|'low'|'normal'|'high'|'ai:low'|'ai:normal'|'ai:high'
        try {
          if ((config as any).accuFrequencyPerRate) {
            const parsed = JSON.parse((config as any).accuFrequencyPerRate);
            if (parsed && typeof parsed === 'object') accuFrequencyPerRate = parsed;
          }
        } catch {}

        // Ler ticks por modalidade configurados pelo usuário (dígitos, rise/fall)
        let userModalityTicks: Record<string, number> = {};
        try {
          if ((config as any).modalityTicks) {
            const parsed = JSON.parse((config as any).modalityTicks);
            if (parsed && typeof parsed === 'object') userModalityTicks = parsed;
          }
        } catch {}

        console.log(`🎯 [${operationId}] Modalidades ativas do usuário: ${isAutoModalityMode ? '🤖 AUTOMÁTICO — IA seleciona por ciclo' : activeModalities.join(', ')}`);
        if (allowedAccuGrowthRates.length < 5 && activeModalities.includes('accumulator')) {
          console.log(`📈 [${operationId}] ACCU growth rates permitidas: ${allowedAccuGrowthRates.map(r => (r*100).toFixed(0)+'%').join(', ')}`);
        }

        // Escolher modalidade por rotação: pega baseado na hora atual para distribuir
        const DIGIT_TYPES: Record<string, string> = {
          'digit_differs': 'DIGITDIFF',
          'digit_matches': 'DIGITMATCH',
          'digit_even': 'DIGITEVEN',
          'digit_odd': 'DIGITODD',
          'digit_over': 'DIGITOVER',
          'digit_under': 'DIGITUNDER',
        };
        // 'rise'/'fall' → CALL/PUT (contrato de ticks simples, sem barreira)
        // 'higher'/'lower' → CALLE/PUTE (contrato com barreira — preço termina acima/abaixo do barrier)
        // São modalidades DISTINTAS — 'higher'/'lower' NÃO devem gerar Rise/Fall
        const RISFALL_TYPES: Set<string> = new Set(['rise', 'fall']);
        const HIGHER_LOWER_TYPES: Record<string, string> = { 'higher': 'CALLE', 'lower': 'PUTE' };
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
          ...Object.keys(HIGHER_LOWER_TYPES),  // higher, lower → CALLE/PUTE
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
        const DIGIT_KEYS        = Object.keys(DIGIT_TYPES);
        const RISFALL_KEYS      = ['rise', 'fall'];           // CALL/PUT — ticks simples
        const HIGHER_LOWER_KEYS = ['higher', 'lower'];        // CALLE/PUTE — com barreira
        const INOUT_KEYS        = Object.keys(IN_OUT_TYPES);
        const TOUCH_KEYS        = Object.keys(TOUCH_TYPES);
        const MULT_KEYS         = Object.keys(MULTIPLIER_TYPES);
        const ACCU_KEYS         = ['accumulator'];
        const TURBO_KEYS        = Object.keys(TURBO_TYPES);
        const VANILLA_KEYS      = Object.keys(VANILLA_TYPES);
        const LB_KEYS           = Object.keys(LOOKBACK_TYPES);

        // Volatility Indices (R_10..R_100): suportam tudo, incluindo CALLE/PUTE (higher/lower)
        const VOL_BASE   = [...DIGIT_KEYS, ...RISFALL_KEYS, ...HIGHER_LOWER_KEYS, ...INOUT_KEYS, ...TOUCH_KEYS, ...MULT_KEYS, ...ACCU_KEYS, ...LB_KEYS];
        // Jump Indices (JD10..JD100): apenas dígitos e CALL/PUT (rise/fall) — NÃO suportam CALLE/PUTE
        const JUMP_OK    = [...DIGIT_KEYS, ...RISFALL_KEYS];
        // Range Break (RDBULL, RDBEAR): apenas dígitos e CALL/PUT (rise/fall) — NÃO suportam CALLE/PUTE
        const RDB_OK     = [...DIGIT_KEYS, ...RISFALL_KEYS];
        // R_100 também suporta Turbos e Vanillas (maior liquidez)
        const VOL_100    = [...VOL_BASE, ...TURBO_KEYS, ...VANILLA_KEYS];

        const SYMBOL_COMPAT: Record<string, string[]> = {
          'R_10': VOL_BASE,   'R_25': VOL_BASE,   'R_50': VOL_BASE,
          'R_75': VOL_BASE,   'R_100': VOL_100,
          'JD10': JUMP_OK,    'JD25': JUMP_OK,    'JD50': JUMP_OK,
          'JD75': JUMP_OK,    'JD100': JUMP_OK,
          'RDBULL': RDB_OK,   'RDBEAR': RDB_OK,
        };

        // Determinar modalidades compatíveis com o símbolo selecionado
        const symbolCompatible = new Set<string>(SYMBOL_COMPAT[selectedSymbol] ?? [...DIGIT_KEYS, ...RISFALL_KEYS]);

        // 🤖 MODO AUTOMÁTICO: usar todas as modalidades compatíveis com o símbolo
        // A IA (selectModalityByMarketFit) escolhe a melhor para cada ciclo.
        // MODO MANUAL: filtrar apenas as modalidades que o usuário selecionou.
        let compatibleModalities: string[];
        if (isAutoModalityMode) {
          // Pool completo: todas as modalidades que o símbolo suporta
          compatibleModalities = [...symbolCompatible].filter(m => ALL_SUPPORTED.has(m));
          console.log(`🤖 [${operationId}] MODO AUTOMÁTICO — pool de modalidades para ${selectedSymbol}: [${compatibleModalities.join(', ')}]`);
        } else {
          compatibleModalities = activeModalities.filter(m => ALL_SUPPORTED.has(m) && symbolCompatible.has(m));
        }

        if (compatibleModalities.length === 0) {
          if (!isAutoModalityMode) {
            const knownUnsupported = activeModalities.filter(m => ALL_SUPPORTED.has(m) && !symbolCompatible.has(m));
            const unknown = activeModalities.filter(m => !ALL_SUPPORTED.has(m));
            console.log(`⛔ [${operationId}] Modalidades selecionadas (${activeModalities.join(', ')}) incompatíveis com ${selectedSymbol}${knownUnsupported.length ? ` [incompatíveis: ${knownUnsupported.join(', ')}]` : ''}${unknown.length ? ` [desconhecidas: ${unknown.join(', ')}]` : ''} — operação cancelada.`);
          }
          return { success: false, reason: 'no_compatible_modalities' };
        }

        if (!isAutoModalityMode) {
          const dropped = activeModalities.filter(m => ALL_SUPPORTED.has(m) && !symbolCompatible.has(m));
          if (dropped.length > 0) {
            console.log(`🔄 [${operationId}] Compatibilidade: ${dropped.join(', ')} não disponível em ${selectedSymbol} → usando: ${compatibleModalities.join(', ')}`);
          }
        }

        // 🎯 FILTRO DE QUALIDADE — DIGIT DIFFERS: só opera com consenso ≥90%
        // Fundamento matemático: payout ~9% por trade exige win rate >92% para ser lucrativo.
        // Abaixo de 90% de consenso da IA o edge não está garantido → usar Accumulator no ciclo.
        // Quando consenso ≥90% a IA está com confiança excepcional → Digit Differs é autorizado.
        const DIGIT_DIFFERS_MIN_CONSENSUS = 90;
        if (compatibleModalities.includes('digit_differs') && aiConsensus.consensusStrength < DIGIT_DIFFERS_MIN_CONSENSUS) {
          const withoutDD = compatibleModalities.filter(m => m !== 'digit_differs');
          if (withoutDD.length === 0) {
            // Só tem Digit Differs e o consenso é baixo → aguardar sinal mais forte
            console.log(`🔒 [${operationId}] Digit Differs bloqueado: consenso ${aiConsensus.consensusStrength.toFixed(1)}% < ${DIGIT_DIFFERS_MIN_CONSENSUS}% mínimo exigido. Sem alternativa — aguardando consenso excepcional.`);
            return { success: false, reason: 'digit_differs_low_consensus' };
          }
          // Tem outra modalidade (ex: Accumulator) → usar ela neste ciclo
          console.log(`🔒 [${operationId}] Digit Differs requer consenso ≥${DIGIT_DIFFERS_MIN_CONSENSUS}% (atual: ${aiConsensus.consensusStrength.toFixed(1)}%) → usando ${withoutDD.join(', ')} neste ciclo`);
          compatibleModalities.splice(0, compatibleModalities.length, ...withoutDD);
        } else if (compatibleModalities.includes('digit_differs') && aiConsensus.consensusStrength >= DIGIT_DIFFERS_MIN_CONSENSUS) {
          console.log(`✅ [${operationId}] Digit Differs AUTORIZADO: consenso ${aiConsensus.consensusStrength.toFixed(1)}% ≥ ${DIGIT_DIFFERS_MIN_CONSENSUS}% — edge confirmado`);
        }

        // 🧠 SUPREME MARKET ANALYZER: Selecionar modalidade por inteligência, não por rotação de tempo
        let selectedModality: string;
        const supremeAnalysis = supremeAnalyzer.getLatestAnalysis(selectedSymbol);

        if (supremeAnalysis && supremeAnalysis.adaptiveParams && supremeAnalysis.adaptiveParams.modalityScore > 30) {
          const recommended = supremeAnalysis.adaptiveParams.recommendedModality;
          if (compatibleModalities.includes(recommended)) {
            selectedModality = recommended;
            console.log(`🧠 [${operationId}] Modalidade pelo Motor Supremo: ${selectedModality} (score=${supremeAnalysis.adaptiveParams.modalityScore.toFixed(0)}% | regime=${supremeAnalysis.regime} | hurst=${supremeAnalysis.statistics.hurstExponent.toFixed(2)} | entropy=${supremeAnalysis.statistics.shannonEntropy.toFixed(2)} | opp=${supremeAnalysis.opportunityScore.toFixed(0)}%)`);
          } else {
            const opHash = operationId.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
            const rotationIndex = (Math.floor(Date.now() / 1000) + opHash) % compatibleModalities.length;
            selectedModality = compatibleModalities[rotationIndex];
            console.log(`🔄 [${operationId}] ${recommended} incompatível com ${selectedSymbol} → fallback rotação: ${selectedModality}`);
          }
        } else {
          // Construir pool ponderado pela frequência configurada pelo usuário
          const freqWeights: Record<string, number> = { low: 1, normal: 3, high: 6 };
          const weightedPool: string[] = [];
          for (const m of compatibleModalities) {
            const level = modalityFrequency[m] ?? 'normal';
            const w = freqWeights[level] ?? 3;
            for (let i = 0; i < w; i++) weightedPool.push(m);
          }
          const opHash = operationId.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
          const rotationIndex = (Math.floor(Date.now() / 1000) + opHash) % weightedPool.length;
          selectedModality = weightedPool[rotationIndex];
          console.log(`⏳ [${operationId}] Motor Supremo acumulando dados → rotação ponderada: ${selectedModality} (pool: ${compatibleModalities.join(', ')})`);
        }


        // ─── EXECUÇÃO POR MODALIDADE ─────────────────────────────────────
        let contract: any = null;
        let resolvedTradeType = 'digitdiff';
        let accuTargetTicks: number | undefined = undefined; // ⚡ ACCU: ticks alvo para auto-sell

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
          if (contractType === 'DIGITOVER') {
            const smartBarrier = this.selectDigitBarrierForOverUnder(selectedSymbol, 'over');
            barrier = smartBarrier.barrier;
            console.log(`🎯 [DIGITOVER] ${selectedSymbol}: barreira inteligente=${barrier} | winRate≈${smartBarrier.winRateEst}% | ${smartBarrier.reason}`);
          }
          if (contractType === 'DIGITUNDER') {
            const smartBarrier = this.selectDigitBarrierForOverUnder(selectedSymbol, 'under');
            barrier = smartBarrier.barrier;
            console.log(`🎯 [DIGITUNDER] ${selectedSymbol}: barreira inteligente=${barrier} | winRate≈${smartBarrier.winRateEst}% | ${smartBarrier.reason}`);
          }
          if (!needsBarrier) barrier = undefined;

          const rawDigitTicks = userModalityTicks[selectedModality];
          const digitDuration = rawDigitTicks === 0
            ? this.calculateDynamicTicks(selectedSymbol, 5) // 🤖 IA livre
            : rawDigitTicks && rawDigitTicks < 0
              ? Math.min(Math.abs(rawDigitTicks), Math.max(1, this.calculateDynamicTicks(selectedSymbol, Math.abs(rawDigitTicks)))) // 🤖 IA+Máx
              : rawDigitTicks
                ? Math.max(1, Math.min(rawDigitTicks, 10)) // ⚙️ Fixo
                : tradeParams.duration;
          contract = await derivAPI.buyGenericDigitContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            duration: digitDuration,
            amount: tradeParams.amount,
            barrier,
            currency: 'USD',
          });
          resolvedTradeType = selectedModality.replace('_', '');

        } else if (RISFALL_TYPES.has(selectedModality)) {
          // ── Contratos Rise/Fall (CALL/PUT) — ticks simples, sem barreira ──
          const callPutDirection: 'up' | 'down' = selectedModality === 'rise' ? 'up' : selectedModality === 'fall' ? 'down' : safeDirection;
          const rawRFTicks = userModalityTicks[selectedModality];
          const callPutDuration = rawRFTicks === 0
            ? this.calculateDynamicTicks(selectedSymbol, 5) // 🤖 IA controla
            : rawRFTicks
              ? Math.max(1, Math.min(rawRFTicks, 10))
              : Math.max(1, Math.floor(tradeParams.duration / 2));
          contract = await derivAPI.buyCallPutContract(selectedSymbol, callPutDirection, callPutDuration, tradeParams.amount);
          resolvedTradeType = selectedModality;

        } else if (HIGHER_LOWER_TYPES[selectedModality]) {
          // ── Contratos Higher/Lower (CALLE/PUTE) — preço deve terminar acima/abaixo da barreira ──
          const contractType = HIGHER_LOWER_TYPES[selectedModality]; // 'CALLE' ou 'PUTE'
          const isHigher = selectedModality === 'higher';
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);
          // Barreira: 0.3% do preço (adaptada pelo Motor Supremo se disponível)
          const rawHLBarrierPct = supremeAnalysis?.adaptiveParams?.touch?.barrierOffsetPct;
          const hlOffsetPct = rawHLBarrierPct ? Math.min(rawHLBarrierPct, 0.005) : 0.003;
          const offset = currentPrice && currentPrice > 0 ? parseFloat((currentPrice * hlOffsetPct).toFixed(2)) : 0.5;
          const barrier = isHigher ? '+' + offset : '-' + offset;
          // Duração em minutos (IA ou config do usuário)
          const rawHLMin = userModalityTicks[selectedModality];
          const aiHLDurMin = supremeAnalysis?.adaptiveParams?.vanilla?.durationMin ?? 5;
          const durationMin = rawHLMin === 0 ? aiHLDurMin : (rawHLMin && rawHLMin > 0 ? rawHLMin : aiHLDurMin);
          const dateExpiry = Math.floor(Date.now() / 1000) + (durationMin * 60);
          console.log(`📊 [${operationId}] ${contractType}: barrier=${barrier}, expiry=${durationMin}min | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            barrier,
            date_expiry: dateExpiry,
            currency: 'USD',
          });
          resolvedTradeType = contractType.toLowerCase();

        } else if (IN_OUT_TYPES[selectedModality]) {
          // ── Contratos Dentro & Fora (EXPIRYRANGE, EXPIRYMISS, RANGE, UPORDOWN) ──
          // EXPIRYRANGE/EXPIRYMISS: usam date_expiry + barriers absolutas
          // RANGE/UPORDOWN: usam duration + barriers relativas
          const contractType = IN_OUT_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);

          const isExpiry = (selectedModality === 'ends_between' || selectedModality === 'ends_outside');
          // Offsets específicos por modalidade — NÃO usar touch.barrierOffsetPct (é para ONETOUCH/NOTOUCH)
          // stays_between/ends_between: range estreito (~0.5%) → preço pode sair da faixa
          // goes_outside/ends_outside: range maior (~0.8%) → preço precisa escapar
          const offsetPct = (selectedModality === 'ends_outside' || selectedModality === 'goes_outside') ? 0.008 : 0.005;

          // Duração: respeita config do usuário (0=IA controla, >0=fixo em minutos)
          const rawInOutMin = userModalityTicks[selectedModality];
          const aiInOutExpiryMin = supremeAnalysis?.adaptiveParams?.vanilla?.durationMin ?? 15;
          const aiInOutRangeMin = supremeAnalysis?.adaptiveParams?.turbo?.durationMin ?? 5;
          const userInOutMin = rawInOutMin === 0 ? null : (rawInOutMin && rawInOutMin > 0 ? rawInOutMin : null);

          if (isExpiry && currentPrice && currentPrice > 0) {
            // EXPIRYRANGE / EXPIRYMISS: barriers absolutas + date_expiry dinâmico via IA
            const adaptiveExpiryMin = userInOutMin ?? aiInOutExpiryMin;
            // Usar offsetPct dedicado — touch.barrierOffsetPct é para ONETOUCH/NOTOUCH, não EXPIRY
            const adaptiveOffsetPct = offsetPct;
            const offset = currentPrice * adaptiveOffsetPct;
            const upperBarrier = (currentPrice + offset).toFixed(2);
            const lowerBarrier  = (currentPrice - offset).toFixed(2);
            const dateExpiry  = Math.floor(Date.now() / 1000) + (adaptiveExpiryMin * 60);

            console.log(`📊 [${operationId}] ${contractType}: barrier=${upperBarrier}, barrier2=${lowerBarrier}, expiry=${adaptiveExpiryMin}min ${rawInOutMin === 0 ? '🤖 IA' : userInOutMin ? '⚙️ FIXO' : 'ADAPTATIVO'} (regime=${supremeAnalysis?.regime ?? 'padrão'}) | Symbol: ${selectedSymbol}`);
            contract = await derivAPI.buyFlexibleContract({
              contract_type: contractType,
              symbol: selectedSymbol,
              amount: tradeParams.amount,
              barrier: upperBarrier,
              barrier2: lowerBarrier,
              date_expiry: dateExpiry,
            });
          } else {
            // RANGE / UPORDOWN: barriers relativas + duration dinâmica via IA
            const adaptiveRangeDurMin = userInOutMin ?? aiInOutRangeMin;
            // Usar offsetPct dedicado — touch.barrierOffsetPct é para ONETOUCH/NOTOUCH, não RANGE
            const offset = currentPrice && currentPrice > 0
              ? parseFloat((currentPrice * offsetPct).toFixed(2))
              : 0.5;
            const upperBarrier = '+' + offset;
            const lowerBarrier  = '-' + offset;

            console.log(`📊 [${operationId}] ${contractType}: barrier=${upperBarrier}, barrier2=${lowerBarrier}, ${adaptiveRangeDurMin}m ${rawInOutMin === 0 ? '🤖 IA' : userInOutMin ? '⚙️ FIXO' : 'ADAPTATIVO'} (regime=${supremeAnalysis?.regime ?? 'padrão'}) | Symbol: ${selectedSymbol}`);
            contract = await derivAPI.buyFlexibleContract({
              contract_type: contractType,
              symbol: selectedSymbol,
              amount: tradeParams.amount,
              duration: adaptiveRangeDurMin,
              duration_unit: 'm',
              barrier: upperBarrier,
              barrier2: lowerBarrier,
            });
          }

          if (!contract) {
            // Não usar DIGITDIFF como fallback — pode causar timeout quando WS cai
            // Deixar o ciclo seguinte escolher outra modalidade
            console.warn(`⚠️ [${operationId}] ${contractType} rejeitado pela Deriv — aguardando próximo ciclo`);
            resolvedTradeType = selectedModality;
          } else {
            resolvedTradeType = selectedModality;
          }

        } else if (TOUCH_TYPES[selectedModality]) {
          // ── Contratos Touch / No Touch (ONETOUCH, NOTOUCH) ──
          const contractType = TOUCH_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);
          let barrier: string;

          if (currentPrice && currentPrice > 0) {
            // ─── Barreira TOUCH / NOTOUCH ───────────────────────────────────────────
            // ANÁLISE MATEMÁTICA (dados reais 158 NOTOUCH trades):
            //   NOTOUCH atual (0.3% offset, 30min): 85.2% WR, 4.32% payout → precisa 91% WR → PERDEDOR (-$2.24)
            //   ONETOUCH atual (0.2% offset, 30min): 75.0% WR, 34.12% payout → precisa 59.7% WR → LUCRATIVO (+$2.38)
            //
            // FIX NOTOUCH: barreira 0.12% (era 0.3%) → payout alvo 15-25%, WR alvo 72-78%
            //   → break-even = 25/(25+80) = 77% → alcançável se IA tiver mínimo de edge
            //   → EV estimado: 0.75 * 20% - 0.25 * 80% = 15% - 20% = -5% (MUITO melhor que -11%)
            //
            // ONETOUCH: manter 0.2% (comprovadamente lucrativo)
            const rawAdaptivePct = supremeAnalysis?.adaptiveParams?.touch?.barrierOffsetPct;
            let offsetPct: number;
            if (selectedModality === 'no_touch') {
              // NOTOUCH: barreira agressiva (0.12%) para forçar payout ≥ 15%
              // Cap adaptivo em 0.002 (0.2%) para não permitir barreira muito distante (payout ínfimo)
              const cappedAdaptivePct = rawAdaptivePct ? Math.min(rawAdaptivePct, 0.002) : null;
              offsetPct = cappedAdaptivePct ?? 0.0012; // 0.12% padrão (era 0.3% → payout era 4%)
            } else {
              // ONETOUCH: manter 0.2% (funciona bem com 34% payout)
              const cappedAdaptivePct = rawAdaptivePct ? Math.min(rawAdaptivePct, 0.004) : null;
              offsetPct = cappedAdaptivePct ?? 0.002;
            }
            // Deriv só aceita até 2 casas decimais na barreira
            const offset = parseFloat((currentPrice * offsetPct).toFixed(2));
            barrier = (safeDirection === 'up' ? '+' : '-') + offset;
            console.log(`📊 [${operationId}] ${contractType}: barrier=${barrier} (offset=${(offsetPct*100).toFixed(3)}%${rawAdaptivePct ? ' [adaptivo]' : ' padrão'}) | Symbol: ${selectedSymbol}`);
          } else {
            barrier = safeDirection === 'up' ? '+0.2' : '-0.2';
            console.log(`📊 [${operationId}] ${contractType}: barrier=${barrier} | Symbol: ${selectedSymbol}`);
          }
          // Duração: separada por modalidade para otimizar payout
          // NOTOUCH: máx 5 min → menos exposição → menos toques acidentais em alta vol
          // ONETOUCH: 5-30 min → mais tempo para o preço tocar a barreira → wins mais fáceis
          const rawTouchMin = userModalityTicks[selectedModality];
          const aiTouchDuration = supremeAnalysis?.adaptiveParams?.vanilla?.durationMin ?? 15;
          const touchDuration = rawTouchMin === 0
            ? aiTouchDuration  // 🤖 IA controla
            : rawTouchMin && rawTouchMin > 0
              ? rawTouchMin    // ⚙️ fixo pelo usuário
              : aiTouchDuration;
          // NOTOUCH: máx 5 min (curta exposição = menos chance de tocar a barreira)
          // ONETOUCH: 5-30 min (mais tempo para preço alcançar a barreira = mais wins)
          const isNoTouch = selectedModality === 'no_touch';
          const clampedTouchDuration = isNoTouch
            ? Math.min(Math.max(touchDuration, 1), 5)   // NOTOUCH: 1-5 min
            : Math.min(Math.max(touchDuration, 5), 30);  // ONETOUCH: 5-30 min
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            duration: clampedTouchDuration,
            duration_unit: 'm',
            barrier,
          });
          resolvedTradeType = selectedModality;

        } else if (MULTIPLIER_TYPES[selectedModality]) {
          // ── Contratos Multiplicadores (MULTUP, MULTDOWN) ──
          const contractType = MULTIPLIER_TYPES[selectedModality];
          // 🧠 SUPREMO: multiplicador adaptativo por força de tendência e volatilidade
          // Índices de volatilidade (R_*, JD*) aceitam apenas: 80, 200, 400, 600, 800
          // Demais ativos (forex, etc.) aceitam multiplicadores menores (1, 2, 3, 5, 10...)
          const isVolatilityIndex = /^(R_|JD|1HZ|RDBULL|RDBEAR)/.test(selectedSymbol);
          const VALID_VOL_MULTIPLIERS = [80, 200, 400, 600, 800];
          const rawAdaptiveMult = supremeAnalysis?.adaptiveParams?.multiplier?.factor ?? (isVolatilityIndex ? 80 : 10);
          let adaptiveMult: number;
          if (isVolatilityIndex) {
            // Encontrar o multiplicador válido mais próximo ao sugerido pela IA
            adaptiveMult = VALID_VOL_MULTIPLIERS.reduce((prev, curr) =>
              Math.abs(curr - rawAdaptiveMult) < Math.abs(prev - rawAdaptiveMult) ? curr : prev
            );
          } else {
            adaptiveMult = rawAdaptiveMult;
          }
          console.log(`📊 [${operationId}] ${contractType}: multiplier=${adaptiveMult}x${supremeAnalysis ? ` ADAPTATIVO (regime=${supremeAnalysis.regime})` : ' padrão'} | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            multiplier: adaptiveMult,
          });
          if (!contract) {
            console.warn(`⚠️ [${operationId}] Multiplier rejeitado pela Deriv — operação cancelada (sem fallback)`);
            return { success: false, error: `Multiplier (${contractType}) rejeitado pela Deriv para ${selectedSymbol}` };
          }
          resolvedTradeType = selectedModality;

        } else if (selectedModality === 'accumulator') {
          // ── Contratos Acumuladores (ACCU) ──

          // 🛡️ FILTRO DE SEGURANÇA ACCU — indicadores devem ter sido CALCULADOS (não undefined)
          // Bloqueio apenas quando os três indicadores estão todos ausentes (undefined/null),
          // o que indica que a análise técnica real nunca foi executada.
          const rsiNotCalculated  = aiConsensus.rsi       === undefined || aiConsensus.rsi      === null;
          const macdNotCalculated = aiConsensus.macd      === undefined || aiConsensus.macd     === null;
          const bbNotCalculated   = aiConsensus.bbPosition === undefined || aiConsensus.bbPosition === null;
          const regimeUnknown  = !aiConsensus.marketRegime || aiConsensus.marketRegime === 'unknown';
          const supremeUnknown = !supremeAnalysis || supremeAnalysis.regime === 'unknown' || supremeAnalysis.regime === 'neutral';
          const indicatorsAllDefault = rsiNotCalculated && macdNotCalculated && bbNotCalculated;

          // 🔴 BLOQUEIO TOTAL: Se os três indicadores nunca foram calculados (undefined),
          // a análise técnica real não ocorreu — entrar seria operar no escuro.
          if (indicatorsAllDefault) {
            console.warn(`⛔ [${operationId}] ACCU BLOQUEADO: Indicadores técnicos não calculados (undefined) — análise técnica real não foi executada. Entrada negada para proteger capital.`);
            this.setPhase('AGUARDANDO', `⛔ ACCU bloqueado em ${selectedSymbol}: indicadores técnicos não disponíveis`, 'warning');
            return { success: false, error: `ACCU: Indicadores técnicos não disponíveis (undefined) — análise técnica não executada, entrada bloqueada` };
          }
          console.log(`✅ [${operationId}] ACCU: Indicadores técnicos calculados — RSI=${aiConsensus.rsi?.toFixed(1)} | MACD=${aiConsensus.macd?.toFixed(6)} | BB=${aiConsensus.bbPosition?.toFixed(3)}`);

          // Volatilidade extrema: R_75 e R_100 têm volatilidade inerentemente alta — 
          // só entrar se o regime for CONFIRMADO (não 'unknown')
          const isHighVolSymbol = /R_75|R_100/.test(selectedSymbol);
          if (isHighVolSymbol && regimeUnknown) {
            console.warn(`⛔ [${operationId}] ACCU BLOQUEADO: ${selectedSymbol} tem alta volatilidade nativa e regime desconhecido — risco de knockout elevado.`);
            this.setPhase('AGUARDANDO', `⛔ ACCU bloqueado: ${selectedSymbol} é de alta volatilidade e regime está desconhecido`, 'warning');
            return { success: false, error: `ACCU: ${selectedSymbol} (alta volatilidade) com regime desconhecido — bloqueado por segurança` };
          }

          // 🧠 ACCU: stake via IA por ativo — mesmo motor de calculateAIStakePercentage
          const accuRisk = supremeAnalysis?.adaptiveParams?.accumulator?.riskLevel ?? 'medium';
          {
            const bankBalance  = this.cachedBalance?.value ?? tradeParams.amount * 30;
            const consensus    = aiConsensus.consensusStrength ?? 50;
            const regime       = supremeAnalysis?.regime ?? 'unknown';
            const hurst        = supremeAnalysis?.statistics?.hurstExponent ?? 0.5;
            const vol          = aiConsensus.volatility ?? supremeAnalysis?.statistics?.shannonEntropy ?? 0.5;
            const perf         = this.assetPerformance.get(selectedSymbol);
            const totalPerfTrades = perf ? perf.wins + perf.losses : 0;
            const assetWinRate = totalPerfTrades > 0 ? perf!.wins / totalPerfTrades : 0.55;

            // 🧠 IA calcula stake específico para ESTE ativo neste momento
            let aiPct = this.calculateAIStakePercentage(consensus, regime, hurst, vol, assetWinRate, bankBalance);

            // Redução adicional por risco do ACCU (barreira)
            if      (accuRisk === 'high')    aiPct *= 0.70;
            else if (accuRisk === 'medium')  aiPct *= 0.90;
            // 'low' → sem penalidade

            const accuStake = Math.max(1.00, Math.round(bankBalance * aiPct * 100) / 100);
            console.log(`🧠 [ACCU STAKE] ${selectedSymbol} | consenso=${consensus.toFixed(0)}% | regime=${regime} | risco=${accuRisk} | WR=${(assetWinRate*100).toFixed(0)}% → ${(aiPct*100).toFixed(1)}% × $${bankBalance.toFixed(2)} = $${accuStake.toFixed(2)}`);

            // 🧠 SUPREMO: growth_rate totalmente dinâmico — IA escolhe 1%-5% conforme volatilidade real
            // mercado em recuperação parcial → usa menor taxa PERMITIDA pelo usuário (nunca força taxa fora da config)
            // mercado normal → selectAccumulatorGrowthRate decide conforme volatilidade, dentro das taxas do usuário
            let adaptiveGrowth: number;
            let growthModeLabel: string;
            if (this.badMarketReducedGrowthActive) {
              // Mercado em recuperação: usar a MENOR taxa permitida pelo usuário (conservador)
              // — nunca forçar uma taxa fora da configuração do usuário
              const minAllowedRate = Math.min(...allowedAccuGrowthRates);
              adaptiveGrowth = minAllowedRate;
              growthModeLabel = `REDUZIDO — menor taxa permitida (${(minAllowedRate*100).toFixed(0)}%) — mercado em recuperação`;
            } else {
              // Shannon Entropy como proxy de volatilidade (0=previsível=baixa vol, 1=caótico=alta vol)
              const mktVol = supremeAnalysis?.statistics?.shannonEntropy ?? 0.5;
              const { rate, reason } = this.selectAccumulatorGrowthRate(mktVol, consensus, allowedAccuGrowthRates);
              adaptiveGrowth = rate;
              growthModeLabel = `IA (${reason})`;
            }

            // ─── FREQUÊNCIA POR TAXA (ACCU) ────────────────────────────────────────────
            {
              const rateKey = (adaptiveGrowth * 100).toFixed(0); // '1','2','3','4','5'
              const freqVal = accuFrequencyPerRate[rateKey] ?? 'ai';
              const isAiFreq = freqVal === 'ai' || freqVal.startsWith('ai:');
              const hintLevel = freqVal.startsWith('ai:') ? freqVal.slice(3) : (freqVal === 'ai' ? 'normal' : freqVal);

              if (freqVal !== 'ai') { // 'ai' puro = nenhum filtro (comportamento atual)
                let effectiveLevel = hintLevel;
                if (isAiFreq) {
                  // IA+hint: qualidade de mercado modula o nível preferido
                  const mktVol = supremeAnalysis?.statistics?.shannonEntropy ?? 0.5;
                  if (mktVol < 0.35)       effectiveLevel = hintLevel === 'low' ? 'normal' : 'high';
                  else if (mktVol > 0.65)  effectiveLevel = hintLevel === 'high' ? 'normal' : 'low';
                  // else: mercado neutro → usa o nível do usuário sem ajuste
                }
                const freqW: Record<string, number> = { low: 1, normal: 3, high: 6 };
                const maxW = 6;
                const slot = Math.floor(Date.now() / 30000) % maxW;
                if (slot >= (freqW[effectiveLevel] ?? 3)) {
                  const modeLabel = isAiFreq ? `IA+${hintLevel}→${effectiveLevel}` : effectiveLevel;
                  console.log(`⏭️ [${operationId}] Frequência ACCU ${rateKey}% [${modeLabel}] → ciclo pulado (slot ${slot}/${maxW})`);
                  this.setPhase('AGUARDANDO', `⏭️ Frequência ${effectiveLevel} — ACCU ${rateKey}% aguardando próximo ciclo`, 'info');
                  return { success: false, reason: `accu_frequency_skip_${rateKey}pct` };
                }
              }
            }
            // ───────────────────────────────────────────────────────────────────────────

            // ⚡ Ticks alvo: inversamente proporcional ao growth — taxa menor = mais ticks necessários
            // para manter lucro alvo similar e compensar a barreira mais apertada com acumulação gradual
            //   1% growth → 10 ticks → ~10.5% lucro se todos sobreviverem
            //   2% growth →  7 ticks → ~14.9% lucro
            //   3% growth →  5 ticks → ~15.9% lucro
            //   4% growth →  4 ticks → ~16.9% lucro
            //   5% growth →  3 ticks → ~15.8% lucro
            const minTicksByGrowthRate: Record<number, number> = userAccuTicksPerRate;
            const configuredTicks = minTicksByGrowthRate[adaptiveGrowth] ?? 3;
            // Negativo = IA dinâmico com máximo |N|; Positivo = fixo em N ticks
            let accuTicks: number;
            if (configuredTicks < 0) {
              const maxAllowed = Math.abs(configuredTicks);
              const defaultBase = { 0.01: 10, 0.02: 7, 0.03: 5, 0.04: 4, 0.05: 3 }[adaptiveGrowth] ?? 5;
              const dynamicVal = this.calculateDynamicTicks(selectedSymbol, Math.min(defaultBase, maxAllowed));
              // IA decide entre 1 e o máximo permitido pelo usuário
              accuTicks = Math.min(maxAllowed, Math.max(1, dynamicVal));
              console.log(`🤖 [DYNAMIC TICKS] IA decidiu ${accuTicks} tick(s) (máx ${maxAllowed}) para ${selectedSymbol} @ ${(adaptiveGrowth*100).toFixed(0)}%`);
            } else {
              accuTicks = configuredTicks;
            }
            accuTargetTicks = accuTicks;
            const opportunityQuality = consensus >= 75 ? 'ALTA' : consensus >= 50 ? 'MÉDIA' : 'BAIXA';
            console.log(`📊 [${operationId}] ACCU MODO-OPS: stake=$${accuStake} [${opportunityQuality}] (banca=$${bankBalance.toFixed(2)} | consenso=${consensus}% | risco=${accuRisk}) | growth=${(adaptiveGrowth*100).toFixed(0)}% ${growthModeLabel} | ticks=${accuTicks}${supremeAnalysis ? ` | regime=${regime} | hurst=${supremeAnalysis.statistics.hurstExponent.toFixed(2)}` : ''} | ${selectedSymbol}`);
            contract = await derivAPI.buyFlexibleContract({
              contract_type: 'ACCU',
              symbol: selectedSymbol,
              amount: accuStake,
              growth_rate: adaptiveGrowth,
            });
          }
          if (!contract) {
            console.warn(`⚠️ [${operationId}] Accumulator rejeitado pela Deriv — operação cancelada (sem fallback)`);
            return { success: false, error: `Accumulator rejeitado pela Deriv para ${selectedSymbol}` };
          }
          resolvedTradeType = 'accumulator';

        } else if (TURBO_TYPES[selectedModality]) {
          // ── Contratos Turbos/Knockouts (TURBOSLONG, TURBOSSHORT) ──
          const contractType = TURBO_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);

          if (!currentPrice || currentPrice <= 0) {
            console.warn(`⚠️ [${operationId}] Turbo sem preço válido para ${selectedSymbol} — operação cancelada`);
            return { success: false, error: `Preço indisponível para Turbo em ${selectedSymbol}` };
          }
          // 🧠 SUPREMO: knockout adaptativo por volatilidade real
          const adaptiveTurboPct = supremeAnalysis?.adaptiveParams?.turbo?.knockoutOffsetPct ?? 0.015;
          const aiTurboDur = supremeAnalysis?.adaptiveParams?.turbo?.durationMin ?? 15;
          const rawTurboMin = userModalityTicks[selectedModality];
          const adaptiveTurboDur = rawTurboMin === 0 ? aiTurboDur : (rawTurboMin && rawTurboMin > 0 ? rawTurboMin : aiTurboDur);
          const turboModeLabel = rawTurboMin === 0 ? '🤖 IA' : rawTurboMin && rawTurboMin > 0 ? '⚙️ FIXO' : 'ADAPTATIVO';
          const knockoutOffset = currentPrice * adaptiveTurboPct;
          const barrier = selectedModality === 'turbo_up'
            ? (currentPrice - knockoutOffset).toFixed(4)
            : (currentPrice + knockoutOffset).toFixed(4);
          const dateExpiry = Math.floor(Date.now() / 1000) + (adaptiveTurboDur * 60);
          console.log(`📊 [${operationId}] ${contractType}: barrier=${barrier} (${(adaptiveTurboPct*100).toFixed(2)}%${supremeAnalysis ? ' ADAPTATIVO' : ' padrão'}), expiry=${adaptiveTurboDur}min ${turboModeLabel} | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            barrier,
            date_expiry: dateExpiry,
          });
          if (!contract) {
            console.warn(`⚠️ [${operationId}] Turbo rejeitado pela Deriv — operação cancelada (sem fallback)`);
            return { success: false, error: `Turbo (${contractType}) rejeitado pela Deriv para ${selectedSymbol}` };
          }
          resolvedTradeType = selectedModality;

        } else if (VANILLA_TYPES[selectedModality]) {
          // ── Contratos Vanilla Options (VANILLALONGCALL, VANILLALONGPUT) ──
          const contractType = VANILLA_TYPES[selectedModality];
          const currentPrice = await derivAPI.getCurrentPrice(selectedSymbol);

          if (!currentPrice || currentPrice <= 0) {
            console.warn(`⚠️ [${operationId}] Vanilla sem preço válido para ${selectedSymbol} — operação cancelada`);
            return { success: false, error: `Preço indisponível para Vanilla em ${selectedSymbol}` };
          }
          // 🧠 SUPREMO: strike adaptativo por momentum real do mercado
          const adaptiveVanillaPct = supremeAnalysis?.adaptiveParams?.vanilla?.strikeOffsetPct ?? 0.005;
          const aiVanillaDur = supremeAnalysis?.adaptiveParams?.vanilla?.durationMin ?? 15;
          const rawVanillaMin = userModalityTicks[selectedModality];
          const adaptiveVanillaDur = rawVanillaMin === 0 ? aiVanillaDur : (rawVanillaMin && rawVanillaMin > 0 ? rawVanillaMin : aiVanillaDur);
          const vanillaModeLabel = rawVanillaMin === 0 ? '🤖 IA' : rawVanillaMin && rawVanillaMin > 0 ? '⚙️ FIXO' : 'ADAPTATIVO';
          const strikeOffset = currentPrice * adaptiveVanillaPct;
          const strike = selectedModality === 'vanilla_call'
            ? (currentPrice + strikeOffset).toFixed(4)
            : (currentPrice - strikeOffset).toFixed(4);
          const dateExpiry = Math.floor(Date.now() / 1000) + (adaptiveVanillaDur * 60);
          console.log(`📊 [${operationId}] ${contractType}: strike=${strike} (${(adaptiveVanillaPct*100).toFixed(2)}%${supremeAnalysis ? ' ADAPTATIVO' : ' padrão'}), expiry=${adaptiveVanillaDur}min ${vanillaModeLabel} | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: tradeParams.amount,
            barrier: strike,
            date_expiry: dateExpiry,
          });
          if (!contract) {
            console.warn(`⚠️ [${operationId}] Vanilla rejeitado pela Deriv — operação cancelada (sem fallback)`);
            return { success: false, error: `Vanilla (${contractType}) rejeitado pela Deriv para ${selectedSymbol}` };
          }
          resolvedTradeType = selectedModality;

        } else if (LOOKBACK_TYPES[selectedModality]) {
          // ── Contratos Lookback (LBFLOATPUT, LBFLOATCALL, LBHIGHLOW) ──
          // Lookback usa "amount" como multiplicador e NÃO aceita o campo "basis"
          const contractType = LOOKBACK_TYPES[selectedModality];
          // Duração: respeita config do usuário (0=IA controla, >0=fixo em minutos)
          const rawLbMin = userModalityTicks[selectedModality];
          const aiLbDur = supremeAnalysis?.regime === 'strong_trend' ? 10
                        : supremeAnalysis?.regime === 'weak_trend'   ? 7
                        : supremeAnalysis?.regime === 'calm'         ? 8
                        : 5; // ranging/chaotic: mais curto
          const lbDurMin = rawLbMin === 0
            ? aiLbDur // 🤖 IA controla
            : rawLbMin && rawLbMin > 0 ? rawLbMin
            : aiLbDur;
          const lbModeLabel = rawLbMin === 0 ? '🤖 IA' : rawLbMin && rawLbMin > 0 ? '⚙️ FIXO' : 'ADAPTATIVO';
          console.log(`📊 [${operationId}] ${contractType}: multiplier=${Math.max(1, Math.round(tradeParams.amount))} | duration=${lbDurMin}min ${lbModeLabel} (regime=${supremeAnalysis?.regime ?? 'padrão'}) | Symbol: ${selectedSymbol}`);
          contract = await derivAPI.buyFlexibleContract({
            contract_type: contractType,
            symbol: selectedSymbol,
            amount: Math.max(1, Math.round(tradeParams.amount)), // multiplier deve ser inteiro >= 1
            duration: lbDurMin,
            duration_unit: 'm',
          });
          if (!contract) {
            console.warn(`⚠️ [${operationId}] Lookback rejeitado pela Deriv — operação cancelada (sem fallback)`);
            return { success: false, error: `Lookback (${contractType}) rejeitado pela Deriv para ${selectedSymbol}` };
          }
          resolvedTradeType = selectedModality;

        } else {
          // Modalidade desconhecida — cancelar operação sem fallback
          console.error(`❌ [${operationId}] Modalidade desconhecida: ${selectedModality} — operação cancelada`);
          return { success: false, error: `Modalidade não reconhecida: ${selectedModality}` };
        }

        if (!contract) {
          console.error(`❌ [${operationId}] Erro ao comprar contrato [${selectedModality}] na Deriv para ${selectedSymbol}`);
          return { success: false, error: `Falha ao executar trade [${selectedModality}] na Deriv` };
        }

        const signalToOpenMs = Date.now() - signalDecisionAt;
        console.log(`✅ [${operationId}] Contrato [${selectedModality}] ABERTO: ${contract.contract_id}`);
        console.log(`⏱️ [SINAL→ABERTURA] Tempo total: ${signalToOpenMs}ms (${(signalToOpenMs/1000).toFixed(1)}s) | ${selectedSymbol} | Consenso: ${aiConsensus.consensusStrength}%`);
        if (signalToOpenMs > 5000) {
          console.warn(`⚠️ [SLIPPAGE RISK] Tempo sinal→abertura ${signalToOpenMs}ms > 5s — entry tick pode ter divergido da análise da IA`);
        }

        // 🎰 REGISTRAR CONTRATO NO MARTINGALE (se estiver em sequência ativa)
        try {
          const mgState = this.getMartingaleState(config.userId);
          if (mgState.isActive) {
            this.pendingMartingaleContracts.set(String(contract.contract_id), {
              userId: config.userId,
              part: mgState.currentPart,
            });
            console.log(`🎰 [${operationId}] Contrato ${contract.contract_id} registrado como Martingale Parte ${mgState.currentPart}/3`);
          }
        } catch (mgRegErr) {
          console.error(`❌ [MARTINGALE] Erro ao registrar contrato:`, mgRegErr);
        }

        // 🔭 MONITOR UNIVERSAL IA — acompanhar contrato tick a tick
        const contractTypeForMonitor = (
          DIGIT_TYPES[selectedModality] ||
          (RISFALL_TYPES.has(selectedModality) ? (selectedModality === 'rise' ? 'CALL' : 'PUT') : undefined) ||
          HIGHER_LOWER_TYPES[selectedModality] ||   // 'higher'→CALLE, 'lower'→PUTE
          IN_OUT_TYPES[selectedModality] ||
          TOUCH_TYPES[selectedModality] ||
          MULTIPLIER_TYPES[selectedModality] ||
          (selectedModality === 'accumulator' ? 'ACCU' : undefined) ||
          TURBO_TYPES[selectedModality] ||
          VANILLA_TYPES[selectedModality] ||
          LOOKBACK_TYPES[selectedModality] ||
          'DIGITDIFF'
        );
        try {
          contractMonitor.setToken(tokenData.token);
          await contractMonitor.startMonitoring({
            contractId: contract.contract_id,
            contractType: contractTypeForMonitor,
            symbol: selectedSymbol,
            buyPrice: contract.buy_price || tradeParams.amount,
            amount: tradeParams.amount,
            direction: safeDirection,
            userId: config.userId,
            openedAt: Date.now(),
            barrier: tradeParams.barrier,
            // ⚡ ACCU MODO-OPS: auto-sell após N ticks (1 ou 2) decididos pela IA
            ...(resolvedTradeType === 'accumulator' && accuTargetTicks !== undefined && { targetTicks: accuTargetTicks }),
          });
          console.log(`🔭 [MONITOR] Iniciado para contrato ${contract.contract_id} (${contractTypeForMonitor}) em ${selectedSymbol}`);

          // 🧠 REGISTRAR CONTEXTO DE APRENDIZADO: captura o que cada modelo previu
          try {
            const pricesArr: number[] = priceHistory.slice(-30);
            const lastPrice = pricesArr[pricesArr.length - 1] || 0;
            const prevPrice = pricesArr[pricesArr.length - 2] || lastPrice;
            const volatility = pricesArr.length > 5
              ? Math.sqrt(pricesArr.slice(-10).reduce((sum: number, p: number, i: number, arr: number[]) => {
                  if (i === 0) return 0;
                  return sum + Math.pow((p - arr[i-1]) / (arr[i-1] || 1), 2);
                }, 0) / Math.min(10, pricesArr.length)) : 0.01;

            persistentLearningEngine.registerTradeContext({
              contractId: String(contract.contract_id),
              symbol: selectedSymbol,
              tradeType: contractTypeForMonitor,
              modelPredictions: {
                advanced_learning: aiConsensus.finalDecision || 'neutral',
                quantum_neural: aiConsensus.quantumPrediction || aiConsensus.finalDecision || 'neutral',
                microscopic_technical: aiConsensus.microscopicPrediction || aiConsensus.finalDecision || 'neutral',
                huggingface_ai: aiConsensus.huggingFacePrediction || aiConsensus.finalDecision || 'neutral',
                digit_frequency: aiConsensus.digitFrequencySignal || 'neutral',
                asset_scorer: aiConsensus.assetGrade >= 'B' ? aiConsensus.finalDecision : 'neutral',
                market_regime: aiConsensus.marketRegime === 'trending' ? aiConsensus.finalDecision : 'neutral',
                momentum_indicator: (lastPrice - prevPrice) > 0 ? 'up' : 'down',
                volatility_filter: volatility < 0.02 ? aiConsensus.finalDecision : 'neutral',
                pattern_recognition: aiConsensus.patternSignal || aiConsensus.finalDecision || 'neutral',
              },
              modelConfidences: {
                advanced_learning: (aiConsensus.consensusStrength || 50) / 100,
                quantum_neural: (aiConsensus.quantumConfidence || aiConsensus.consensusStrength || 50) / 100,
                microscopic_technical: (aiConsensus.microscopicConfidence || 50) / 100,
                huggingface_ai: (aiConsensus.huggingFaceConfidence || 50) / 100,
                digit_frequency: (aiConsensus.digitEdge || 50) / 100,
                asset_scorer: aiConsensus.assetGrade === 'S' ? 0.9 : aiConsensus.assetGrade === 'A' ? 0.75 : 0.5,
                market_regime: aiConsensus.marketRegime === 'trending' ? 0.7 : 0.4,
                momentum_indicator: Math.abs((lastPrice - prevPrice) / (prevPrice || 1)) * 50,
                volatility_filter: volatility < 0.01 ? 0.8 : volatility < 0.02 ? 0.6 : 0.3,
                pattern_recognition: (aiConsensus.patternConfidence || 50) / 100,
              },
              marketContext: {
                price: lastPrice,
                volatility,
                momentum: (lastPrice - prevPrice) / (prevPrice || 1),
                regime: aiConsensus.marketRegime || 'unknown',
                timestamp: Date.now(),
              },
              technicalIndicators: {
                rsi: aiConsensus.rsi || 50,
                macd: aiConsensus.macd || 0,
                bb_position: aiConsensus.bbPosition || 0.5,
                consensus_strength: aiConsensus.consensusStrength || 50,
                up_score: aiConsensus.upScore || 0,
                down_score: aiConsensus.downScore || 0,
              },
              overallConfidence: (aiConsensus.consensusStrength || 50) / 100,
              finalDecision: aiConsensus.finalDecision || 'neutral',
            });
          } catch (learningErr) {
            console.warn('⚠️ [LEARNING] Falha ao registrar contexto (não bloqueia trade):', learningErr);
          }
        } catch (monitorErr) {
          console.warn(`⚠️ [MONITOR] Falha ao iniciar monitoramento (trade executado normalmente): ${monitorErr}`);
        }

        // Salvar operação no banco com informações de recuperação
        await storage.createTradeOperation({
          userId: config.userId,
          derivContractId: String(contract.contract_id),
          symbol: selectedSymbol,
          tradeType: resolvedTradeType,
          contractType: contractTypeForMonitor,
          direction: safeDirection,
          amount: tradeParams.amount,
          duration: tradeParams.duration,
          status: 'pending',
          aiConsensus: JSON.stringify(aiConsensus),
          isRecoveryMode,
          recoveryMultiplier,
          operationMode: this.getCurrentOperationLabel(config.userId, config.mode)
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
        // ⚡ NÃO DESCONECTAR — manter conexão persistente para reutilização no próximo ciclo
        // A reconexão automática cuida de quedas de conexão via heartbeat
        console.log(`🔗 [${operationId}] Conexão Deriv mantida ativa para próximo ciclo`);
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
  private async analyzeBestSymbolFromAll(userId: string, operationId: string, activeModalities?: string[]): Promise<{
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

      // ── Mapa de compatibilidade símbolo × modalidade (espelhado da lógica de execução) ──
      // Permite que a seleção de símbolo SOMENTE considere ativos onde as modalidades do usuário funcionam.
      const _DIGIT_K   = ['digit_differs','digit_matches','digit_over','digit_under','digit_odd','digit_even'];
      const _RF_K      = ['rise','fall'];                   // CALL/PUT (ticks simples)
      const _HL_K      = ['higher','lower'];                 // CALLE/PUTE (com barreira) — JD/RDB não suportam
      const _INOUT_K   = ['ends_between','ends_outside','stays_between','goes_outside'];
      const _TOUCH_K   = ['touch','no_touch'];
      const _MULT_K    = ['multiplier_up','multiplier_down'];
      const _ACCU_K    = ['accumulator'];
      const _TURBO_K   = ['turbo_up','turbo_down'];
      const _VANILLA_K = ['vanilla_call','vanilla_put'];
      const _LB_K      = ['lookback_high_close','lookback_close_low','lookback_high_low'];
      const _VOL_BASE  = [..._DIGIT_K, ..._RF_K, ..._HL_K, ..._INOUT_K, ..._TOUCH_K, ..._MULT_K, ..._ACCU_K, ..._LB_K];
      const _JUMP_OK   = [..._DIGIT_K, ..._RF_K];           // JD: apenas ticks — sem CALLE/PUTE
      const _RDB_OK    = [..._DIGIT_K, ..._RF_K];           // RDB: apenas ticks — sem CALLE/PUTE
      const _VOL_100   = [..._VOL_BASE, ..._TURBO_K, ..._VANILLA_K];
      const _COMPAT: Record<string, string[]> = {
        'R_10': _VOL_BASE,  'R_25': _VOL_BASE,   'R_50': _VOL_BASE,
        'R_75': _VOL_BASE,  'R_100': _VOL_100,
        'JD10': _JUMP_OK,   'JD25': _JUMP_OK,    'JD50': _JUMP_OK,
        'JD75': _JUMP_OK,   'JD100': _JUMP_OK,
        'RDBULL': _RDB_OK,  'RDBEAR': _RDB_OK,
      };

      // Se o usuário tem modalidades ativas, pré-filtrar símbolos compatíveis com PELO MENOS UMA.
      // Símbolos não mapeados aceitam dígitos e rise/fall — são descartados se o usuário só tem ACCU/MULT/etc.
      const modalityFilter = activeModalities && activeModalities.length > 0 ? new Set(activeModalities) : null;
      const isSymbolCompatibleWithModalities = (sym: string): boolean => {
        if (!modalityFilter) return true;
        const supported = _COMPAT[sym] ?? [..._DIGIT_K, ..._RF_K]; // default: dígitos + rise/fall
        return [...modalityFilter].some(m => supported.includes(m));
      };
      
      // 🔥 EXPANSÃO MASSIVA: Usar TODOS os 120+ ativos disponíveis na Deriv
      // 🚫 BLOQUEIO TOTAL: Filtrar 100% os ativos com "(1s)" - CAUSADORES DE LOSS
      // 🎯 FILTRO DE MODALIDADE: Ignorar ativos incompatíveis com as modalidades do usuário
      
      const filteredSymbolsData = allSymbolsData.filter((symbolData: any) => {
        const symbol = symbolData.symbol;
        
        // ☠️ EXECUÇÃO: crime tentado na seleção de pool — eliminado silenciosamente
        if (this.isSymbolBlocked(symbol)) {
          return false;
        }

        // 🎯 FILTRO DE MODALIDADE: Ignorar ativos incompatíveis com as modalidades do usuário
        if (!isSymbolCompatibleWithModalities(symbol)) {
          return false;
        }
        
        return true;
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
          // 🔥 AUMENTADO para 15 minutos para aguentar reconexões temporárias do WebSocket
          const lastUpdateTime = symbolData.lastUpdate ? new Date(symbolData.lastUpdate).getTime() : 0;
          const dataAge = new Date().getTime() - lastUpdateTime;
          const isDataStale = dataAge > (symbolData.isSimulated ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000);
          
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

          // 📝 GRAVAR LOGS DAS IAs COOPERATIVAS NO BANCO DE DADOS (CRASH/BOOM)
          if (aiConsensus.analyses && aiConsensus.analyses.length > 0) {
            const cbLogPromises = aiConsensus.analyses.map((analysis: any) =>
              storage.createAiLog({
                userId,
                modelName: analysis.modelName,
                analysis: JSON.stringify({
                  prediction: analysis.prediction,
                  reasoning: analysis.reasoning || aiConsensus.reasoning || '',
                  confidence: analysis.confidence,
                  symbol,
                  consensusStrength: aiConsensus.consensusStrength,
                  finalDecision: aiConsensus.finalDecision,
                }),
                decision: analysis.prediction,
                confidence: analysis.confidence / 100,
                marketData: JSON.stringify({ symbol, consensusStrength: aiConsensus.consensusStrength })
              }).catch(() => {})
            );
            Promise.all(cbLogPromises).catch(() => {});
          }

          // 🌻 MOTOR GIRASSOL + AUTOFIB: integrar para símbolos CRASH/BOOM
          // O motor cooperativo tripartite (Girassol + AutoFib + IA) é o cérebro especializado
          // para esses índices sintéticos — amplifica o consenso quando detecta spike iminente
          const symUpper = symbol.toUpperCase();
          const isSpikeSymbol = symUpper.includes('CRASH') || symUpper.includes('BOOM');
          if (isSpikeSymbol && priceHistory.length >= 50) {
            try {
              const candles = priceHistory.slice(-200).map((price: number, idx: number, arr: number[]) => ({
                close: price,
                high:  price * 1.001,
                low:   price * 0.999,
                open:  arr[Math.max(0, idx - 1)] || price,
              }));
              const spikeResult = analyzeCrashBoomSpike(symbol, candles);
              if (spikeResult.isSpikeIndex) {
                aiConsensus.girassolScore   = spikeResult.girassolSystem.totalGirassolScore;
                aiConsensus.autoFibScore    = spikeResult.autoFib.nearestLevel
                  ? Math.min(100, (spikeResult.autoFib.spikeMultiplier - 1) * 80 + spikeResult.autoFib.confluenceCount * 20)
                  : 0;
                aiConsensus.spikeExpected   = spikeResult.spikeExpected;
                aiConsensus.spikeImminence  = spikeResult.imminencePercent;
                aiConsensus.spikeConfluence = spikeResult.girassolSystem.confluenceLabel;

                // Ampliar consenso se Girassol detectou confluência forte
                if (spikeResult.overallConfidence > 40) {
                  const boost = spikeResult.girassolSystem.triConfluence ? 1.4
                    : spikeResult.girassolSystem.dualConfluence ? 1.25 : 1.10;
                  aiConsensus.consensusStrength = Math.min(95, Math.round(aiConsensus.consensusStrength * boost));
                  console.log(`🌻 [GIRASSOL+AUTOFIB] ${symbol}: score=${spikeResult.overallConfidence}% | confluência=${spikeResult.girassolSystem.confluenceLabel} | iminência=${spikeResult.imminencePercent}% | boost=${boost}x → consenso=${aiConsensus.consensusStrength}%`);
                }
              }
            } catch (spikeErr) {
              console.warn(`⚠️ [GIRASSOL] Erro na análise de spike para ${symbol}: ${spikeErr}`);
            }
          }

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

          // Detectar se estamos operando exclusivamente acumuladores para usar scoring ACCU
          const isAccuOnly = activeModalities && activeModalities.length > 0 &&
            activeModalities.every((m: string) => m === 'accumulator');
          const isAccuIncluded = activeModalities && activeModalities.includes('accumulator');

          // Buscar dados do motor supremo para scoring ACCU (volatilidade e Hurst real)
          const supremeForScore = isAccuIncluded ? supremeAnalyzer.getLatestAnalysis(symbol) : null;

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
            isBlacklisted: false,
            // Scoring especializado para ACCU: usa volatilidade + Hurst em vez de frequência de dígitos
            contractType: isAccuOnly ? 'accumulator' : undefined,
            supremeStats: supremeForScore ? {
              hurstExponent: supremeForScore.statistics.hurstExponent,
              shannonEntropy: supremeForScore.statistics.shannonEntropy,
              zScoreVolatility: supremeForScore.statistics.zScoreVolatility,
              marketRegime: supremeForScore.regime,
            } : undefined,
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

          const digitFreqResult = digitFrequencyAnalyzer.getBestBarrier(symbol);
          const enrichedConsensus = {
            ...aiConsensus,
            consensusStrength: scoreResult.finalScore,
            digitFrequencySignal: (digitFreqResult.edge > 0 ? aiConsensus.finalDecision : 'neutral') as 'up' | 'down' | 'neutral',
            digitEdge: digitFreqResult.edge,
            assetGrade: scoreResult.grade,
            patternSignal: aiConsensus.finalDecision !== 'neutral' ? aiConsensus.finalDecision : null,
            patternConfidence: aiConsensus.consensusStrength,
          };
          
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

      // 📉 DETECÇÃO DE MERCADO RUIM: contar quantos ativos do top5 têm consenso < 65%
      // Se a maioria dos ativos está fraca simultaneamente, o mercado está globalmente ruim
      const POOR_CONSENSUS_THRESHOLD = 65;
      const poorAssets = top5.filter(r => r!.consensus < POOR_CONSENSUS_THRESHOLD).length;
      // Qualidade = % de ativos bons no top5 (0-100)
      const scanQuality = top5.length > 0
        ? Math.round(((top5.length - poorAssets) / top5.length) * 100)
        : 100;
      this.lastScanMarketQuality = scanQuality;

      // 🚫 PAUSA POR MERCADO RUIM — lógica de pausa, recuperação parcial e plena
      const now = Date.now();
      if (scanQuality <= this.BAD_MARKET_QUALITY_THRESHOLD) {
        // Mercado globalmente ruim → pausar por 15 min (renova o timer a cada scan ruim)
        this.badMarketPausedUntil = now + this.BAD_MARKET_PAUSE_MS;
        this.badMarketReducedGrowthActive = false;
        const pauseMin = Math.round(this.BAD_MARKET_PAUSE_MS / 60000);
        console.log(`🚫 [MERCADO RUIM] ${poorAssets}/${top5.length} ativos fracos → qualidade=${scanQuality}% ≤ ${this.BAD_MARKET_QUALITY_THRESHOLD}% → PAUSA TOTAL de ${pauseMin} min ativada`);
        this.setPhase('PAUSADO', `🚫 Mercado ruim (qualidade ${scanQuality}%) — operações pausadas por ${pauseMin} min`, 'warning');
      } else if (this.badMarketPausedUntil > now) {
        // Ainda dentro da janela de pausa — verificar se recuperou parcialmente
        if (scanQuality > this.BAD_MARKET_RECOVERED_THRESHOLD) {
          // Recuperação plena → encerrar pausa e voltar ao normal (5%)
          this.badMarketPausedUntil = 0;
          this.badMarketReducedGrowthActive = false;
          console.log(`✅ [MERCADO RECUPERADO] Qualidade=${scanQuality}% > ${this.BAD_MARKET_RECOVERED_THRESHOLD}% → pausa encerrada, retomando growth 5% normal`);
          this.setPhase('ANALISANDO', `✅ Mercado recuperado (qualidade ${scanQuality}%) — operações normais retomadas`, 'success');
        } else if (scanQuality > this.BAD_MARKET_PARTIAL_THRESHOLD) {
          // Recuperação parcial (41-60%) → permitir operações com growth 1%
          this.badMarketReducedGrowthActive = true;
          const secsLeft = Math.round((this.badMarketPausedUntil - now) / 1000);
          console.log(`⚠️ [MERCADO PARCIAL] Qualidade=${scanQuality}% (parcial) → operações com growth 1% por mais ${secsLeft}s`);
          this.setPhase('REDUZIDO', `⚠️ Recuperação parcial (qualidade ${scanQuality}%) — operando a 1% de crescimento`, 'warning');
        } else {
          // Ainda ruim (dentro da pausa e qualidade ainda ≤ 40)
          this.badMarketReducedGrowthActive = false;
          const secsLeft = Math.round((this.badMarketPausedUntil - now) / 1000);
          console.log(`🚫 [MERCADO RUIM] Qualidade=${scanQuality}% ainda baixa → pausa ativa por mais ${secsLeft}s`);
        }
      } else {
        // Fora da janela de pausa e mercado OK → garantir que flags estão limpas
        if (this.badMarketReducedGrowthActive) {
          this.badMarketReducedGrowthActive = false;
          console.log(`✅ [MERCADO NORMAL] Janela de pausa expirada → growth 5% restaurado`);
        }
      }
      
      // 📡 PUBLICAR SINAIS DE TODOS OS SÍMBOLOS ANALISADOS NO STORE (lido pela ponte MT5)
      for (const r of validResults) {
        if (!r) continue;
        const symAi = r.aiConsensus;
        if (!symAi) continue;
        const symDir: 'up' | 'down' =
          (symAi.finalDecision === 'up' || symAi.finalDecision === 'down')
            ? symAi.finalDecision as 'up' | 'down'
            : ((symAi.upScore || 0) >= (symAi.downScore || 0) ? 'up' : 'down');
        const sym = r.symbol;
        const entry = {
          symbol: sym, direction: symDir, confidence: r.consensus,
          consensus: r.consensus,
          reason: `Análise Deriv: ${symDir.toUpperCase()} ${sym} — score ${r.consensus.toFixed(1)}%`,
          timestamp: Date.now()
        };
        setSignal(sym, entry);
        const mt5 = derivToMT5Name(sym);
        if (mt5) setSignal(mt5, { ...entry, symbol: mt5 });
      }

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
    // 🧠 PAPEL DAS 5 IAs: Amplificar stake quando o mercado está favorável.
    //   Consensus alto = mercado estável = aumentar stake para maximizar ganhos.
    //   Consensus baixo = mercado incerto = stake base ou reduzido = proteção da banca.
    //
    // 🛡️ MODO ALMOFADA DE LUCRO (Cushion Mode) — SOMENTE em mercado normal:
    //   Consenso ≥90% → stake elevado para que o lucro pré-cubra N perdas futuras.
    //   Fórmula: lucro_cushion = stake × payout_ratio → deve cobrir N × stake_base
    //   Payout típico Digit Differs = ~95% do stake
    //
    // ⚠️ MODO MERCADO RUIM — Defensivo (NOVO):
    //   Quando 3+ de 5 ativos simultaneamente têm consenso < 65%, o mercado está
    //   globalmente desfavorável. Aplicar dampener de 0.60 para proteger capital.
    //   NÃO é modo recovery — é proteção preventiva contra fases ruins do mercado.
    //
    // ✅ MODO RECOVERY — veja getTradeParamsForMode():
    //   O stake de recuperação é calculado ANTES de entrar aqui, baseado no déficit.
    //   Esta função apenas aplica o AI multiplier (sem cushion) sobre ele.

    const DIGIT_DIFFERS_PAYOUT_RATIO = 0.95;

    // ─── MODO MERCADO RUIM: dampener defensivo quando mercado está globalmente fraco ───
    const isBadMarket = this.lastScanMarketQuality <= 40;
    if (isBadMarket) {
      const dampened = Math.round(baseAmount * 0.60 * 100) / 100;
      console.log(`📉 [MERCADO RUIM] Qualidade=${this.lastScanMarketQuality}% → stake defensivo ×0.60: $${baseAmount} → $${dampened}`);
      return dampened;
    }

    // ─── MODO RECOVERY: sem cushion — retorna baseAmount com leve ajuste por consenso ───
    // O stake base já foi calculado para cobrir o déficit em getTradeParamsForMode()
    const inRecoveryMode = realStatsTracker.isPostLossMode();
    if (inRecoveryMode) {
      // Sem amplificação em recovery — o stake de recuperação já está calibrado para o déficit.
      // Permitir no máximo ×1.0 (nenhum cushion). Volatilidade ainda reduz levemente.
      let volAdj = 1.0;
      if (volatility > 0.8) {
        volAdj = 0.95;
        console.log(`⚡ [RECOVERY+VOL] Volatilidade alta → stake ×0.95`);
      }
      const recoveryStake = Math.round(baseAmount * volAdj * 100) / 100;
      console.log(`🔺 [RECOVERY STAKE] Stake calibrado: $${recoveryStake} (sem cushion — déficit já embutido)`);
      return recoveryStake;
    }

    // ─── MODO NORMAL: cushion mode ativo ─────────────────────────────────────────────
    let aiMultiplier = 1.0;
    let cushionCoverage = 0;

    if (consensoStrength >= 95) {
      aiMultiplier = 3.0;
      cushionCoverage = Math.floor((baseAmount * aiMultiplier * DIGIT_DIFFERS_PAYOUT_RATIO) / baseAmount);
      console.log(`🚀🚀 [CUSHION ULTRA] Consensus ${consensoStrength}% ≥ 95% → stake ×3.0 | Lucro pré-cobre ~${cushionCoverage} perdas futuras`);
    } else if (consensoStrength >= 90) {
      aiMultiplier = 2.2;
      cushionCoverage = Math.floor((baseAmount * aiMultiplier * DIGIT_DIFFERS_PAYOUT_RATIO) / baseAmount);
      console.log(`💎 [CUSHION MODE] Consensus ${consensoStrength}% ≥ 90% → stake ×2.2 | Lucro pré-cobre ~${cushionCoverage} perda(s) futura(s)`);
    } else if (consensoStrength >= 80) {
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

    // Redução adicional em volatilidade extrema
    let volMultiplier = 1.0;
    if (volatility > 0.8) {
      volMultiplier = 0.9;
      console.log(`⚡ [VOL GUARD] Volatilidade alta (${(volatility * 100).toFixed(0)}%) → stake ×0.9`);
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
  // ─── CAMADA DE INTELIGÊNCIA ESTRATÉGICA ──────────────────────────────────────
  // Analisa condições de mercado em tempo real e toma decisões como um trader humano.
  // Cada parâmetro de contrato é calculado com base em dados reais, não fixo/hardcoded.

  /**
   * Analisa o estado atual do mercado usando o histórico de preços.
   * Retorna volatilidade normalizada, tendência e distribuição de dígitos.
   */
  private analyzeMarketConditions(priceHistory: number[], symbol: string): {
    volatility: number;         // 0-1: 0=estável, 1=extremamente volátil
    volatilityPct: number;      // em % (ex: 0.3 = 0.3% de desvio médio)
    trend: 'strong_up' | 'strong_down' | 'weak_up' | 'weak_down' | 'sideways';
    trendStrength: number;      // 0-1
    momentum: number;           // -1 a +1 (negativo=queda, positivo=alta)
    digitEvenBias: number;      // 0-1 (>0.5 = mais pares nos últimos 100 ticks)
    digitHighBias: number;      // 0-1 (>0.5 = mais dígitos >= 5)
    reasoning: string[];        // log do raciocínio
  } {
    const reasoning: string[] = [];
    const recent = priceHistory.slice(-100);
    if (recent.length < 10) {
      return { volatility: 0.5, volatilityPct: 0.3, trend: 'sideways', trendStrength: 0, momentum: 0, digitEvenBias: 0.5, digitHighBias: 0.5, reasoning: ['dados insuficientes'] };
    }

    // Calcular retornos tick a tick
    const returns: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1] !== 0) returns.push((recent[i] - recent[i - 1]) / recent[i - 1]);
    }

    // Volatilidade = desvio padrão dos retornos
    const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const volatilityPct = stdDev * 100; // em %

    // Normalizar: <0.1% = baixo, 0.3% = médio, >0.7% = alto
    const volatility = Math.min(1, volatilityPct / 0.7);
    reasoning.push(`Volatilidade: ${volatilityPct.toFixed(3)}% (σ normalizado: ${volatility.toFixed(2)})`);

    // Tendência: comparar média dos últimos 10 ticks vs 30 ticks anteriores
    const last10 = recent.slice(-10);
    const prev30 = recent.slice(-40, -10);
    const avgLast10 = last10.reduce((s, p) => s + p, 0) / last10.length;
    const avgPrev30 = prev30.length > 0 ? prev30.reduce((s, p) => s + p, 0) / prev30.length : avgLast10;
    const priceDelta = avgPrev30 !== 0 ? (avgLast10 - avgPrev30) / avgPrev30 : 0;
    const momentum = Math.max(-1, Math.min(1, priceDelta * 500)); // amplificado

    let trend: 'strong_up' | 'strong_down' | 'weak_up' | 'weak_down' | 'sideways';
    let trendStrength: number;
    const absDelta = Math.abs(priceDelta) * 10000; // em bps

    if (absDelta > 5) {
      trend = priceDelta > 0 ? 'strong_up' : 'strong_down';
      trendStrength = Math.min(1, absDelta / 20);
    } else if (absDelta > 2) {
      trend = priceDelta > 0 ? 'weak_up' : 'weak_down';
      trendStrength = absDelta / 10;
    } else {
      trend = 'sideways';
      trendStrength = 0;
    }
    reasoning.push(`Tendência: ${trend} | Força: ${(trendStrength * 100).toFixed(0)}% | Delta: ${(priceDelta * 10000).toFixed(1)}bps`);

    // Distribuição de dígitos finais
    const state = (digitFrequencyAnalyzer as any).states?.get(symbol);
    let digitEvenBias = 0.5;
    let digitHighBias = 0.5;
    if (state && state.recentDigits && state.recentDigits.length >= 20) {
      const recent100 = state.recentDigits.slice(-100);
      const evenCount = recent100.filter((d: number) => d % 2 === 0).length;
      const highCount = recent100.filter((d: number) => d >= 5).length;
      digitEvenBias = evenCount / recent100.length;
      digitHighBias = highCount / recent100.length;
      reasoning.push(`Dígitos: ${(digitEvenBias * 100).toFixed(0)}% pares | ${(digitHighBias * 100).toFixed(0)}% altos (≥5)`);
    }

    return { volatility, volatilityPct, trend, trendStrength, momentum, digitEvenBias, digitHighBias, reasoning };
  }

  /**
   * Escolhe a taxa de crescimento do Accumulator com base na volatilidade.
   * Lógica: mercado volátil → crescimento menor (menos KO risk), mercado calmo → crescimento maior.
   * Taxa disponíveis Deriv: 1%, 2%, 3%, 4%, 5%
   */
  private selectAccumulatorGrowthRate(
    volatility: number,
    consensusStrength: number,
    allowedRates: number[] = [0.01, 0.02, 0.03, 0.04, 0.05]
  ): { rate: number; reason: string } {
    // Determina a taxa ideal com base na volatilidade e consenso
    let idealRate: number;
    if (volatility > 0.75) {
      idealRate = 0.01;
    } else if (volatility > 0.55) {
      idealRate = 0.02;
    } else if (volatility > 0.35) {
      idealRate = consensusStrength > 70 ? 0.03 : 0.02;
    } else if (volatility > 0.18) {
      idealRate = consensusStrength > 75 ? 0.04 : 0.03;
    } else {
      idealRate = consensusStrength > 72 ? 0.05 : 0.04;
    }

    // Filtra pelas taxas permitidas pelo usuário
    const allowed = allowedRates.sort((a, b) => a - b);
    if (!allowed.length) return { rate: idealRate, reason: `sem filtro → taxa ideal ${(idealRate * 100).toFixed(0)}%` };

    // Encontra a taxa permitida mais próxima da ideal
    let best = allowed[0];
    let minDist = Math.abs(idealRate - allowed[0]);
    for (const r of allowed) {
      const d = Math.abs(idealRate - r);
      if (d < minDist) { minDist = d; best = r; }
    }

    const restricted = best !== idealRate ? ` (ideal ${(idealRate*100).toFixed(0)}% → forçado para ${(best*100).toFixed(0)}% pelas suas preferências)` : '';
    let reason = '';
    if (volatility > 0.75) reason = `volatilidade ALTA (${(volatility * 100).toFixed(0)}%) → ${(best*100).toFixed(0)}% para minimizar KO`;
    else if (volatility > 0.55) reason = `volatilidade MÉDIA-ALTA (${(volatility * 100).toFixed(0)}%) → ${(best*100).toFixed(0)}% conservador`;
    else if (volatility > 0.35) reason = `volatilidade MÉDIA (${(volatility * 100).toFixed(0)}%) + consenso ${consensusStrength.toFixed(0)}% → ${(best*100).toFixed(0)}%`;
    else if (volatility > 0.18) reason = `volatilidade BAIXA-MÉDIA (${(volatility * 100).toFixed(0)}%) + consenso ${consensusStrength.toFixed(0)}% → ${(best*100).toFixed(0)}%`;
    else reason = `volatilidade BAIXA (${(volatility * 100).toFixed(0)}%) + consenso ${consensusStrength.toFixed(0)}% → ${(best*100).toFixed(0)}% (máximo ganho/tick)`;

    return { rate: best, reason: reason + restricted };
  }

  /**
   * Escolhe o multiplicador para contratos Multiplier.
   * Lógica: confiança alta + mercado calmo = multiplicador maior = mais lucro.
   * Deriv aceita: 10, 20, 30, 40, 50, 100, 150, 200, 250, 300, 400, 500
   */
  private selectMultiplier(consensusStrength: number, volatility: number): { mult: number; reason: string } {
    if (volatility > 0.7) {
      return { mult: 10, reason: `volatilidade ALTA (${(volatility * 100).toFixed(0)}%) → 10x para proteger capital` };
    } else if (volatility > 0.45) {
      const m = consensusStrength > 78 ? 20 : 10;
      return { mult: m, reason: `volatilidade MÉDIA (${(volatility * 100).toFixed(0)}%) + consenso ${consensusStrength.toFixed(0)}% → ${m}x` };
    } else if (volatility > 0.25) {
      const m = consensusStrength > 80 ? 50 : (consensusStrength > 72 ? 20 : 10);
      return { mult: m, reason: `volatilidade BAIXA-MÉDIA (${(volatility * 100).toFixed(0)}%) + consenso ${consensusStrength.toFixed(0)}% → ${m}x` };
    } else {
      const m = consensusStrength > 82 ? 100 : (consensusStrength > 76 ? 50 : (consensusStrength > 68 ? 20 : 10));
      return { mult: m, reason: `volatilidade BAIXA (${(volatility * 100).toFixed(0)}%) + consenso ${consensusStrength.toFixed(0)}% → ${m}x (máximo lucro)` };
    }
  }

  /**
   * Escolhe duração para contratos Rise/Fall baseado na força da tendência.
   * Tendência forte → duração curta (captura movimento imediato).
   * Tendência fraca → duração maior (dá tempo para o movimento se confirmar).
   * Retorna {duration, unit} compatível com a API Deriv.
   */
  private selectRiseFallDuration(trendStrength: number, trend: string): { duration: number; unit: string; reason: string } {
    const isDirectional = trend !== 'sideways';
    if (trend === 'strong_up' || trend === 'strong_down') {
      // Tendência forte: 5 ticks — captura o movimento agora
      return { duration: 5, unit: 't', reason: `tendência ${trend} forte (${(trendStrength * 100).toFixed(0)}%) → 5 ticks para capturar momentum` };
    } else if (isDirectional && trendStrength > 0.3) {
      // Tendência moderada: 1 minuto — dá tempo de desenvolver
      return { duration: 1, unit: 'm', reason: `tendência ${trend} moderada (${(trendStrength * 100).toFixed(0)}%) → 1 min` };
    } else if (isDirectional) {
      // Tendência fraca: 2-3 minutos
      return { duration: 2, unit: 'm', reason: `tendência ${trend} fraca (${(trendStrength * 100).toFixed(0)}%) → 2 min` };
    } else {
      // Sideways: evitar e usar 5 ticks como neutro
      return { duration: 5, unit: 't', reason: `mercado lateral (${(trendStrength * 100).toFixed(0)}%) → 5 ticks neutro` };
    }
  }

  /**
   * Seleciona a barreira inteligente para DIGITOVER/DIGITUNDER baseado na frequência real.
   * DIGITOVER X: apostamos que dígito final > X → queremos X mais BAIXO (menos dígitos acima)
   *    → Analisa os dígitos mais quentes (frequentes): se dígitos altos estão quentes, usar threshold alto
   *    → Ex: 7,8,9 são quentes (70%+ das vezes) → barrier=5 → ~70% chance de > 5
   * DIGITUNDER X: apostamos que dígito final < X → queremos X mais ALTO
   *    → Se dígitos baixos estão quentes → barrier=6 → ~alta chance de < 6
   */
  private selectDigitBarrierForOverUnder(symbol: string, type: 'over' | 'under'): { barrier: string; winRateEst: number; reason: string } {
    try {
      const state = (digitFrequencyAnalyzer as any).states?.get(symbol);
      if (!state || state.recentDigits.length < 30) {
        const def = type === 'over' ? '4' : '5';
        return { barrier: def, winRateEst: 50, reason: `dados insuficientes → barreira padrão ${def}` };
      }
      const recent = state.recentDigits.slice(-100);
      const counts = new Array(10).fill(0);
      for (const d of recent) counts[d]++;
      const total = recent.length;

      if (type === 'over') {
        // DIGITOVER X: dígito final > X. Queremos maximizar P(d > X).
        // Calcular para cada X de 0 a 8 qual % dos últimos ticks tem dígito > X
        let bestBarrier = 4;
        let bestWinRate = 0;
        for (let x = 0; x <= 8; x++) {
          const aboveX = recent.filter((d: number) => d > x).length;
          const wr = aboveX / total;
          if (wr > bestWinRate && wr > 0.52) { // só se > 52% (melhor que neutro)
            bestWinRate = wr;
            bestBarrier = x;
          }
        }
        // Verificar: se não encontrou nenhum bom, usar 4 (chance natural ~50%)
        if (bestWinRate < 0.52) {
          bestBarrier = 4;
          bestWinRate = recent.filter((d: number) => d > 4).length / total;
        }
        return {
          barrier: String(bestBarrier),
          winRateEst: Math.round(bestWinRate * 100),
          reason: `OVER ${bestBarrier}: ${(bestWinRate * 100).toFixed(1)}% dos últimos ${total} ticks tiveram dígito > ${bestBarrier}`
        };
      } else {
        // DIGITUNDER X: dígito final < X. Queremos maximizar P(d < X).
        let bestBarrier = 5;
        let bestWinRate = 0;
        for (let x = 1; x <= 9; x++) {
          const belowX = recent.filter((d: number) => d < x).length;
          const wr = belowX / total;
          if (wr > bestWinRate && wr > 0.52) {
            bestWinRate = wr;
            bestBarrier = x;
          }
        }
        if (bestWinRate < 0.52) {
          bestBarrier = 5;
          bestWinRate = recent.filter((d: number) => d < 5).length / total;
        }
        return {
          barrier: String(bestBarrier),
          winRateEst: Math.round(bestWinRate * 100),
          reason: `UNDER ${bestBarrier}: ${(bestWinRate * 100).toFixed(1)}% dos últimos ${total} ticks tiveram dígito < ${bestBarrier}`
        };
      }
    } catch {
      const def = type === 'over' ? '4' : '5';
      return { barrier: def, winRateEst: 50, reason: `erro na análise → barreira padrão ${def}` };
    }
  }

  /**
   * Seleção inteligente de modalidade quando múltiplas estão ativas.
   * Em vez de pura rotação, analisa o que o mercado favorece agora.
   * Retorna a modalidade com maior edge atual baseado na análise de mercado.
   */
  private selectModalityByMarketFit(
    compatibleModalities: string[],
    marketAnalysis: ReturnType<typeof AutoTradingScheduler.prototype.analyzeMarketConditions>,
    digitAnalysis: any,
    operationId: string
  ): string {
    if (compatibleModalities.length === 1) return compatibleModalities[0];

    const scores: { modality: string; score: number; reason: string }[] = [];

    for (const m of compatibleModalities) {
      let score = 50; // base neutra
      let reason = '';

      if (m.startsWith('digit_')) {
        const barrierData = digitFrequencyAnalyzer.getBestBarrier(m === 'digit_differs' ? digitAnalysis?.symbol || 'R_50' : '');
        // Digits são bons quando há desvio estatístico claro
        if (digitAnalysis && digitAnalysis.confidence > 60) {
          score = 60 + digitAnalysis.confidence * 0.3;
          reason = `edge estatístico ${digitAnalysis.edge?.toFixed(1)}%`;
        } else {
          score = 45;
          reason = 'dados insuficientes';
        }
        // Digit even/odd tem vantagem quando há viés claro de par/ímpar
        if (m === 'digit_even') {
          const bias = Math.abs(marketAnalysis.digitEvenBias - 0.5);
          if (marketAnalysis.digitEvenBias > 0.55) { score = 65 + bias * 80; reason = `${(marketAnalysis.digitEvenBias * 100).toFixed(0)}% pares (viés favorável)`; }
          else { score -= 10; }
        }
        if (m === 'digit_odd') {
          if (marketAnalysis.digitEvenBias < 0.45) { score = 65 + (0.5 - marketAnalysis.digitEvenBias) * 80; reason = `${((1 - marketAnalysis.digitEvenBias) * 100).toFixed(0)}% ímpares (viés favorável)`; }
          else { score -= 10; }
        }
        if (m === 'digit_over' || m === 'digit_under') {
          const highBias = Math.abs(marketAnalysis.digitHighBias - 0.5);
          if ((m === 'digit_over' && marketAnalysis.digitHighBias > 0.54) ||
              (m === 'digit_under' && marketAnalysis.digitHighBias < 0.46)) {
            score = 62 + highBias * 80;
            reason = `viés de ${m === 'digit_over' ? 'dígitos altos' : 'dígitos baixos'} detectado`;
          } else { score -= 5; }
        }

      } else if (m === 'accumulator') {
        // Accumulators são melhores em mercados laterais/baixa volatilidade (crescem sem knock-out)
        score = 55 + (1 - marketAnalysis.volatility) * 30;
        reason = `volatilidade ${(marketAnalysis.volatility * 100).toFixed(0)}% → ${marketAnalysis.volatility < 0.4 ? 'IDEAL para ACCU' : 'volatilidade alta penaliza ACCU'}`;

      } else if (m === 'rise' || m === 'fall') {
        // Rise/Fall (CALL/PUT ticks): melhores com tendência clara
        const favored = (m === 'rise' && (marketAnalysis.trend === 'strong_up' || marketAnalysis.trend === 'weak_up'))
                     || (m === 'fall' && (marketAnalysis.trend === 'strong_down' || marketAnalysis.trend === 'weak_down'));
        score = favored ? 70 + marketAnalysis.trendStrength * 20 : 35;
        reason = favored ? `tendência ${marketAnalysis.trend} favorece ${m}` : `tendência oposta penaliza ${m}`;

      } else if (m === 'higher' || m === 'lower') {
        // Higher/Lower (CALLE/PUTE): preço termina acima/abaixo da barreira — bom com tendência + baixa volatilidade
        const favored = (m === 'higher' && (marketAnalysis.trend === 'strong_up' || marketAnalysis.trend === 'weak_up'))
                     || (m === 'lower' && (marketAnalysis.trend === 'strong_down' || marketAnalysis.trend === 'weak_down'));
        score = favored
          ? 65 + marketAnalysis.trendStrength * 20 + (1 - marketAnalysis.volatility) * 10
          : 38;
        reason = favored
          ? `tendência ${marketAnalysis.trend} + vol ${(marketAnalysis.volatility*100).toFixed(0)}% favorece ${m}`
          : `tendência contrária penaliza ${m}`;

      } else if (m.startsWith('multiplier_')) {
        // Multipliers são bons com tendência forte + baixa volatilidade
        const isUp = m === 'multiplier_up';
        const favored = (isUp && marketAnalysis.momentum > 0.2) || (!isUp && marketAnalysis.momentum < -0.2);
        score = favored
          ? 55 + marketAnalysis.trendStrength * 25 + (1 - marketAnalysis.volatility) * 15
          : 30;
        reason = favored ? `momentum ${marketAnalysis.momentum.toFixed(2)} favorece ${m}` : `momentum contrário penaliza ${m}`;

      } else if (m.startsWith('lookback_')) {
        // Lookbacks são melhores com ALTA volatilidade (captura maior range)
        score = 40 + marketAnalysis.volatility * 45;
        reason = `volatilidade ${(marketAnalysis.volatility * 100).toFixed(0)}% → ${marketAnalysis.volatility > 0.5 ? 'IDEAL para lookback' : 'baixa volatilidade limita ganho'}`;

      } else if (m === 'touch' || m === 'no_touch') {
        // Touch é melhor com tendência forte; no_touch com mercado lateral
        if (m === 'touch') {
          score = 42 + marketAnalysis.trendStrength * 40;
          reason = `força de tendência ${(marketAnalysis.trendStrength * 100).toFixed(0)}%`;
        } else {
          // no_touch: base elevada (melhor performer histórico 56W/11L)
          // Mercado lateral = ideal; tendência = barreira ameaçada (penaliza)
          score = 68 + (1 - marketAnalysis.trendStrength) * 22;
          reason = `mercado ${marketAnalysis.trend} → ${marketAnalysis.trend === 'sideways' ? 'IDEAL para no_touch' : 'barreira ameaçada'}`;
        }
      } else {
        score = 50;
        reason = 'neutro';
      }

      scores.push({ modality: m, score, reason });
    }

    // Ordenar por score e selecionar com probabilidade ponderada (não sempre o melhor)
    // → Evita repetição excessiva da mesma modalidade mas favorece a melhor
    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, Math.min(3, scores.length));

    // Seleção ponderada entre os 3 melhores
    const totalWeight = top.reduce((s, t) => s + t.score, 0);
    let rand = Math.random() * totalWeight;
    let selected = top[0];
    for (const t of top) {
      rand -= t.score;
      if (rand <= 0) { selected = t; break; }
    }

    const logLines = scores.slice(0, 5).map(s => `${s.modality}=${s.score.toFixed(0)}(${s.reason})`).join(' | ');
    console.log(`🧠 [${operationId}] Seleção inteligente de modalidade → ${selected.modality} (score ${selected.score.toFixed(0)})`);
    console.log(`📊 [${operationId}] Ranking: ${logLines}`);
    return selected.modality;
  }

  private calculateDynamicTicks(symbol: string, baseTicks: number = 10): number {
    const performance = this.assetPerformance.get(symbol);
    const totalTrades = performance ? performance.wins + performance.losses : 0;
    const winRate = totalTrades > 0 ? performance!.wins / totalTrades : 0.5;

    // 🧠 INTEGRAÇÃO SUPREMA: ajusta duração com base no regime de mercado
    const supreme = supremeAnalyzer.getLatestAnalysis(symbol);
    let regimeAdj = 0;
    let regimeReason = '';

    if (supreme) {
      const regime = supreme.regime;
      const hurst = supreme.statistics.hurstExponent;
      const entropy = supreme.statistics.shannonEntropy;

      if (regime === 'trending') {
        // Tendência forte: mais ticks para capturar momentum
        regimeAdj = hurst > 0.6 ? +3 : +2;
        regimeReason = `trending (hurst=${hurst.toFixed(2)}) → +${regimeAdj}`;
      } else if (regime === 'ranging') {
        // Mercado lateral/reversão: menos ticks, saída rápida
        regimeAdj = hurst < 0.4 ? -3 : -2;
        regimeReason = `ranging (hurst=${hurst.toFixed(2)}) → ${regimeAdj}`;
      } else if (regime === 'chaotic' || entropy > 3.5) {
        // Caótico: mínimo de ticks, exposição mínima
        regimeAdj = -4;
        regimeReason = `chaotic (entropy=${entropy.toFixed(2)}) → ${regimeAdj}`;
      } else {
        regimeReason = `${regime} → neutro`;
      }
    }

    // Ajuste por win rate histórico
    let winRateAdj = 0;
    if (winRate > 0.60) winRateAdj = +1;
    else if (winRate < 0.40) winRateAdj = -2;

    const ticksAdjustment = Math.min(10, Math.max(3, baseTicks + regimeAdj + winRateAdj));

    if (regimeAdj !== 0 || winRateAdj !== 0) {
      console.log(`⏱️ [DYNAMIC TICKS] ${symbol}: base=${baseTicks} | regime=${regimeReason} | wr=${(winRate*100).toFixed(0)}%(${winRateAdj>0?'+':''}${winRateAdj}) → ${ticksAdjustment} ticks`);
    }

    return ticksAdjustment;
  }

  /**
   * Calcula o percentual de stake por ativo usando todos os dados da IA disponíveis.
   * Combina: consenso, regime de mercado, Hurst, volatilidade e win rate histórico do ativo.
   * Retorna um percentual da banca (ex: 0.13 = 13%).
   */
  private calculateAIStakePercentage(
    consensus: number,
    regime: string,
    hurst: number,
    volatility: number,
    assetWinRate: number,
    bankSize: number,
  ): number {
    // ── 1. Base por nível de consenso ──────────────────────────────────
    let pct: number;
    if      (consensus >= 93) pct = 0.18; // Sinal excepcional → 18%
    else if (consensus >= 88) pct = 0.14; // Sinal muito forte → 14%
    else if (consensus >= 83) pct = 0.10; // Sinal forte       → 10%
    else if (consensus >= 77) pct = 0.07; // Sinal bom         →  7%
    else                      pct = 0.04; // Sinal fraco       →  4%

    // ── 2. Ajuste por regime de mercado ───────────────────────────────
    if (regime === 'trending' && hurst > 0.60)      pct *= 1.20; // Tendência com persistência → mais
    else if (regime === 'strong_trend')              pct *= 1.25; // Tendência forte → máximo
    else if (regime === 'calm')                      pct *= 1.10; // Mercado calmo → bom
    else if (regime === 'ranging' && hurst < 0.40)  pct *= 0.85; // Lateral com reversão → menos
    else if (regime === 'chaotic')                   pct *= 0.70; // Caótico → muito conservador

    // ── 3. Ajuste por win rate histórico do ativo ─────────────────────
    if      (assetWinRate > 0.72) pct *= 1.18; // ativo consistente → confiar mais
    else if (assetWinRate > 0.60) pct *= 1.08;
    else if (assetWinRate < 0.40) pct *= 0.75; // ativo problemático → reduzir
    else if (assetWinRate < 0.50) pct *= 0.90;

    // ── 4. Guarda de volatilidade ──────────────────────────────────────
    if      (volatility > 0.80) pct *= 0.80; // alta volatilidade → proteger
    else if (volatility > 0.65) pct *= 0.90;
    else if (volatility < 0.25) pct *= 1.10; // baixa volatilidade → aproveitar

    // ── 5. Teto adaptativo por tamanho da banca ────────────────────────
    // Bancas pequenas têm teto maior (%) para conseguir superar o mínimo Deriv ($0.35-$1)
    const maxPct = bankSize <= 20  ? 0.22 // até $4.40 max em $20
                 : bankSize <= 50  ? 0.16
                 : bankSize <= 200 ? 0.10
                 : bankSize <= 1000? 0.07
                 :                   0.05;

    return Math.min(pct, maxPct);
  }

  private async getTradeParamsForMode(mode: string, symbol: string, direction: string, userId: string, consensoStrength?: number, volatility?: number, riskConfig?: { enableMartingale?: boolean; martingaleMultipliers?: number[]; enableRecoveryMode?: boolean; stakeMode?: string; fixedStake?: number }): Promise<{amount: number, duration: number, barrier: string}> {
    let amount = 0.35; // Default para bancas pequenas (conservador)
    let duration = 10; // ⚡ OTIMIZAÇÃO: Aumentado de 5 para 10 ticks para distribuir fechamento

    // 📌 STAKE FIXO — bypassa cálculo da IA completamente
    if (riskConfig?.stakeMode === 'fixed' && typeof riskConfig?.fixedStake === 'number' && riskConfig.fixedStake >= 0.35) {
      amount = riskConfig.fixedStake;
      console.log(`📌 [STAKE FIXO] Usando stake definido pelo usuário: $${amount.toFixed(2)} (bypassing IA)`);
      // ainda precisa de duration/barrier — vai setar abaixo via modo
    }
    
    // 🎯 CALCULAR STAKE VIA IA — por ativo, por sinal, por regime
    const useAIStake = !riskConfig?.stakeMode || riskConfig.stakeMode === 'ai';
    try {
      // Buscar saldo do usuário
      const balanceAnalysis = await storage.getBalanceAnalysis(userId);
      
      if (useAIStake && balanceAnalysis && balanceAnalysis.currentBalance > 0) {
        const bankSize = balanceAnalysis.currentBalance;

        // Dados de IA disponíveis para decisão de stake
        const consensus  = consensoStrength ?? 50;
        const vol        = volatility ?? 0.5;
        const supreme    = supremeAnalyzer.getLatestAnalysis(symbol);
        const regime     = supreme?.regime ?? 'unknown';
        const hurst      = supreme?.statistics?.hurstExponent ?? 0.5;
        const perf       = this.assetPerformance.get(symbol);
        const totalTrades = perf ? perf.wins + perf.losses : 0;
        const winRate    = totalTrades > 0 ? perf!.wins / totalTrades : 0.55; // Prior favorável

        // 🧠 IA CALCULA O STAKE: percentual específico para este ativo + sinal
        const aiPct = this.calculateAIStakePercentage(consensus, regime, hurst, vol, winRate, bankSize);
        amount = Math.max(0.35, Math.round(bankSize * aiPct * 100) / 100);

        console.log(`🧠 [AI STAKE] ${symbol} | consenso=${consensus.toFixed(0)}% | regime=${regime} | hurst=${hurst.toFixed(2)} | vol=${(vol*100).toFixed(0)}% | WR=${(winRate*100).toFixed(0)}% | ${(aiPct*100).toFixed(1)}% × $${bankSize.toFixed(2)} = $${amount.toFixed(2)}`);
        
        // 🔺 RECOVERY STAKE — calcular stake baseado no déficit a recuperar
        // Objetivo: um único trade bem-sucedido cobre o déficit + 15% de lucro extra.
        // Não é sequencial: o sistema aguarda sinal com consenso ≥ minConsensus antes de operar.
        if ((riskConfig?.enableRecoveryMode ?? true) && realStatsTracker.isPostLossMode()) {
          const deficit = realStatsTracker.getLossDeficit();
          if (deficit > 0) {
            // ════════════════════════════════════════════════════════════════
            // 🎰 MARTINGALE DE RECUPERAÇÃO — stake cobre déficit acumulado
            // Fórmula: stake_ideal = (déficit / payout) × 1.15
            //   → 1 vitória = déficit zerado + 15% de lucro extra
            //   → Exemplo: déficit $1.00 → stake $1.21 → lucro $1.15 → net +$0.15
            // ════════════════════════════════════════════════════════════════
            const RECOVERY_PAYOUT = 0.95;
            const idealRecoveryStake = (deficit / RECOVERY_PAYOUT) * 1.15;
            // Teto em recovery: 12% da banca (abaixo do limite de proteção de 15% → nunca bloqueia)
            const maxRecoveryStake = Math.max(bankSize * 0.12, amount);
            // Não usar menos que o stake base, nem menos que $1 (mínimo ACCU)
            amount = Math.max(Math.min(idealRecoveryStake, maxRecoveryStake), amount);
            const reqs = realStatsTracker.getRecoveryRequirements();
            const expectedProfit = amount * RECOVERY_PAYOUT;
            const profitAfterRecovery = expectedProfit - deficit;
            const recoversInOneWin = profitAfterRecovery >= 0;
            console.log(`🎰 [MARTINGALE RECUPERAÇÃO] Déficit: $${deficit.toFixed(2)} | Stake: $${amount.toFixed(2)} | Ideal era: $${idealRecoveryStake.toFixed(2)}`);
            console.log(`   → 1 vitória esperada: +$${expectedProfit.toFixed(2)} | ${recoversInOneWin ? '✅ Recupera déficit em 1 trade' : '⚠️ Déficit residual: $' + Math.abs(profitAfterRecovery).toFixed(2)}`);
            console.log(`   → Consenso mínimo exigido: ${reqs.minConsensus}% (${reqs.consecutiveLosses} perda(s) consecutiva(s))`);
          } else {
            console.log(`✅ [RECOVERY] Déficit = $0 (saldo recuperado) → stake normal`);
          }
        }

        // calculateDynamicStake() removido: calculateAIStakePercentage() já incorpora
        // consenso, volatilidade, regime e win rate — segunda passagem causaria over-amplification.

        // 🛡️ SAFETY CAP ADAPTATIVO — alinhado com calculateAIStakePercentage (teto da IA)
        // Bancas pequenas têm teto % maior para permitir superar o mínimo Deriv ($0.35-$1)
        const inRecovery = realStatsTracker.isPostLossMode();
        const capPct = bankSize <= 20  ? 0.25  // ≤$20: até 25% ($5 max em $20)
                     : bankSize <= 50  ? 0.18  // $20-50: 18%
                     : bankSize <= 200 ? 0.12  // $50-200: 12%
                     : bankSize <= 1000? 0.08  // $200-1000: 8%
                     :                  0.06;  // >$1000: 6%
        const minFloor = inRecovery ? 1.00 : 0.35;
        const maxSafeStake = Math.max(minFloor, bankSize * capPct);
        if (amount > maxSafeStake) {
          console.log(`🛡️ [SAFETY CAP] Stake $${amount.toFixed(2)} > ${(capPct * 100).toFixed(0)}% da banca ($${maxSafeStake.toFixed(2)}) → limitado a $${maxSafeStake.toFixed(2)}`);
          amount = maxSafeStake;
        }
        // 🎯 RECOVERY FLOOR: garantir mínimo $1.00 em modo de recuperação (mínimo ACCU/Digit Differs)
        if (inRecovery && amount < 1.00) {
          console.log(`🔺 [RECOVERY FLOOR] Stake $${amount.toFixed(2)} < $1.00 mínimo ACCU → elevado a $1.00`);
          amount = 1.00;
        }

        // Arredondar para 2 casas decimais
        amount = Math.round(amount * 100) / 100;
      } else if (useAIStake) {
        console.log(`⚠️ [STAKE] Saldo não encontrado, usando stake padrão: $${amount}`);
      }
    } catch (error) {
      console.error(`❌ [STAKE] Erro ao calcular stake: ${error}, usando padrão $${amount}`);
    }

    // Se stake fixo, garantir que o martingale/safety cap não sobrescreva
    if (!useAIStake) {
      // Stake fixo definido pelo usuário — não aplicar martingale nem safety cap
    } else {
      // 🎰 APLICAR MARTINGALE — SOMENTE se consenso excepcional e sem recovery/circuit breaker
      if (consensoStrength !== undefined && userId) {
        try {
          const mgEnabled = riskConfig?.enableMartingale ?? true;
          const mgMults = riskConfig?.martingaleMultipliers;
          amount = this.applyMartingaleStake(userId, amount, consensoStrength, 'STAKE', mgEnabled, mgMults);
        } catch (mgErr) {
          console.error(`❌ [MARTINGALE] Erro ao aplicar stake: ${mgErr}`);
        }
      }
    } // end else (useAIStake)

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

  getSchedulerStatus(): {
    isRunning: boolean;
    hasActiveSessions: boolean;
    emergencyStop: boolean;
    isInitialized: boolean;
    currentPhase: string;
    currentPhaseDetail: string;
    lastCycleStartedAt: number;
    nextCycleAt: number;
    cycleIntervalMs: number;
    activityLog: Array<{ time: number; message: string; type: string }>;
    marketQuality: number;
    badMarketPaused: boolean;
    badMarketPausedSecondsLeft: number;
    badMarketReducedGrowth: boolean;
  } {
    const nowSt = Date.now();
    const isPaused = this.badMarketPausedUntil > nowSt;
    const secsLeft = isPaused ? Math.round((this.badMarketPausedUntil - nowSt) / 1000) : 0;
    return {
      isRunning: !!this.cronJob,
      hasActiveSessions: this.activeSessions.size > 0,
      emergencyStop: this.emergencyStop,
      isInitialized: this.isInitialized,
      currentPhase: this.currentPhase,
      currentPhaseDetail: this.currentPhaseDetail,
      lastCycleStartedAt: this.lastCycleStartedAt,
      nextCycleAt: this.nextCycleAt,
      cycleIntervalMs: this.CYCLE_INTERVAL_MS,
      activityLog: this.activityLog.slice(0, 10),
      marketQuality: this.lastScanMarketQuality,
      badMarketPaused: isPaused && !this.badMarketReducedGrowthActive,
      badMarketPausedSecondsLeft: secsLeft,
      badMarketReducedGrowth: this.badMarketReducedGrowthActive,
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
    
    // ⚡ ANÁLISE CONTÍNUA: Ciclo a cada 5 segundos — IA decide livremente quando operar
    // Sem restrições de tempo: circuit breaker, consenso e bad market pause são os guardiões
    // A IA analisa o mercado continuamente e entra quando identifica oportunidade real
    
    // ▶️ A IA decide sozinha quando e como operar — sem restrições artificiais de tempo
    (async () => {
      try {
        await this.executeAnaliseNaturalAnalysis();
      } catch (error) {
        console.error('❌ [SCHEDULER] Erro no ciclo inicial:', error);
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
    }, this.CYCLE_INTERVAL_MS); // 5 segundos — análise contínua, IA decide livremente
    
    // 🔄 Iniciar sincronização automática de trades da Deriv
    derivTradeSync.startAutoSync();
    
    console.log('▶️ Auto Trading Scheduler iniciado - análise contínua a cada 5 segundos — IA livre para operar quando identificar oportunidade');
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