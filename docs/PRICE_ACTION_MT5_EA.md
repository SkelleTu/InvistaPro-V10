# Invista PRO Price Action EA for MetaTrader 5

## Broker-neutral contract

This EA is independent from the existing Girassol EA and its download. It trades only the symbol of the chart where it is attached (`_Symbol`). It does not connect to Binance or Deriv APIs and does not infer the broker from the symbol name.

Quotes, candles, contract size, tick size, volume step/minimum/maximum, trade mode, margin calculation and order execution come from the connected MT5 terminal/broker. Names such as BTCUSD, BTCUSDT, BTCUSD.r or broker-specific suffixes are not hardcoded. The actual instrument must still be a tradable Bitcoin market with sufficient MT5 history and valid contract specifications.

## Entry process

1. Read closed candles only from H4, H1, M15, M5 and M1.
2. Require H4/H1 EMA trend alignment.
3. Detect a closed M5 candle pattern and require proximity to an M15 structure extreme.
4. Require relative tick volume above the prior 20 closed candles.
5. Send the complete OHLCV snapshot, symbol, trigger, invalidation, spread and account-risk context to the authenticated MT5 AI review endpoint.
6. The existing multi-model AI ensemble must return a unanimous approval. Missing models, invalid news status, malformed data, low confidence or disagreement blocks the entry.
7. On the next M5 close, revalidate trend, invalidation, M15 zone and volume, then require the final trigger breakout.
8. Recalculate structural stop, broker tick normalization, estimated round-trip costs, net R:R, lot size and margin immediately before sending the order.

The EA does not let AI create an entry or bypass local risk gates.

## Risk and position management

- Default risk: 1% of equity; hard configurable ceiling: 2%.
- Structural stop: latest confirmed two-left/two-right M15 swing pivot plus an ATR margin.
- Stop distance above 1.5% of entry is rejected.
- Minimum estimated net reward/risk: 1:2 after the configured cost estimate.
- Lot size uses `OrderCalcProfit` in account currency and broker volume constraints.
- Broker tick size, stop/freeze distance, trade mode and free margin are validated.
- Default daily trade cap: 3 (configurable up to 5).
- Two consecutive losing positions trigger a 60-minute pause.
- Three losing positions stop entries for the day.
- Default daily equity drawdown ceiling: 3%.
- Break-even at +1R; one 50% partial at +1.5R; structural trailing from +2R.
- AI position reviews run on a material move (0.5 M15 ATR) or a 15-minute heartbeat. AI may HOLD, request one partial, tighten a stop or request a close. It cannot widen a stop.
- Initial R distance and daily circuit-breaker state are persisted in MT5 terminal Global Variables.

## Cost configuration

`InpEstimatedRoundTripCostPercent` is an explicit estimate for combined round-trip commission and slippage. It is broker/instrument-specific and must be calibrated from the broker's contract and actual DEMO fills. `InpMaxSpreadPoints` and `InpMaxSlippagePoints` can be set explicitly; zero selects an ATR-based ceiling. Incorrect assumptions can invalidate the net R:R calculation, so the defaults are not universal guarantees.

## Security and operating mode

- This validation build refuses to initialize on a non-DEMO account.
- The AI review and telemetry endpoints require the EA token injected by the authenticated dashboard download.
- Add the platform URL to MT5: Tools → Options → Expert Advisors → Allow WebRequest for listed URL.
- Install the `.mq5` in `MQL5/Experts`, compile with MetaEditor (F7), attach to the intended Bitcoin chart and test on DEMO first.
- Broker-side SL/TP are submitted with the entry order; local AI/network availability is not required for those protective orders to remain active.

## Validation still required

This source has not been compiled by MetaEditor in this environment and has not completed forward DEMO execution. Static TypeScript/source-policy tests do not prove MQL5 compilation or broker execution.

Before calling the EA production-ready, complete:
- MetaEditor compile with zero errors and review all warnings.
- DEMO forward tests on at least two MT5 brokers and different Bitcoin symbol suffixes/contract types.
- Reconnect/restart tests with an open position, partial fill, rejected modification, slippage and market closure.
- Verify realized commissions/fees and slippage against `InpEstimatedRoundTripCostPercent`.
- Full parity for liquidity sweep, FVG, Order Block, BOS/CHoCH, range-extreme logic and pivot lifecycle.
- Backtest with real broker history, out-of-sample periods and realistic costs.

No profitability is guaranteed. This EA is a DEMO validation build, not an authorization for live trading.
