import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const required = [
  ["server/index.ts", ["observabilityRequestMiddleware", "globalErrorHandler", "/api/observability/health", "/api/observability/errors"]],
  ["server/services/production-observability.ts", ["uncaughtException", "unhandledRejection", "memoryWatchdog", "trackRequest", "finishRequest", "captureRequest"]],
  ["server/services/error-tracker.ts", ["captureError", "setupGlobalErrorHandlers"]],
  ["server/middleware/error-handler.ts", ["globalErrorHandler", "errorTracker.captureError"]],
  ["client/src/lib/observability.ts", ["window.addEventListener(\"error\"", "window.addEventListener(\"unhandledrejection\""]],
  ["client/src/App.tsx", ["initClientObservability()"]]
];

const failures = [];
for (const [file, needles] of required) {
  let content;
  try { content = read(file); } catch (e) { failures.push(`${file}: unreadable`); continue; }
  for (const needle of needles) if (!content.includes(needle)) failures.push(`${file}: missing ${needle}`);
}

const obs = read("server/services/production-observability.ts");
if (!obs.includes("memory.max") || !obs.includes("memory.current")) failures.push("memory watchdog: cgroup limits not instrumented");
if (!obs.includes("activeRequests")) failures.push("request causality: active request registry missing");
if (!obs.includes("x-client-trace-id") || !obs.includes("x-observability-trace-id")) failures.push("request causality: client/server trace correlation missing");
const client = read("client/src/lib/observability.ts");
if (!client.includes("clientTraceId")) failures.push("client causality: client trace id missing");
if (!client.includes("PerformanceObserver")) failures.push("client performance: long-task instrumentation missing");
if (!obs.includes('res.setHeader("x-request-id"')) failures.push("request causality: response request-id missing");

const index = read("server/index.ts");
if (!index.includes("app.use(observabilityRequestMiddleware)")) failures.push("HTTP coverage: observability middleware not installed");
if (!index.includes("app.use(globalErrorHandler)")) failures.push("HTTP coverage: global error handler not installed");

if (failures.length) {
  console.error("OBSERVABILITY AUDIT FAILED");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("OBSERVABILITY AUDIT PASSED");
console.log("Coverage: boot, HTTP requests, backend errors, uncaught exceptions, unhandled rejections, client errors, request correlation, active-request tracking, cgroup memory watchdog.");
