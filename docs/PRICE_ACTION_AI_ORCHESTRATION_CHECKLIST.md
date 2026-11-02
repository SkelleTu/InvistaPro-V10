# Price Action AI orchestration checklist

Status: design baseline only. Not approved for live trading.

- [x] Public Binance REST/WebSocket closed-candle feed for BTCUSDT, ETHUSDT and SOLUSDT; Spot or USD-M Futures must be selected explicitly.
- [ ] Connect the feed lifecycle to a supervised worker and operational health endpoint.
- [ ] Closed-candle multi-timeframe pre-trigger scanner (H4, H1, M15, M5/M1), including confirmed pivots and stale/gap checks.
- [ ] Cheap deterministic pre-trigger scanner; no AI call without a candidate.
- [x] AI review coordinator contract with per-symbol cooldown, in-flight deduplication and fail-closed behavior.
- [ ] Adapter that sends the complete Binance multi-timeframe snapshot to the existing Invista PRO AI ensemble.
- [ ] Final deterministic gates rerun after AI approval; AI cannot create signals or override risk.
- [ ] DEMO/testnet-only execution adapter with idempotency and reconciliation.
- [ ] Exchange-side protective stop confirmed before considering a position protected.
- [ ] Event-driven AI monitoring for open positions, with heartbeat fallback.
- [ ] AI stop changes may tighten only; hard risk limits and emergency exits remain deterministic.
- [ ] Backtest, out-of-sample, replay, fault-injection and DEMO evidence before any live enablement.
- [ ] Preserve existing Girassol EA and its download route unchanged.

No checklist item is complete merely because its interface or documentation exists. Each item requires implementation evidence and tests.