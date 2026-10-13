import fetch from "node-fetch";

type Platform = "main" | "aura";
const platform: Platform = process.env.INVISTA_PLATFORM === "aura" ? "aura" : "main";
const universalUrl = (process.env.UNIVERSAL_SERVER_URL || "").replace(/\/$/, "");
const serviceKey = process.env.INVISTA_UNIVERSAL_SERVER_KEY || "";

function requireConfiguration() {
  if (!universalUrl || !serviceKey) {
    throw new Error("Universal remote access is not configured.");
  }
}

async function call(path: string, body: unknown) {
  requireConfiguration();
  const response = await fetch(`${universalUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-invista-server-key": serviceKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Universal remote access failed (HTTP ${response.status}).`);
  return await response.json() as Record<string, any>;
}

/** Issue a short-lived, single-use browser handoff for the already-authenticated user. */
export async function createUniversalRemoteTicket(userId: string) {
  if (!userId) throw new Error("An authenticated user is required.");
  const result = await call("/api/invista/remote-access/tickets", { userId: String(userId), platform });
  if (result.ok !== true || typeof result.ticket !== "string" || typeof result.expiresAt !== "string") {
    throw new Error("Universal Server did not confirm a remote access grant.");
  }
  return { ticket: result.ticket as string, expiresAt: result.expiresAt as string, platform };
}

/** Consume a grant exactly once and verify it is bound to this deployment. */
export async function consumeUniversalRemoteTicket(ticket: string) {
  if (!ticket || ticket.length < 32) throw new Error("Invalid remote access ticket.");
  const result = await call("/api/invista/remote-access/consume", { ticket, platform });
  if (result.ok !== true || typeof result.userId !== "string" || result.platform !== platform) {
    throw new Error("Universal Server did not confirm the remote access grant.");
  }
  return { userId: result.userId as string, platform };
}
