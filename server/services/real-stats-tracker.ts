/**
 * REAL STATS TRACKER
 * Rastreia resultados reais de trades (won/lost) baseado em dados do banco.
 * Substitui a simulação falsa do quantum system.
 */

class RealStatsTracker {
  private wonTrades: number = 0;
  private lostTrades: number = 0;
  private totalProfit: number = 0;
  private initialized: boolean = false;

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

  recordWin(profit: number): void {
    this.wonTrades++;
    this.totalProfit += profit;
    console.log(`🏆 [REAL STATS] Trade GANHO! WinRate atual: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | +$${profit.toFixed(2)}`);
  }

  recordLoss(loss: number): void {
    this.lostTrades++;
    this.totalProfit += loss; // loss é negativo
    console.log(`❌ [REAL STATS] Trade PERDIDO. WinRate atual: ${this.winRate.toFixed(1)}% (${this.wonTrades}W/${this.lostTrades}L) | $${loss.toFixed(2)}`);
  }

  getStats() {
    return {
      wonTrades: this.wonTrades,
      lostTrades: this.lostTrades,
      totalTrades: this.totalTrades,
      winRate: this.winRate,
      totalProfit: this.totalProfit,
      initialized: this.initialized,
    };
  }

  logCurrentStats(): void {
    if (this.totalTrades === 0) {
      console.log(`📊 [REAL STATS] Aguardando primeiros resultados reais...`);
    } else {
      const sharpe = this.totalTrades > 0 ? this.totalProfit / Math.sqrt(this.totalTrades) : 0;
      console.log(`📊 [REAL STATS] Trades: ${this.totalTrades} | WinRate: ${this.winRate.toFixed(1)}% | Lucro: $${this.totalProfit.toFixed(2)} | Sharpe: ${sharpe.toFixed(2)}`);
    }
  }
}

export const realStatsTracker = new RealStatsTracker();
