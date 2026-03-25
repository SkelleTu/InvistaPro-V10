/**
 * REAL STATS TRACKER
 * Rastreia resultados reais de trades (won/lost) baseado em dados do banco.
 *
 * 🛡️ MODO PROTEÇÃO DE BANCA — CIRCUIT BREAKER REAL
 *
 * CAMADA 1 - ANTI-REPETIÇÃO:
 *   O mesmo ativo é bloqueado por 5 min após perda — tempo real para o mercado mudar.
 *
 * CAMADA 2 - CONSENSO ESCALADO POR STREAK:
 *   A cada perda consecutiva o sistema exige consenso progressivamente maior.
 *   Evita entrar em mercado ruim com sinal fraco.
 *
 * CAMADA 3 - CIRCUIT BREAKER COM PAUSA REAL:
 *   Pausas significativas (2-15 min) por streak de perdas.
 *   Dá tempo real de o mercado mudar condições antes de nova entrada.
 *
 * CAMADA 4 - BLOQUEIO DE ATIVO PERDEDOR:
 *   Ativo bloqueado por 5 minutos após causar perda.
 */

const RECOVERY_ASSET_BLOCK_MS = 5 * 60 * 1000; // 5 minutos — ativo perdedor precisa de pausa real

// Consenso mínimo por nível de perdas consecutivas
// Escala progressiva: após perdas consecutivas, exige sinal muito mais forte
const RECOVERY_CONSENSUS_BY_STREAK: Record<number, number> = {
  1: 72,  // 1 perda consecutiva → 72% (mesmo threshold do gate principal)
  2: 78,  // 2 perdas consecutivas → 78% (sinal forte exigido)
  3: 85,  // 3+ perdas consecutivas → 85% (sinal excepcional — mercado claramente contra)
};

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

  get winRate(): number {
    const total = this.wonTrades + this.lostTrades;
    return total > 0 ? (this.wonTrades / total) * 100 : 0;
  }

  get totalTrades(): number {
    return this.wonTrades + this.lostTrades;
  }

  /** Consenso mínimo exigido com base na streak de perdas consecutivas */
  get recoveryMinConsensus(): number {
    if (this.consecutiveLosses <= 0) return 0;
    const level = Math.min(this.consecutiveLosses, 3);
    return RECOVERY_CONSENSUS_BY_STREAK[level] ?? 95;
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

  recordLoss(loss: number, symbol: string = '', contractId?: string): void {
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
    // Se usuário configurou threshold+pausa, usa config customizada; senão usa padrão escalonado
    let breakerPauseMs: number;
    if (this.cbUserLossThreshold !== null && this.cbUserPauseMs !== null) {
      // Config do usuário: ativa quando atingir o threshold configurado
      breakerPauseMs = this.consecutiveLosses >= this.cbUserLossThreshold ? this.cbUserPauseMs : 0;
    } else {
      // Padrão escalonado: 1 perda=90s, 2=5min, 3+=15min
      const streakLevel = Math.min(this.consecutiveLosses, 3);
      breakerPauseMs = CIRCUIT_BREAKER_PAUSE_MS[streakLevel] ?? 0;
    }
    if (breakerPauseMs > 0) {
      this.circuitBreakerUntil = Date.now() + breakerPauseMs;
      const pauseMin = Math.round(breakerPauseMs / 60000);
      const pauseSec = Math.round(breakerPauseMs / 1000);
      const display = pauseMin >= 1 ? `${pauseMin} minuto(s)` : `${pauseSec} segundos`;
      console.log(`🔴 [CIRCUIT BREAKER] ${this.consecutiveLosses} perdas consecutivas → PAUSA OBRIGATÓRIA de ${display}`);
      console.log(`   → Próximo trade permitido após: ${new Date(this.circuitBreakerUntil).toLocaleTimeString()}`);
    }

    // 🛡️ CAMADA 2/4 - Ativar/atualizar modo recuperação
    this.postLossMode = true;
    this.balanceToRecover = balanceBefore;
    this.blockedAsset = symbol.toUpperCase();
    this.assetBlockedUntil = Date.now() + RECOVERY_ASSET_BLOCK_MS;

    const minConsensus = this.recoveryMinConsensus;

    console.log(`❌ [REAL STATS] Trade PERDIDO. WinRate: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | $${loss.toFixed(2)}`);
    console.log(`🛡️ [RECOVERY] MODO RECUPERAÇÃO ATIVADO (streak: ${this.consecutiveLosses} perdas consecutivas):`);
    console.log(`   • Ativo bloqueado (CAMADA 4): ${symbol || 'N/A'} por 30 min`);
    console.log(`   • Saldo alvo: $${balanceBefore.toFixed(2)} (precisa SUPERAR este valor)`);
    console.log(`   • Consenso mínimo escalado (CAMADA 2): ${minConsensus}% (streak: ${this.consecutiveLosses})`);
    console.log(`   • Anti-repetição (CAMADA 1): ativo anterior bloqueado para próximo ciclo`);
    if (breakerPauseMs > 0) {
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
