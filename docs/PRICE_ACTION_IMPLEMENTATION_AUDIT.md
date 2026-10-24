# Price Action implementation audit

**Scope reviewed:** branch `fix/price-action-compliance-20261024` in `SkelleTu/InvistaPro-V10`.
**Production status:** unchanged. This branch has not been merged or deployed.
**Validation rule:** no item is marked “implemented and tested” because this review has no successful automated test/build run, no MetaEditor compilation result, and no MT5 Demo forward-test evidence.

Status meanings follow the source strategy's requested categories:
- **Implemented and tested:** code and executable test evidence both exist and passed.
- **Implemented, not validated:** code path exists, but passing tests/real execution evidence is missing.
- **Incomplete:** only part of the requirement exists, or the code targets a different platform than the source document.
- **Nonexistent / no evidence found:** no usable implementation or verifiable evidence was found in this scope.

| Requirement from the strategy | Status | Evidence and remaining work |
|---|---|---|
| Real data for Binance BTC/USDT, ETH/USDT and SOL/USDT | **Incomplete** | The application currently receives market/account data through an MT5 EA and broker symbols such as BTCUSD/ETHUSD/SOLUSD. A Binance market-data adapter for the requested USDT pairs is not implemented in this branch. |
| Closed, chronological candles and H4/H1/M15/M5-or-M1 analysis | **Implemented, not validated** | EA candle export was changed to start at shift 1; server candle validation rejects unordered bars. The engine selects M1 when it is the valid trigger and enforces closed-bar data. No automated check has passed yet. |
| Confirmed swings, trend/range distinction, support/resistance, FVG, Order Block, BOS/CHoCH | **Implemented, not validated** | The engine contains confirmed-pivot trend logic, explicit range-boundary detection, zone clustering, retraced/non-invalidated FVG logic, Order Block validation, and swing-based BOS/CHoCH. The calculations still need unit-test and historical-chart verification. |
| Full entry checklist, including trigger, volume, zone, space, spread, news, session, risk and cost-aware R:R | **Implemented, not validated** | The deterministic route evaluates the checklist and returns explicit HOLD reasons. Volume is checked against the preceding 20 closed bars; a missing barrier, spread, calendar or cost estimate fails closed. No passed tests or chart-by-chart evidence is available. |
| Stop/target/position sizing, partial at 1.5R, breakeven at 1R and structural trailing | **Implemented, not validated** | The EA contains position sizing, partial-close logic, breakeven management and confirmed-M5 structural trailing after the partial. The EA also checks broker-side SL/TP after fills. These paths have not been compiled or exercised in MT5. |
| 1% default risk, 1–2% allowed risk, 3–5 trades/day, three daily losses, one-hour cooldown after two consecutive losses | **Implemented, not validated** | Server-side gates and Brasília-day counters were added. They require successful automated tests and Demo execution evidence, including partial closes, fees, restart and day rollover. |
| London/New York/Brasília sessions and 30-minute high-impact-news window | **Implemented, not validated** | Session windows use IANA time zones and daylight-saving-aware conversion; missing/invalid calendar data blocks entries. The integration with the live economic calendar has not been verified end-to-end. |
| Exact broker/server position reconciliation and closed-trade accounting | **Implemented, not validated** | The EA reports broker position tickets, the server no longer silently erases internal positions on a zero count, and mismatches block new entries. Close reports aggregate deal profit, commission, swap and fee and retry failed reports on heartbeats. This remains uncompiled and untested. |
| Binance order submission and Binance-side order/position confirmation | **Incomplete** | The current execution route uses MT5/CTrade, not Binance's API. MT5 fill and protective-stop verification do not establish Binance execution compliance. This is the principal platform-scope mismatch with the authoritative document. |
| Verifiable backtest, out-of-sample evaluation and real-time simulation with realistic costs | **Incomplete / no evidence verified** | No passing backtest report, out-of-sample results, paper-trading run, cost reconciliation, or Demo forward-test evidence has been provided or verified in this work. |
| Production readiness and permission to enable REAL | **Incomplete** | No production deployment has occurred. Do not enable REAL. The broker-specific `PriceActionExtraRoundTripCostPerLot` is deliberately defaulted to zero, which blocks Price Action entries until a real commission/slippage estimate is configured. |

## Validation results at this audit

- Automated test suite: **not confirmed executed successfully**.
- TypeScript check and production bundle: **not confirmed executed successfully**.
- Vercel status: failed with a build-rate-limit destination; this does not prove whether the source compiles.
- GitHub Actions workflow: added to this branch, but no workflow run result is available yet.
- MetaEditor/MQL5 compilation: **not performed / no evidence**.
- MT5 Demo forward testing: **not performed / no evidence**.
- Production deployment: **not performed**.
- Aura service: must remain suspended.

## Conclusion

The current branch contains substantial implementation work, but it cannot honestly be labeled 100% complete or production-ready. In particular, the source document explicitly specifies Binance spot data and order execution, while the current application executes through MT5. Full literal conformance requires a Binance implementation (or an explicitly approved scope change), successful automated checks, MQL5 compilation, reconciliation tests, and a documented Demo/simulation run before any REAL authorization.
