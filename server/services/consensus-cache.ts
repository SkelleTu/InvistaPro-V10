/**
 * CONSENSUS CACHE — Cache compartilhado de consenso das IAs
 *
 * Permite que qualquer parte do sistema (auto-trading-scheduler, metatrader-bridge,
 * market-data-collector) publique o último resultado de análise das IAs, e que
 * os endpoints de status (Sinais & IAs) leiam sempre o consenso mais recente,
 * independente de qual pipeline gerou o dado.
 */

export interface ConsensusEntry {
  symbol: string;
  aiConsensus: number;       // 0-100 %
  aiDirection: 'up' | 'down' | 'neutral';
  requiredConsensus: number;
  participatingModels: number;
  reasoning: string;
  timestamp: number;         // Date.now()
  source: 'auto_trading' | 'mt5_bridge' | 'market_collector';
}

const MAX_ENTRIES = 50;

class ConsensusCache {
  private entries: ConsensusEntry[] = [];

  publish(entry: ConsensusEntry): void {
    if (!entry.symbol || entry.aiConsensus <= 0) return;
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.pop();
    }
  }

  /** Retorna a entrada mais recente com consenso > 0, opcionalmente filtrada por símbolo */
  getLatest(symbol?: string): ConsensusEntry | null {
    if (symbol) {
      return this.entries.find(e => e.symbol === symbol && e.aiConsensus > 0) ?? null;
    }
    return this.entries.find(e => e.aiConsensus > 0) ?? null;
  }

  /** Retorna todas as entradas recentes (até MAX_ENTRIES) */
  getAll(): ConsensusEntry[] {
    return this.entries.filter(e => e.aiConsensus > 0);
  }

  /** Retorna somente as entradas mais recentes por símbolo (última análise de cada ativo) */
  getLatestPerSymbol(): ConsensusEntry[] {
    const seen = new Set<string>();
    return this.entries.filter(e => {
      if (e.aiConsensus <= 0) return false;
      if (seen.has(e.symbol)) return false;
      seen.add(e.symbol);
      return true;
    });
  }
}

export const consensusCache = new ConsensusCache();
