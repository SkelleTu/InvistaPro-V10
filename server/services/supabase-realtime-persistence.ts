import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sqlite } from "../db";
import { pgDb, pgSchema, isPostgresAvailable } from "../db-postgres";

const CORE_TABLES = [
  "users",
  "sessions",
  "movimentos",
  "documentos",
  "kyc_status",
  "deriv_tokens",
  "trade_configurations",
  "ai_logs",
  "trade_operations",
  "market_data",
  "daily_pnl",
  "ai_recovery_strategies",
  "affiliate_profiles",
  "affiliate_referrals",
  "affiliate_commissions",
] as const;

const BATCH_SIZE = 200;
const SYNC_INTERVAL_MS = 2000;

function ensureAffiliateReplicaSchema(): void {
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
}

let client: SupabaseClient | null = null;
let timer: NodeJS.Timeout | null = null;
let running = false;

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  // Production replication is server-to-server and must not use the public anon key.
  // Without a service-role key, SQLite remains authoritative and replica sync stays off.
  const key = process.env.NODE_ENV === "production" ? serviceRoleKey : (serviceRoleKey || anonKey);
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function normalize(value: any): any {
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Date) return value.toISOString();
  // better-sqlite3 does not accept JavaScript booleans or plain objects as bind values.
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

function rowsFor(table: string): any[] {
  return sqlite.prepare(`SELECT * FROM "${table}"`).all().map((row: any) => {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) out[k] = normalize(v);
    return out;
  });
}

async function upsertTable(supabase: SupabaseClient, table: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  let written = 0;
  const typedColumns: Record<string, string[]> = {
    users: ["id","email","password_hash","nome_completo","cpf","telefone","endereco","cidade","estado","cep","chave_pix","tipo_chave_pix","telefone_verificado","codigo_verificacao","codigo_expires_at","password_reset_token","password_reset_token_expires_at","conta_aprovada","aprovada_por","aprovada_em","documentos_verificados","documentos_aprovados_em","is_admin","senha_fallback","usar_senha_fallback","biometria_configurada","saldo","deposito_data","rendimento_saque_automatico","created_at","updated_at"],
    sessions: ["sid","sess","expire"],
    movimentos: ["id","user_id","tipo","valor","descricao","pix_string","biometria_verificada","created_at"],
    documentos: ["id","user_id","tipo","arquivo","status","motivo_rejeicao","aprovado_por","aprovado_em","created_at","updated_at"],
    kyc_status: ["id","user_id","status","rg_cnh_frente_status","rg_cnh_verso_status","comprovante_residencia_status","completed_at","approved_at","rejected_at","rejection_reason","reviewed_by","created_at","updated_at"],
    deriv_tokens: ["id","user_id","token","account_type","is_active","created_at","updated_at"],
    trade_configurations: ["id","user_id","mode","is_active","operations_count","interval_type","interval_value","created_at","updated_at"],
    ai_logs: ["id","user_id","model_name","analysis","decision","confidence","market_data","created_at"],
    trade_operations: ["id","user_id","deriv_contract_id","symbol","trade_type","direction","amount","duration","status","entry_price","exit_price","profit","ai_consensus","isRecoveryMode","recovery_multiplier","is_conservative_forced","created_at","completed_at"],
    market_data: ["id","symbol","current_price","price_history","last_update","is_simulated"],
    daily_pnl: ["id","user_id","date","opening_balance","current_balance","daily_pnl","total_trades","won_trades","lost_trades","conservative_operations","is_recovery_active","recovery_threshold","max_drawdown","recovery_operations","created_at","updated_at"],
    ai_recovery_strategies: ["id","user_id","strategy_name","is_active","parameters","success_rate","total_recoveries","avg_recovery_time","created_at","updated_at"],
  };
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const replica = batch.map((row: any) => ({
      table_name: table,
      row_id: String(row.id ?? row.sid ?? row.user_id ?? (table + ":" + i)),
      payload: row,
      updated_at: new Date().toISOString(),
    }));
    const { error: replicaError } = await supabase
      .from("sqlite_replica_rows")
      .upsert(replica, { onConflict: "table_name,row_id", ignoreDuplicates: false });
    if (replicaError) throw new Error("SUPABASE_REPLICA_" + table + ": " + replicaError.message);

    if (table.startsWith("affiliate_")) { written += batch.length; continue; }

    const allowed = typedColumns[table] ?? Object.keys(batch[0]);
    const typedBatch = batch.map((row: any) => {
      const typed: any = {};
      for (const column of allowed) {
        if (Object.prototype.hasOwnProperty.call(row, column)) typed[column] = row[column];
      }
      return typed;
    });
    const conflict = table === "sessions" ? "sid" : "id";
    const { error } = await supabase.from(table).upsert(typedBatch, {
      onConflict: conflict,
      ignoreDuplicates: false,
    });
    if (error) throw new Error("SUPABASE_SYNC_" + table + ": " + error.message);
    written += batch.length;
  }
  return written;
}

/**
 * SQLite continua sendo o cache de execução local. Supabase recebe uma cópia
 * durável continuamente. Isto não substitui a necessidade de backup.
 */
export async function syncSqliteToSupabaseOnce(): Promise<{ tables: number; rows: number }> {
  const supabase = getClient();
  if (!supabase) return { tables: 0, rows: 0 };
  let tables = 0;
  let rows = 0;
  ensureAffiliateReplicaSchema();
  for (const table of CORE_TABLES) {
    const source = rowsFor(table);
    if (!source.length) continue;
    rows += await upsertTable(supabase, table, source);
    tables++;
  }
  return { tables, rows };
}

/**
 * Recupera dados que já existam no Supabase para o SQLite, sem apagar dados locais.
 * O merge é feito por PK e só cobre tabelas presentes nos dois lados.
 */
export async function restoreSupabaseToSqliteOnce(): Promise<{ tables: number; rows: number }> {
  const supabase = getClient();
  if (!supabase) return { tables: 0, rows: 0 };
  let tables = 0;
  let rows = 0;

  ensureAffiliateReplicaSchema();
  for (const table of CORE_TABLES) {
    let data: any[] | null = null;
    let error: any = null;
    if (table.startsWith("affiliate_")) {
      const replica = await supabase.from("sqlite_replica_rows").select("payload").eq("table_name", table);
      error = replica.error;
      data = (replica.data || []).map((item: any) => typeof item.payload === "string" ? JSON.parse(item.payload) : item.payload).filter(Boolean);
    } else {
      const result = await supabase.from(table).select("*");
      data = result.data;
      error = result.error;
    }
    if (error) {
      console.warn(`[SUPABASE→SQLITE] ${table}: ${error.message}`);
      continue;
    }
    if (!data?.length) continue;

    // Only restore columns that exist in the current local SQLite schema.
    // Newer Supabase schemas may contain columns not yet present in this release.
    const localColumns = new Set(
      (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map(column => String(column.name))
    );
    const columns = Object.keys(data[0]).filter(column => localColumns.has(column));
    const pk = table === "sessions" ? "sid" : table === "affiliate_profiles" ? "user_id" : "id";
    if (!columns.includes(pk)) continue;

    const quotedColumns = columns.map(c => `"${c}"`).join(",");
    const placeholders = columns.map(c => `@${c}`).join(",");
    const updates = columns.filter(c => c !== pk).map(c => `"${c}"=excluded."${c}"`).join(",");
    const stmt = sqlite.prepare(`
      INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})
      ON CONFLICT("${pk}") DO UPDATE SET ${updates || `"${pk}"=excluded."${pk}"`}
    `);

    const tx = sqlite.transaction((items: any[]) => {
      for (const row of items) {
        const normalized: any = {};
        for (const column of columns) normalized[column] = normalize(row[column]);
        stmt.run(normalized);
      }
    });
    tx(data);
    rows += data.length;
    tables++;
  }
  return { tables, rows };
}

export async function startSupabaseRealtimePersistence(): Promise<boolean> {
  if (timer) return;
  if (!getClient()) {
    console.warn("[SUPABASE] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados; sincronização segura desativada e SQLite permanece como fonte principal.");
    return false;
  }

  try {
    const restored = await restoreSupabaseToSqliteOnce();
    console.log(`[SUPABASE→SQLITE] restauração concluída: ${restored.tables} tabelas / ${restored.rows} linhas.`);
  } catch (error: any) {
    console.warn("[SUPABASE→SQLITE] restauração inicial falhou; SQLite local será preservado:", error?.message || error);
  }

  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncSqliteToSupabaseOnce();
      if (result.rows) console.log(`[SQLITE→SUPABASE] sincronização: ${result.tables} tabelas / ${result.rows} linhas.`);
    } catch (error: any) {
      console.warn("[SQLITE→SUPABASE] ciclo falhou; próxima tentativa automática:", error?.message || error);
    } finally {
      running = false;
    }
  };

  await cycle();
  timer = setInterval(() => void cycle(), SYNC_INTERVAL_MS);
  timer.unref();
  console.log("🔄 [SUPABASE] persistência contínua SQLite ↔ Supabase ativada (2s).");
  return true;

  // Supabase Realtime: invalida o cache local quando outro cliente alterar dados.
  const channel = getClient()!.channel("invistapro-persistence");
  channel
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => void restoreSupabaseToSqliteOnce())
    .on("postgres_changes", { event: "*", schema: "public", table: "movimentos" }, () => void restoreSupabaseToSqliteOnce())
    .on("postgres_changes", { event: "*", schema: "public", table: "trade_operations" }, () => void restoreSupabaseToSqliteOnce())
    .subscribe((status) => console.log(`[SUPABASE REALTIME] ${status}`));
}

export function stopSupabaseRealtimePersistence(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
