import fetch from "node-fetch";

type Platform = "main" | "aura";

const platform: Platform = process.env.INVISTA_PLATFORM === "aura" ? "aura" : "main";
const universalUrl = (process.env.UNIVERSAL_SERVER_URL || "").replace(/\/$/, "");
const serviceKey = process.env.INVISTA_UNIVERSAL_SERVER_KEY || "";

interface SessionState { sessionId: string; userId: string; platform: Platform; tradingArmed: boolean; }
const sessions = new Map<string, SessionState>();

function enabled() {
  return Boolean(universalUrl && serviceKey);
}

async function call(path: string, body: any) {
  if (!enabled()) return null;
  const response = await fetch(`${universalUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-invista-server-key": serviceKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Universal Server ${path} returned HTTP ${response.status}`);
  return await response.json() as any;
}

export async function registerUniversalSession(userId: string) {
  if (!userId) throw new Error("Universal session requires an authenticated user ID.");
  if (!enabled()) throw new Error("Universal Server integration is not configured; refusing to create an untracked trading session.");
  const result = await call("/api/invista/session/register", { userId: String(userId), platform });
  const session = result?.session;
  if (!session?.sessionId) throw new Error("Universal Server did not confirm session registration.");
  sessions.set(String(userId), {
    sessionId: session.sessionId,
    userId: String(userId),
    platform,
    tradingArmed: Boolean(session.tradingArmed),
  });
  console.log(`💓 [UNIVERSAL] Sessão registrada | user=${userId} | platform=${platform} | session=${session.sessionId}`);
  return session;
}

export async function heartbeatUniversalSession(userId: string, tradingArmed = false) {
  const state = sessions.get(String(userId));
  if (!state) return registerUniversalSession(String(userId));
  try {
    state.tradingArmed = tradingArmed;
    return (await call("/api/invista/session/heartbeat", {
      sessionId: state.sessionId,
      userId: state.userId,
      platform: state.platform,
      tradingArmed,
    }))?.session || null;
  } catch (error) {
    console.warn(`⚠️ [UNIVERSAL] Heartbeat falhou para user=${userId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function setUniversalTradingArmed(userId: string, armed: boolean) {
  if (!enabled()) throw new Error("Universal Server integration is not configured; Play/Stop synchronization is required.");
  const state = sessions.get(String(userId));
  if (!state) await registerUniversalSession(String(userId));
  const current = sessions.get(String(userId));
  if (!current) throw new Error("Universal Server session is not registered; refusing to change local trading state.");
  // Store the desired state before the network call so the heartbeat retries
  // the latest intent if the remote request fails.
  current.tradingArmed = armed;
  const result = await call("/api/invista/session/arm", {
    sessionId: current.sessionId,
    userId: current.userId,
    armed,
  });
  if (!result?.session?.sessionId) throw new Error("Universal Server did not confirm the requested armed state.");
  return result.session;
}

export async function disconnectUniversalSession(userId: string) {
  const state = sessions.get(String(userId));
  if (!state || !enabled()) return;
  try {
    await call("/api/invista/session/disconnect", { sessionId: state.sessionId, userId: state.userId });
  } catch (error) {
    console.warn(`⚠️ [UNIVERSAL] Falha ao desconectar sessão user=${userId}:`, error instanceof Error ? error.message : error);
  } finally {
    sessions.delete(String(userId));
  }
}

export function startUniversalHeartbeatLoop() {
  if (!enabled()) {
    console.log("ℹ️ [UNIVERSAL] Integração não configurada: defina UNIVERSAL_SERVER_URL e INVISTA_UNIVERSAL_SERVER_KEY.");
    return;
  }
  setInterval(() => {
    for (const state of sessions.values()) {
      void heartbeatUniversalSession(state.userId, state.tradingArmed);
    }
  }, 30_000).unref?.();
  console.log(`💓 [UNIVERSAL] Heartbeat Invista Pro → Universal Server ativo a cada 30s | platform=${platform}`);
}
