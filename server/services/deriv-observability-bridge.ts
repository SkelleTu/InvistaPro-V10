import { getDerivAPI } from "./deriv-api";
import { observability } from "./production-observability";
import { autoTradingScheduler } from "./auto-trading-scheduler";
import { resilienceSupervisor } from "./resilience-supervisor";

export function startDerivObservabilityBridge() {
  const sessions = [getDerivAPI("demo"), getDerivAPI("real")];

  for (const api of sessions) {
    const rawApi: any = api as any;
    const originalSend = rawApi.sendMessage?.bind(rawApi);
    if (originalSend && !rawApi.__observabilityWrapped) {
      rawApi.sendMessage = (payload: any) => {
        const safe: Record<string, any> = {};
        for (const [key, value] of Object.entries(payload || {})) {
          safe[key] = /token|secret|authorization|password|api[-_]?key|otp/i.test(key)
            ? "[REDACTED]"
            : value;
        }
        observability.emit({
          level: "DEBUG",
          category: "WEBSOCKET",
          message: "DERIV OUTBOUND FRAME",
          details: {
            accountType: rawApi.accountType,
            keys: Object.keys(payload || {}),
            payload: safe,
            connected: rawApi.isConnected,
            readyState: rawApi.ws?.readyState,
          },
        });
        return originalSend(payload);
      };
      rawApi.__observabilityWrapped = true;
    }

    api.on("connected", () => {
      observability.emit({
        level: "INFO",
        category: "WEBSOCKET",
        message: "DERIV CONNECTED",
        details: {
          accountType: rawApi.accountType,
          activeSubscriptions: api.getActiveSubscriptions().length,
        },
      });
    });

    api.on("disconnected", (info: any) => {
      observability.emit({
        level: "WARNING",
        category: "WEBSOCKET",
        message: "DERIV DISCONNECTED",
        details: { accountType: rawApi.accountType, ...(info || {}) },
      });
    });

    api.on("error", (error: any) => {
      observability.captureError(error, {
        level: "ERROR",
        category: "WEBSOCKET",
        message: "DERIV EVENT ERROR",
        details: {
          accountType: rawApi.accountType,
          activeSubscriptions: api.getActiveSubscriptions().length,
        },
      });
    });

    api.on("message", (message: any) => {
      observability.emit({
        level: message?.error ? "ERROR" : "DEBUG",
        category: message?.error ? "API_EXTERNAL" : "WEBSOCKET",
        message: "DERIV MESSAGE",
        details: {
          accountType: rawApi.accountType,
          msgType: message?.msg_type,
          reqId: message?.req_id,
          symbol: message?.tick?.symbol,
          quote: message?.tick?.quote,
          epoch: message?.tick?.epoch,
          contractId: message?.proposal_open_contract?.contract_id || message?.buy?.contract_id,
          subscriptionId: message?.subscription?.id,
          errorCode: message?.error?.code,
          errorMessage: message?.error?.message,
        },
      });
    });

    api.on("tick", (tick: any) => {
      observability.emit({
        level: "INFO",
        category: "WEBSOCKET",
        message: "DERIV TICK",
        details: {
          accountType: rawApi.accountType,
          symbol: tick?.symbol,
          quote: tick?.quote,
          epoch: tick?.epoch,
          displayValue: tick?.display_value,
        },
      });
    });
  }

  observability.emit({
    level: "INFO",
    category: "SYSTEM",
    message: "DERIV OBSERVABILITY BRIDGE ACTIVE",
    details: { mode: "demo-and-real-account-telemetry" },
  });

  const heartbeat = async () => {
    const tradingActive = Boolean(autoTradingScheduler.getSchedulerStatus()?.isRunning);
    for (const api of sessions) {
      const rawApi: any = api as any;
      const connected = api.getIsConnected();
      if (!tradingActive) {
        await resilienceSupervisor.reportHeartbeat("websocket", {
          status: "idle",
          tradingActive: false,
          connected,
          accountType: rawApi.accountType,
        });
      } else if (connected) {
        await resilienceSupervisor.reportHeartbeat("websocket", {
          status: "connected",
          tradingActive: true,
          connected,
          accountType: rawApi.accountType,
        });
      }
    }
  };
  void heartbeat();
  setInterval(() => { void heartbeat(); }, 30000).unref?.();
}
