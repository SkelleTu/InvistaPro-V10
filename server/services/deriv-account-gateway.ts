import WebSocket from 'ws';

export type DerivAccountType = 'demo' | 'real';

export interface DerivAccountContext {
  accountId: string;
  accountType: DerivAccountType;
  authorizationToken: string;
  websocketUrl: string;
  appId: string;
}

const API_BASE = 'https://api.derivws.com';

function appId(): string {
  const value = String(process.env.DERIV_APP_ID ?? '').trim();
  if (!value) throw new Error('DERIV_APP_ID is required for Deriv API v1 authentication');
  return value;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Deriv-App-ID': appId(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
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
    appId: appId(),
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
  const context = await createDerivAccountContext(token, accountType, preferredAccountId);
  assertDerivAccountContext(context);

  const ws = new WebSocket(context.websocketUrl, {
    headers: { Origin: 'https://app.deriv.com' },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Deriv authenticated WebSocket connection timeout after 10 seconds'));
    }, 10000);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { ws, context };
}
