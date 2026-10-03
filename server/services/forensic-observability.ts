import crypto from "crypto";
import os from "os";

export type ForensicLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface ForensicEvent {
  id: string;
  timestamp: string;
  level: ForensicLevel;
  type: string;
  message: string;
  requestId?: string;
  traceId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  component?: string;
  metadata?: Record<string, unknown>;
}

type Subscriber = (event: ForensicEvent) => void;

const REDACT_KEYS = /password|passwd|secret|token|authorization|cookie|api[-_]?key|credential|private[-_]?key|access[-_]?key/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 4000 ? value.slice(0, 4000) + "…[TRUNCATED]" : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.test(key) ? "[REDACTED]" : sanitize(val, depth + 1);
    }
    return out;
  }
  return value;
}

function id(prefix: string): string {
  return prefix + "_" + crypto.randomBytes(8).toString("hex");
}

class ForensicObservability {
  private readonly maxEvents = 5000;
  private events: ForensicEvent[] = [];
  private subscribers = new Set<Subscriber>();
  private startedAt = new Date().toISOString();
  private counters = new Map<string, number>();

  record(input: Omit<ForensicEvent, "id" | "timestamp">): ForensicEvent {
    const event: ForensicEvent = {
      id: id("EVT"),
      timestamp: new Date().toISOString(),
      ...input,
      metadata: input.metadata ? sanitize(input.metadata) as Record<string, unknown> : undefined,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);

    const counterKey = input.type + ":" + input.level;
    this.counters.set(counterKey, (this.counters.get(counterKey) || 0) + 1);

    // Structured stdout is intentionally the primary runtime sink on Render.
    console.log(JSON.stringify({ forensic: true, ...event }));

    for (const subscriber of this.subscribers) {
      try { subscriber(event); } catch { /* observer failures must never affect the app */ }
    }
    return event;
  }

  error(error: unknown, context: Partial<ForensicEvent> = {}): ForensicEvent {
    const err = error instanceof Error ? error : new Error(String(error));
    return this.record({
      level: context.level || "ERROR",
      type: context.type || "exception",
      message: err.message,
      ...context,
      metadata: sanitize({
        ...(context.metadata || {}),
        errorName: err.name,
        stack: err.stack,
        cause: (err as any).cause,
      }) as Record<string, unknown>,
    });
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  getRecent(limit = 200): ForensicEvent[] {
    return this.events.slice(-Math.min(Math.max(limit, 1), 1000)).reverse();
  }

  getSnapshot() {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    return {
      service: "Invista Pro",
      observability: "forensic-v1",
      startedAt: this.startedAt,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(uptime),
      process: {
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || "unknown",
        portConfigured: Boolean(process.env.PORT),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        encryptionConfigured: Boolean(process.env.ENCRYPTION_KEY),
        derivDemoConfigured: Boolean(process.env.DERIV_API_KEY_DEMO),
        derivRealConfigured: Boolean(process.env.DERIV_API_KEY_REAL),
      },
      counters: Object.fromEntries(this.counters.entries()),
      bufferedEvents: this.events.length,
      lastEvent: this.events[this.events.length - 1] || null,
    };
  }

  clearBuffer(): void {
    this.events = [];
    this.counters.clear();
  }
}

export const forensicObservability = new ForensicObservability();
export { sanitize };
