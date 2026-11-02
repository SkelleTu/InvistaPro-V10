import type { BinanceMarket } from './binance-price-action-feed';
import type { MarketContext } from './price-action-engine';
import { buildTrustedPriceActionContext, getHighImpactNewsStatus, isAllowedBrasiliaTradingSession } from './price-action-context';

export interface PriceActionAccountRiskProvider {
  /** Must account for daily loss, consecutive losses, open risk and confirmed DEMO/testnet account mode. */
  isRiskWithinLimits(symbol: string): Promise<boolean>;
}

function requiredRate(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') throw new Error(name + ' must be configured before Price Action can evaluate entries');
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 0.02) throw new Error(name + ' is outside the accepted range');
  return value;
}

/**
 * Builds fail-closed execution context from live Binance bid/ask, trusted news,
 * Brasília session policy and an injected account-level risk authority.
 * Fee and slippage assumptions are mandatory configuration, never guessed.
 */
export class BinancePriceActionContextProvider {
  constructor(
    private readonly market: BinanceMarket,
    private readonly riskProvider: PriceActionAccountRiskProvider,
  ) {}

  async getContext(symbol: string): Promise<MarketContext> {
    const endpoint = this.market === 'spot'
      ? 'https://api.binance.com/api/v3/ticker/bookTicker'
      : 'https://fapi.binance.com/fapi/v1/ticker/bookTicker';
    const url = new URL(endpoint);
    url.searchParams.set('symbol', symbol.toUpperCase());
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('Binance bookTicker HTTP ' + response.status);
    const book = await response.json() as { bidPrice?: unknown; askPrice?: unknown };
    const bid = Number(book.bidPrice), ask = Number(book.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
      throw new Error('Binance bid/ask invalid; entry blocked');
    }

    const feeRate = requiredRate('PRICE_ACTION_TAKER_FEE_RATE');
    const slippageRate = requiredRate('PRICE_ACTION_SLIPPAGE_RATE');
    const mid = (bid + ask) / 2;
    const spread = ask - bid;
    const estimatedRoundTripCost = spread * 2 + mid * (feeRate * 2 + slippageRate * 2);
    const [news, riskLimitOk] = await Promise.all([
      getHighImpactNewsStatus(),
      this.riskProvider.isRiskWithinLimits(symbol),
    ]);

    const trusted = buildTrustedPriceActionContext({
      bid, ask, entryPrice: mid, riskLimitOk, newsBlocked: news.blocked || !news.valid,
      sessionOpen: isAllowedBrasiliaTradingSession(),
    });
    return {
      ...trusted,
      estimatedRoundTripCost,
      highImpactNewsBlocked: news.blocked || !news.valid,
      riskLimitOk: riskLimitOk === true,
      tradingSessionOpen: isAllowedBrasiliaTradingSession(),
    };
  }
}
