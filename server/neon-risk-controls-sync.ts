import { eq } from "drizzle-orm";
import { pgDb, pgSchema, isPostgresAvailable } from "./db-postgres";
import { db as sqliteDb, sqlite } from "./db";
import * as localSchema from "@shared/schema";

function asDate(value: any): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localValue(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? null;
}

/** Import risk-control history once, without replacing any existing Neon value. */
export async function backfillRiskControlsToNeon() {
  if (!isPostgresAvailable || !pgDb) throw new Error("NEON_REQUIRED: Neon indisponível para importar controles de risco.");
  const [identity] = await pgDb.select().from(pgSchema.invistaDatabaseIdentity)
    .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));
  if (!identity) throw new Error("NEON_PLATFORM_IDENTITY_MISSING");
  if (identity.riskControlsBackfillCompletedAt) {
    return { dailyPnL: 0, recoveryStrategies: 0, assetBlacklist: 0, blockedAssets: 0, pauseConfigurations: 0, tradingControl: 0 };
  }

  const localUsers = await sqliteDb.select({ id: localSchema.users.id }).from(localSchema.users);
  const counts = { dailyPnL: 0, recoveryStrategies: 0, assetBlacklist: 0, blockedAssets: 0, pauseConfigurations: 0, tradingControl: 0 };

  for (const localUser of localUsers) {
    const [dailyRows, strategies, blacklistRows, blockedRows, pauseRows] = await Promise.all([
      sqliteDb.select().from(localSchema.dailyPnL).where(eq(localSchema.dailyPnL.userId, localUser.id)),
      sqliteDb.select().from(localSchema.aiRecoveryStrategies).where(eq(localSchema.aiRecoveryStrategies.userId, localUser.id)),
      sqliteDb.select().from(localSchema.assetBlacklist).where(eq(localSchema.assetBlacklist.userId, localUser.id)),
      sqliteDb.select().from(localSchema.blockedAssets).where(eq(localSchema.blockedAssets.userId, localUser.id)),
      sqliteDb.select().from(localSchema.pauseConfiguration).where(eq(localSchema.pauseConfiguration.userId, localUser.id)),
    ]);
    if (dailyRows.length + strategies.length + blacklistRows.length + blockedRows.length + pauseRows.length === 0) continue;

    const [durableUser] = await pgDb.select({ id: pgSchema.users.id }).from(pgSchema.users)
      .where(eq(pgSchema.users.id, localUser.id)).limit(1);
    if (!durableUser) throw new Error("RISK_BACKFILL_USER_MISSING: usuário local sem identidade Neon; importação interrompida.");

    await pgDb.transaction(async (tx: any) => {
      for (const row of dailyRows as any[]) {
        const [saved] = await tx.insert(pgSchema.dailyPnL).values({
          id: row.id, userId: localUser.id, date: row.date,
          openingBalance: Number(row.openingBalance || 0), currentBalance: Number(row.currentBalance || 0),
          dailyPnL: Number(row.dailyPnL || 0), totalTrades: row.totalTrades ?? 0,
          wonTrades: row.wonTrades ?? 0, lostTrades: row.lostTrades ?? 0,
          conservativeOperations: row.conservativeOperations ?? 0,
          isRecoveryActive: Boolean(row.isRecoveryActive), recoveryThreshold: row.recoveryThreshold ?? 0.75,
          maxDrawdown: row.maxDrawdown ?? 0, recoveryOperations: row.recoveryOperations ?? 0,
          createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt),
        }).onConflictDoNothing().returning({ id: pgSchema.dailyPnL.id });
        if (saved) counts.dailyPnL++;
      }
      for (const row of strategies as any[]) {
        const [saved] = await tx.insert(pgSchema.aiRecoveryStrategies).values({
          id: row.id, userId: localUser.id, strategyName: row.strategyName,
          isActive: row.isActive !== false, parameters: row.parameters ?? "{}",
          successRate: row.successRate ?? 0, totalRecoveries: row.totalRecoveries ?? 0,
          avgRecoveryTime: row.avgRecoveryTime ?? 0, createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt),
        }).onConflictDoNothing().returning({ id: pgSchema.aiRecoveryStrategies.id });
        if (saved) counts.recoveryStrategies++;
      }
      for (const row of blacklistRows as any[]) {
        const [saved] = await tx.insert(pgSchema.assetBlacklist).values({
          id: row.id, userId: localUser.id, assetPattern: row.assetPattern,
          patternType: row.patternType, isActive: row.isActive !== false, reason: row.reason ?? null,
          createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt),
        }).onConflictDoNothing().returning({ id: pgSchema.assetBlacklist.id });
        if (saved) counts.assetBlacklist++;
      }
      for (const row of blockedRows as any[]) {
        const [saved] = await tx.insert(pgSchema.blockedAssets).values({
          id: row.id, userId: localUser.id, tradeMode: row.tradeMode,
          symbol: row.symbol, createdAt: asDate(row.createdAt),
        }).onConflictDoNothing().returning({ id: pgSchema.blockedAssets.id });
        if (saved) counts.blockedAssets++;
      }
      for (const row of pauseRows as any[]) {
        const [saved] = await tx.insert(pgSchema.pauseConfiguration).values({
          id: row.id, userId: localUser.id, isEnabled: row.isEnabled !== false,
          operatingDurationMinutes: row.operatingDurationMinutes ?? 15,
          pauseDurationMinSeconds: row.pauseDurationMinSeconds ?? 60,
          pauseDurationMaxSeconds: row.pauseDurationMaxSeconds ?? 180,
          useTechnicalAnalysisConsensus: row.useTechnicalAnalysisConsensus !== false,
          minAIConsensusForPause: row.minAIConsensusForPause ?? 0.7,
          lastPauseStartedAt: asDate(row.lastPauseStartedAt),
          lastOperatingStartedAt: asDate(row.lastOperatingStartedAt),
          isPausedNow: Boolean(row.isPausedNow), createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt),
        }).onConflictDoNothing().returning({ id: pgSchema.pauseConfiguration.id });
        if (saved) counts.pauseConfigurations++;
      }
    });
  }

  const localControls = await sqliteDb.select().from(localSchema.tradingControl);
  for (const row of localControls as any[]) {
    const [saved] = await pgDb.insert(pgSchema.tradingControl).values({
      id: row.id, isPaused: Boolean(row.isPaused), pausedBy: row.pausedBy ?? null,
      pausedAt: asDate(row.pausedAt), pauseReason: row.pauseReason ?? null,
      resumedAt: asDate(row.resumedAt), updatedAt: asDate(row.updatedAt),
    }).onConflictDoNothing().returning({ id: pgSchema.tradingControl.id });
    if (saved) counts.tradingControl++;
  }

  await pgDb.update(pgSchema.invistaDatabaseIdentity)
    .set({ riskControlsBackfillCompletedAt: new Date() })
    .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));

  console.info("[SQLITE→NEON] Controles de risco e segurança persistidos.", counts);
  return counts;
}

/** Restore durable risk state into the local execution cache after each restart. */
export async function restoreRiskControlsToSqlite() {
  if (!isPostgresAvailable || !pgDb) throw new Error("NEON_REQUIRED: Neon indisponível para restaurar controles de risco.");
  const [dailyRows, strategies, blacklistRows, blockedRows, pauseRows, controls] = await Promise.all([
    pgDb.select().from(pgSchema.dailyPnL),
    pgDb.select().from(pgSchema.aiRecoveryStrategies),
    pgDb.select().from(pgSchema.assetBlacklist),
    pgDb.select().from(pgSchema.blockedAssets),
    pgDb.select().from(pgSchema.pauseConfiguration),
    pgDb.select().from(pgSchema.tradingControl),
  ]);

  const dailyUpsert = sqlite.prepare(`
    INSERT INTO daily_pnl(id,user_id,date,opening_balance,current_balance,daily_pnl,total_trades,won_trades,lost_trades,
      conservative_operations,is_recovery_active,recovery_threshold,max_drawdown,recovery_operations,created_at,updated_at)
    VALUES(@id,@user_id,@date,@opening_balance,@current_balance,@daily_pnl,@total_trades,@won_trades,@lost_trades,
      @conservative_operations,@is_recovery_active,@recovery_threshold,@max_drawdown,@recovery_operations,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET opening_balance=excluded.opening_balance,current_balance=excluded.current_balance,
      daily_pnl=excluded.daily_pnl,total_trades=excluded.total_trades,won_trades=excluded.won_trades,
      lost_trades=excluded.lost_trades,conservative_operations=excluded.conservative_operations,
      is_recovery_active=excluded.is_recovery_active,recovery_threshold=excluded.recovery_threshold,
      max_drawdown=excluded.max_drawdown,recovery_operations=excluded.recovery_operations,updated_at=excluded.updated_at
  `);
  const strategyUpsert = sqlite.prepare(`
    INSERT INTO ai_recovery_strategies(id,user_id,strategy_name,is_active,parameters,success_rate,total_recoveries,avg_recovery_time,created_at,updated_at)
    VALUES(@id,@user_id,@strategy_name,@is_active,@parameters,@success_rate,@total_recoveries,@avg_recovery_time,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET strategy_name=excluded.strategy_name,is_active=excluded.is_active,parameters=excluded.parameters,
      success_rate=excluded.success_rate,total_recoveries=excluded.total_recoveries,avg_recovery_time=excluded.avg_recovery_time,updated_at=excluded.updated_at
  `);
  const blacklistUpsert = sqlite.prepare(`
    INSERT INTO asset_blacklist(id,user_id,asset_pattern,pattern_type,is_active,reason,created_at,updated_at)
    VALUES(@id,@user_id,@asset_pattern,@pattern_type,@is_active,@reason,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET asset_pattern=excluded.asset_pattern,pattern_type=excluded.pattern_type,
      is_active=excluded.is_active,reason=excluded.reason,updated_at=excluded.updated_at
  `);
  const blockedUpsert = sqlite.prepare(`
    INSERT INTO blocked_assets(id,user_id,trade_mode,symbol,created_at)
    VALUES(@id,@user_id,@trade_mode,@symbol,@created_at)
    ON CONFLICT(id) DO UPDATE SET trade_mode=excluded.trade_mode,symbol=excluded.symbol
  `);
  const pauseUpsert = sqlite.prepare(`
    INSERT INTO pause_configuration(id,user_id,is_enabled,operating_duration_minutes,pause_duration_min_seconds,
      pause_duration_max_seconds,use_technical_analysis_consensus,min_ai_consensus_for_pause,last_pause_started_at,
      last_operating_started_at,is_paused_now,created_at,updated_at)
    VALUES(@id,@user_id,@is_enabled,@operating_duration_minutes,@pause_duration_min_seconds,
      @pause_duration_max_seconds,@use_technical_analysis_consensus,@min_ai_consensus_for_pause,@last_pause_started_at,
      @last_operating_started_at,@is_paused_now,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET is_enabled=excluded.is_enabled,operating_duration_minutes=excluded.operating_duration_minutes,
      pause_duration_min_seconds=excluded.pause_duration_min_seconds,pause_duration_max_seconds=excluded.pause_duration_max_seconds,
      use_technical_analysis_consensus=excluded.use_technical_analysis_consensus,min_ai_consensus_for_pause=excluded.min_ai_consensus_for_pause,
      last_pause_started_at=excluded.last_pause_started_at,last_operating_started_at=excluded.last_operating_started_at,
      is_paused_now=excluded.is_paused_now,updated_at=excluded.updated_at
  `);
  const controlUpsert = sqlite.prepare(`
    INSERT INTO trading_control(id,is_paused,paused_by,paused_at,pause_reason,resumed_at,updated_at)
    VALUES(@id,@is_paused,@paused_by,@paused_at,@pause_reason,@resumed_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET is_paused=excluded.is_paused,paused_by=excluded.paused_by,
      paused_at=excluded.paused_at,pause_reason=excluded.pause_reason,resumed_at=excluded.resumed_at,updated_at=excluded.updated_at
  `);

  const transaction = sqlite.transaction(() => {
    for (const row of dailyRows as any[]) dailyUpsert.run({
      id: row.id, user_id: row.userId, date: row.date, opening_balance: row.openingBalance,
      current_balance: row.currentBalance, daily_pnl: row.dailyPnL, total_trades: row.totalTrades ?? 0,
      won_trades: row.wonTrades ?? 0, lost_trades: row.lostTrades ?? 0,
      conservative_operations: row.conservativeOperations ?? 0, is_recovery_active: localValue(row.isRecoveryActive),
      recovery_threshold: row.recoveryThreshold ?? 0.75, max_drawdown: row.maxDrawdown ?? 0,
      recovery_operations: row.recoveryOperations ?? 0, created_at: localValue(row.createdAt), updated_at: localValue(row.updatedAt),
    });
    for (const row of strategies as any[]) strategyUpsert.run({
      id: row.id, user_id: row.userId, strategy_name: row.strategyName, is_active: localValue(row.isActive),
      parameters: row.parameters, success_rate: row.successRate ?? 0, total_recoveries: row.totalRecoveries ?? 0,
      avg_recovery_time: row.avgRecoveryTime ?? 0, created_at: localValue(row.createdAt), updated_at: localValue(row.updatedAt),
    });
    for (const row of blacklistRows as any[]) blacklistUpsert.run({
      id: row.id, user_id: row.userId, asset_pattern: row.assetPattern, pattern_type: row.patternType,
      is_active: localValue(row.isActive), reason: row.reason, created_at: localValue(row.createdAt), updated_at: localValue(row.updatedAt),
    });
    for (const row of blockedRows as any[]) blockedUpsert.run({
      id: row.id, user_id: row.userId, trade_mode: row.tradeMode, symbol: row.symbol, created_at: localValue(row.createdAt),
    });
    for (const row of pauseRows as any[]) pauseUpsert.run({
      id: row.id, user_id: row.userId, is_enabled: localValue(row.isEnabled),
      operating_duration_minutes: row.operatingDurationMinutes ?? 15,
      pause_duration_min_seconds: row.pauseDurationMinSeconds ?? 60,
      pause_duration_max_seconds: row.pauseDurationMaxSeconds ?? 180,
      use_technical_analysis_consensus: localValue(row.useTechnicalAnalysisConsensus),
      min_ai_consensus_for_pause: row.minAIConsensusForPause ?? 0.7,
      last_pause_started_at: localValue(row.lastPauseStartedAt), last_operating_started_at: localValue(row.lastOperatingStartedAt),
      is_paused_now: localValue(row.isPausedNow), created_at: localValue(row.createdAt), updated_at: localValue(row.updatedAt),
    });
    for (const row of controls as any[]) controlUpsert.run({
      id: row.id, is_paused: localValue(row.isPaused), paused_by: row.pausedBy, paused_at: localValue(row.pausedAt),
      pause_reason: row.pauseReason, resumed_at: localValue(row.resumedAt), updated_at: localValue(row.updatedAt),
    });
  });
  transaction();

  return {
    dailyPnL: dailyRows.length, recoveryStrategies: strategies.length, assetBlacklist: blacklistRows.length,
    blockedAssets: blockedRows.length, pauseConfigurations: pauseRows.length, tradingControl: controls.length,
  };
}
