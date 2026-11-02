# Price Action AI orchestration checklist

Status: design baseline only. Not approved for live trading.

- [ ] Binance market-data adapter for BTC/USDT, ETH/USDT and SOL/USDT.
- [ ] Closed-candle multi-timeframe scanner (H4, H1, M15, M5/M1).
- [ ] Cheap deterministic pre-trigger scanner; no AI call without a candidate.
- [ ] AI full-context review only after pre-trigger, with per-symbol deduplication and cooldown.
- [ ] Final deterministic gates rerun after AI approval; AI cannot create signals or override risk.
- [ ] DEMO/testnet-only execution adapter with idempotency and reconciliation.
- [ ] Exchange-side protective stop confirmed before considering a position protected.
- [ ] Event-driven AI monitoring for open positions, with heartbeat fallback.
- [ ] AI stop changes may tighten only; hard risk limits and emergency exits remain deterministic.
- [ ] Backtest, out-of-sample, replay, fault-injection and DEMO evidence before any live enablement.
- [ ] Preserve existing Girassol EA and its download route unchanged.

No checklist item is complete merely because its interface or documentation exists. Each item requires implementation evidence and tests.