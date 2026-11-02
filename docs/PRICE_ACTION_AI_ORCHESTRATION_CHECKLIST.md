# Price Action AI orchestration checklist

Status: design baseline only. Not approved for live trading.

- [x] Public Binance REST/WebSocket closed-candle feed for BTCUSDT, ETHUSDT and SOLUSDT; Spot or USD-M Futures must be selected explicitly.
- [ ] Connect the feed lifecycle to a supervised worker and operational health endpoint.
- [x] Closed-candle pre-trigger detector using H4/H1 alignment, M15 structure zone, candle pattern, volume and unbroken trigger.
- [ ] Full pivot-confirmed structure scanner, zone lifecycle and data-freshness orchestration.
- [ ] Cheap deterministic pre-trigger scanner; no AI call without a candidate.
- [x] AI review coordinator contract with per-symbol cooldown, in-flight deduplication and fail-closed behavior.
- [x] Provider adapter calls the existing Invista PRO multi-model ensemble with original OHLCV candles and structured strategy context; missing model response fails closed.
- [ ] Wire runtime into supervised worker and provide complete context/position adapters.
- [x] Pipeline contract connects pre-trigger approval to the final deterministic gate; no order is sent by the pipeline.
- [ ] Final deterministic gates rerun after AI approval; AI cannot create signals or override risk.
- [ ] DEMO/testnet-only execution adapter with idempotency and reconciliation.
- [ ] Exchange-side protective stop confirmed before considering a position protected.
- [x] Runtime port for event-driven position reviews through the AI coordinator.
- [ ] Connect real exchange position stream, material-event detector and bounded heartbeat scheduler.
- [ ] AI stop changes may tighten only; hard risk limits and emergency exits remain deterministic.
- [ ] Backtest, out-of-sample, replay, fault-injection and DEMO evidence before any live enablement.
- [ ] Preserve existing Girassol EA and its download route unchanged.

No checklist item is complete merely because its interface or documentation exists. Each item requires implementation evidence and tests.