/**
 * signal-store.ts
 * Armazém global de sinais — compartilhado entre o bot Deriv e a ponte MT5.
 * O auto-trading-scheduler escreve aqui; o MetaTrader bridge lê daqui.
 */

export interface AnalysisSignal {
  symbol: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: number;
  consensus: number;
  reason: string;
  timestamp: number;
}

const store = new Map<string, AnalysisSignal>();

/** Grava o sinal mais recente para um símbolo (chamado pelo scheduler Deriv). */
export function setSignal(symbol: string, signal: AnalysisSignal): void {
  store.set(symbol.toUpperCase(), { ...signal, timestamp: Date.now() });
}

/** Lê o sinal mais recente para um símbolo (chamado pela ponte MT5). */
export function getSignal(symbol: string): AnalysisSignal | undefined {
  const key = symbol.toUpperCase();
  const entry = store.get(key);
  if (!entry) return undefined;
  const ageMs = Date.now() - entry.timestamp;
  if (ageMs > 5 * 60 * 1000) return undefined; // expirado após 5 minutos
  return entry;
}

/** Retorna todos os sinais recentes. */
export function getAllSignals(): AnalysisSignal[] {
  const now = Date.now();
  return Array.from(store.values()).filter(s => now - s.timestamp < 5 * 60 * 1000);
}
