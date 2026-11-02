# Price Action AI execution design

The scanner is a low-cost deterministic process. It must not call AI while no candidate exists. Once a pre-trigger is found, it sends one complete, timestamped multi-timeframe snapshot to the existing Invista PRO AI ensemble. The ensemble returns a structured APPROVE, REJECT, WATCH or HOLD decision with direction, confidence, reasoning, risks and invalidation conditions.

An approval is provisional. The deterministic strategy engine must wait for the final trigger and rerun every data, structure, volume, session, news, spread, cost, reward/risk and account-risk gate. Any missing, stale, inconsistent or rejected check means HOLD. AI cannot create a signal, change sizing, widen a stop or override a hard limit.

For an open position, the coordinator calls AI on material market events and on a bounded heartbeat, not on every tick. AI may recommend HOLD, partial close, tighter stop or exit. Exchange-side protective stops and hard circuit breakers remain active independently of AI availability. An AI outage never removes existing protection.

The coordinator in server/services/price-action-ai-coordinator.ts provides the call contracts, per-symbol cooldown, in-flight deduplication, fail-closed handling and stop-tightening validation. It does not connect to a market feed, invoke the production AI ensemble or place orders.

Not yet implemented: Binance feed and candle builder, pre-trigger scanner integration, adapter to the existing AI ensemble, background worker and routes, Binance DEMO/testnet order adapter, order/position reconciliation, complete position manager, independent EA/download UI, and validation evidence. This code is not a trading system and must not be enabled for live orders.

Open strategy decisions: Binance Spot or USD-M Futures; complete range-market entry rules; macro calendar provider and open-position news policy; account-level monetary loss and margin caps; and the exact role of an MT5 EA when the execution venue is Binance. These must be settled before enabling an exchange adapter.