import { derivAPI } from "./deriv-api";
import { observability } from "./production-observability";
import { autoTradingScheduler } from "./auto-trading-scheduler";
import { resilienceSupervisor } from "./resilience-supervisor";

export function startDerivObservabilityBridge() {
  // Runtime instrumentation also captures outbound frames without storing secrets.
  const api: any = derivAPI as any;
  const originalSend = api.sendMessage?.bind(api);
  if (originalSend && !api.__observabilityWrapped) {
    api.sendMessage = (payload: any) => {
      const safe: Record<string, any> = {};
      for (const [key, value] of Object.entries(payload || {})) {
        safe[key] = /token|secret|authorization|password|api[-_]?key/i.test(key) ? "[REDACTED]" : value;
      }
      observability.emit({
        level: "DEBUG",
        category: "WEBSOCKET",
        message: "DERIV OUTBOUND FRAME",
        details: { keys: Object.keys(payload || {}), payload: safe, connected: api.isConnected, readyState: api.ws?.readyState },
      });
      return originalSend(payload);
    };
    api.__observabilityWrapped = true;
  }
  derivAPI.on("connected", () => {
    observability.emit({
      level: "INFO",
      category: "WEBSOCKET",
      message: "DERIV CONNECTED",
      details: { activeSubscriptions: derivAPI.getActiveSubscriptions().length },
    });
  });

  derivAPI.on("disconnected", (info: any) => {
    observability.emit({
      level: "WARNING",
      category: "WEBSOCKET",
      message: "DERIV DISCONNECTED",
      details: info || {},
    });
  });

  derivAPI.on("error", (error: any) => {
    observability.captureError(error, {
      level: "ERROR",
      category: "WEBSOCKET",
      message: "DERIV EVENT ERROR",
      details: { activeSubscriptions: derivAPI.getActiveSubscriptions().length },
    });
  });

  derivAPI.on("message", (message: any) => {
    // Ticks já são agregados em tickTelemetry abaixo. Não gravar um evento por tick,
    // pois isso recriaria o próprio "turbilhão de dados" dentro da observabilidade.
    if (message?.msg_type === "tick") return;

    observability.emit({
      level: message?.error ? "ERROR" : "DEBUG",
      category: message?.error ? "API_EXTERNAL" : "WEBSOCKET",
      message: "DERIV MESSAGE",
      details: {
        msgType: message?.msg_type,
        reqId: message?.req_id,
        symbol: message?.tick?.symbol,
        contractId: message?.proposal_open_contract?.contract_id || message?.buy?.contract_id,
        subscriptionId: message?.subscription?.id,
        errorCode: message?.error?.code,
        errorMessage: message?.error?.message,
      },
    });
  });

  const tickStats = new Map<string, { count: number; lastQuote: number | null; lastEpoch: number | null }>();
  derivAPI.on("tick", (tick: any) => {
    const symbol = String(tick?.symbol || "UNKNOWN");
    const current = tickStats.get(symbol) || { count: 0, lastQuote: null, lastEpoch: null };
    current.count += 1;
    current.lastQuote = Number.isFinite(Number(tick?.quote)) ? Number(tick.quote) : current.lastQuote;
    current.lastEpoch = Number.isFinite(Number(tick?.epoch)) ? Number(tick.epoch) : current.lastEpoch;
    tickStats.set(symbol, current);
  });

  const tickTelemetry = setInterval(() => {
    if (tickStats.size === 0) return;
    const snapshot = [...tickStats.entries()].map(([symbol, stats]) => ({ symbol, ...stats }));
    tickStats.clear();
    observability.emit({
      level: "INFO",
      category: "WEBSOCKET",
      message: "DERIV TICK TELEMETRY WINDOW",
      details: {
        windowSeconds: 10,
        totalTicks: snapshot.reduce((sum, item) => sum + item.count, 0),
        symbols: snapshot,
      },
    });
  }, 10000);
  tickTelemetry.unref?.();

  observability.emit({
    level: "INFO",
    category: "SYSTEM",
    message: "DERIV OBSERVABILITY BRIDGE ACTIVE",
    details: { mode: "complete-inbound-and-tick-telemetry" },
  });

  const heartbeat = async () => {
    const tradingActive = Boolean(autoTradingScheduler.getSchedulerStatus()?.isRunning);
    const connected = derivAPI.getIsConnected();
    // When trading is intentionally OFF, websocket inactivity is a healthy idle state.
    // When trading is ON, heartbeat is emitted only while connected so a disconnect expires naturally.
    if (!tradingActive) {
      await resilienceSupervisor.reportHeartbeat("websocket", { status: "idle", tradingActive: false, connected });
      await resilienceSupervisor.reportHeartbeat("market_collector", { status: "idle", tradingActive: false });
      return;
    }
    if (connected) {
      await resilienceSupervisor.reportHeartbeat("websocket", { status: "connected", tradingActive: true, connected });
    }
  };
  void heartbeat();
  setInterval(() => { void heartbeat(); }, 30000).unref?.();
}
