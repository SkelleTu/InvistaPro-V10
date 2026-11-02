import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_PriceAction_EA.mq5', import.meta.url), 'utf8');
const route = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../client/src/pages/metatrader-page.tsx', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../server/services/huggingface-ai.ts', import.meta.url), 'utf8');

assert.ok(ea.includes('#property version   "1.0"'), 'Price Action EA must have its own version');
assert.ok(ea.includes('_Symbol'), 'EA must operate on the selected chart symbol');
assert.ok(ea.includes('CopyRates(_Symbol, tf, 1, count, rates)'), 'EA must use closed candles only');
assert.ok(ea.includes('bool AllFramesFresh()'), 'Entry and position AI reviews must reject stale chart history');
assert.ok(ea.includes('PERIOD_H4') && ea.includes('PERIOD_H1') && ea.includes('PERIOD_M15') && ea.includes('PERIOD_M5') && ea.includes('PERIOD_M1'), 'EA must implement top-down multi-timeframe analysis');
assert.ok(ea.includes('(t4!=0 && t15!=0 && t15!=t4)'), 'A conflicting M15 trend must block a directional H4/H1 setup');
assert.ok(ea.includes('bool rangeMode=(t4==0 && t1==0 && t15==0)'), 'Range mode must require H4/H1/M15 range and operate only at extremes');
assert.ok(ea.includes('TrendDataReady(PERIOD_H4)'), 'Missing trend history must not be mistaken for a valid range');
assert.ok(ea.includes('barrier<=target+cost'), 'Long targets must not be placed into the nearest opposing pivot');
assert.ok(ea.includes('HasLiquiditySweep') && ea.includes('HasFVGConfluence') && ea.includes('HasOrderBlockConfluence') && ea.includes('HasBreakOfStructure') && ea.includes('HasChangeOfCharacter'), 'EA must expose structural confluence features to the AI review');
assert.ok(ea.includes('/api/mt5/price-action/review'), 'EA must request independent AI pre-trigger review');
assert.ok(ea.includes('g_approvedPatternTime>0'), 'EA must retain and revalidate AI-approved pre-trigger before final breakout');
assert.ok(ea.includes('PeriodSeconds(PERIOD_M5)*3'), 'AI pre-trigger approval must expire after three M5 candles');
assert.ok(ea.includes('InpRiskPercent>2.0'), 'EA must cap configurable risk at 2%');
assert.ok(ea.includes('InpMaxStopPercent>1.5'), 'EA must cap stop distance at 1.5%');
assert.ok(ea.includes('InpMinimumRR<2.0'), 'EA must enforce minimum net reward/risk of 1:2');
assert.ok(ea.includes('risk*InpMinimumRR+cost*(InpMinimumRR+1.0)'), 'Target distance must solve the net RR equation including entry/exit costs');
assert.ok(ea.includes('finalReward/(finalRisk+cost)<InpMinimumRR'), 'Normalized target must still pass the final net RR gate');

assert.ok(ea.includes('OrderCalcProfit'), 'Position size must use account-currency loss per lot');
assert.ok(ea.includes('SYMBOL_VOLUME_STEP') && ea.includes('SYMBOL_VOLUME_MIN') && ea.includes('SYMBOL_VOLUME_MAX'), 'Volume must respect broker contract steps and limits');
assert.ok(ea.includes('TerminalInfoInteger(TERMINAL_CONNECTED)'), 'Disconnected terminal must block new entries');
assert.ok(ea.includes('TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)'), 'Disabled terminal trading must block new entries');
assert.ok(ea.includes('MQLInfoInteger(MQL_TRADE_ALLOWED)'), 'Disabled EA trading permission must block new entries');
assert.ok(ea.includes('AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)'), 'Account trading restrictions must block new entries');
assert.ok(ea.includes('TRADE_RETCODE_DONE'), 'EA must validate execution return code');
assert.ok(ea.includes('PositionSelectByTicket(positionTicket)'), 'Position management must reselect the exact MT5 position ticket');
assert.ok(ea.includes('trade.PositionModify(positionTicket,'), 'Protective stop changes must target the exact position ticket');
assert.ok(ea.includes('trade.PositionClose(positionTicket)'), 'Position closes must target the exact position ticket');
assert.ok(ea.includes('trade.PositionClosePartial(positionTicket,closeVolume)'), 'Hedging partial closes must target the exact position ticket');
assert.ok(ea.includes('DEAL_POSITION_ID'), 'Slippage emergency close must resolve the position created by the exact fill deal');
assert.ok(ea.includes('PositionModify'), 'EA must manage protective stops');
assert.ok(ea.includes('PositionClosePartial'), 'EA must support partial exit');
assert.ok(ea.includes('ClosePartialPosition'), 'Partial exits must be abstracted for account margin mode');
assert.ok(ea.includes('ACCOUNT_MARGIN_MODE_RETAIL_HEDGING'), 'Partial exits must support hedging accounts');
assert.ok(ea.includes('PA partial reduction'), 'Partial exits must reduce netting accounts with an opposite deal');
assert.ok(ea.includes('GlobalVariableCheck(partialKey)'), 'The deterministic partial exit must happen at most once per position');
assert.ok(ea.includes('ReviewOpenPositionAI'), 'Open positions must receive event-driven AI reviews');
assert.ok(ea.includes('POSITION_IDENTIFIER)!=identifier'), 'Stale AI responses must not modify a replaced position');
assert.ok(ea.includes('bool PersistPositionRisk(ulong identifier)'), 'Original structural risk must be persisted independently of a moved stop');
assert.ok(ea.includes('PersistPositionRisk(filledPositionId)'), 'Initial risk must be captured immediately after an entry fill');
assert.ok(ea.includes('stop<=0'), 'A managed position without a protective stop must trigger fail-safe handling');
assert.ok(ea.includes('MathAbs(beforeVolume-currentVolume)>step*0.5'), 'Partial reductions must reject stale position-volume snapshots');
assert.ok(ea.includes('beforeVolume-closeVolume<minVolume-step*0.25'), 'Netting partial reductions must preserve the broker minimum remaining volume');
assert.ok(ea.includes('bool samePosition='), 'Netting partial reductions must verify the same position identifier after execution');
assert.ok(ea.includes('bool reduced=afterVolume>0 && afterVolume<beforeVolume-step*0.25'), 'Netting partial reductions must verify that volume actually decreased');
assert.ok(ea.includes('bool HasPendingDealEvents()'), 'Unreconciled trade events must block new entries');
assert.ok(ea.includes('PA_RESERVE_'), 'Accepted orders without immediate deal callbacks must reserve a daily trade slot');
assert.ok(ea.includes('GlobalVariableSet(trackKey,1.0)'), 'Confirmed fills must be registered before releasing the shared daily lock');
assert.ok(ea.includes('if(reservedAt>=serverDayStart && reservedAt<=TimeCurrent()) tradesToday++'), 'Daily trade cap must include accepted orders awaiting a deal callback');
assert.ok(ea.includes('GlobalVariableDel("PA_RESERVE_"+account+"_"+(string)orderId)'), 'Broker-history reconciliation must release filled-order reservations');

assert.ok(ea.includes('!g_dailyLedgerReady || HasPendingDealEvents()'), 'Daily risk gate must fail closed while the trade ledger is pending');
assert.ok(ea.includes('headers,5000,data,result,responseHeaders)'), 'Position AI review must not block local protection for 25 seconds');

assert.ok(ea.includes('SYMBOL_TRADE_FREEZE_LEVEL'), 'AI stop tightening must respect broker freeze distance');
assert.ok(ea.includes('TimeCurrent()-g_lastPositionAIReview)>=900'), 'AI position review must have a bounded 15-minute heartbeat');
assert.ok(ea.includes('InpEstimatedRoundTripCostPercent'), 'Net RR and sizing must account for broker-specific costs');
assert.ok(ea.includes('OrderCalcMargin'), 'Entry must validate available margin');
assert.ok(ea.includes('InpMaxSlippagePoints'), 'EA must expose a broker-configurable slippage ceiling');
assert.ok(ea.includes('trade.ResultPrice()'), 'EA must validate the actual execution price after fill');
assert.ok(ea.includes('SYMBOL_TRADE_TICK_SIZE'), 'Prices must align to broker tick size');
assert.ok(ea.includes('PersistDailyState'), 'Daily circuit-breaker state must persist across EA restarts');
assert.ok(ea.includes('GlobalVariableSet(pending,(double)TimeCurrent())'), 'Trade transaction events must be queued persistently');
assert.ok(ea.includes('HistoryDealGetInteger(deal,DEAL_TIME)'), 'Daily ledgers must use actual broker deal timestamps');
assert.ok(ea.includes('ProcessPendingDeals()'), 'Queued deal accounting must be retried by the timer');
assert.ok(ea.includes('GlobalVariableSet(dealGuard,0.0)'), 'Persistent deal guards must survive terminal restarts');
assert.ok(ea.includes('GlobalVariableSet(dealGuard,(double)TimeCurrent())'), 'Deal guard must be committed only after accounting side effects');
assert.ok(ea.includes('HistorySelectByPosition(positionId)'), 'Final position PnL must be reconstructed from all position deals');
assert.ok(ea.includes('PA_CLOSED_'), 'Closed-position accounting must be idempotent by position identifier');
assert.ok(ea.includes('RebuildDailyLossCountersFromLedger()'), 'Daily loss streaks must be reconstructed from the durable closed-position ledger');
assert.ok(ea.includes('bool ReconcilePriceActionHistory(datetime serverDayStart)'), 'Startup reconciliation must recover missed trade transaction callbacks from MT5 history');
assert.ok(ea.includes('HistorySelect(historyFrom,TimeCurrent())'), 'Trade reconciliation must scan broker history after terminal restarts');
assert.ok(ea.includes('GlobalVariableSet(trackKey,1.0)'), 'Recovered open Price Action positions must restore their tracking marker');
assert.ok(ea.includes('if(!HistorySelectByPosition(positionId)) return false'), 'Unavailable position history must fail closed during ledger reconciliation');

assert.ok(ea.includes('!GlobalVariableCheck(closedKey) || !GlobalVariableCheck(closedPnlKey)'), 'Interrupted closed-position ledger writes must be repaired from deal history');

assert.ok(ea.includes('PA_CLOSED_PNL_'), 'Closed-position PnL must be persisted separately for restart-safe reconciliation');
assert.ok(ea.includes('closeTimes[j]<closeTimes[i]'), 'Consecutive losses must be reconstructed in chronological order');
assert.ok(ea.includes('GlobalVariableDel("PA_CLOSED_PNL_"+account+"_"+positionId)'), 'Old closed-position PnL ledger entries must be cleaned up with their timestamps');

assert.ok(ea.includes('DailyRiskAllowed(); // initialize the daily key before any transaction callback can persist state'), 'Daily state must initialize during EA startup');

assert.ok(ea.includes('GlobalVariableSetOnCondition'), 'Concurrent chart instances must serialize entry attempts with an atomic risk lock');
assert.ok(ea.includes('PendingDealPrefix()'), 'Trade callbacks must persist pending accounting work for restart recovery');
assert.ok(ea.includes('trade.PositionModify(positionTicket,'), 'Ticket-based position protection must be used across charts');
assert.ok(ea.includes('GlobalVariableGet(dealGuard)!=0.0'), 'Persistent deal guard must skip only events already fully processed');
assert.ok(ea.includes('CleanupOldDealGuards'), 'Deal deduplication guards must be periodically cleaned up');
assert.ok(ea.includes('return "PA_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+TimeToString(g_dayStart,TIME_DATE);'), 'Daily risk state must be shared across Price Action chart instances on the same account');
assert.ok(ea.includes('DailyRiskAllowed() || !AcquireDailyLock()'), 'Entry must acquire the shared daily risk lock before sending an order');
assert.ok(ea.includes('ReconstructDayStartEquity'), 'Daily drawdown baseline must be reconstructed from history or fail closed');
assert.ok(ea.includes('TimeGMT()-3*60*60'), 'Daily circuit breakers must use the Brasília calendar day, not broker server midnight');
assert.ok(ea.includes('Baseline de equity diário não pode ser reconstruído'), 'Uncertain daily drawdown baseline must block new entries');
assert.ok(ea.includes('InpMaxLosingTradesPerDay = 3'), 'Three losing trades must stop entries for the day');
assert.ok(ea.includes('g_losingTradesToday>=InpMaxLosingTradesPerDay'), 'Daily losing-trade circuit breaker must be enforced');
assert.ok(ea.includes('DEAL_POSITION_ID'), 'Partial exit PnL must be aggregated by position before counting losses');
assert.ok(ea.includes('GlobalVariableTemp(key)'), 'Shared lock initialization must not overwrite another chart lock');
assert.ok(ea.includes('GlobalVariableSetOnCondition(key,0.0,g_dailyLockToken)'), 'A chart must release only the lock token it owns');
assert.ok(ea.includes('g_dailyLockToken=token'), 'Shared execution lock must retain an ownership token');
assert.ok(ea.includes('PA_TRACK_'), 'Account-wide loss accounting must track Price Action positions independent of chart magic number');
assert.ok(ea.includes('StringFind(comment,"InvistaPRO PA")>=0'), 'Price Action entry tracking must identify the EA order comment');
assert.ok(ea.includes('dealMagic==(ulong)InpMagic'), 'Price Action entry tracking must use the configured MT5 magic number as its primary identity');

assert.ok(ea.includes('DEAL_COMMISSION)+\n                            HistoryDealGetDouble(positionDeal,DEAL_FEE)'), 'Net trade PnL must include every deal commission and fee for the position');
assert.ok(ea.includes('InpRiskPercent<1.0 || InpRiskPercent>2.0'), 'EA risk input must stay within the documented 1%-2% range');
assert.ok(ea.includes('if(!IsDemoAccount())'), 'This validation build must block non-DEMO accounts');
assert.ok(!ea.toLowerCase().includes('binance'), 'EA strategy must not depend on Binance');
assert.ok(!ea.toLowerCase().includes('deriv'), 'EA strategy must not depend on Deriv');
assert.ok(!ea.includes('Symbol_Override'), 'EA must use the chart symbol, not a broker-specific override');

assert.ok(route.includes("router.post('/price-action/review'"), 'Server must expose the protected broker-neutral AI review');
assert.ok(route.includes("router.post('/price-action/heartbeat'"), 'Server must expose the authenticated telemetry heartbeat');
assert.ok(route.includes('getHighImpactNewsStatus'), 'AI review must fail closed during high-impact news windows');
assert.ok(route.includes('ageSeconds > timeframeSeconds[tf] * 3'), 'Server must reject stale MT5 candles independently of the EA client check');
assert.ok(ea.includes('brokerUtcOffsetSeconds'), 'EA must send broker time offset for server-side candle freshness validation');
assert.ok(route.includes("router.get('/download-price-action-ea'"), 'Server must expose a separate Price Action EA download');
assert.ok(route.includes('mt5EaTokenAccess'), 'AI review must require the EA token');
assert.ok(route.includes('InvistaPRO_PriceAction_EA.mq5'), 'Download must serve the independent source file');
assert.ok(page.includes('button-download-price-action-ea'), 'Dashboard must expose a separate Price Action download button');
assert.ok(page.includes('/api/mt5/download-price-action-ea'), 'Dashboard must use the independent download route');
assert.ok(ai.includes('reviewPriceActionSnapshot'), 'Price Action AI provider must call the existing ensemble');

assert.ok(ea.includes(String.raw`body+="\"riskPercent\":`), 'Entry AI JSON risk fields must use valid string concatenation');
assert.ok(ea.includes(String.raw`body+="\"spread\":`), 'Position AI JSON spread field must use valid string concatenation');
assert.ok(!ea.includes('marketRegime\\\",\n   body+='), 'Market regime JSON string must not contain a broken multiline literal');
assert.ok(!ea.includes('tick.ask-tick.bid,_Digits)+",\n   body+='), 'Position spread JSON string must not contain a broken multiline literal');

console.log('Broker-neutral Price Action EA static policy checks passed. MetaEditor compilation and DEMO execution remain separate gates.');
