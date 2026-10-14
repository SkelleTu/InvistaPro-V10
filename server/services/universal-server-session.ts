import fetch from "node-fetch";

type Platform = "main" | "aura";

const platform: Platform = process.env.INVISTA_PLATFORM === "aura" ? "aura" : "main";
const universalUrl = (process.env.UNIVERSAL_SERVER_URL || "").replace(/\/$/, "");
const serviceKey = process.env.INVISTA_UNIVERSAL_SERVER_KEY || "";

interface SessionState { sessionId: string; userId: string; platform: Platform; tradingArmed: boolean; }
const sessions = new Map<string, SessionState>();
// Keep authenticated users in the retry set even when a transient registration
// failure leaves them without a session entry. The heartbeat loop can recover.
const knownUserIds = new Set<string>();

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

export async function syncDerivTokenToUniversalServer(userId: string, token: string, accountType: "demo" | "real") {
  if (!enabled()) throw new Error("Universal Server integration is not configured; Deriv token cannot be registered for a persistent remote session.");
  const response = await call("/api/invista/deriv/session", {
    userId: String(userId),
    platform,
    token,
    accountType,
  });
  if (response?.ok !== true || response?.connected !== true) {
    throw new Error("Universal Server did not confirm a live Deriv session.");
  }
  console.log(`🔐 [UNIVERSAL] Token Deriv registrada de forma protegida e sessão conectada | user=${userId} | platform=${platform} | accountType=${accountType}`);
  return { connected: true, accountType: response.accountType, accountId: response.accountId };
}

export async function disconnectUniversalDerivSession(userId: string) {
  if (!enabled()) return null;
  try {
    const response = await fetch(`${universalUrl}/api/invista/deriv/session/disconnect/${platform}/${encodeURIComponent(String(userId))}`, {
      method: "POST",
      headers: { "x-invista-server-key": serviceKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Universal Server Deriv disconnect returned HTTP ${response.status}`);
    return await response.json() as any;
  } catch (error) {
    console.warn(`⚠️ [UNIVERSAL] Falha ao encerrar conexão Deriv user=${userId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function deleteUniversalDerivSession(userId: string) {
  if (!enabled()) throw new Error("Universal Server integration is not configured; remote Deriv session cannot be revoked.");
  const response = await fetch(`${universalUrl}/api/invista/deriv/session/${platform}/${encodeURIComponent(String(userId))}`, {
    method: "DELETE",
    headers: { "x-invista-server-key": serviceKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Universal Server Deriv session deletion returned HTTP ${response.status}`);
  return await response.json() as any;
}

export async function registerUniversalSession(userId: string) {
  if (!userId) throw new Error("Universal session requires an authenticated user ID.");
  if (!enabled()) throw new Error("Universal Server integration is not configured; refusing to create an untracked trading session.");
  const id = String(userId);
  knownUserIds.add(id);
  const result = await call("/api/invista/session/register", { userId: id, platform });
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
  const id = String(userId);
  if (!id) return null;
  try {
    knownUserIds.add(id);
    const state = sessions.get(id);
    // If login-time registration failed, retry it on the next heartbeat instead
    // of leaving this user permanently absent from the heartbeat loop.
    if (!state) {
      await registerUniversalSession(id);
      return sessions.get(id) || null;
    }
    state.tradingArmed = tradingArmed;
    return (await call("/api/invista/session/heartbeat", {
      sessionId: state.sessionId,
      userId: state.userId,
      platform: state.platform,
      tradingArmed,
    }))?.session || null;
  } catch (error) {
    console.warn(`⚠️ [UNIVERSAL] Heartbeat/registration retry failed for user=${id}:`, error instanceof Error ? error.message : error);
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
  const id = String(userId);
  knownUserIds.delete(id);
  const state = sessions.get(id);
  if (!state || !enabled()) {
    sessions.delete(id);
    return;
  }
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
    for (const userId of knownUserIds) {
      void heartbeatUniversalSession(userId, sessions.get(userId)?.tradingArmed ?? false);
    }
  }, 30_000).unref?.();
  console.log(`💓 [UNIVERSAL] Heartbeat Invista Pro → Universal Server ativo a cada 30s | platform=${platform}`);
}
