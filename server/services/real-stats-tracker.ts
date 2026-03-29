/**
 * REAL STATS TRACKER
 * Rastreia resultados reais de trades (won/lost) baseado em dados do banco.
 *
 * 🛡️ MODO PROTEÇÃO DE BANCA — CIRCUIT BREAKER REAL
 *
 * CAMADA 1 - ANTI-REPETIÇÃO:
 *   O mesmo ativo é bloqueado por 5 min após perda — tempo real para o mercado mudar.
 *
 * CAMADA 2 - CONSENSO ESCALADO POR STREAK (ADAPTATIVO POR TIPO DE ATIVO):
 *   A cada perda consecutiva o sistema exige consenso progressivamente maior.
 *   O threshold base é calibrado por tipo de ativo (sintético, forex, B3, etc.).
 *
 * CAMADA 3 - CIRCUIT BREAKER COM PAUSA REAL:
 *   Pausas significativas (2-15 min) por streak de perdas.
 *   Dá tempo real de o mercado mudar condições antes de nova entrada.
 *
 * CAMADA 4 - BLOQUEIO DE ATIVO PERDEDOR:
 *   Ativo bloqueado por 5 minutos após causar perda.
 */

import { getRecoveryThreshold } from '../utils/asset-classifier';

// Tipos de contrato que NÃO usam circuit breaker — índices pseudoaleatórios onde
// perdas consecutivas são variância normal, não sinal de mercado adverso.
const DIGIT_CONTRACT_TYPES = new Set([
  'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD',
  'digitmatch', 'digitdiff', 'digitover', 'digitunder', 'digiteven', 'digitodd',
]);

function isDigitContract(contractType?: string): boolean {
  if (!contractType) return false;
  return DIGIT_CONTRACT_TYPES.has(contractType.toUpperCase());
}

const RECOVERY_ASSET_BLOCK_MS = 5 * 60 * 1000; // 5 minutos — ativo perdedor precisa de pausa real

// Pausas reais por perdas consecutivas para proteção de banca
// Cada pausa dá tempo para as condições de mercado mudarem
const CIRCUIT_BREAKER_PAUSE_MS: Record<number, number> = {
  1:  2 * 60 * 1000,   // 1 perda  → 2 minutos (avaliar condições)
  2:  5 * 60 * 1000,   // 2 perdas → 5 minutos (mercado pode estar adverso)
  3: 15 * 60 * 1000,   // 3+ perdas → 15 minutos (sinal claro de mercado ruim)
};

export interface PersistedRecoveryState {
  consecutiveLosses: number;
  circuitBreakerUntil: number;
  postLossMode: boolean;
  lastKnownBalance: number;
  balanceToRecover: number;
  blockedAsset: string;
  assetBlockedUntil: number;
  savedAt: number;
}

class RealStatsTracker {
  private wonTrades: number = 0;
  private lostTrades: number = 0;
  private totalProfit: number = 0;
  private initialized: boolean = false;

  // 🛡️ CAMADA 2 & 3 - Perdas consecutivas + Circuit Breaker
  private consecutiveLosses: number = 0;
  private circuitBreakerUntil: number = 0;   // timestamp — não operar antes disso

  // 🛡️ CAMADA 1 - Anti-repetição por usuário
  private lastTradedAssetByUser: Map<string, string> = new Map();

  // 🛡️ CAMADA 2/3/4 - Modo recuperação pós-perda
  private postLossMode: boolean = false;
  private lastKnownBalance: number = 0;       // atualizado antes de cada trade
  private balanceToRecover: number = 0;       // saldo pré-perda — meta a superar
  private blockedAsset: string = '';          // ativo que causou a perda
  private assetBlockedUntil: number = 0;      // timestamp até quando o ativo está bloqueado

  // 🔧 Configuração de Circuit Breaker customizável pelo usuário
  private cbUserLossThreshold: number | null = null;  // nº de perdas para ativar
  private cbUserPauseMs: number | null = null;        // duração da pausa em ms

  // 🔄 Callback de persistência — chamado após cada win/loss para salvar estado no BD
  private persistCallback?: (state: PersistedRecoveryState) => void;

  // 🚫 Anti-duplo-registro: controla contratos já processados nas estatísticas
  private processedContracts: Map<string, number> = new Map(); // contractId → timestamp
  private readonly PROCESSED_CONTRACT_TTL_MS = 10 * 60 * 1000; // 10 minutos

  // 🤖 CONTEXTO DE MERCADO — alimentado pela IA a cada ciclo de análise
  private marketQuality: number = 100;         // 0-100: qualidade geral do mercado
  private aiConsensus: number = 100;           // 0-100: nível de consenso das IAs
  private marketContextUpdatedAt: number = 0;  // timestamp da última atualização
  // Histórico de qualidade para detectar degradação sustentada
  private marketQualityHistory: number[] = [];
  private readonly QUALITY_HISTORY_SIZE = 5;   // Últimas 5 leituras (~2 min em ciclos normais)

  get winRate(): number {
    const total = this.wonTrades + this.lostTrades;
    return total > 0 ? (this.wonTrades / total) * 100 : 0;
  }

  get totalTrades(): number {
    return this.wonTrades + this.lostTrades;
  }

  /** Consenso mínimo exigido com base na streak de perdas e no tipo do ativo bloqueado.
   *  Se em recovery mas streak = 0 (já ganhou 1 vez), retorna o gate base do ativo.
   *  Se fora de recovery (sem perdas), retorna 0 (sem restrição extra). */
  get recoveryMinConsensus(): number {
    if (this.consecutiveLosses <= 0) {
      // Em recovery mas sem streak ativo → apenas gate base do ativo
      if (this.postLossMode && this.blockedAsset) {
        return getRecoveryThreshold(this.blockedAsset, 1);
      }
      return 0;
    }
    return getRecoveryThreshold(this.blockedAsset, this.consecutiveLosses);
  }

  /**
   * Registra um callback que será chamado sempre que o estado de recuperação mudar.
   * Use para persistir o estado no banco e sobreviver a reinícios do servidor.
   */
  registerPersistCallback(cb: (state: PersistedRecoveryState) => void): void {
    this.persistCallback = cb;
  }

  /**
   * Configura o Circuit Breaker com os valores definidos pelo usuário no dashboard.
   * Quando configurado, substitui os valores padrão escalonados.
   * @param lossThreshold - número de perdas consecutivas para ativar o breaker
   * @param pauseMinutes - duração da pausa em minutos
   */
  configureCircuitBreaker(lossThreshold: number, pauseMinutes: number): void {
    this.cbUserLossThreshold = Math.max(1, Math.round(lossThreshold));
    this.cbUserPauseMs = Math.max(30_000, pauseMinutes * 60_000); // mínimo 30s
  }

  /**
   * 🤖 CIRCUIT BREAKER INTELIGENTE — Atualiza o contexto de mercado.
   * Chamado pelo scheduler a cada ciclo de análise.
   * Permite que a IA decida pausar ANTES de ocorrerem perdas quando o mercado está ruim.
   */
  updateMarketContext(quality: number, consensus: number): void {
    this.marketQuality = Math.max(0, Math.min(100, quality));
    this.aiConsensus = Math.max(0, Math.min(100, consensus));
    this.marketContextUpdatedAt = Date.now();

    // Manter histórico de qualidade (rolling window)
    this.marketQualityHistory.push(this.marketQuality);
    if (this.marketQualityHistory.length > this.QUALITY_HISTORY_SIZE) {
      this.marketQualityHistory.shift();
    }
  }

  /**
   * 🤖 CIRCUIT BREAKER PROATIVO — A IA verifica se deve pausar por condições de mercado.
   * Retorna { shouldPause, pauseMs, reason } se o mercado está ruim o suficiente para pausar.
   * Não requer perdas prévias — age de forma PREVENTIVA.
   *
   * Critérios de ativação:
   * 1. Qualidade de mercado consistentemente baixa (≤ 25%) por múltiplas leituras
   * 2. Consenso de IA muito baixo (≤ 30%) — IAs discordando muito
   * 3. Combinação de qualidade fraca + consenso fraco (cada um ≤ 40%)
   */
  checkProactiveBreaker(): { shouldPause: boolean; pauseMs: number; reason: string } {
    const now = Date.now();
    const noResult = { shouldPause: false, pauseMs: 0, reason: '' };

    // Contexto desatualizado (mais de 3 min) — não agir por falta de dados
    if (now - this.marketContextUpdatedAt > 3 * 60 * 1000) return noResult;

    // Já tem circuit breaker ativo — não sobrescrever
    if (this.isCircuitBreakerActive()) return noResult;

    const histLen = this.marketQualityHistory.length;
    const avgQuality = histLen > 0
      ? this.marketQualityHistory.reduce((a, b) => a + b, 0) / histLen
      : this.marketQuality;

    // Critério 1: Qualidade muito ruim e sustentada (≥3 leituras consecutivas ruins)
    if (histLen >= 3 && avgQuality <= 25) {
      const pauseMs = 45 * 1000; // 45 segundos — dar tempo ao mercado respirar
      const reason = `Mercado com qualidade muito baixa sustentada (média ${avgQuality.toFixed(0)}% nas últimas ${histLen} leituras)`;
      console.log(`🤖 [CB PROATIVO] ${reason} → PAUSA PREVENTIVA de ${pauseMs/1000}s`);
      this.circuitBreakerUntil = now + pauseMs;
      this.triggerPersist();
      return { shouldPause: true, pauseMs, reason };
    }

    // Critério 2: Consenso de IA muito baixo (IAs discordando fortemente)
    if (this.aiConsensus <= 30 && histLen >= 2) {
      const pauseMs = 30 * 1000; // 30 segundos
      const reason = `Consenso de IAs muito baixo (${this.aiConsensus.toFixed(0)}%) — aguardar convergência`;
      console.log(`🤖 [CB PROATIVO] ${reason} → PAUSA PREVENTIVA de ${pauseMs/1000}s`);
      this.circuitBreakerUntil = now + pauseMs;
      this.triggerPersist();
      return { shouldPause: true, pauseMs, reason };
    }

    // Critério 3: Dupla fraqueza — qualidade + consenso ambos fracos
    if (avgQuality <= 40 && this.aiConsensus <= 40 && histLen >= 2) {
      const pauseMs = 20 * 1000; // 20 segundos — pausa curta de avaliação
      const reason = `Dupla fraqueza: qualidade=${avgQuality.toFixed(0)}% + consenso=${this.aiConsensus.toFixed(0)}%`;
      console.log(`🤖 [CB PROATIVO] ${reason} → PAUSA BREVE de ${pauseMs/1000}s`);
      this.circuitBreakerUntil = now + pauseMs;
      this.triggerPersist();
      return { shouldPause: true, pauseMs, reason };
    }

    return noResult;
  }

  /**
   * 🤖 CIRCUIT BREAKER ADAPTATIVO — Ajusta a duração da pausa pós-perda com base no contexto.
   * Mercado ruim = pausa mais longa. Mercado bom = pausa mais curta.
   * Retorna o multiplicador a aplicar sobre a pausa padrão (0.5 – 2.0×).
   */
  private getMarketContextMultiplier(): number {
    // Contexto desatualizado — não ajustar
    if (Date.now() - this.marketContextUpdatedAt > 5 * 60 * 1000) return 1.0;

    const histLen = this.marketQualityHistory.length;
    const avgQuality = histLen > 0
      ? this.marketQualityHistory.reduce((a, b) => a + b, 0) / histLen
      : this.marketQuality;

    // Mercado muito ruim → pausa 2× mais longa
    if (avgQuality <= 20) return 2.0;
    // Mercado ruim → pausa 1.5× mais longa
    if (avgQuality <= 40) return 1.5;
    // Mercado fraco → pausa 1.2× mais longa
    if (avgQuality <= 60) return 1.2;
    // Mercado bom → pausa 0.8× (mais curta — recuperação mais rápida)
    if (avgQuality >= 80 && this.aiConsensus >= 70) return 0.8;
    // Mercado excelente → pausa 0.5× (mínimo 30s mesmo assim)
    if (avgQuality >= 90 && this.aiConsensus >= 85) return 0.5;

    return 1.0; // Neutro
  }

  /**
   * Retorna o estado de recuperação atual para persistência.
   */
  getRecoveryStateToSave(): PersistedRecoveryState {
    return {
      consecutiveLosses: this.consecutiveLosses,
      circuitBreakerUntil: this.circuitBreakerUntil,
      postLossMode: this.postLossMode,
      lastKnownBalance: this.lastKnownBalance,
      balanceToRecover: this.balanceToRecover,
      blockedAsset: this.blockedAsset,
      assetBlockedUntil: this.assetBlockedUntil,
      savedAt: Date.now(),
    };
  }

  /**
   * Restaura o estado de recuperação a partir de dados persistidos.
   * Chamado na inicialização para sobreviver a reinícios do servidor.
   */
  restoreRecoveryState(state: PersistedRecoveryState): void {
    const now = Date.now();
    // Só restaurar se salvo nas últimas 3 horas (estados muito antigos não são relevantes)
    const maxAgeMs = 3 * 60 * 60 * 1000;
    if (now - state.savedAt > maxAgeMs) {
      console.log(`⏩ [RECOVERY] Estado salvo muito antigo (${Math.round((now - state.savedAt) / 60000)} min) — ignorando`);
      return;
    }

    this.consecutiveLosses = state.consecutiveLosses || 0;
    this.postLossMode = state.postLossMode || false;
    this.lastKnownBalance = state.lastKnownBalance || 0;
    this.balanceToRecover = state.balanceToRecover || 0;
    this.blockedAsset = state.blockedAsset || '';

    // Limitar timestamps restaurados aos novos valores máximos (evita que bloqueios antigos longos persistam)
    // Circuit breaker máx: 10s; Asset block máx: 90s — valores das novas constantes
    const maxCircuitBreakerUntil = now + Math.max(...Object.values(CIRCUIT_BREAKER_PAUSE_MS));
    const maxAssetBlockUntil = now + RECOVERY_ASSET_BLOCK_MS;
    this.circuitBreakerUntil = Math.min(state.circuitBreakerUntil || 0, maxCircuitBreakerUntil);
    this.assetBlockedUntil = Math.min(state.assetBlockedUntil || 0, maxAssetBlockUntil);

    if (this.postLossMode) {
      const remainingBlock = Math.max(0, this.assetBlockedUntil - now);
      const remainingBreaker = Math.max(0, this.circuitBreakerUntil - now);
      console.log(`🔄 [RECOVERY] Estado restaurado após reinício:`);
      console.log(`   • Perdas consecutivas: ${this.consecutiveLosses}`);
      console.log(`   • Ativo bloqueado: ${this.blockedAsset || 'N/A'} (${Math.round(remainingBlock / 60000)} min restantes)`);
      console.log(`   • Saldo alvo: $${this.balanceToRecover.toFixed(2)}`);
      console.log(`   • Consenso mínimo exigido: ${this.recoveryMinConsensus}%`);
      if (remainingBreaker > 0) {
        console.log(`   • 🔴 Circuit Breaker: ${Math.round(remainingBreaker / 60000)} min restantes`);
      }
    } else {
      console.log(`✅ [RECOVERY] Estado restaurado — modo NORMAL (sem perdas consecutivas ativas)`);
    }
  }

  /** Dispara o callback de persistência se registrado */
  private triggerPersist(): void {
    if (this.persistCallback) {
      try {
        this.persistCallback(this.getRecoveryStateToSave());
      } catch (e) {
        // Silencia erros de persistência — nunca bloquear o fluxo principal
      }
    }
  }

  initializeFromDB(wonTrades: number, lostTrades: number, totalProfit: number): void {
    this.wonTrades = wonTrades;
    this.lostTrades = lostTrades;
    this.totalProfit = totalProfit;
    this.initialized = true;
    console.log(`✅ [REAL STATS] Inicializado do banco: ${wonTrades}W/${lostTrades}L | WinRate: ${this.winRate.toFixed(1)}% | Lucro: $${totalProfit.toFixed(2)}`);
  }

  /**
   * Atualiza o saldo atual. Chamar ANTES de cada tentativa de trade.
   * Verifica automaticamente se o modo de recuperação pode ser encerrado.
   */
  updateBalance(balance: number): void {
    if (balance <= 0) return;
    this.lastKnownBalance = balance;

    if (this.postLossMode && balance > this.balanceToRecover) {
      console.log(`✅ [RECOVERY] Saldo recuperado! $${balance.toFixed(2)} > $${this.balanceToRecover.toFixed(2)} | Voltando ao modo NORMAL`);
      this._clearRecoveryMode();
    }
  }

  private _clearRecoveryMode(): void {
    this.postLossMode = false;
    this.balanceToRecover = 0;
    this.blockedAsset = '';
    this.assetBlockedUntil = 0;
    this.consecutiveLosses = 0;
    this.circuitBreakerUntil = 0;
    this.triggerPersist();
  }

  /**
   * CAMADA 1 - Anti-Repetição Total
   * Registra o ativo que acabou de ser operado para um usuário.
   * Deve ser chamado IMEDIATAMENTE ANTES de executar o contrato.
   */
  setLastTradedAsset(userId: string, symbol: string): void {
    this.lastTradedAssetByUser.set(userId, symbol.toUpperCase());
    console.log(`📌 [ANTI-REP] Ativo registrado para ${userId}: ${symbol.toUpperCase()}`);
  }

  /**
   * CAMADA 1 - Anti-Repetição Total
   * Retorna true se o ativo é o mesmo do último trade deste usuário.
   * Independente de qualquer outro critério — NUNCA pode repetir.
   */
  isAssetRepeated(userId: string, symbol: string): boolean {
    const last = this.lastTradedAssetByUser.get(userId);
    if (!last) return false;
    return last === symbol.toUpperCase();
  }

  /**
   * CAMADA 3 - Circuit Breaker
   * Retorna true se o circuit breaker está ativo (pausa obrigatória).
   */
  isCircuitBreakerActive(): boolean {
    return Date.now() < this.circuitBreakerUntil;
  }

  /**
   * CAMADA 3 - Circuit Breaker
   * Retorna ms restantes do circuit breaker (0 se inativo).
   */
  circuitBreakerRemainingMs(): number {
    return Math.max(0, this.circuitBreakerUntil - Date.now());
  }

  /**
   * Retorna true se o sistema está em modo de recuperação pós-perda.
   */
  isPostLossMode(): boolean {
    return this.postLossMode;
  }

  /**
   * RESET DE SESSÃO — Limpa o estado operacional de testes sem apagar dados de aprendizado.
   * Zera: perdas consecutivas, circuit breaker, modo recovery, ativo bloqueado.
   * Preserva: wonTrades, lostTrades, totalProfit e todos os dados históricos de aprendizado.
   */
  resetSessionState(): void {
    const prev = {
      consecutiveLosses: this.consecutiveLosses,
      postLossMode: this.postLossMode,
      circuitBreakerUntil: this.circuitBreakerUntil,
      blockedAsset: this.blockedAsset,
    };
    this._clearRecoveryMode();
    this.lastTradedAssetByUser.clear();
    console.log(`[RealStatsTracker] 🔄 Sessão resetada — perdas consec: ${prev.consecutiveLosses}→0 | recovery: ${prev.postLossMode}→false | CB: ${prev.circuitBreakerUntil > Date.now() ? 'ativo→inativo' : 'inativo'} | ativo bloqueado: "${prev.blockedAsset}"→""`);
  }

  /**
   * Retorna o déficit de capital a recuperar (quanto falta para voltar ao saldo pré-perda).
   * Retorna 0 se não estiver em modo recovery ou se o saldo já superou o alvo.
   */
  getLossDeficit(): number {
    if (!this.postLossMode) return 0;
    if (this.lastKnownBalance <= 0) return 0;
    return Math.max(0, this.balanceToRecover - this.lastKnownBalance);
  }

  /**
   * Retorna os requisitos completos do modo de recuperação.
   */
  getRecoveryRequirements(): {
    minConsensus: number;
    consecutiveLosses: number;
    blockedAsset: string;
    balanceToRecover: number;
    assetBlockedUntil: number;
    assetStillBlocked: boolean;
    circuitBreakerActive: boolean;
    circuitBreakerRemainingMs: number;
  } {
    return {
      minConsensus: this.recoveryMinConsensus,
      consecutiveLosses: this.consecutiveLosses,
      blockedAsset: this.blockedAsset,
      balanceToRecover: this.balanceToRecover,
      assetBlockedUntil: this.assetBlockedUntil,
      assetStillBlocked: this.blockedAsset !== '' && Date.now() < this.assetBlockedUntil,
      circuitBreakerActive: this.isCircuitBreakerActive(),
      circuitBreakerRemainingMs: this.circuitBreakerRemainingMs(),
    };
  }

  /**
   * Verifica se um ativo específico está bloqueado por perda recente.
   */
  isAssetBlocked(symbol: string): boolean {
    if (!this.postLossMode) return false;
    if (this.blockedAsset === '') return false;
    if (symbol.toUpperCase() !== this.blockedAsset.toUpperCase()) return false;
    return Date.now() < this.assetBlockedUntil;
  }

  private isContractAlreadyProcessed(contractId?: string): boolean {
    if (!contractId) return false;
    const now = Date.now();
    // Limpar entradas antigas do mapa
    for (const [id, ts] of this.processedContracts) {
      if (now - ts > this.PROCESSED_CONTRACT_TTL_MS) {
        this.processedContracts.delete(id);
      }
    }
    return this.processedContracts.has(contractId);
  }

  private markContractProcessed(contractId?: string): void {
    if (!contractId) return;
    this.processedContracts.set(contractId, Date.now());
  }

  recordWin(profit: number, contractId?: string): void {
    if (contractId && this.isContractAlreadyProcessed(contractId)) {
      console.log(`⚠️ [REAL STATS] Contrato ${contractId} já registrado — ignorando win duplicado`);
      return;
    }
    this.markContractProcessed(contractId);
    this.wonTrades++;
    this.totalProfit += profit;
    this.lastKnownBalance += Math.abs(profit);

    // 🏆 Ganho zera a streak de perdas consecutivas
    const hadStreak = this.consecutiveLosses;
    this.consecutiveLosses = 0;
    this.circuitBreakerUntil = 0;

    console.log(`🏆 [REAL STATS] Trade GANHO! WinRate: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | +$${profit.toFixed(2)}`);

    if (hadStreak > 0) {
      console.log(`✅ [RECOVERY] Streak de perdas resetada (era ${hadStreak}) | Circuit Breaker desativado`);
    }

    if (this.postLossMode) {
      if (this.lastKnownBalance > this.balanceToRecover) {
        console.log(`✅ [RECOVERY] Perda recuperada via ganho! Saldo estimado $${this.lastKnownBalance.toFixed(2)} > $${this.balanceToRecover.toFixed(2)} | Voltando ao modo NORMAL`);
        this._clearRecoveryMode();
      } else {
        const deficit = this.balanceToRecover - this.lastKnownBalance;
        console.log(`🔄 [RECOVERY] Ganho ajudou! Saldo estimado: $${this.lastKnownBalance.toFixed(2)} | Falta: $${deficit.toFixed(2)} para recuperar`);
        this.triggerPersist();
      }
    } else {
      this.triggerPersist();
    }
  }

  recordLoss(loss: number, symbol: string = '', contractId?: string, contractType?: string): void {
    if (contractId && this.isContractAlreadyProcessed(contractId)) {
      console.log(`⚠️ [REAL STATS] Contrato ${contractId} já registrado — ignorando loss duplicado`);
      return;
    }
    this.markContractProcessed(contractId);
    this.lostTrades++;
    this.totalProfit += loss; // loss é negativo

    const balanceBefore = this.lastKnownBalance;
    this.lastKnownBalance = Math.max(0, this.lastKnownBalance + loss);

    // 🛡️ CAMADA 2 - Incrementar streak de perdas consecutivas
    this.consecutiveLosses++;

    // 🛡️ CAMADA 3 - Ativar Circuit Breaker
    // ⚠️  DIGIT CONTRACTS EXEMPT: DIGITMATCH/DIFF/OVER/UNDER/EVEN/ODD operam sobre
    // índices pseudoaleatórios onde perdas consecutivas são variância normal — não sinal
    // de mercado adverso. O CB interromperia operações em janelas ainda favoráveis.
    const digitExempt = isDigitContract(contractType);
    let breakerPauseMs = 0;
    if (!digitExempt) {
      const marketMultiplier = this.getMarketContextMultiplier();
      if (this.cbUserLossThreshold !== null && this.cbUserPauseMs !== null) {
        const basePause = this.consecutiveLosses >= this.cbUserLossThreshold ? this.cbUserPauseMs : 0;
        breakerPauseMs = Math.round(basePause * marketMultiplier);
      } else {
        const streakLevel = Math.min(this.consecutiveLosses, 3);
        const basePause = CIRCUIT_BREAKER_PAUSE_MS[streakLevel] ?? 0;
        breakerPauseMs = Math.round(basePause * marketMultiplier);
      }
      if (breakerPauseMs > 0) {
        this.circuitBreakerUntil = Date.now() + breakerPauseMs;
        const pauseMin = Math.round(breakerPauseMs / 60000);
        const pauseSec = Math.round(breakerPauseMs / 1000);
        const display = pauseMin >= 1 ? `${pauseMin} minuto(s)` : `${pauseSec} segundos`;
        const mkt = this.getMarketContextMultiplier();
        const contextNote = mkt !== 1.0 ? ` (×${mkt.toFixed(1)} por qualidade de mercado ${this.marketQuality.toFixed(0)}%)` : '';
        console.log(`🔴 [CIRCUIT BREAKER] ${this.consecutiveLosses} perdas consecutivas → PAUSA OBRIGATÓRIA de ${display}${contextNote}`);
        console.log(`   → Próximo trade permitido após: ${new Date(this.circuitBreakerUntil).toLocaleTimeString()}`);
      }
    } else {
      // Digits: sem circuit breaker — mantém streak contado mas não pausa
      console.log(`📊 [DIGIT CB-EXEMPT] ${contractType?.toUpperCase()} — streak de perdas: ${this.consecutiveLosses} (sem pausa — variância esperada em índices pseudoaleatórios)`);
    }

    // 🛡️ CAMADA 2/4 - Ativar/atualizar modo recuperação
    this.postLossMode = true;
    this.balanceToRecover = balanceBefore;
    this.blockedAsset = symbol.toUpperCase();
    this.assetBlockedUntil = Date.now() + RECOVERY_ASSET_BLOCK_MS;

    const minConsensus = this.recoveryMinConsensus;

    console.log(`❌ [REAL STATS] Trade PERDIDO. WinRate: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | $${loss.toFixed(2)}`);
    console.log(`🛡️ [RECOVERY] MODO RECUPERAÇÃO ATIVADO (streak: ${this.consecutiveLosses} perdas consecutivas):`);
    console.log(`   • Ativo bloqueado (CAMADA 4): ${symbol || 'N/A'} por 5 min`);
    console.log(`   • Saldo alvo: $${balanceBefore.toFixed(2)} (precisa SUPERAR este valor)`);
    console.log(`   • Consenso mínimo escalado (CAMADA 2): ${minConsensus}% (streak: ${this.consecutiveLosses})`);
    if (digitExempt) {
      console.log(`   • Circuit Breaker (CAMADA 3): ISENTO — contrato DIGIT não pausa o sistema`);
    } else if (breakerPauseMs > 0) {
      console.log(`   • Circuit Breaker (CAMADA 3): ${Math.round(breakerPauseMs / 60000)} min de pausa ativa`);
    }

    // 💾 Persistir estado para sobreviver a reinícios do servidor
    this.triggerPersist();
  }

  getStats() {
    return {
      wonTrades: this.wonTrades,
      lostTrades: this.lostTrades,
      totalTrades: this.totalTrades,
      winRate: this.winRate,
      totalProfit: this.totalProfit,
      initialized: this.initialized,
      postLossMode: this.postLossMode,
      balanceToRecover: this.balanceToRecover,
      blockedAsset: this.blockedAsset,
      consecutiveLosses: this.consecutiveLosses,
      recoveryMinConsensus: this.recoveryMinConsensus,
      circuitBreakerActive: this.isCircuitBreakerActive(),
      circuitBreakerRemainingMs: this.circuitBreakerRemainingMs(),
    };
  }

  logCurrentStats(): void {
    if (this.totalTrades === 0) {
      console.log(`📊 [REAL STATS] Aguardando primeiros resultados reais...`);
    } else {
      const sharpe = this.totalTrades > 0 ? this.totalProfit / Math.sqrt(this.totalTrades) : 0;
      let modeStr = '';
      if (this.postLossMode) {
        modeStr = ` | 🛡️ RECOVERY (streak:${this.consecutiveLosses}, consenso≥${this.recoveryMinConsensus}%, alvo:$${this.balanceToRecover.toFixed(2)})`;
        if (this.isCircuitBreakerActive()) {
          modeStr += ` | 🔴 CIRCUIT BREAKER (${Math.round(this.circuitBreakerRemainingMs() / 1000)}s restantes)`;
        }
      }
      console.log(`📊 [REAL STATS] Trades: ${this.totalTrades} | WinRate: ${this.winRate.toFixed(1)}% | Lucro: $${this.totalProfit.toFixed(2)} | Sharpe: ${sharpe.toFixed(2)}${modeStr}`);
    }
  }

  resetUserMemory(userId: string): void {
    this.wonTrades = 0;
    this.lostTrades = 0;
    this.totalProfit = 0;
    this.initialized = false;
    this.consecutiveLosses = 0;
    this.circuitBreakerUntil = 0;
    this.postLossMode = false;
    this.lastKnownBalance = 0;
    this.balanceToRecover = 0;
    this.blockedAsset = '';
    this.assetBlockedUntil = 0;
    this.lastTradedAssetByUser.delete(userId);
    this.triggerPersist();
    console.log(`🧹 [REAL STATS] Memória em tempo real resetada para usuário ${userId}`);
  }
}

export const realStatsTracker = new RealStatsTracker();
