# Invista PRO Price Action EA for MetaTrader 5

This is a standalone, broker-neutral Expert Advisor. It trades only the symbol of the chart where it is attached (_Symbol) and does not depend on the Girassol EA.

## Current validation mode

**DEMO accounts only.** The EA intentionally refuses to initialize on a real-money account. This restriction must remain until MetaEditor compilation, Strategy Tester validation, and forward testing on DEMO have all passed.

Source: public/downloads/InvistaPRO_PriceAction_EA.mq5

## Setup

1. Download the EA from the authenticated Invista PRO Price Action EA download route, rather than copying a token into a public file.
2. In MetaTrader 5, open Tools → Options → Expert Advisors.
3. Enable Allow WebRequest for listed URL and add https://invista-pro-v10-kzlv.onrender.com
4. Open MetaEditor and compile InvistaPRO_PriceAction_EA.mq5.
5. Attach the EA to the broker's BTC chart on a DEMO account. The chart timeframe is not the strategy timeframe; the EA reads closed H4, H1, M15, M5 and M1 candles itself.
6. Confirm that Algo Trading is enabled and that the EA's status indicator is active. Review the Experts and Journal tabs for data, permission, token, or news-calendar blocks.

The download route injects the configured API token into the downloaded EA. Do not commit that token, post it in screenshots, or share a tokenized source file.

## Strategy and execution

- H4/H1 establish directional bias. Conflicting higher-timeframe direction blocks the setup.
- M15 defines the operational zone. The strategy avoids the middle of a range.
- M5 supplies the closed-candle trigger; M1 is additional context for AI review.
- Liquidity sweeps, FVG, order blocks, BOS/CHoCH, candle rejection and relative volume contribute to confluence. They do not replace the trigger and execution gates.
- The server-side review checks candle freshness and blocks entry when the high-impact news calendar is blocked, stale or unavailable.
- A failed API request, invalid data, missing permissions, excessive spread, insufficient margin or failed risk calculation blocks a new entry.

## Default risk controls

| Setting | Default |
|---|---:|
| Risk per trade | 1.0% of equity |
| Maximum configured risk | 2.0% |
| Maximum stop distance | 1.5% |
| Minimum weighted net reward/risk | 2.0 |
| Estimated round-trip costs | 0.15% plus spread estimate |
| Trades per day | 3 |
| Consecutive losses before pause | 2 |
| Losing trades per day | 3 |
| Pause after consecutive losses | 60 minutes |
| Daily equity loss limit | 3.0% |
| Free-margin reserve multiplier | 1.5 |

The EA sizes volume with OrderCalcProfit, broker volume limits and a worst-permitted-slippage buffer. It rechecks the actual fill, stop percentage and weighted net RR after execution. The planned scale-out closes up to 50% at +1.5R; the remaining target is extended so the weighted result still meets the configured net RR. Structural trailing begins at +2R and never widens the stop.

Daily counters, trade events and closed-position results are reconciled against MT5 history and flushed to terminal storage. Position management is serialized across charts using the same account, symbol and magic number.

## Required validation before live trading

- Zero-error, zero-warning MetaEditor compilation.
- Strategy Tester runs with broker-specific BTC history, real ticks where available, spread and commission settings.
- Separate checks on netting and hedging account modes.
- Tests for partial fills, rejected orders, slippage, stop/freeze levels, disconnects, API unavailability, news-calendar failure and terminal restarts.
- DEMO forward test long enough to cover different volatility and liquidity conditions.
- Review trade logs and realized net RR, not only signal accuracy or gross backtest profit.

A successful TypeScript/static policy test or production build is not an MQL5 compile and does not establish profitability. This EA is not approved for real-money execution.
