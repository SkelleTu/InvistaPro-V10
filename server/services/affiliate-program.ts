import { randomBytes } from "crypto";
import { sqlite } from "../db";

type QueryRow = Record<string, any>;

let schemaReady: Promise<void> | null = null;

/**
 * Affiliate records use the same SQLite source of truth as the V10 fallback
 * store. They are mirrored through sqlite_replica_rows to Supabase by the
 * shared persistence worker; no request depends on the quota-blocked Neon DB.
 */
export async function ensureAffiliateSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = Promise.resolve().then(() => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS affiliate_profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          referral_code TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS affiliate_referrals (
          id TEXT PRIMARY KEY,
          referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (referrer_user_id <> referred_user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer ON affiliate_referrals(referrer_user_id);
        CREATE TABLE IF NOT EXISTS affiliate_commissions (
          id TEXT PRIMARY KEY,
          referrer_user_id TEXT NOT NULL REFERENCES users(id),
          referred_user_id TEXT NOT NULL REFERENCES users(id),
          payment_reference TEXT NOT NULL UNIQUE,
          eligible_base_cents INTEGER NOT NULL,
          rate_bps INTEGER NOT NULL DEFAULT 150,
          commission_amount_cents INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_referrer ON affiliate_commissions(referrer_user_id);
      `);
    }).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const makeCode = () => randomBytes(5).toString("hex").toUpperCase();

export async function findAffiliateReferrer(referralCode: string): Promise<string | null> {
  await ensureAffiliateSchema();
  const code = referralCode.trim().toUpperCase();
  if (!code) return null;
  const row = sqlite.prepare(
    "SELECT user_id FROM affiliate_profiles WHERE referral_code = ? LIMIT 1"
  ).get(code) as QueryRow | undefined;
  return row?.user_id ? String(row.user_id) : null;
}

export async function ensureAffiliateProfile(userId: string): Promise<string> {
  await ensureAffiliateSchema();
  const existing = sqlite.prepare(
    "SELECT referral_code FROM affiliate_profiles WHERE user_id = ? LIMIT 1"
  ).get(userId) as QueryRow | undefined;
  if (existing?.referral_code) return String(existing.referral_code);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    try {
      sqlite.prepare(
        "INSERT OR IGNORE INTO affiliate_profiles (user_id, referral_code) VALUES (?, ?)"
      ).run(userId, code);
      const created = sqlite.prepare(
        "SELECT referral_code FROM affiliate_profiles WHERE user_id = ? LIMIT 1"
      ).get(userId) as QueryRow | undefined;
      if (created?.referral_code) return String(created.referral_code);
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Não foi possível gerar um código de indicação único.");
}

export async function attachAffiliateReferral(referredUserId: string, referrerUserId: string): Promise<void> {
  await ensureAffiliateSchema();
  if (!referredUserId || !referrerUserId || referredUserId === referrerUserId) {
    throw new Error("Autoindicação não é permitida.");
  }

  sqlite.prepare(
    "INSERT OR IGNORE INTO affiliate_referrals (id, referrer_user_id, referred_user_id) VALUES (?, ?, ?)"
  ).run(randomBytes(16).toString("hex"), referrerUserId, referredUserId);
  const row = sqlite.prepare(
    "SELECT referrer_user_id FROM affiliate_referrals WHERE referred_user_id = ? LIMIT 1"
  ).get(referredUserId) as QueryRow | undefined;
  if (!row || String(row.referrer_user_id) !== referrerUserId) {
    throw new Error("Esta conta já possui uma indicação vinculada.");
  }
}

export async function getAffiliateDashboard(userId: string) {
  const referralCode = await ensureAffiliateProfile(userId);
  const networkRows = sqlite.prepare(`
    WITH RECURSIVE network(user_id, depth, created_at) AS (
      SELECT referred_user_id, 1, created_at
      FROM affiliate_referrals
      WHERE referrer_user_id = ?
      UNION ALL
      SELECT ar.referred_user_id, n.depth + 1, ar.created_at
      FROM affiliate_referrals ar
      INNER JOIN network n ON ar.referrer_user_id = n.user_id
      WHERE n.depth < 10
    )
    SELECT u.id, u.nome_completo AS nomeCompleto, n.depth, n.created_at AS createdAt
    FROM network n INNER JOIN users u ON u.id = n.user_id
    ORDER BY n.depth ASC, n.created_at DESC
  `).all(userId) as QueryRow[];

  const commission = sqlite.prepare(`
    SELECT COALESCE(SUM(commission_amount_cents), 0) AS total_cents,
           COUNT(*) AS total_events,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_events
    FROM affiliate_commissions WHERE referrer_user_id = ?
  `).get(userId) as QueryRow;

  const network = networkRows.map((row) => ({
    id: String(row.id),
    displayName: String(row.nomeCompleto || "Cliente").split(" ")[0],
    level: Number(row.depth || 1),
    createdAt: row.createdAt,
  }));
  return {
    referralCode,
    referralLink: `/auth?ref=${encodeURIComponent(referralCode)}`,
    directReferrals: network.filter((row) => row.level === 1).length,
    totalNetwork: network.length,
    commissionRatePercent: 1.5,
    commissionTotal: Number(commission.total_cents || 0) / 100,
    commissionEvents: Number(commission.total_events || 0),
    pendingCommissionEvents: Number(commission.pending_events || 0),
    referrals: network.filter((row) => row.level === 1),
    network,
    commissionNotice: "Comissões só serão registradas após confirmação de eventos financeiros pelo provedor e aplicação da regra de base elegível do programa. Nenhum valor é creditado nesta etapa.",
  };
}

export async function getAffiliateAdminNetwork(limit = 500) {
  await ensureAffiliateSchema();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 500, 1), 1000);
  return sqlite.prepare(`
    SELECT
      ar.id,
      ar.referrer_user_id AS referrerUserId,
      parent.nome_completo AS referrerName,
      parent.email AS referrerEmail,
      ar.referred_user_id AS referredUserId,
      child.nome_completo AS referredName,
      child.email AS referredEmail,
      ar.created_at AS createdAt
    FROM affiliate_referrals ar
    INNER JOIN users parent ON parent.id = ar.referrer_user_id
    INNER JOIN users child ON child.id = ar.referred_user_id
    ORDER BY ar.created_at DESC
    LIMIT ?
  `).all(safeLimit) as QueryRow[];
}

export async function getAffiliateAdminSummary() {
  await ensureAffiliateSchema();
  const row = sqlite.prepare(`
    SELECT (SELECT COUNT(*) FROM affiliate_profiles) AS profiles,
           (SELECT COUNT(*) FROM affiliate_referrals) AS referrals,
           (SELECT COUNT(*) FROM affiliate_commissions) AS commission_events,
           (SELECT COALESCE(SUM(commission_amount_cents), 0) FROM affiliate_commissions) AS commission_cents
  `).get() as QueryRow;
  return {
    profiles: Number(row.profiles || 0),
    referrals: Number(row.referrals || 0),
    commissionEvents: Number(row.commission_events || 0),
    commissionTotal: Number(row.commission_cents || 0) / 100,
  };
}

/**
 * Internal-only hook for a future verified payment webhook.
 * Call only after provider signature, payment status, amount and idempotency checks.
 */
export async function recordAffiliateCommission(
  referredUserId: string,
  paymentReference: string,
  eligibleBaseCents: number
): Promise<void> {
  if (!paymentReference || !Number.isSafeInteger(eligibleBaseCents) || eligibleBaseCents <= 0) {
    throw new Error("Referência única e base elegível positiva em centavos são obrigatórias.");
  }
  await ensureAffiliateSchema();
  const referral = sqlite.prepare(
    "SELECT referrer_user_id FROM affiliate_referrals WHERE referred_user_id = ? LIMIT 1"
  ).get(referredUserId) as QueryRow | undefined;
  if (!referral) return;

  const rateBps = 150;
  const commissionCents = Math.round(eligibleBaseCents * rateBps / 10000);
  sqlite.prepare(`
    INSERT OR IGNORE INTO affiliate_commissions
      (id, referrer_user_id, referred_user_id, payment_reference, eligible_base_cents, rate_bps, commission_amount_cents, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    randomBytes(16).toString("hex"),
    String(referral.referrer_user_id),
    referredUserId,
    paymentReference,
    eligibleBaseCents,
    rateBps,
    commissionCents
  );
}
