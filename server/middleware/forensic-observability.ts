import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { forensicObservability } from "../services/forensic-observability";

function makeId(prefix: string) {
  return prefix + "_" + crypto.randomBytes(10).toString("hex");
}

export function forensicRequestMiddleware(req: Request, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  const requestId =
    String(req.headers["x-request-id"] || req.headers["rndr-id"] || makeId("REQ"));
  const traceId = String(req.headers["traceparent"] || makeId("TRACE")).slice(0, 256);

  (req as any).forensicRequestId = requestId;
  res.setHeader("X-Forensic-Request-Id", requestId);
  res.setHeader("X-Forensic-Trace-Id", traceId);

  forensicObservability.record({
    level: "INFO",
    type: "request.start",
    message: "HTTP request started",
    requestId,
    traceId,
    method: req.method,
    path: req.path,
    metadata: {
      host: req.headers.host,
      userAgent: req.headers["user-agent"],
      cfRay: req.headers["cf-ray"],
      rndrId: req.headers["rndr-id"],
    },
  });

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    forensicObservability.record({
      level: res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO",
      type: "request.finish",
      message: "HTTP request completed",
      requestId,
      traceId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });

  next();
}
