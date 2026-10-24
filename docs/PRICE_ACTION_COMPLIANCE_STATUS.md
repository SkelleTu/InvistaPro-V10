# Invista Pro Price Action Compliance Status

## Normative source

The document supplied by the user is the normative strategy. This branch preserves an exact copy at `docs/PRICE_ACTION_AUTHORITATIVE_SPEC.txt`. AI consensus, model confidence, Girassol, Fibonacci, or a legacy double-top/double-bottom condition must not add an entry veto after the deterministic strategy has passed every written gate. They remain diagnostic only.

## Changes in this branch

- The crypto Price Action route no longer requires a cached AI signal or a second fixed 70% confidence gate to approve a valid strategy setup.
- Legacy Girassol, Fibonacci and Brazilian-news checks no longer overturn a setup approved by the deterministic strategy.
- The evaluator verifies ordered OHLCV candles, closed-bar timing, H4/H1 market structure, M15 context, M5/M1 trigger, volume, a relevant zone, structural stop, 1:2 reward/risk after estimated costs, space to a known next structural barrier, spread, session, news and risk protections.
- Range trading is allowed only at an identified range extreme with a confirmed entry trigger.
- The response exposes relevant support/resistance, FVG, Order Block and liquidity zones with timeframe, origin/identification times, reaction count, invalidation level and state, including diagnostic zones when it returns HOLD.
- The EA ignores unfinished candles, keeps strategy-owned SL/TP/lot logic for supported crypto symbols regardless of manual/partial AI mode, reserves estimated transaction costs while sizing, checks broker margin, moves stop to break-even at +1R, attempts the documented 50% partial at +1.5R and uses confirmed M5 swings to tighten trailing protection.
- Risk controls use the Brasilia operational day, a separate money-loss ceiling, a configured daily cap of 3–5 operations, three losing operations per day, and the documented one-hour cooldown after two consecutive losses.
- Session windows use London and New York local time zones so daylight-saving changes are not hard-coded as permanent Brasília times.

## Configuration needed before a valid signal can be accepted

`MT5_PRICE_ACTION_EXTRA_COST_RATE` must be explicitly configured in the server environment. It represents the additional round-trip cost rate beyond twice the observed spread, covering estimated commission, slippage and other fees. For example, `0.0002` means an additional estimate of 0.02% of the mid-price. An explicit `0` means the operator deliberately declares no additional costs; an unset/invalid value fails closed and prevents entry rather than assuming fees are zero.

The EA receives the same estimated round-trip cost used by the server's reward/risk check and reserves it when sizing the position.

## Critical integration gap: Binance versus MT5

The supplied specification explicitly names Binance BTC/USDT, ETH/USDT and SOL/USDT and requires execution in the correct Binance environment. The existing production integration is still an MT5 Expert Advisor: market candles and tick volume come from the MT5 broker, and orders are sent by the MT5 terminal. This branch aligns the strategy logic in that MT5 pathway; it does **not** turn the existing service into a Binance market-data or Binance order-execution adapter.

Before claiming complete compliance with the entire document, a Binance execution/data pathway must be implemented and validated. The spec does not specify Spot versus a derivatives product, which changes short-selling behavior, margin calculation, order types and protective-stop implementation. No Binance API credentials are available in this branch, so a real exchange execution cannot be verified or safely enabled by this code change.

## Validation status

This is an isolated review branch. It has not been merged to `main`, deployed to production, or connected to live order execution. GitHub Actions is being used for TypeScript checks, strategy/risk regression tests and a production build. The MT5 source still needs compilation in MetaEditor and an operational DEMO test; neither is represented as passed until verified. Backtesting, out-of-sample testing and cost-inclusive real-time simulation are also required before considering real-money operation.

Passing unit/static checks proves code behavior only for the tested cases. It does not establish strategy profitability or complete platform compliance.
