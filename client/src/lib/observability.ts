let initialized = false;
const clientTraceId = (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + "-" + Date.now().toString(36);

function send(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify({
      ...payload,
      url: window.location.href,
      browser: navigator.userAgent,
      timestamp: new Date().toISOString(),
      clientTraceId,
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/observability/client-error", blob);
    } else {
      void fetch("/api/observability/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Observability must never break the application.
  }
}

export function initClientObservability() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  try {
    if ("PerformanceObserver" in window) {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 250) {
            send({
              source: "performance.longtask",
              level: "WARNING",
              name: "LongTask",
              message: "Browser long task: " + Math.round(entry.duration) + "ms",
              details: { durationMs: Math.round(entry.duration), startTime: Math.round(entry.startTime) },
            });
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    }
  } catch {}

  window.addEventListener("error", event => {
    send({
      source: "window.error",
      level: "ERROR",
      name: event.error?.name || "Error",
      message: event.message || "Unknown browser error",
      stack: event.error?.stack,
      line: event.lineno,
      column: event.colno,
      details: {
        filename: event.filename,
        target: event.target instanceof HTMLElement ? event.target.outerHTML.slice(0, 1000) : undefined,
      },
    });
  });

  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    send({
      source: "window.unhandledrejection",
      level: "ERROR",
      name: reason?.name || "UnhandledRejection",
      message: reason?.message || String(reason || "Unknown rejection"),
      stack: reason?.stack,
    });
  });
}
