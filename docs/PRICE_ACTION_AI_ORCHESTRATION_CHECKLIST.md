# Price Action AI orchestration checklist

Status: design baseline only. Not approved for live trading.

- [x] Public Binance REST/WebSocket closed-candle feed for BTCUSDT, ETHUSDT and SOLUSDT; Spot or USD-M Futures must be selected explicitly.
- [ ] Connect the feed lifecycle to a supervised worker and operational health endpoint.
- [x] Closed-candle pre-trigger detector using H4/H1 alignment, M15 structure zone, candle pattern, volume and unbroken trigger.
- [ ] Full pivot-confirmed structure scanner, zone lifecycle and data-freshness orchestration.
- [ ] Cheap deterministic pre-trigger scanner; no AI call without a candidate.
- [x] AI review coordinator contract with per-symbol cooldown, in-flight deduplication and fail-closed behavior.
- [x] Provider adapter calls the existing Invista PRO multi-model ensemble with original OHLCV candles and structured strategy context; missing model response fails closed.
- [x] Binance context adapter for bid/ask, configured taker fees and slippage, macro-news window, Brasília sessions and injected account-risk authority; missing configuration fails closed.
- [ ] Wire runtime into supervised worker and supply a verified account-risk implementation.
- [x] Pipeline contract connects pre-trigger approval to the final deterministic gate; no order is sent by the pipeline.
- [ ] Final deterministic gates rerun after AI approval; AI cannot create signals or override risk.
- [ ] DEMO/testnet-only execution adapter with idempotency and reconciliation.
- [ ] Exchange-side protective stop confirmed before considering a position protected.
- [x] Runtime port for event-driven position reviews through the AI coordinator, fed by Binance trade ticks rather than waiting only for candle closes.
- [ ] Connect real exchange position stream, material-event detector and bounded heartbeat scheduler.
- [ ] AI stop changes may tighten only; hard risk limits and emergency exits remain deterministic.
- [ ] Backtest, out-of-sample, replay, fault-injection and DEMO evidence before any live enablement.
- [x] Independent MT5 Price Action EA source uses the selected chart symbol and broker-provided contract specifications; no Binance/Deriv dependency.
- [x] Separate authenticated download route and dashboard button; existing Girassol EA and its download route remain unchanged.
- [x] MT5 AI review endpoint accepts closed OHLCV frames for arbitrary broker symbol names, validates candles and fails closed on news/AI unavailability.
- [x] EA risk controls include account-currency lot sizing, broker volume/tick/margin constraints, structural pivot stop, net cost estimate, daily circuit breakers, persistent state, break-even, one-time partial and tightening-only trailing.
- [x] Event-driven position AI reviews use material price moves plus a 15-minute bounded heartbeat; AI can HOLD, take one partial, tighten stop or request close.
- [ ] MetaEditor compile and runtime validation across MT5 brokers/symbol contract types.
- [ ] DEMO forward test, restart/reconnect tests, execution rejection/slippage tests and trade-history reconciliation.
- [ ] Full deterministic scanner parity with documented sweep/FVG/OB/BOS/CHoCH/range criteria; current EA uses local structure/pattern gates and AI reviews the raw frames.

No checklist item is complete merely because its interface or documentation exists. Each item requires implementation evidence and tests.