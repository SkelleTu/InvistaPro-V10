import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";

type UserId = string;
type WorkerStatus = "ready" | "armed" | "stopped" | "disconnected";

interface UserRuntime {
  userId: UserId;
  sessionId: string;
  worker: ChildProcess;
  status: WorkerStatus;
  armed: boolean;
  createdAt: number;
  lastHeartbeatAt: number;
  activeSessions: number;
  workerReady: boolean;
}

class IsolatedAutoTradingScheduler {
  private runtimes = new Map<string, UserRuntime>();

  private runtimeKey(userId: string, sessionId?: string): string {
    return `${String(userId)}::${String(sessionId || 'default')}`;
  }

  private workerPath(): { file: string; execArgv: string[] } {
    const production = process.env.NODE_ENV === "production";
    if (production) return { file: path.resolve(process.cwd(), "dist/trading-user-worker.js"), execArgv: [] };
    return {
      file: path.resolve(process.cwd(), "server/services/trading-user-worker.ts"),
      execArgv: ["--import", "tsx/esm"],
    };
  }

  private ensureRuntime(userId: string, requestedSessionId?: string): UserRuntime {
    const id = String(userId);
    const key = this.runtimeKey(id, requestedSessionId);
    const existing = this.runtimes.get(key);
    if (existing && existing.worker.connected) {
      existing.lastHeartbeatAt = Date.now();
      return existing;
    }

    const sessionId = crypto.randomUUID();
    const { file, execArgv } = this.workerPath();
    const worker = fork(file, [], {
      execArgv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: {
        ...process.env,
        INVISTA_RUNTIME_USER_ID: id,
        INVISTA_RUNTIME_SESSION_ID: sessionId,
      },
    });

    const runtime: UserRuntime = {
      userId: id,
      sessionId,
      worker,
      status: "ready",
      armed: false,
      createdAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      activeSessions: 0,
      workerReady: false,
    };

    worker.on("message", (message: any) => {
      runtime.lastHeartbeatAt = Date.now();
      if (message?.type === "ready") {
        runtime.workerReady = true;
        runtime.status = "ready";
      } else if (message?.type === "status") {
        runtime.status = message.status || runtime.status;
        runtime.armed = Boolean(message.armed);
        runtime.activeSessions = Number(message.activeSessions || 0);
      } else if (message?.type === "error") {
        console.error(`❌ [USER-RUNTIME] user=${id} session=${sessionId}: ${message.error}`);
      }
    });

    const cleanup = () => {
      const current = this.runtimes.get(key);
      if (current?.worker === worker) this.runtimes.delete(key);
    };
    worker.once("exit", cleanup);
    worker.once("error", (error) => {
      console.error(`❌ [USER-RUNTIME] worker error user=${id} session=${sessionId}:`, error);
      cleanup();
    });

    this.runtimes.set(key, runtime);
    console.log(`🧩 [USER-RUNTIME] criado | user=${id} | session=${sessionId}`);
    return runtime;
  }

  private send(userId: string, command: string, payload: Record<string, unknown> = {}, sessionId?: string) {
    const runtime = this.ensureRuntime(userId, sessionId);
    runtime.lastHeartbeatAt = Date.now();
    if (runtime.worker.connected) {
      runtime.worker.send({ type: command, userId: runtime.userId, sessionId: runtime.sessionId, ...payload });
    }
    return runtime;
  }

  prepareAtBoot(): void {
    console.log("🧠 [USER-RUNTIME] núcleo compartilhado pronto; runtimes individuais serão criados por login.");
  }

  registerUser(userId: string, sessionId?: string): string {
    return this.ensureRuntime(userId, sessionId).sessionId;
  }

  armUserTrading(userId: string, sessionId?: string): void {
    const runtime = this.send(userId, "arm", {}, sessionId);
    runtime.armed = true;
    runtime.status = "armed";
  }

  async startSchedulerForUser(userId: string, sessionId?: string): Promise<void> {
    this.armUserTrading(userId, sessionId);
  }

  async disarmUserTrading(userId: string, sessionId?: string): Promise<void> {
    const runtime = this.runtimes.get(this.runtimeKey(userId, sessionId));
    if (!runtime) return;
    runtime.armed = false;
    runtime.status = "stopped";
    if (runtime.worker.connected) runtime.worker.send({ type: "disarm", userId: runtime.userId, sessionId: runtime.sessionId });
  }

  async stopSchedulerForUser(userId: string, sessionId?: string): Promise<void> {
    await this.disarmUserTrading(userId, sessionId);
  }

  getArmedUserIds(): string[] {
    return [...this.runtimes.values()].filter(r => r.armed).map(r => r.userId);
  }

  getSchedulerStatus() {
    const runtimes = [...this.runtimes.values()];
    return {
      isRunning: runtimes.some(r => r.armed),
      schedulerRunning: runtimes.some(r => r.armed),
      activeSessions: runtimes.reduce((n, r) => n + r.activeSessions, 0),
      isolatedUsers: runtimes.length,
      armedUsers: runtimes.filter(r => r.armed).map(r => r.userId),
    };
  }

  getSessionStats() {
    const runtimes = [...this.runtimes.values()];
    return {
      activeSessions: runtimes.reduce((n, r) => n + r.activeSessions, 0),
      isolatedUsers: runtimes.length,
      armedUsers: runtimes.filter(r => r.armed).length,
    };
  }

  getActiveSessions() {
    return [...this.runtimes.values()].map(r => ({
      userId: r.userId,
      sessionId: r.sessionId,
      isActive: r.armed,
      isolated: true,
      workerReady: r.workerReady,
      lastHeartbeatAt: r.lastHeartbeatAt,
    }));
  }

  trackAssetUsage(userId: string, symbol: string, sessionId?: string): void {
    this.send(userId, "trackAssetUsage", { symbol }, sessionId);
  }

  resetCooldownSystem(userId: string, sessionId?: string): void {
    this.send(userId, "resetCooldownSystem", {}, sessionId);
  }

  clearAllSessions(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.worker.connected) runtime.worker.send({ type: "clearAllSessions", userId: runtime.userId, sessionId: runtime.sessionId });
      runtime.armed = false;
      runtime.status = "stopped";
    }
  }

  getAssetHealthStatus() {
    return [...this.runtimes.values()].map(r => ({
      userId: r.userId,
      sessionId: r.sessionId,
      status: r.status,
      isolated: true,
    }));
  }

  async disconnectUser(userId: string, sessionId?: string): Promise<void> {
    const id = String(userId);
    const key = this.runtimeKey(id, sessionId);
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    if (runtime.worker.connected) runtime.worker.send({ type: "shutdown", userId: id, sessionId: runtime.sessionId });
    setTimeout(() => {
      if (runtime.worker.connected) runtime.worker.kill("SIGTERM");
    }, 5000).unref();
    this.runtimes.delete(key);
    console.log(`🔌 [USER-RUNTIME] destruído | user=${id} | session=${runtime.sessionId}`);
  }
}

export const isolatedAutoTradingScheduler = new IsolatedAutoTradingScheduler();
