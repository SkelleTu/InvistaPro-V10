import { pgDb, pgSchema, isPostgresAvailable } from "./db-postgres";
import { db as sqliteDb, sqlite } from "./db";
import { eq, sql } from "drizzle-orm";
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

/**
 * One-time, additive import of operational records from the legacy local SQLite DB.
 * Neon values win on ID conflicts; legacy data only fills previously empty contract fields. No balance is synthesized and no records are deleted.
 */
export async function backfillOperationalHistoryToNeon(): Promise<{ movements: number; documents: number; trades: number }> {
  if (!isPostgresAvailable || !pgDb) throw new Error("NEON_REQUIRED: Neon indisponível para importar o histórico operacional.");
  const [identity] = await pgDb.select().from(pgSchema.invistaDatabaseIdentity)
    .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));
  if (!identity) throw new Error("NEON_PLATFORM_IDENTITY_MISSING: identidade da base não foi validada.");
  if (identity.operationalBackfillCompletedAt) return { movements: 0, documents: 0, trades: 0 };

  const localUsers = await sqliteDb.select({ id: localSchema.users.id }).from(localSchema.users);
  let movementsImported = 0;
  let documentsImported = 0;
  let tradesImported = 0;

  for (const localUser of localUsers) {
    const [durableUser] = await pgDb.select({ id: pgSchema.users.id }).from(pgSchema.users)
      .where(eq(pgSchema.users.id, localUser.id)).limit(1);
    if (!durableUser) {
      throw new Error("OPERATIONAL_BACKFILL_USER_MISSING: usuário local sem identidade correspondente na Neon; importação interrompida para evitar órfãos.");
    }

    const [movements, documents, trades] = await Promise.all([
      sqliteDb.select().from(localSchema.movimentos).where(eq(localSchema.movimentos.userId, localUser.id)),
      sqliteDb.select().from(localSchema.documentos).where(eq(localSchema.documentos.userId, localUser.id)),
      sqliteDb.select().from(localSchema.tradeOperations).where(eq(localSchema.tradeOperations.userId, localUser.id)),
    ]);

    await pgDb.transaction(async (tx: any) => {
      for (const movement of movements as any[]) {
        const [inserted] = await tx.insert(pgSchema.movimentos).values({
          id: movement.id,
          userId: localUser.id,
          tipo: movement.tipo,
          valor: Number(movement.valor || 0),
          descricao: movement.descricao ?? null,
          pixString: null,
          biometriaVerificada: Boolean(movement.biometriaVerificada),
          createdAt: asDate(movement.createdAt),
        }).onConflictDoNothing().returning({ id: pgSchema.movimentos.id });
        if (inserted) movementsImported++;
      }

      for (const document of documents as any[]) {
        const [inserted] = await tx.insert(pgSchema.documentos).values({
          id: document.id,
          userId: localUser.id,
          tipo: document.tipo,
          arquivo: document.arquivo,
          status: document.status ?? "pendente",
          motivoRejeicao: document.motivoRejeicao ?? null,
          aprovadoPor: document.aprovadoPor ?? null,
          aprovadoEm: asDate(document.aprovadoEm),
          createdAt: asDate(document.createdAt),
          updatedAt: asDate(document.updatedAt),
        }).onConflictDoNothing().returning({ id: pgSchema.documentos.id });
        if (inserted) documentsImported++;
      }

      for (const trade of trades as any[]) {
        const [inserted] = await tx.insert(pgSchema.tradeOperations).values({
          id: trade.id,
          userId: localUser.id,
          derivContractId: trade.derivContractId ?? null,
          symbol: trade.symbol,
          tradeType: trade.tradeType,
          direction: trade.direction,
          amount: Number(trade.amount || 0),
          duration: Number(trade.duration || 0),
          status: trade.status ?? "pending",
          entryPrice: trade.entryPrice ?? null,
          exitPrice: trade.exitPrice ?? null,
          profit: trade.profit ?? null,
          shortcode: trade.shortcode ?? null,
          buyPrice: trade.buyPrice ?? null,
          sellPrice: trade.sellPrice ?? null,
          entryEpoch: trade.entryEpoch ?? null,
          exitEpoch: trade.exitEpoch ?? null,
          contractType: trade.contractType ?? null,
          barrier: trade.barrier ?? null,
          derivStatus: trade.derivStatus ?? null,
          derivProfit: trade.derivProfit ?? null,
          payout: trade.payout ?? null,
          statusChangedAt: asDate(trade.statusChangedAt),
          lastSyncAt: asDate(trade.lastSyncAt),
          syncCount: Number(trade.syncCount || 0),
          aiConsensus: trade.aiConsensus ?? "{}",
          isRecoveryMode: Boolean(trade.isRecoveryMode),
          recoveryMultiplier: trade.recoveryMultiplier ?? 1,
          isConservativeForced: Boolean(trade.isConservativeForced),
          operationMode: trade.operationMode ?? "Operação Ordinária",
          createdAt: asDate(trade.createdAt),
          completedAt: asDate(trade.completedAt),
        }).onConflictDoUpdate({
          target: pgSchema.tradeOperations.id,
          // Neon is authoritative. Backfill only fills fields that were absent
          // before the durable schema was extended; it never replaces a value.
          set: {
            derivContractId: sql`COALESCE(${pgSchema.tradeOperations.derivContractId}, EXCLUDED.deriv_contract_id)`,
            entryPrice: sql`COALESCE(${pgSchema.tradeOperations.entryPrice}, EXCLUDED.entry_price)`,
            exitPrice: sql`COALESCE(${pgSchema.tradeOperations.exitPrice}, EXCLUDED.exit_price)`,
            profit: sql`COALESCE(${pgSchema.tradeOperations.profit}, EXCLUDED.profit)`,
            shortcode: sql`COALESCE(${pgSchema.tradeOperations.shortcode}, EXCLUDED.shortcode)`,
            buyPrice: sql`COALESCE(${pgSchema.tradeOperations.buyPrice}, EXCLUDED.buy_price)`,
            sellPrice: sql`COALESCE(${pgSchema.tradeOperations.sellPrice}, EXCLUDED.sell_price)`,
            entryEpoch: sql`COALESCE(${pgSchema.tradeOperations.entryEpoch}, EXCLUDED.entry_epoch)`,
            exitEpoch: sql`COALESCE(${pgSchema.tradeOperations.exitEpoch}, EXCLUDED.exit_epoch)`,
            contractType: sql`COALESCE(${pgSchema.tradeOperations.contractType}, EXCLUDED.contract_type)`,
            barrier: sql`COALESCE(${pgSchema.tradeOperations.barrier}, EXCLUDED.barrier)`,
            derivStatus: sql`COALESCE(${pgSchema.tradeOperations.derivStatus}, EXCLUDED.deriv_status)`,
            derivProfit: sql`COALESCE(${pgSchema.tradeOperations.derivProfit}, EXCLUDED.deriv_profit)`,
            payout: sql`COALESCE(${pgSchema.tradeOperations.payout}, EXCLUDED.payout)`,
            statusChangedAt: sql`COALESCE(${pgSchema.tradeOperations.statusChangedAt}, EXCLUDED.status_changed_at)`,
            lastSyncAt: sql`COALESCE(${pgSchema.tradeOperations.lastSyncAt}, EXCLUDED.last_sync_at)`,
            syncCount: sql`GREATEST(COALESCE(${pgSchema.tradeOperations.syncCount}, 0), EXCLUDED.sync_count)`,
          },
        }).returning({ id: pgSchema.tradeOperations.id });
        if (inserted) tradesImported++;
      }
    });
  }

  await pgDb.update(pgSchema.invistaDatabaseIdentity)
    .set({ operationalBackfillCompletedAt: new Date() })
    .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));

  console.info("[SQLITE→NEON] Histórico operacional importado sem sobrescrever registros duráveis.", {
    movements: movementsImported, documents: documentsImported, trades: tradesImported,
  });
  return { movements: movementsImported, documents: documentsImported, trades: tradesImported };
}

/** Rehydrates the local engine cache from the durable Neon history after restart. */
export async function restoreOperationalHistoryToSqlite(): Promise<{ movements: number; documents: number; trades: number }> {
  if (!isPostgresAvailable || !pgDb) throw new Error("NEON_REQUIRED: Neon indisponível para restaurar o histórico operacional.");

  const [movements, documents, trades] = await Promise.all([
    pgDb.select().from(pgSchema.movimentos),
    pgDb.select().from(pgSchema.documentos),
    pgDb.select().from(pgSchema.tradeOperations),
  ]);

  const movementUpsert = sqlite.prepare(`
    INSERT INTO movimentos(id,user_id,tipo,valor,descricao,pix_string,biometria_verificada,created_at)
    VALUES(@id,@user_id,@tipo,@valor,@descricao,NULL,@biometria_verificada,@created_at)
    ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo,valor=excluded.valor,descricao=excluded.descricao,
      biometria_verificada=excluded.biometria_verificada,created_at=excluded.created_at
  `);
  const documentUpsert = sqlite.prepare(`
    INSERT INTO documentos(id,user_id,tipo,arquivo,status,motivo_rejeicao,aprovado_por,aprovado_em,created_at,updated_at)
    VALUES(@id,@user_id,@tipo,@arquivo,@status,@motivo_rejeicao,@aprovado_por,@aprovado_em,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo,arquivo=excluded.arquivo,status=excluded.status,
      motivo_rejeicao=excluded.motivo_rejeicao,aprovado_por=excluded.aprovado_por,aprovado_em=excluded.aprovado_em,
      created_at=excluded.created_at,updated_at=excluded.updated_at
  `);
  const tradeUpsert = sqlite.prepare(`
    INSERT INTO trade_operations(
      id,user_id,deriv_contract_id,symbol,trade_type,direction,amount,duration,status,entry_price,exit_price,profit,
      shortcode,buy_price,sell_price,entry_epoch,exit_epoch,contract_type,barrier,deriv_status,deriv_profit,payout,
      status_changed_at,last_sync_at,sync_count,ai_consensus,isRecoveryMode,recovery_multiplier,is_conservative_forced,
      operation_mode,created_at,completed_at
    ) VALUES (
      @id,@user_id,@deriv_contract_id,@symbol,@trade_type,@direction,@amount,@duration,@status,@entry_price,@exit_price,@profit,
      @shortcode,@buy_price,@sell_price,@entry_epoch,@exit_epoch,@contract_type,@barrier,@deriv_status,@deriv_profit,@payout,
      @status_changed_at,@last_sync_at,@sync_count,@ai_consensus,@isRecoveryMode,@recovery_multiplier,@is_conservative_forced,
      @operation_mode,@created_at,@completed_at
    ) ON CONFLICT(id) DO UPDATE SET deriv_contract_id=excluded.deriv_contract_id,status=excluded.status,
      entry_price=excluded.entry_price,exit_price=excluded.exit_price,profit=excluded.profit,shortcode=excluded.shortcode,
      buy_price=excluded.buy_price,sell_price=excluded.sell_price,entry_epoch=excluded.entry_epoch,exit_epoch=excluded.exit_epoch,
      contract_type=excluded.contract_type,barrier=excluded.barrier,deriv_status=excluded.deriv_status,
      deriv_profit=excluded.deriv_profit,payout=excluded.payout,status_changed_at=excluded.status_changed_at,
      last_sync_at=excluded.last_sync_at,sync_count=excluded.sync_count,completed_at=excluded.completed_at
  `);

  const transaction = sqlite.transaction(() => {
    for (const row of movements as any[]) movementUpsert.run({
      id: row.id, user_id: row.userId, tipo: row.tipo, valor: row.valor, descricao: row.descricao,
      biometria_verificada: localValue(row.biometriaVerificada), created_at: localValue(row.createdAt),
    });
    for (const row of documents as any[]) documentUpsert.run({
      id: row.id, user_id: row.userId, tipo: row.tipo, arquivo: row.arquivo, status: row.status,
      motivo_rejeicao: row.motivoRejeicao, aprovado_por: row.aprovadoPor, aprovado_em: localValue(row.aprovadoEm),
      created_at: localValue(row.createdAt), updated_at: localValue(row.updatedAt),
    });
    for (const row of trades as any[]) tradeUpsert.run({
      id: row.id, user_id: row.userId, deriv_contract_id: row.derivContractId, symbol: row.symbol,
      trade_type: row.tradeType, direction: row.direction, amount: row.amount, duration: row.duration,
      status: row.status, entry_price: row.entryPrice, exit_price: row.exitPrice, profit: row.profit,
      shortcode: row.shortcode, buy_price: row.buyPrice, sell_price: row.sellPrice, entry_epoch: row.entryEpoch,
      exit_epoch: row.exitEpoch, contract_type: row.contractType, barrier: row.barrier, deriv_status: row.derivStatus,
      deriv_profit: row.derivProfit, payout: row.payout, status_changed_at: localValue(row.statusChangedAt),
      last_sync_at: localValue(row.lastSyncAt), sync_count: row.syncCount ?? 0, ai_consensus: row.aiConsensus ?? "{}",
      isRecoveryMode: localValue(row.isRecoveryMode), recovery_multiplier: row.recoveryMultiplier ?? 1,
      is_conservative_forced: localValue(row.isConservativeForced), operation_mode: row.operationMode,
      created_at: localValue(row.createdAt), completed_at: localValue(row.completedAt),
    });
  });
  transaction();

  return { movements: movements.length, documents: documents.length, trades: trades.length };
}
