import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const worker = read("server/services/trading-user-worker.ts");
const isolated = read("server/services/isolated-auto-trading-scheduler.ts");
const routes = read("server/routes/auto-trading-routes.ts");
const ui = read("client/src/pages/trading-system.tsx");
const scheduler = read("server/services/auto-trading-scheduler.ts");

for (const field of ["currentPhase", "currentPhaseDetail", "lastCycleStartedAt", "activityLog", "marketQuality"]) {
  assert.match(worker, new RegExp(field), `worker must report ${field}`);
  assert.match(isolated, new RegExp(field), `isolated runtime must retain ${field}`);
}
assert.match(routes, /userRuntime\?\.currentPhase/);
assert.match(routes, /userRuntime\?\.currentPhaseDetail/);
assert.doesNotMatch(routes, /currentPhase:\s*schedulerActiveForUser\s*\?\s*'ATIVO'/);
assert.match(routes, /modalityCompatibilityBlocked/);
assert.match(routes, /Nenhuma combinação válida/);
assert.match(routes, /allowedProductionContractTypes\.has\(contractType\)\s*&&\s*boomCrashSupportedContractTypes\.has\(contractType\)/);
assert.match(scheduler, /Crash\/Boom: somente Rise\/Fall — nunca dígitos/);
assert.match(ui, /MODO AUTO/);
assert.match(ui, /execução real é confirmada separadamente no Controle do Sistema/);
console.log("TRADING RUNTIME READINESS CONTRACT PASSED");
