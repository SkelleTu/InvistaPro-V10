import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Request, Response } from "express";

export type ObservabilityLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type ObservabilityCategory =
  | "HTTP"
  | "AUTH"
  | "DATABASE"
  | "API_EXTERNAL"
  | "WEBSOCKET"
  | "VALIDATION"
  | "CLIENT"
  | "BOOT"
  | "SYSTEM"
  | "UNKNOWN";

export interface ObservabilityEvent {
  id: string;
  timestamp: string;
  level: ObservabilityLevel;
  category: ObservabilityCategory;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  userEmail?: string;
  service: string;
  environment: string;
  instance?: string;
  details?: Record<string, unknown>;
  stack?: string;
}

const MAX_EVENTS = 2000;
const MAX_DETAIL_LENGTH = 12000;
const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "observability.jsonl");

function safeString(value: unknown, max = MAX_DETAIL_LENGTH): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    return raw.length > max ? raw.slice(0, max) + "…[TRUNCATED]" : raw;
  } catch {
    return String(value);
  }
}

function sanitizeObject(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.slice(0, 100).map(sanitizeObject);

  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const sensitive = /password|passwd|token|secret|authorization|cookie|api[-_]?key|credential|private[-_]?key|access[-_]?token|refresh[-_]?token/i;

  for (const [key, value] of Object.entries(source).slice(0, 200)) {
    result[key] = sensitive.test(key) ? "[REDACTED]" : sanitizeObject(value);
  }
  return result;
}

class ProductionObservability {
  private events: ObservabilityEvent[] = [];
  private subscribers = new Set<(event: ObservabilityEvent) => void>();

  constructor() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(LOG_FILE)) return;
      const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);
      this.events = lines
        .slice(-MAX_EVENTS)
        .map(line => {
          try { return JSON.parse(line) as ObservabilityEvent; } catch { return null; }
        })
        .filter(Boolean) as ObservabilityEvent[];
    } catch (error) {
      console.error("[OBSERVABILITY] Failed to load local history:", error);
    }
  }

  private makeId() {
    return "OBS_" + Date.now().toString(36).toUpperCase() + "_" + crypto.randomBytes(4).toString("hex").toUpperCase();
  }

  emit(input: Omit<ObservabilityEvent, "id" | "timestamp" | "service" | "environment">) {
    const event: ObservabilityEvent = {
      ...input,
      id: this.makeId(),
      timestamp: new Date().toISOString(),
      service: process.env.RENDER_SERVICE_NAME || process.env.SERVICE_NAME || "invista-pro",
      environment: process.env.NODE_ENV || "production",
      instance: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME,
    };

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);

    const json = JSON.stringify(event);
    try { fs.appendFileSync(LOG_FILE, json + "\n"); } catch {}

    // Structured JSON goes to stdout/stderr so Render can index, filter and live-tail it.
    const prefix = event.level === "ERROR" || event.level === "CRITICAL" ? "[OBSERVABILITY][ERROR]" : "[OBSERVABILITY]";
    if (event.level === "ERROR" || event.level === "CRITICAL") {
      console.error(prefix, json);
    } else if (event.level === "WARNING") {
      console.warn(prefix, json);
    } else {
      console.log(prefix, json);
    }

    for (const subscriber of this.subscribers) {
      try { subscriber(event); } catch {}
    }
    return event;
  }

  captureError(error: unknown, context: Partial<Omit<ObservabilityEvent, "id" | "timestamp" | "service" | "environment">> = {}) {
    const err = error as any;
    return this.emit({
      level: context.level || "ERROR",
      category: context.category || "UNKNOWN",
      message: safeString(err?.message || err || "Unknown error", 4000),
      stack: err?.stack,
      details: {
        ...((context.details || {}) as Record<string, unknown>),
        originalError: sanitizeObject({
          name: err?.name,
          message: err?.message,
          code: err?.code,
          status: err?.status,
          statusCode: err?.statusCode,
          cause: err?.cause,
          errno: err?.errno,
          syscall: err?.syscall,
          address: err?.address,
          port: err?.port,
        }) as Record<string, unknown>,
      },
      ...context,
    });
  }

  captureRequest(req: Request, res: Response, durationMs: number) {
    const status = res.statusCode;
    const level: ObservabilityLevel = status >= 500 ? "ERROR" : status >= 400 ? "WARNING" : "INFO";
    const category: ObservabilityCategory = status === 401 || status === 403 ? "AUTH" : "HTTP";
    return this.emit({
      level,
      category,
      message: `${req.method} ${req.originalUrl || req.path} -> ${status}`,
      requestId: String(req.headers["x-request-id"] || req.headers["rndr-id"] || ""),
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: status,
      durationMs,
      userId: (req as any).user?.id,
      userEmail: (req as any).user?.email,
      details: {
        query: sanitizeObject(req.query),
        params: sanitizeObject(req.params),
        userAgent: req.headers["user-agent"],
        contentType: req.headers["content-type"],
      },
    });
  }

  getRecent(limit = 100) {
    return this.events.slice(-Math.min(Math.max(limit, 1), MAX_EVENTS)).reverse();
  }

  getUnresolved() {
    return this.events.filter(e => e.level === "ERROR" || e.level === "CRITICAL").slice().reverse();
  }

  getById(id: string) {
    return this.events.find(e => e.id === id) || null;
  }

  getHealth() {
    const recent = this.getRecent(500);
    const errors = recent.filter(e => e.level === "ERROR" || e.level === "CRITICAL");
    const warnings = recent.filter(e => e.level === "WARNING");
    const critical = errors.filter(e => e.level === "CRITICAL");
    return {
      status: critical.length ? "critical" : errors.length ? "degraded" : "healthy",
      score: Math.max(0, 100 - errors.length * 5 - warnings.length),
      totalBuffered: this.events.length,
      recentEvents: recent.length,
      errors: errors.length,
      critical: critical.length,
      warnings: warnings.length,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      pid: process.pid,
      node: process.version,
      timestamp: new Date().toISOString(),
    };
  }

  subscribe(fn: (event: ObservabilityEvent) => void) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  requestContext(req: Request) {
    return {
      requestId: String(req.headers["x-request-id"] || req.headers["rndr-id"] || ""),
      method: req.method,
      path: req.originalUrl || req.path,
      userId: (req as any).user?.id,
      userEmail: (req as any).user?.email,
      details: {
        query: sanitizeObject(req.query),
        params: sanitizeObject(req.params),
        body: sanitizeObject(req.body) as Record<string, unknown>,
        headers: sanitizeObject({
          ...req.headers,
          host: req.headers.host,
          "user-agent": req.headers["user-agent"],
        }) as Record<string, unknown>,
      },
    };
  }

  setupGlobalHandlers() {
    process.on("uncaughtException", error => {
      this.captureError(error, { level: "CRITICAL", category: "SYSTEM", message: "uncaughtException" });
      setTimeout(() => process.exit(1), 1000).unref();
    });

    process.on("unhandledRejection", reason => {
      this.captureError(reason, { level: "CRITICAL", category: "SYSTEM", message: "unhandledRejection" });
    });

    process.on("warning", warning => {
      this.captureError(warning, { level: "WARNING", category: "SYSTEM", message: "Node.js process warning" });
    });
  }
}

export const observability = new ProductionObservability();
observability.setupGlobalHandlers();

export function observabilityRequestMiddleware(req: Request, res: Response, next: () => void) {
  const started = Date.now();
  const incoming = req.headers["x-request-id"] || req.headers["rndr-id"];
  const requestId = String(incoming || crypto.randomUUID());
  res.setHeader("x-request-id", requestId);
  (req as any).observabilityRequestId = requestId;

  res.on("finish", () => {
    const duration = Date.now() - started;
    observability.captureRequest(req, res, duration);
  });

  next();
}

export function clientErrorPayload(body: any, req: Request) {
  return observability.emit({
    level: body?.level === "WARNING" ? "WARNING" : "ERROR",
    category: "CLIENT",
    message: safeString(body?.message || "Client-side error", 4000),
    requestId: String(req.headers["x-request-id"] || req.headers["rndr-id"] || ""),
    path: safeString(body?.path || req.get("referer") || "browser", 2000),
    details: sanitizeObject({
      source: body?.source,
      stack: body?.stack,
      name: body?.name,
      component: body?.component,
      browser: body?.browser,
      url: body?.url,
      line: body?.line,
      column: body?.column,
      details: body?.details,
    }) as Record<string, unknown>,
  });
}

export default observability;
