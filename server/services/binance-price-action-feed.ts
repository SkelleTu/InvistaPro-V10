import WebSocket from 'ws';
import type { Candle, Timeframe } from './price-action-engine';

export const PRICE_ACTION_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
export const PRICE_ACTION_INTERVALS = ['1m', '5m', '15m', '1h', '4h'] as const;
export type BinanceMarket = 'spot' | 'usdm';
export type BinanceInterval = typeof PRICE_ACTION_INTERVALS[number];

export interface BinanceCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export interface BinanceSnapshot {
  market: BinanceMarket;
  symbol: string;
  generatedAt: number;
  frames: Record<BinanceInterval, BinanceCandle[]>;
  stale: boolean;
  issues: string[];
}

type CandleListener = (symbol: string, interval: BinanceInterval, candle: BinanceCandle) => void;

const REST_BASE: Record<BinanceMarket, string> = {
  spot: 'https://api.binance.com',
  usdm: 'https://fapi.binance.com',
};
const WS_BASE: Record<BinanceMarket, string> = {
  spot: 'wss://stream.binance.com:9443/stream',
  usdm: 'wss://fstream.binance.com/stream',
};
const INTERVAL_MS: Record<BinanceInterval, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
const MAX_CANDLE_AGE_MS: Record<BinanceInterval, number> = {
  '1m': 90_000, '5m': 390_000, '15m': 990_000, '1h': 3_900_000, '4h': 14_700_000,
};

function parseKline(row: unknown): BinanceCandle | null {
  if (!Array.isArray(row) || row.length < 8) return null;
  const values = row.slice(0, 7).map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [openTime, open, high, low, close, volume, closeTime] = values;
  if (open <= 0 || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || volume < 0) return null;
  return { openTime, closeTime, open, high, low, close, volume, closed: closeTime < Date.now() };
}

function parseStreamKline(k: any): BinanceCandle | null {
  if (!k || typeof k !== 'object') return null;
  const values = [k.t, k.T, k.o, k.h, k.l, k.c, k.v].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [openTime, closeTime, open, high, low, close, volume] = values;
  if (open <= 0 || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || volume < 0) return null;
  return { openTime, closeTime, open, high, low, close, volume, closed: k.x === true };
}

/**
 * Public Binance candle feed. Market is mandatory because Spot and USD-M
 * Futures have different prices and contracts. No API keys or order methods.
 */
export class BinancePriceActionFeed {
  private sockets: WebSocket[] = [];
  private readonly candles = new Map<string, BinanceCandle[]>();
  private readonly listeners = new Set<CandleListener>();
  private stopped = true;
  private lastMessageAt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  constructor(
    private readonly market: BinanceMarket,
    private readonly symbols: readonly string[] = PRICE_ACTION_SYMBOLS,
  ) {
    if (market !== 'spot' && market !== 'usdm') throw new Error('Binance market must be explicitly spot or usdm');
    if (!symbols.length || symbols.some(s => !/^[A-Z0-9]{5,20}$/.test(s))) throw new Error('Invalid Binance symbol list');
  }

  private key(symbol: string, interval: BinanceInterval): string { return symbol + ':' + interval; }

  async loadInitialHistory(limit = 120): Promise<void> {
    if (!Number.isInteger(limit) || limit < 60 || limit > 1000) throw new Error('History limit must be between 60 and 1000');
    const tasks: Promise<void>[] = [];
    for (const symbol of this.symbols) {
      for (const interval of PRICE_ACTION_INTERVALS) {
        tasks.push(this.fetchHistory(symbol, interval, limit));
      }
    }
    const results = await Promise.allSettled(tasks);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) throw new Error('Binance history incomplete: ' + failed.length + ' request(s) failed');
  }

  private async fetchHistory(symbol: string, interval: BinanceInterval, limit: number): Promise<void> {
    const path = this.market === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
    const url = new URL(path, REST_BASE[this.market]);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(limit));
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('Binance HTTP ' + response.status + ' for ' + symbol + ' ' + interval);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error('Invalid Binance kline response');
    const parsed = payload.map(parseKline).filter((c): c is BinanceCandle => c !== null && c.closed);
    if (parsed.length < 30) throw new Error('Insufficient closed Binance candles for ' + symbol + ' ' + interval);
    this.candles.set(this.key(symbol, interval), parsed);
  }

  onClosedCandle(listener: CandleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.candles.size) throw new Error('Load and validate initial Binance history before starting streams');
    if (!this.stopped) return;
    this.stopped = false;
    const streams = this.symbols.flatMap(symbol =>
      PRICE_ACTION_INTERVALS.map(interval => symbol.toLowerCase() + '@kline_' + interval));
    this.connectStreams(streams);
  }

  private connectStreams(streams: string[]): void {
    if (this.stopped) return;
    const url = WS_BASE[this.market] + '?streams=' + streams.join('/');
    const socket = new WebSocket(url);
    this.sockets.push(socket);
    socket.on('open', () => { this.reconnectAttempts = 0; });
    socket.on('message', raw => {
      this.lastMessageAt = Date.now();
      try {
        const envelope = JSON.parse(raw.toString());
        const data = envelope?.data;
        const symbol = String(data?.s ?? '').toUpperCase();
        const interval = data?.k?.i as BinanceInterval;
        if (!this.symbols.includes(symbol) || !PRICE_ACTION_INTERVALS.includes(interval)) return;
        const candle = parseStreamKline(data.k);
        if (!candle || !candle.closed) return;
        const key = this.key(symbol, interval);
        const previous = this.candles.get(key) ?? [];
        const next = previous.filter(c => c.openTime !== candle.openTime);
        next.push(candle);
        next.sort((a, b) => a.openTime - b.openTime);
        this.candles.set(key, next.slice(-500));
        for (const listener of this.listeners) listener(symbol, interval, candle);
      } catch {
        // Malformed stream messages are ignored; freshness checks then fail closed.
      }
    });
    socket.on('error', () => { this.lastMessageAt = 0; });
    socket.on('close', () => {
      this.lastMessageAt = 0;
      this.sockets = this.sockets.filter(item => item !== socket);
      if (this.stopped || this.reconnectTimer) return;
      const delay = Math.min(30_000, 1_000 * (2 ** Math.min(this.reconnectAttempts, 5)));
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connectStreams(streams);
      }, delay);
    });
  }

  getSnapshot(symbol: string, now = Date.now()): BinanceSnapshot {
    const normalized = symbol.toUpperCase();
    if (!this.symbols.includes(normalized)) throw new Error('Symbol is not enabled in this feed');
    const frames = {} as Record<BinanceInterval, BinanceCandle[]>;
    const issues: string[] = [];
    for (const interval of PRICE_ACTION_INTERVALS) {
      const candles = this.candles.get(this.key(normalized, interval)) ?? [];
      const closed = candles.filter(c => c.closed).slice(-120);
      frames[interval] = closed;
      const latest = closed[closed.length - 1];
      if (closed.length < 30) issues.push(interval + ': insufficient closed candles');
      if (!latest || now - latest.closeTime > MAX_CANDLE_AGE_MS[interval]) issues.push(interval + ': stale or missing latest candle');
      for (let i = 1; i < closed.length; i++) {
        const delta = closed[i].openTime - closed[i - 1].openTime;
        if (delta <= 0) issues.push(interval + ': duplicate or out-of-order candle');
        else if (delta > INTERVAL_MS[interval] * 1.5) issues.push(interval + ': candle gap detected');
      }
    }
    if (!this.lastMessageAt || now - this.lastMessageAt > 30_000) issues.push('Binance websocket heartbeat missing or stale');
    return { market: this.market, symbol: normalized, generatedAt: now, frames, stale: issues.length > 0, issues };
  }

  getStrategyFrames(symbol: string): Partial<Record<Timeframe, Candle[]>> {
    const snapshot = this.getSnapshot(symbol);
    if (snapshot.stale) return {};
    const map: Record<Timeframe, BinanceInterval> = { H4: '4h', H1: '1h', M15: '15m', M5: '5m', M1: '1m' };
    const frames: Partial<Record<Timeframe, Candle[]>> = {};
    for (const [timeframe, interval] of Object.entries(map) as Array<[Timeframe, BinanceInterval]>) {
      frames[timeframe] = snapshot.frames[interval].map(c => ({
        time: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      }));
    }
    return frames;
  }

  getConnectionStatus(): { connected: boolean; lastMessageAt: number; market: BinanceMarket } {
    const connected = !this.stopped && this.sockets.some(s => s.readyState === WebSocket.OPEN) &&
      this.lastMessageAt > 0 && Date.now() - this.lastMessageAt <= 30_000;
    return { connected, lastMessageAt: this.lastMessageAt, market: this.market };
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const socket of this.sockets) {
      try { socket.close(); } catch { /* best-effort socket cleanup */ }
    }
    this.sockets = [];
    this.lastMessageAt = 0;
  }
}
