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
  workerReadyPromise: Promise<void> | null;
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

  private ensureRuntime(userId: string): UserRuntime {
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
        workerReadyPromise: null,
      };
      this.runtimes.set(id, runtime);
      console.log(`🧩 [USER-RUNTIME] sessão leve criada | user=${id} | session=${runtime.sessionId}`);
    }
    runtime.lastHeartbeatAt = Date.now();
    return runtime;
  }

  private startWorker(runtime: UserRuntime): Promise<void> {
    if (runtime.worker?.connected) {
      if (runtime.workerReady) return Promise.resolve();
      if (runtime.workerReadyPromise) return runtime.workerReadyPromise;
      return Promise.reject(new Error("Worker IPC connected without a readiness handshake."));
    }

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
    runtime.armed = false;
    runtime.status = "ready";

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    runtime.workerReadyPromise = readyPromise;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) rejectReady(error);
      else resolveReady();
    };

    timeout = setTimeout(() => {
      settle(new Error("Worker did not send a ready handshake within 15 seconds."));
      if (worker.connected) worker.kill("SIGTERM");
    }, 15000);

    worker.on("message", (message: any) => {
      runtime.lastHeartbeatAt = Date.now();
      if (message?.userId !== runtime.userId || message?.sessionId !== runtime.sessionId) return;
      if (message?.type === "ready") {
        runtime.workerReady = true;
        runtime.status = "ready";
        settle();
      } else if (message?.type === "status") {
        runtime.status = message.status || runtime.status;
        runtime.armed = Boolean(message.armed);
        runtime.activeSessions = Number(message.activeSessions || 0);
      } else if (message?.type === "error") {
        console.error(`❌ [USER-RUNTIME] user=${runtime.userId} session=${runtime.sessionId}: ${message.error}`);
        if (!settled) settle(new Error(String(message.error || "Worker failed before readiness.")));
      }
    });

    const cleanup = (error?: Error) => {
      if (runtime.worker === worker) {
        runtime.worker = null;
        runtime.workerReady = false;
        runtime.workerReadyPromise = null;
        runtime.armed = false;
        runtime.status = "stopped";
      }
      if (!settled) settle(error || new Error("Worker exited before readiness handshake."));
    };
    worker.once("exit", (code, signal) => {
      cleanup(new Error(`Worker exited before readiness confirmation (code=${code}, signal=${signal || "none"}).`));
    });
    worker.once("error", (error) => {
      console.error(`❌ [USER-RUNTIME] worker error user=${runtime.userId} session=${runtime.sessionId}:`, error);
      cleanup(error);
    });
    console.log(`🧩 [USER-RUNTIME] worker iniciado após comando explícito | user=${runtime.userId} | session=${runtime.sessionId}`);
    return readyPromise;
  }

  prepareAtBoot(): void {
    console.log("🧠 [USER-RUNTIME] núcleo compartilhado pronto; runtimes individuais serão criados por login.");
  }

  registerUser(userId: string): string {
    return this.ensureRuntime(userId, false).sessionId;
  }

  async armUserTrading(userId: string): Promise<void> {
    if (this.emergencyStop) {
      throw new Error("Play blocked: isolated scheduler emergency stop is active.");
    }

    const runtime = this.ensureRuntime(userId);
    await this.startWorker(runtime);
    const worker = runtime.worker;
    if (!worker?.connected || !runtime.workerReady) {
      throw new Error("Play blocked: isolated worker is not ready.");
    }

    // Do not report Play as active until the worker acknowledges that its
    // scheduler is actually running. A timeout or worker error fails closed.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => finish(new Error("Play blocked: worker did not confirm the armed state within 30 seconds.")), 30000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.off("message", onMessage);
        if (error) {
          runtime.armed = false;
          runtime.status = "stopped";
          try {
            if (worker.connected) worker.send({ type: "disarm", userId: runtime.userId, sessionId: runtime.sessionId });
          } catch {}
          // A worker that cannot confirm Play must not remain alive in an
          // ambiguous state where it could trade without a confirmed response.
          try {
            if (worker.connected) worker.kill("SIGTERM");
          } catch {}
          reject(error);
        } else {
          runtime.armed = true;
          runtime.status = "armed";
          resolve();
        }
      };
      const onMessage = (message: any) => {
        if (message?.userId !== runtime.userId || message?.sessionId !== runtime.sessionId) return;
        if (message?.type === "error") {
          finish(new Error(String(message.error || "Isolated worker rejected Play.")));
        } else if (message?.type === "status" && message?.armed === true && message?.status === "armed") {
          finish();
        }
      };
      worker.on("message", onMessage);
      try {
        worker.send({ type: "arm", userId: runtime.userId, sessionId: runtime.sessionId }, (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async startSchedulerForUser(userId: string): Promise<void> {
    await this.armUserTrading(userId);
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
    if (runtime.worker?.connected) runtime.worker.send({ type: "disarm", userId: runtime.userId, sessionId: runtime.sessionId });
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
    const runtime = this.runtimes.get(String(userId));
    if (runtime?.worker?.connected) {
      runtime.worker.send({ type: "trackAssetUsage", userId: runtime.userId, sessionId: runtime.sessionId, symbol });
    }
  }

  resetCooldownSystem(userId: string): { cleared: number; reason: string } {
    const runtime = this.runtimes.get(String(userId));
    if (runtime?.worker?.connected) {
      runtime.worker.send({ type: "resetCooldownSystem", userId: runtime.userId, sessionId: runtime.sessionId });
      return { cleared: 0, reason: "reset solicitado ao runtime isolado" };
    }
    return { cleared: 0, reason: "runtime ainda não iniciado; nenhum motor carregado" };
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
