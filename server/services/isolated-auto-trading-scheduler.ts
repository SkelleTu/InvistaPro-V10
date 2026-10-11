import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
let brazilNewsServicePromise: Promise<typeof import("./brazil-news-service")> | null = null;

async function getBrazilNewsService() {
  brazilNewsServicePromise ??= import("./brazil-news-service");
  return (await brazilNewsServicePromise).brazilNewsService;
}

async function stopBrazilNewsUpdatesIfIdle(hasArmedUsers: boolean) {
  if (hasArmedUsers || !brazilNewsServicePromise) return;
  const service = await getBrazilNewsService();
  service.stopAutoUpdate();
}

type UserId = string;
type WorkerStatus = "ready" | "armed" | "stopped" | "disconnected";

interface UserRuntime {
  userId: UserId;
  sessionId: string;
  worker: ChildProcess | null;
  status: WorkerStatus;
  armed: boolean;
  createdAt: number;
  lastHeartbeatAt: number;
  activeSessions: number;
  workerReady: boolean;
}

class IsolatedAutoTradingScheduler {
  private runtimes = new Map<UserId, UserRuntime>();
  private emergencyStop = false;

  private workerPath(): { file: string; execArgv: string[] } {
    const production = process.env.NODE_ENV === "production";
    if (production) return { file: path.resolve(process.cwd(), "dist/trading-user-worker.js"), execArgv: [] };
    return {
      file: path.resolve(process.cwd(), "server/services/trading-user-worker.ts"),
      execArgv: ["--import", "tsx/esm"],
    };
  }

  private ensureRuntime(userId: string, startWorker = false): UserRuntime {
    const id = String(userId);
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = {
        userId: id,
        sessionId: crypto.randomUUID(),
        worker: null,
        status: "ready",
        armed: false,
        createdAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        activeSessions: 0,
        workerReady: false,
      };
      this.runtimes.set(id, runtime);
      console.log(`🧩 [USER-RUNTIME] sessão leve criada | user=${id} | session=${runtime.sessionId}`);
    }
    runtime.lastHeartbeatAt = Date.now();
    if (startWorker && (!runtime.worker || !runtime.worker.connected)) {
      this.startWorker(runtime);
    }
    return runtime;
  }

  private startWorker(runtime: UserRuntime): void {
    if (runtime.worker?.connected) return;
    const { file, execArgv } = this.workerPath();
    const worker = fork(file, [], {
      execArgv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: {
        ...process.env,
        INVISTA_RUNTIME_USER_ID: runtime.userId,
        INVISTA_RUNTIME_SESSION_ID: runtime.sessionId,
      },
    });
    runtime.worker = worker;
    runtime.workerReady = false;
    worker.on("message", (message: any) => {
      runtime.lastHeartbeatAt = Date.now();
      if (message?.userId !== runtime.userId || message?.sessionId !== runtime.sessionId) return;
      if (message?.type === "ready") {
        runtime.workerReady = true;
        runtime.status = "ready";
      } else if (message?.type === "status") {
        runtime.status = message.status || runtime.status;
        runtime.armed = Boolean(message.armed);
        runtime.activeSessions = Number(message.activeSessions || 0);
      } else if (message?.type === "error") {
        console.error(`❌ [USER-RUNTIME] user=${runtime.userId} session=${runtime.sessionId}: ${message.error}`);
      }
    });
    const cleanup = () => {
      if (runtime.worker === worker) {
        runtime.worker = null;
        runtime.workerReady = false;
        runtime.armed = false;
        runtime.status = "stopped";
      }
    };
    worker.once("exit", cleanup);
    worker.once("error", (error) => {
      console.error(`❌ [USER-RUNTIME] worker error user=${runtime.userId} session=${runtime.sessionId}:`, error);
      cleanup();
    });
    console.log(`🧩 [USER-RUNTIME] worker iniciado após comando explícito | user=${runtime.userId} | session=${runtime.sessionId}`);
  }

  private send(userId: string, command: string, payload: Record<string, unknown> = {}) {
    const runtime = this.ensureRuntime(userId, true);
    runtime.lastHeartbeatAt = Date.now();
    if (runtime.worker?.connected) {
      runtime.worker.send({ type: command, userId: runtime.userId, sessionId: runtime.sessionId, ...payload });
    }
    return runtime;
  }

  prepareAtBoot(): void {
    console.log("🧠 [USER-RUNTIME] núcleo compartilhado pronto; runtimes individuais serão criados por login.");
  }

  registerUser(userId: string): string {
    return this.ensureRuntime(userId, false).sessionId;
  }

  armUserTrading(userId: string): void {
    if (this.emergencyStop) {
      throw new Error("Play blocked: isolated scheduler emergency stop is active.");
    }
    const runtime = this.send(userId, "arm");
    runtime.armed = true;
    runtime.status = "armed";
  }

  async startSchedulerForUser(userId: string): Promise<void> {
    this.armUserTrading(userId);
    const service = await getBrazilNewsService();
    service.startAutoUpdate();
  }

  async startScheduler(): Promise<void> {
    // A global start must never arm every logged-in user. Each runtime may
    // only be armed through startSchedulerForUser after that user's explicit Play.
    console.warn("🛑 [USER-RUNTIME] Global start ignored; use per-user manual Play.");
  }

  async emergencyStopAll(): Promise<void> {
    this.emergencyStop = true;
    await this.stopScheduler();
  }

  clearEmergencyStop(): void {
    // Clearing the latch never starts trading; users must press Play again.
    this.emergencyStop = false;
  }

  async stopScheduler(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await this.disarmUserTrading(runtime.userId);
    }
  }

  async disarmUserTrading(userId: string): Promise<void> {
    const runtime = this.runtimes.get(String(userId));
    if (!runtime) {
      await stopBrazilNewsUpdatesIfIdle(this.getArmedUserIds().length > 0);
      return;
    }
    runtime.armed = false;
    runtime.status = "stopped";
    if (runtime.worker.connected) runtime.worker.send({ type: "disarm", userId: runtime.userId, sessionId: runtime.sessionId });
    await stopBrazilNewsUpdatesIfIdle(this.getArmedUserIds().length > 0);
  }

  async stopSchedulerForUser(userId: string): Promise<void> {
    await this.disarmUserTrading(userId);
  }

  getArmedUserIds(): string[] {
    return [...this.runtimes.values()].filter(r => r.armed).map(r => r.userId);
  }

  getSchedulerStatus() {
    const runtimes = [...this.runtimes.values()];
    return {
      isRunning: !this.emergencyStop && runtimes.some(r => r.armed),
      schedulerRunning: !this.emergencyStop && runtimes.some(r => r.armed),
      emergencyStop: this.emergencyStop,
      activeSessions: this.emergencyStop ? 0 : runtimes.reduce((n, r) => n + r.activeSessions, 0),
      isolatedUsers: runtimes.length,
      armedUsers: this.emergencyStop ? [] : runtimes.filter(r => r.armed).map(r => r.userId),
      totalExecutedOperations: 0,
    };
  }

  getSessionStats() {
    const runtimes = [...this.runtimes.values()];
    return {
      activeSessions: runtimes.reduce((n, r) => n + r.activeSessions, 0),
      isolatedUsers: runtimes.length,
      armedUsers: runtimes.filter(r => r.armed).length,
      totalExecutedOperations: 0,
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

  trackAssetUsage(userId: string, symbol: string): void {
    this.send(userId, "trackAssetUsage", { symbol });
  }

  resetCooldownSystem(userId: string): { cleared: number; reason: string } {
    this.send(userId, "resetCooldownSystem");
    return { cleared: 0, reason: "reset solicitado ao runtime isolado" };
  }

  clearAllSessions(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.worker?.connected) runtime.worker.send({ type: "clearAllSessions", userId: runtime.userId, sessionId: runtime.sessionId });
      runtime.armed = false;
      runtime.status = "stopped";
    }
    void stopBrazilNewsUpdatesIfIdle(this.getArmedUserIds().length > 0).catch((error) => console.warn("[USER-RUNTIME] failed to stop news updates:", error));
  }

  getAssetHealthStatus() {
    return [...this.runtimes.values()].map(r => ({
      userId: r.userId,
      sessionId: r.sessionId,
      status: r.status,
      isolated: true,
    }));
  }

  async disconnectUser(userId: string): Promise<void> {
    const id = String(userId);
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    if (runtime.worker?.connected) runtime.worker.send({ type: "shutdown", userId: id, sessionId: runtime.sessionId });
    setTimeout(() => {
      if (runtime.worker?.connected) runtime.worker.kill("SIGTERM");
    }, 5000).unref();
    this.runtimes.delete(id);
    await stopBrazilNewsUpdatesIfIdle(this.getArmedUserIds().length > 0);
    console.log(`🔌 [USER-RUNTIME] destruído | user=${id} | session=${runtime.sessionId}`);
  }
}

export const isolatedAutoTradingScheduler = new IsolatedAutoTradingScheduler();
