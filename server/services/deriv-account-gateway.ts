import WebSocket from 'ws';

export type DerivAccountType = 'demo' | 'real';

export interface DerivAccountContext {
  accountId: string;
  accountType: DerivAccountType;
  authorizationToken: string;
  websocketUrl: string;
  appId: string | null;
}

const API_BASE = 'https://api.derivws.com';
const ACCOUNT_WS_START_GAP_MS = 1800;
let nextDerivSocketStartAt = 0;
let derivSocketStartQueue: Promise<void> = Promise.resolve();

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Process-wide pacing shared by public and account-scoped Deriv sockets.
 * A fresh OTP is acquired for each authenticated attempt; account/token isolation
 * is retained while rapid parallel handshakes that trigger HTTP 429 are avoided.
 */
export async function waitForDerivConnectionStartSlot(): Promise<void> {
  const previous = derivSocketStartQueue;
  let release!: () => void;
  derivSocketStartQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, nextDerivSocketStartAt - Date.now());
    if (waitMs > 0) await delay(waitMs);
    nextDerivSocketStartAt = Date.now() + ACCOUNT_WS_START_GAP_MS;
  } finally {
    release();
  }
}

function isOAuthAccessToken(token: string): boolean {
  return String(process.env.DERIV_AUTH_MODE ?? '').trim().toLowerCase() === 'oauth'
    || /^ory_at_[A-Za-z0-9._~-]+$/.test(String(token ?? '').trim());
}

function appId(): string | null {
  const value = String(process.env.DERIV_APP_ID ?? '').trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error('DERIV_APP_ID has an invalid format for the current Deriv developer application');
  }
  return value;
}

function headers(token: string): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  // Current Deriv documentation requires Deriv-App-ID for PAT, not OAuth access tokens.
  if (!isOAuthAccessToken(token)) {
    const id = appId();
    if (!id) throw new Error('DERIV_APP_ID is required when using a Deriv PAT');
    result['Deriv-App-ID'] = id;
  }

  return result;
}

async function derivFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = body?.errors?.[0]?.message ?? body?.error?.message ?? `Deriv API HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function collectObjects(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out);
    return out;
  }
  const object = value as Record<string, unknown>;
  out.push(object);
  for (const child of Object.values(object)) collectObjects(child, out);
  return out;
}

function accountTypeOf(account: Record<string, unknown>): DerivAccountType | null {
  const raw = String(
    account.account_type ??
    account.accountType ??
    account.type ??
    account.environment ??
    account.mode ??
    ''
  ).toLowerCase();
  if (raw.includes('demo') || raw.includes('virtual') || raw.includes('vrt')) return 'demo';
  if (raw.includes('real') || raw.includes('live') || raw.includes('cr')) return 'real';
  return null;
}

function accountIdOf(account: Record<string, unknown>): string | null {
  const raw = account.account_id ?? account.accountId ?? account.id ?? account.loginid ?? account.loginId;
  const value = String(raw ?? '').trim();
  return value || null;
}

export async function resolveDerivAccount(token: string, accountType: DerivAccountType): Promise<string> {
  const response = await derivFetch<any>(token, '/trading/v1/options/accounts');
  const candidates = collectObjects(response)
    .map(account => ({ account, type: accountTypeOf(account), id: accountIdOf(account) }))
    .filter(item => item.id && item.type === accountType);

  if (candidates.length === 0) {
    throw new Error(`No Deriv Options ${accountType} account is available for the supplied authorization token`);
  }

  return candidates[0].id!;
}

export async function createDerivAccountContext(
  token: string,
  accountType: DerivAccountType,
  preferredAccountId?: string,
): Promise<DerivAccountContext> {
  const authorizationToken = String(token ?? '').trim();
  if (!authorizationToken) throw new Error('Deriv authorization token is required');

  const accountId = String(preferredAccountId ?? '').trim() || await resolveDerivAccount(authorizationToken, accountType);
  const response = await derivFetch<any>(
    authorizationToken,
    `/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    { method: 'POST', body: '{}' },
  );

  const websocketUrl = String(response?.data?.url ?? '').trim();
  if (!websocketUrl) throw new Error('Deriv OTP response did not contain an authenticated WebSocket URL');

  const parsed = new URL(websocketUrl);
  const endpointMode = parsed.pathname.endsWith('/real') ? 'real' : parsed.pathname.endsWith('/demo') ? 'demo' : null;
  if (endpointMode !== accountType) {
    throw new Error(`Deriv account routing mismatch: requested ${accountType}, received ${endpointMode ?? 'unknown'} WebSocket endpoint`);
  }

  return {
    accountId,
    accountType,
    authorizationToken,
    websocketUrl,
    appId: isOAuthAccessToken(authorizationToken) ? null : appId(),
  };
}

export function assertDerivAccountContext(context: DerivAccountContext): void {
  if (!context.accountId) throw new Error('Deriv accountId is missing');
  if (!context.authorizationToken) throw new Error('Deriv authorization token is missing');
  if (!context.websocketUrl) throw new Error('Deriv authenticated WebSocket URL is missing');

  const parsed = new URL(context.websocketUrl);
  const expectedPath = context.accountType === 'real'
    ? '/trading/v1/options/ws/real'
    : '/trading/v1/options/ws/demo';

  if (parsed.pathname !== expectedPath) {
    throw new Error(`Deriv WebSocket endpoint mismatch: expected ${expectedPath}, received ${parsed.pathname}`);
  }

  if (!parsed.searchParams.get('otp')) {
    throw new Error('Deriv authenticated WebSocket URL is missing its OTP');
  }
}

export async function connectDerivAccount(
  token: string,
  accountType: DerivAccountType,
  preferredAccountId?: string,
): Promise<{ ws: WebSocket; context: DerivAccountContext }> {
  let lastError: Error | null = null;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let ws: WebSocket | null = null;
    try {
      // Obtain a fresh, single-use OTP for every handshake attempt.
      const context = await createDerivAccountContext(token, accountType, preferredAccountId);
      assertDerivAccountContext(context);
      await waitForDerivConnectionStartSlot();

      ws = new WebSocket(context.websocketUrl, {
        headers: { Origin: 'https://app.deriv.com' },
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ws?.off('open', onOpen);
          ws?.off('error', onError);
          ws?.off('unexpected-response', onUnexpectedResponse);
          if (error) {
            try { ws?.terminate(); } catch {}
            reject(error);
          } else {
            resolve();
          }
        };
        const onOpen = () => finish();
        const onError = (error: Error) => finish(error);
        const onUnexpectedResponse = (_request: unknown, response: { statusCode?: number }) => {
          const status = Number(response?.statusCode || 0);
          finish(new Error(status === 429
            ? 'Deriv authenticated WebSocket rate limited the connection (HTTP 429).'
            : `Deriv authenticated WebSocket rejected the connection (HTTP ${status || 'unknown'}).`));
        };
        const timer = setTimeout(() => {
          finish(new Error('Deriv authenticated WebSocket connection timeout after 10 seconds'));
        }, 10000);

        ws!.once('open', onOpen);
        ws!.once('error', onError);
        ws!.once('unexpected-response', onUnexpectedResponse);
      });

      return { ws, context };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      try {
        if (ws && ws.readyState !== WebSocket.CLOSED) ws.terminate();
      } catch {}

      const rateLimited = /\b429\b|rate.?limit/i.test(lastError.message);
      if (!rateLimited || attempt >= maxAttempts - 1) throw lastError;

      // Bounded, increasing delay. Do not loop rapidly during a Deriv throttle.
      const backoffMs = attempt === 0 ? 8000 : 18000;
      console.warn(`[DERIV_GATEWAY] HTTP 429 during ${accountType} handshake; retry ${attempt + 2}/${maxAttempts} in ${Math.round(backoffMs / 1000)}s.`);
      await delay(backoffMs);
    }
  }

  throw lastError || new Error('Unable to establish Deriv authenticated WebSocket connection.');
}
