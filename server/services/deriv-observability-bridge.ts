import { derivAPI } from "./deriv-api";
import { observability } from "./production-observability";

export function startDerivObservabilityBridge() {
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
    observability.emit({
      level: message?.error ? "ERROR" : "DEBUG",
      category: message?.error ? "API_EXTERNAL" : "WEBSOCKET",
      message: "DERIV MESSAGE",
      details: {
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

  derivAPI.on("tick", (tick: any) => {
    observability.emit({
      level: "INFO",
      category: "WEBSOCKET",
      message: "DERIV TICK",
      details: {
        symbol: tick?.symbol,
        quote: tick?.quote,
        epoch: tick?.epoch,
        displayValue: tick?.display_value,
      },
    });
  });

  observability.emit({
    level: "INFO",
    category: "SYSTEM",
    message: "DERIV OBSERVABILITY BRIDGE ACTIVE",
    details: { mode: "complete-inbound-and-tick-telemetry" },
  });
}
