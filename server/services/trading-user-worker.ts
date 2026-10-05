import { AutoTradingScheduler } from "./auto-trading-scheduler";

const userId = String(process.env.INVISTA_RUNTIME_USER_ID || "");
const sessionId = String(process.env.INVISTA_RUNTIME_SESSION_ID || "");
const scheduler = new AutoTradingScheduler();

function sendStatus() {
  try {
    const status = scheduler.getSchedulerStatus();
    process.send?.({
      type: "status",
      userId,
      sessionId,
      status: status.isRunning ? "armed" : "ready",
      armed: status.isRunning,
      activeSessions: status.activeSessions || 0,
    });
  } catch {}
}

process.on("message", async (message: any) => {
  if (!message || message.userId !== userId || message.sessionId !== sessionId) return;
  try {
    switch (message.type) {
      case "arm":
        scheduler.armUserTrading(userId);
        await scheduler.startScheduler();
        break;
      case "disarm":
        await scheduler.disarmUserTrading(userId);
        break;
      case "trackAssetUsage":
        scheduler.trackAssetUsage(userId, String(message.symbol || ""));
        break;
      case "resetCooldownSystem":
        scheduler.resetCooldownSystem(userId);
        break;
      case "clearAllSessions":
        scheduler.clearAllSessions();
        break;
      case "shutdown":
        await scheduler.disarmUserTrading(userId);
        await scheduler.stopScheduler();
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
