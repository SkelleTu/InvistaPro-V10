import type { AutoTradingScheduler } from "./auto-trading-scheduler";

const userId = String(process.env.INVISTA_RUNTIME_USER_ID || "");
const sessionId = String(process.env.INVISTA_RUNTIME_SESSION_ID || "");
let scheduler: AutoTradingScheduler | null = null;

async function ensureScheduler(): Promise<AutoTradingScheduler> {
  if (scheduler) return scheduler;
  // Importação dinâmica é intencional: login/heartbeat não deve carregar os
  // motores pesados de trading, IA, mercado ou Deriv. Eles só entram na memória
  // depois do Play/arm autenticado.
  const { AutoTradingScheduler } = await import("./auto-trading-scheduler");
  scheduler = new AutoTradingScheduler();
  return scheduler;
}

function sendStatus() {
  try {
    const status = scheduler?.getSchedulerStatus();
    process.send?.({
      type: "status",
      userId,
      sessionId,
      status: status?.isRunning ? "armed" : "ready",
      armed: Boolean(status?.isRunning),
      activeSessions: Number(status?.activeSessions || 0),
    });
  } catch {}
}

process.on("message", async (message: any) => {
  if (!message || message.userId !== userId || message.sessionId !== sessionId) return;
  try {
    switch (message.type) {
      case "getLiveAnalysis": {
        const { contractMonitor } = await import("./contract-monitor");
        const data = contractMonitor.getLiveAnalysis(String(userId));
        process.send?.({
          type: "response",
          requestId: String(message.requestId || ""),
          userId,
          sessionId,
          data,
        });
        break;
      }
      case "arm": {
        const activeScheduler = await ensureScheduler();
        activeScheduler.armUserTrading(userId);
        await activeScheduler.startScheduler();
        break;
      }
      case "disarm":
        if (scheduler) await scheduler.disarmUserTrading(userId);
        break;
      case "trackAssetUsage":
        // Não inicializar o motor pesado por causa de uma chamada de diagnóstico.
        if (scheduler) scheduler.trackAssetUsage(userId, String(message.symbol || ""));
        break;
      case "resetCooldownSystem":
        if (scheduler) scheduler.resetCooldownSystem(userId);
        break;
      case "clearAllSessions":
        if (scheduler) scheduler.clearAllSessions();
        break;
      case "shutdown":
        if (scheduler) {
          await scheduler.disarmUserTrading(userId);
          await scheduler.stopScheduler();
        }
        process.exit(0);
        break;
    }
    sendStatus();
  } catch (error) {
    process.send?.({
      type: "error",
      userId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

process.send?.({ type: "ready", userId, sessionId });
sendStatus();

setInterval(sendStatus, 15000).unref();
