import assert from "node:assert/strict";
import {
  getConfirmedUsdBrl,
  getTradingActivity,
  tradingStatusRefreshOptions,
} from "../client/src/lib/trading-dashboard-status.js";

const blocked = {
  schedulerActive: false,
  canExecuteTrades: false,
  tradingBlockers: ["Nenhum contrato compatível confirmado"],
  lastError: "Play blocked: HTTP 429",
  schedulerStatus: {
    currentPhase: "BLOQUEADO",
    currentPhaseDetail: "Deriv limitou a conexão",
    activityLog: [{ message: "Falha de preflight", time: 1792371600000, type: "warning" }],
  },
};
const activity = getTradingActivity(blocked);
assert.equal(activity.visible, true);
assert.equal(activity.label, "Pausado/Bloqueado");
assert.equal(activity.phase, "BLOQUEADO");
assert.equal(activity.logs.length, 1);
assert.equal(activity.errors[0], "Play blocked: HTTP 429");
assert.equal(activity.blockers.length, 1);

assert.equal(getTradingActivity({ schedulerActive: false }).logs.length, 0);
assert.equal(getTradingActivity({ canExecuteTrades: true }).label, "Operando");
assert.notEqual(getTradingActivity({ canExecuteTrades: false }).label, "Operando");
assert.notEqual(getTradingActivity({ schedulerActive: true, tradingBlockers: ["blocked"] }).label, "Operando");

assert.deepEqual(tradingStatusRefreshOptions, {
  refetchInterval: 3000,
  staleTime: 0,
  refetchOnWindowFocus: true,
});
assert.equal(getConfirmedUsdBrl({ success: false, rates: { USD_BRL: 5.12 } }), null);
assert.equal(getConfirmedUsdBrl({ success: false, rates: null }), null);
assert.equal(getConfirmedUsdBrl({ success: true, rates: { USD_BRL: 5.12 } }), 5.12);
for (const rate of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(getConfirmedUsdBrl({ rates: { USD_BRL: rate } }), null);
}
assert.equal(getConfirmedUsdBrl(), null);
console.log("OK: blocked runtime activity, safety labels, polling, and exchange-rate truthfulness");
