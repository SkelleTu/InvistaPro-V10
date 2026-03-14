/**
 * REAL STATS TRACKER
 * Rastreia resultados reais de trades (won/lost) baseado em dados do banco.
 *
 * 🛡️ MODO RECUPERAÇÃO HIPER-SELETIVO
 * Após uma perda, o sistema CONTINUA operando mas com critérios muito mais
 * rígidos para garantir que o próximo trade tenha altíssima probabilidade de ganho:
 *   - Consenso mínimo de IA elevado para 85% (vs ~65% normal)
 *   - Ativo que causou a perda bloqueado por RECOVERY_ASSET_BLOCK_MS
 *   - Assim que saldo superar o pré-perda, volta ao modo normal
 */

const RECOVERY_MIN_CONSENSUS = 85;        // % mínimo de consenso de IA em modo recuperação
const RECOVERY_ASSET_BLOCK_MS = 30 * 60 * 1000; // 30 minutos de bloqueio para o ativo perdedor

class RealStatsTracker {
  private wonTrades: number = 0;
  private lostTrades: number = 0;
  private totalProfit: number = 0;
  private initialized: boolean = false;

  // 🛡️ MODO RECUPERAÇÃO
  private postLossMode: boolean = false;
  private lastKnownBalance: number = 0;       // atualizado antes de cada trade
  private balanceToRecover: number = 0;       // saldo pré-perda — meta a superar
  private blockedAsset: string = '';          // ativo que causou a perda
  private assetBlockedUntil: number = 0;      // timestamp até quando o ativo está bloqueado

  get winRate(): number {
    const total = this.wonTrades + this.lostTrades;
    return total > 0 ? (this.wonTrades / total) * 100 : 0;
  }

  get totalTrades(): number {
    return this.wonTrades + this.lostTrades;
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
  }

  /**
   * Retorna true se o sistema está em modo de recuperação pós-perda.
   */
  isPostLossMode(): boolean {
    return this.postLossMode;
  }

  /**
   * Retorna os requisitos do modo de recuperação.
   */
  getRecoveryRequirements(): {
    minConsensus: number;
    blockedAsset: string;
    balanceToRecover: number;
    assetBlockedUntil: number;
    assetStillBlocked: boolean;
  } {
    return {
      minConsensus: RECOVERY_MIN_CONSENSUS,
      blockedAsset: this.blockedAsset,
      balanceToRecover: this.balanceToRecover,
      assetBlockedUntil: this.assetBlockedUntil,
      assetStillBlocked: this.blockedAsset !== '' && Date.now() < this.assetBlockedUntil,
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

  recordWin(profit: number): void {
    this.wonTrades++;
    this.totalProfit += profit;
    this.lastKnownBalance += Math.abs(profit);

    console.log(`🏆 [REAL STATS] Trade GANHO! WinRate: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | +$${profit.toFixed(2)}`);

    if (this.postLossMode) {
      if (this.lastKnownBalance > this.balanceToRecover) {
        console.log(`✅ [RECOVERY] Perda recuperada via ganho! Saldo estimado $${this.lastKnownBalance.toFixed(2)} > $${this.balanceToRecover.toFixed(2)} | Voltando ao modo NORMAL`);
        this._clearRecoveryMode();
      } else {
        const deficit = this.balanceToRecover - this.lastKnownBalance;
        console.log(`🔄 [RECOVERY] Ganho ajudou! Saldo estimado: $${this.lastKnownBalance.toFixed(2)} | Falta: $${deficit.toFixed(2)} para recuperar`);
      }
    }
  }

  recordLoss(loss: number, symbol: string = ''): void {
    this.lostTrades++;
    this.totalProfit += loss; // loss é negativo

    // 🛡️ ATIVAR MODO RECUPERAÇÃO HIPER-SELETIVO
    const balanceBefore = this.lastKnownBalance;  // saldo ANTES desta perda
    this.lastKnownBalance = Math.max(0, this.lastKnownBalance + loss);

    this.postLossMode = true;
    this.balanceToRecover = balanceBefore;       // meta: superar o saldo pré-perda
    this.blockedAsset = symbol.toUpperCase();
    this.assetBlockedUntil = Date.now() + RECOVERY_ASSET_BLOCK_MS;

    console.log(`❌ [REAL STATS] Trade PERDIDO. WinRate: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | $${loss.toFixed(2)}`);
    console.log(`🛡️ [RECOVERY] MODO RECUPERAÇÃO ATIVADO:`);
    console.log(`   • Ativo bloqueado: ${symbol || 'N/A'} por 30 min`);
    console.log(`   • Saldo alvo: $${balanceBefore.toFixed(2)} (precisa SUPERAR este valor)`);
    console.log(`   • Consenso mínimo exigido: ${RECOVERY_MIN_CONSENSUS}% (vs normal ~65%)`);
    console.log(`   • Sistema continua operando, mas APENAS em sinais excepcionais`);
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
    };
  }

  logCurrentStats(): void {
    if (this.totalTrades === 0) {
      console.log(`📊 [REAL STATS] Aguardando primeiros resultados reais...`);
    } else {
      const sharpe = this.totalTrades > 0 ? this.totalProfit / Math.sqrt(this.totalTrades) : 0;
      const modeStr = this.postLossMode
        ? ` | 🛡️ RECOVERY MODE (alvo: $${this.balanceToRecover.toFixed(2)}, mín.consenso: ${RECOVERY_MIN_CONSENSUS}%)`
        : '';
      console.log(`📊 [REAL STATS] Trades: ${this.totalTrades} | WinRate: ${this.winRate.toFixed(1)}% | Lucro: $${this.totalProfit.toFixed(2)} | Sharpe: ${sharpe.toFixed(2)}${modeStr}`);
    }
  }
}

export const realStatsTracker = new RealStatsTracker();
