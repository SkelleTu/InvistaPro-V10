import { EventEmitter } from 'events';
import { BinancePriceActionFeed, type BinanceMarket } from './binance-price-action-feed';
import { priceActionAiPipeline, priceActionAiCoordinator } from './price-action-ai-pipeline';
import type { MarketContext, Timeframe } from './price-action-engine';
import type { PositionState } from './price-action-ai-coordinator';

export interface PriceActionContextProvider {
  /** Must return explicit spread, costs, news, session and risk status; missing values fail closed in the engine. */
  getContext(symbol: string): Promise<MarketContext>;
}
export interface PriceActionPositionProvider {
  listOpenPositions(symbol: string): Promise<PositionState[]>;
  getPositionSnapshot(position: PositionState, frames: unknown): Promise<unknown>;
  isMaterialEvent(position: PositionState, frames: unknown): Promise<boolean>;
}

/**
 * Supervised runtime boundary. It connects Binance closed candles to the
 * scanner/AI pipeline and sends position snapshots to the AI coordinator.
 * There is intentionally no order-execution method in this runtime.
 */
export class PriceActionRuntime extends EventEmitter {
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private readonly busy = new Set<string>();

  constructor(
    private readonly market: BinanceMarket,
    private readonly contextProvider: PriceActionContextProvider,
    private readonly positionProvider?: PriceActionPositionProvider,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.started) return;
    const feed = new BinancePriceActionFeed(this.market);
    await feed.loadInitialHistory(120);
    this.unsubscribe = feed.onClosedCandle((symbol) => {
      void this.evaluateSymbol(symbol, feed);
    });
    feed.start();
    this.feed = feed;
    this.started = true;
    this.emit('status', { active: true, market: this.market, symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] });
  }

  private feed: BinancePriceActionFeed | null = null;

  private async evaluateSymbol(symbol: string, feed: BinancePriceActionFeed): Promise<void> {
    if (this.busy.has(symbol)) return;
    this.busy.add(symbol);
    try {
      const snapshot = feed.getSnapshot(symbol);
      if (snapshot.stale) {
        this.emit('hold', { symbol, reasons: snapshot.issues });
        return;
      }
      const frames = feed.getStrategyFrames(symbol);
      const context = await this.contextProvider.getContext(symbol);
      const result = await priceActionAiPipeline.evaluate(symbol, frames, context);
      this.emit('analysis', { ...result, market: snapshot.market, generatedAt: snapshot.generatedAt });

      if (this.positionProvider) {
        const positions = await this.positionProvider.listOpenPositions(symbol);
        for (const position of positions) {
          const marketSnapshot = await this.positionProvider.getPositionSnapshot(position, frames);
          const materialEvent = await this.positionProvider.isMaterialEvent(position, frames);
          const review = await priceActionAiCoordinator.reviewOpenPosition(
            position, marketSnapshot, materialEvent,
          );
          if (review.invoked) this.emit('position-review', { positionId: position.id, symbol, ...review });
        }
      }
    } catch (error) {
      this.emit('hold', {
        symbol,
        reasons: [error instanceof Error ? error.message : 'Price Action runtime failure'],
      });
    } finally {
      this.busy.delete(symbol);
    }
  }

  getStatus(): { active: boolean; market: BinanceMarket | null; feed: ReturnType<BinancePriceActionFeed['getConnectionStatus']> | null } {
    return {
      active: this.started,
      market: this.market,
      feed: this.feed?.getConnectionStatus() ?? null,
    };
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.feed?.stop();
    this.feed = null;
    this.started = false;
    this.emit('status', { active: false, market: this.market });
  }
}
