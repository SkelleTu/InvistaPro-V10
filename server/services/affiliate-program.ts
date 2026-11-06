import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { sqlite } from "../db";
import { pgDb, isPostgresAvailable } from "../db-postgres";

type QueryRow = Record<string, any>;
const normalizeRows = (result: any): QueryRow[] => {
  if (Array.isArray(result)) return result as QueryRow[];
  if (Array.isArray(result?.rows)) return result.rows as QueryRow[];
  return [];
};

let schemaReady: Promise<void> | null = null;

export async function ensureAffiliateSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
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

      if (isPostgresAvailable && pgDb) {
        const statements = [
          `CREATE TABLE IF NOT EXISTS affiliate_profiles (
            user_id varchar(32) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            referral_code varchar(20) NOT NULL UNIQUE,
            created_at timestamptz NOT NULL DEFAULT now()
          )`,
          `CREATE TABLE IF NOT EXISTS affiliate_referrals (
            id varchar(32) PRIMARY KEY,
            referrer_user_id varchar(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            referred_user_id varchar(32) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT affiliate_no_self_referral CHECK (referrer_user_id <> referred_user_id)
          )`,
          "CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer ON affiliate_referrals(referrer_user_id)",
          `CREATE TABLE IF NOT EXISTS affiliate_commissions (
            id varchar(32) PRIMARY KEY,
            referrer_user_id varchar(32) NOT NULL REFERENCES users(id),
            referred_user_id varchar(32) NOT NULL REFERENCES users(id),
            payment_reference varchar(160) NOT NULL UNIQUE,
            eligible_base_cents bigint NOT NULL,
            rate_bps integer NOT NULL DEFAULT 150,
            commission_amount_cents bigint NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'pending',
            created_at timestamptz NOT NULL DEFAULT now()
          )`,
          "CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_referrer ON affiliate_commissions(referrer_user_id)",
        ];
        for (const statement of statements) await pgDb.execute(sql.raw(statement));
      }
    })().catch((error) => {
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
  if (isPostgresAvailable && pgDb) {
    const rows = normalizeRows(await pgDb.execute(sql`SELECT user_id FROM affiliate_profiles WHERE referral_code = ${code} LIMIT 1`));
    return rows[0]?.user_id ? String(rows[0].user_id) : null;
  }
  const row = sqlite.prepare("SELECT user_id FROM affiliate_profiles WHERE referral_code = ? LIMIT 1").get(code) as QueryRow | undefined;
  return row?.user_id ? String(row.user_id) : null;
}

export async function ensureAffiliateProfile(userId: string): Promise<string> {
  await ensureAffiliateSchema();
  if (isPostgresAvailable && pgDb) {
    const existing = normalizeRows(await pgDb.execute(sql`SELECT referral_code FROM affiliate_profiles WHERE user_id = ${userId} LIMIT 1`));
    if (existing[0]?.referral_code) return String(existing[0].referral_code);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        await pgDb.execute(sql`INSERT INTO affiliate_profiles (user_id, referral_code) VALUES (${userId}, ${code}) ON CONFLICT (user_id) DO NOTHING`);
        const created = normalizeRows(await pgDb.execute(sql`SELECT referral_code FROM affiliate_profiles WHERE user_id = ${userId} LIMIT 1`));
        if (created[0]?.referral_code) {
          try {
            sqlite.prepare("INSERT OR IGNORE INTO affiliate_profiles (user_id, referral_code) VALUES (?, ?)").run(userId, String(created[0].referral_code));
          } catch (cacheError) {
            console.warn("[AFFILIATE] Profile is durable in PostgreSQL; local cache sync will be retried later:", cacheError instanceof Error ? cacheError.message : String(cacheError));
          }
          return String(created[0].referral_code);
        }
      } catch (error: any) {
        if (attempt === 4) throw error;
      }
    }
    throw new Error("Não foi possível gerar um código de indicação único.");
  }

  const existing = sqlite.prepare("SELECT referral_code FROM affiliate_profiles WHERE user_id = ? LIMIT 1").get(userId) as QueryRow | undefined;
  if (existing?.referral_code) return String(existing.referral_code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    try {
      sqlite.prepare("INSERT OR IGNORE INTO affiliate_profiles (user_id, referral_code) VALUES (?, ?)").run(userId, code);
      const created = sqlite.prepare("SELECT referral_code FROM affiliate_profiles WHERE user_id = ? LIMIT 1").get(userId) as QueryRow | undefined;
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

  if (isPostgresAvailable && pgDb) {
    await pgDb.execute(sql`INSERT INTO affiliate_referrals (id, referrer_user_id, referred_user_id) VALUES (${randomBytes(16).toString("hex")}, ${referrerUserId}, ${referredUserId}) ON CONFLICT (referred_user_id) DO NOTHING`);
    const rows = normalizeRows(await pgDb.execute(sql`SELECT referrer_user_id FROM affiliate_referrals WHERE referred_user_id = ${referredUserId} LIMIT 1`));
    if (!rows[0] || String(rows[0].referrer_user_id) !== referrerUserId) {
      throw new Error("Esta conta já possui uma indicação vinculada.");
    }
  } else {
    sqlite.prepare("INSERT OR IGNORE INTO affiliate_referrals (id, referrer_user_id, referred_user_id) VALUES (?, ?, ?)").run(randomBytes(16).toString("hex"), referrerUserId, referredUserId);
    const row = sqlite.prepare("SELECT referrer_user_id FROM affiliate_referrals WHERE referred_user_id = ? LIMIT 1").get(referredUserId) as QueryRow | undefined;
    if (!row || String(row.referrer_user_id) !== referrerUserId) throw new Error("Esta conta já possui uma indicação vinculada.");
  }
}

export async function getAffiliateDashboard(userId: string) {
  const referralCode = await ensureAffiliateProfile(userId);
  let networkRows: QueryRow[] = [];
  let commissionRows: QueryRow[] = [];

  if (isPostgresAvailable && pgDb) {
    networkRows = normalizeRows(await pgDb.execute(sql`
      WITH RECURSIVE network(user_id, depth, created_at) AS (
        SELECT referred_user_id, 1, created_at
        FROM affiliate_referrals
        WHERE referrer_user_id = ${userId}
        UNION ALL
        SELECT ar.referred_user_id, n.depth + 1, ar.created_at
        FROM affiliate_referrals ar
        INNER JOIN network n ON ar.referrer_user_id = n.user_id
        WHERE n.depth < 10
      )
      SELECT u.id, u.nome_completo AS "nomeCompleto", n.depth, n.created_at AS "createdAt"
      FROM network n INNER JOIN users u ON u.id = n.user_id
      ORDER BY n.depth ASC, n.created_at DESC
    `));
    commissionRows = normalizeRows(await pgDb.execute(sql`
      SELECT COALESCE(SUM(commission_amount_cents), 0)::bigint AS total_cents,
             COUNT(*)::int AS total_events,
             COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_events
      FROM affiliate_commissions WHERE referrer_user_id = ${userId}
    `));
  } else {
    networkRows = sqlite.prepare(`
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
    commissionRows = [sqlite.prepare(`
      SELECT COALESCE(SUM(commission_amount_cents), 0) AS total_cents,
             COUNT(*) AS total_events,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_events
      FROM affiliate_commissions WHERE referrer_user_id = ?
    `).get(userId) as QueryRow];
  }

  const directReferrals = networkRows.filter((row) => Number(row.depth) === 1);
  const commission = commissionRows[0] || {};
  const network = networkRows.map((row) => ({
    id: String(row.id),
    displayName: String(row.nomeCompleto || "Cliente").split(" ")[0],
    level: Number(row.depth || 1),
    createdAt: row.createdAt,
  }));
  return {
    referralCode,
    referralLink: `/auth?ref=${encodeURIComponent(referralCode)}`,
    directReferrals: directReferrals.length,
    totalNetwork: network.length,
    commissionRatePercent: 1.5,
    commissionTotal: Number(commission.total_cents || 0) / 100,
    commissionEvents: Number(commission.total_events || 0),
    pendingCommissionEvents: Number(commission.pending_events || 0),
    referrals: network.filter((item) => item.level === 1),
    network,
    commissionNotice: "Comissões só serão registradas após confirmação de eventos financeiros pelo provedor e aplicação da regra de base elegível do programa. Nenhum valor é creditado nesta etapa.",
  };
}

export async function getAffiliateAdminNetwork(limit = 500) {
  await ensureAffiliateSchema();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 500, 1), 1000);
  if (isPostgresAvailable && pgDb) {
    return normalizeRows(await pgDb.execute(sql`
      SELECT
        ar.id,
        ar.referrer_user_id AS "referrerUserId",
        parent.nome_completo AS "referrerName",
        parent.email AS "referrerEmail",
        ar.referred_user_id AS "referredUserId",
        child.nome_completo AS "referredName",
        child.email AS "referredEmail",
        ar.created_at AS "createdAt"
      FROM affiliate_referrals ar
      INNER JOIN users parent ON parent.id = ar.referrer_user_id
      INNER JOIN users child ON child.id = ar.referred_user_id
      ORDER BY ar.created_at DESC
      LIMIT ${safeLimit}
    `));
  }
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
  if (isPostgresAvailable && pgDb) {
    const rows = normalizeRows(await pgDb.execute(sql.raw(`
      SELECT
        (SELECT COUNT(*) FROM affiliate_profiles)::int AS profiles,
        (SELECT COUNT(*) FROM affiliate_referrals)::int AS referrals,
        (SELECT COUNT(*) FROM affiliate_commissions)::int AS commission_events,
        (SELECT COALESCE(SUM(commission_amount_cents), 0) FROM affiliate_commissions)::bigint AS commission_cents
    `)));
    const row = rows[0] || {};
    return { profiles: Number(row.profiles || 0), referrals: Number(row.referrals || 0), commissionEvents: Number(row.commission_events || 0), commissionTotal: Number(row.commission_cents || 0) / 100 };
  }
  const row = sqlite.prepare(`
    SELECT (SELECT COUNT(*) FROM affiliate_profiles) AS profiles,
           (SELECT COUNT(*) FROM affiliate_referrals) AS referrals,
           (SELECT COUNT(*) FROM affiliate_commissions) AS commission_events,
           (SELECT COALESCE(SUM(commission_amount_cents), 0) FROM affiliate_commissions) AS commission_cents
  `).get() as QueryRow;
  return { profiles: Number(row.profiles || 0), referrals: Number(row.referrals || 0), commissionEvents: Number(row.commission_events || 0), commissionTotal: Number(row.commission_cents || 0) / 100 };
}

/**
 * Internal-only hook for a future verified payment webhook.
 * Call only after provider signature, payment status, amount and idempotency checks.
 * The payment integration supplies the eligible monetary base only after provider verification and after the program's commission-basis policy is applied.
 */
export async function recordAffiliateCommission(referredUserId: string, paymentReference: string, eligibleBaseCents: number): Promise<void> {
  if (!paymentReference || !Number.isSafeInteger(eligibleBaseCents) || eligibleBaseCents <= 0) {
    throw new Error("Referência única e base elegível positiva em centavos são obrigatórias.");
  }
  await ensureAffiliateSchema();
  const rateBps = 150;
  const commissionCents = Math.round(eligibleBaseCents * rateBps / 10000);
  if (isPostgresAvailable && pgDb) {
    const referrers = normalizeRows(await pgDb.execute(sql`SELECT referrer_user_id FROM affiliate_referrals WHERE referred_user_id = ${referredUserId} LIMIT 1`));
    if (!referrers[0]) return;
    const referrerUserId = String(referrers[0].referrer_user_id);
    await pgDb.execute(sql`
      INSERT INTO affiliate_commissions (id, referrer_user_id, referred_user_id, payment_reference, eligible_base_cents, rate_bps, commission_amount_cents, status)
      VALUES (${randomBytes(16).toString("hex")}, ${referrerUserId}, ${referredUserId}, ${paymentReference}, ${eligibleBaseCents}, ${rateBps}, ${commissionCents}, 'pending')
      ON CONFLICT (payment_reference) DO NOTHING
    `);
    try {
      sqlite.prepare(`
        INSERT OR IGNORE INTO affiliate_commissions (id, referrer_user_id, referred_user_id, payment_reference, eligible_base_cents, rate_bps, commission_amount_cents, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(randomBytes(16).toString("hex"), referrerUserId, referredUserId, paymentReference, eligibleBaseCents, rateBps, commissionCents);
    } catch (cacheError) {
      console.warn("[AFFILIATE] Commission is durable in PostgreSQL; local cache sync failed:", cacheError instanceof Error ? cacheError.message : String(cacheError));
    }
    return;
  }
  const referral = sqlite.prepare("SELECT referrer_user_id FROM affiliate_referrals WHERE referred_user_id = ? LIMIT 1").get(referredUserId) as QueryRow | undefined;
  if (!referral) return;
  sqlite.prepare(`
    INSERT OR IGNORE INTO affiliate_commissions (id, referrer_user_id, referred_user_id, payment_reference, eligible_base_cents, rate_bps, commission_amount_cents, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(randomBytes(16).toString("hex"), String(referral.referrer_user_id), referredUserId, paymentReference, eligibleBaseCents, rateBps, commissionCents);
}
