# Price Action EA implementation checklist

The primary deliverable is a broker-neutral MetaTrader 5 EA. It reads the selected chart symbol and uses the connected MT5 broker for quotes, contract specifications and execution. It does not require Binance or Deriv APIs. The experimental Binance service below is a separate adapter and is not a prerequisite for this EA.

## MT5 EA implemented in source

- [x] Independent MT5 EA source: `public/downloads/InvistaPRO_PriceAction_EA.mq5`.
- [x] Uses `_Symbol` from the selected chart; no hardcoded broker, exchange or BTC symbol suffix.
- [x] H4/H1 trend alignment and closed-candle M15/M5 structure/pattern checks.
- [x] Pre-trigger request to the existing multi-model AI ensemble; approval is mandatory and fail-closed.
- [x] AI review endpoint validates OHLCV, symbol, timeframe data and high-impact-news status.
- [x] Final breakout is checked on the next closed M5 candle; trend, invalidation, zone and volume are revalidated.
- [x] Structural stop from confirmed two-left/two-right M15 swing pivot with ATR margin.
- [x] Broker-specific volume step/minimum/maximum, tick size, stop/freeze levels, trade mode and margin validation.
- [x] Account-currency sizing via `OrderCalcProfit`; 1% default risk, 2% hard ceiling and 1.5% maximum stop distance.
- [x] Estimated round-trip cost and net R:R validation, with broker-configurable cost assumption.
- [x] Default daily cap of 3 trades, two consecutive losses pause, three daily losing trades stop, daily drawdown circuit breaker.
- [x] Persisted daily risk state and initial R distance across EA restarts; atomic terminal-global entry lock and deal-event deduplication share daily limits across charts on the same account, including different magic numbers.
- [x] Broker-side SL/TP on entry, break-even at +1R, one 50% partial at +1.5R and tightening-only structural trailing from +2R.
- [x] Event-driven AI position reviews on material price movement plus 15-minute bounded heartbeat; HOLD, one partial, tighten-only stop or reasoned close.
- [x] DEMO-only initialization in this validation build.
- [x] Separate authenticated download route and dashboard button; Girassol EA source, endpoint and button are not replaced.
- [x] Authenticated telemetry heartbeat for the independent EA.
- [x] Static source-policy test included in the project test script.

## MT5 EA still required before production-ready / 100%

- [ ] MetaEditor compile with zero errors; review warnings and confirm behavior on current MT5 builds.
- [ ] Forward DEMO validation on at least two brokers and different Bitcoin symbol suffixes/contract types.
- [ ] Verify commission, fees and slippage assumptions against actual DEMO fills and configure cost inputs per broker.
- [ ] Test restart/reconnect with open positions, partial fills, order rejection, failed stop modification, market closure and lost responses.
- [ ] Reconcile terminal positions and trade history after reconnect/restart; verify no duplicate entry after ambiguous execution.
- [x] Basic range regime detection requires H4/H1/M15 range alignment and permits setups only at M15 extremes; targets are rejected when blocked by a confirmed opposing pivot.
- [ ] Complete deterministic definitions and tests for liquidity sweeps, FVG, Order Blocks, BOS/CHoCH and persistent zone lifecycle.
- [ ] Backtest, out-of-sample, replay, fault-injection and DEMO forward evidence.
- [ ] Validate reconstructed drawdown baseline against broker history with deposits/withdrawals and carried positions; verify shared account-wide risk across different magic numbers and separate MT5 terminals.

## Separate Binance research adapter (not an EA dependency)

- [x] Experimental Binance public REST/WebSocket closed-candle feed for BTCUSDT, ETHUSDT and SOLUSDT.
- [x] Experimental Binance pre-trigger scanner and AI provider contracts.
- [ ] Supervised worker, exchange position stream, DEMO/testnet execution, exchange-side protection and reconciliation.
- [ ] Keep this adapter isolated; it must never impose Binance/Deriv restrictions on the MT5 EA.

No source-level checkbox proves compilation, broker execution, profitability or readiness for live trading. No live trading is enabled by this validation build.
