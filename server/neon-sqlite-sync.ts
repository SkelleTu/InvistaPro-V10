import { pgDb, pgSchema, isPostgresAvailable } from "./db-postgres";
import { db as sqliteDb, sqlite } from "./db";
import { DatabaseStorage } from "./storage";
import * as localSchema from "@shared/schema";
import { eq } from "drizzle-orm";
import { createCipheriv, randomBytes } from "crypto";

function toPgDate(value: any): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function encryptLegacyPlainToken(token: string): string {
  if (token.includes(":")) return token;
  const rawKey = process.env.ENCRYPTION_KEY?.trim();
  if (!rawKey || !/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error("ENCRYPTION_KEY válida é obrigatória para migrar tokens legados.");
  }
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(rawKey, "hex"), iv);
  const encrypted = cipher.update(token, "utf8", "hex") + cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
}

/**
 * One-time additive migration for essential records that may exist only in the old local DB.
 * Existing Neon user records always win; local token/config records fill only missing slots/settings.
 * The marker is written only after the whole backfill succeeds. Each user is migrated in a
 * Neon transaction so an interrupted import can safely retry without half-imported accounts.
 */
export async function backfillMissingEssentialDataToNeon(): Promise<{ importedUsers: number; skippedUsers: number }> {
  if (!isPostgresAvailable || !pgDb) throw new Error("NEON_REQUIRED: Neon indisponível para migração essencial.");

  const [identity] = await pgDb.select().from(pgSchema.invistaDatabaseIdentity)
    .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));
  if (!identity) throw new Error("NEON_PLATFORM_IDENTITY_MISSING: identidade da base não foi validada.");
  if (identity.essentialBackfillCompletedAt) return { importedUsers: 0, skippedUsers: 0 };

  const localUsers = await sqliteDb.select().from(localSchema.users);
  const localStorage = new DatabaseStorage();
  let importedUsers = 0;
  let skippedUsers = 0;

  for (const user of localUsers as any[]) {
    // Run the existing legacy-token compatibility migration before classifying token slots.
    // This prevents an old primary token (historically stored with slot_index=0) from being
    // imported as a duplicate Frenetico slot.
    await localStorage.getUserDerivToken(user.id);
    const [localTokens, localConfigs, localModules] = await Promise.all([
      sqliteDb.select().from(localSchema.derivTokens).where(eq(localSchema.derivTokens.userId, user.id)),
      sqliteDb.select().from(localSchema.tradeConfigurations).where(eq(localSchema.tradeConfigurations.userId, user.id)),
      sqliteDb.select().from(localSchema.modalityModuleConfigs).where(eq(localSchema.modalityModuleConfigs.userId, user.id)),
    ]);

    const outcome = await pgDb.transaction(async (tx: any) => {
      const [byId] = await tx.select().from(pgSchema.users).where(eq(pgSchema.users.id, user.id));
      const [byEmail] = await tx.select().from(pgSchema.users).where(eq(pgSchema.users.email, user.email));
      const [byCpf] = await tx.select().from(pgSchema.users).where(eq(pgSchema.users.cpf, user.cpf));
      if (!byId && (byEmail || byCpf)) {
        throw new Error("LOCAL_USER_ID_CONFLICT: existe uma conta local com identificador diferente da conta durável na Neon; backfill interrompido para evitar misturar identidades.");
      }

      let targetUserId = byId?.id as string | undefined;
      let insertedUser = false;
      if (!byId) {
        const userValues: any = {
          ...user,
          createdAt: toPgDate(user.createdAt),
          updatedAt: toPgDate(user.updatedAt),
          codigoExpiresAt: toPgDate(user.codigoExpiresAt),
          passwordResetTokenExpiresAt: toPgDate(user.passwordResetTokenExpiresAt),
          aprovadaEm: toPgDate(user.aprovadaEm),
          documentosAprovadosEm: toPgDate(user.documentosAprovadosEm),
          depositoData: toPgDate(user.depositoData),
          telefoneVerificado: Boolean(user.telefoneVerificado),
          contaAprovada: Boolean(user.contaAprovada),
          documentosVerificados: Boolean(user.documentosVerificados),
          isAdmin: Boolean(user.isAdmin),
          usarSenhaFallback: Boolean(user.usarSenhaFallback),
          biometriaConfigurada: Boolean(user.biometriaConfigurada),
          rendimentoSaqueAutomatico: Boolean(user.rendimentoSaqueAutomatico),
        };
        const [inserted] = await tx.insert(pgSchema.users).values(userValues).onConflictDoNothing().returning();
        if (!inserted) {
          throw new Error("LOCAL_USER_IMPORT_CONFLICT: conta local não pôde ser migrada sem colisão de identidade.");
        }
        targetUserId = inserted.id;
        insertedUser = true;
      }
      if (!targetUserId) throw new Error("LOCAL_USER_IMPORT_FAILED: ID de usuário ausente durante a migração.");

      // Import only missing token slots. Any existing Neon row, including an inactive row,
      // is authoritative and must not be resurrected from a stale local copy.
      const neonTokens = await tx.select().from(pgSchema.derivTokens)
        .where(eq(pgSchema.derivTokens.userId, targetUserId));
      for (const token of localTokens as any[]) {
        const slotIndex = token.slotIndex ?? null;
        if (neonTokens.some((row: any) => (row.slotIndex ?? null) === slotIndex)) continue;
        await tx.insert(pgSchema.derivTokens).values({
          id: token.id, userId: targetUserId, token: encryptLegacyPlainToken(String(token.token)),
          accountType: token.accountType, isActive: Boolean(token.isActive), slotIndex,
          createdAt: toPgDate(token.createdAt), updatedAt: toPgDate(token.updatedAt),
        }).onConflictDoNothing();
        neonTokens.push({ slotIndex } as any);
      }

      // Current strategy settings are essential, but old/inactive config history is not.
      const neonConfigs = await tx.select().from(pgSchema.tradeConfigurations)
        .where(eq(pgSchema.tradeConfigurations.userId, targetUserId));
      if (!neonConfigs.some((row: any) => Boolean(row.isActive))) {
        const existingConfigIds = new Set(neonConfigs.map((row: any) => row.id));
        const localActiveConfig = (localConfigs as any[])
          .filter(row => Boolean(row.isActive) && !existingConfigIds.has(row.id))
          .sort((a, b) => (toPgDate(b.updatedAt)?.getTime() ?? 0) - (toPgDate(a.updatedAt)?.getTime() ?? 0))
          .slice(0, 1);
        for (const config of localActiveConfig) {
          await tx.insert(pgSchema.tradeConfigurations).values({
            ...config, userId: targetUserId,
            createdAt: toPgDate(config.createdAt), updatedAt: toPgDate(config.updatedAt),
            isActive: true, enableMartingale: Boolean(config.enableMartingale),
            enableLeverage: Boolean(config.enableLeverage), enableCircuitBreaker: Boolean(config.enableCircuitBreaker),
            enableRecoveryMode: Boolean(config.enableRecoveryMode),
          }).onConflictDoNothing();
        }
      }

      const neonModules = await tx.select().from(pgSchema.modalityModuleConfigs)
        .where(eq(pgSchema.modalityModuleConfigs.userId, targetUserId));
      const existingModalities = new Set(neonModules.map((row: any) => row.modality));
      for (const moduleConfig of localModules as any[]) {
        if (existingModalities.has(moduleConfig.modality)) continue;
        await tx.insert(pgSchema.modalityModuleConfigs).values({
          id: moduleConfig.id, userId: targetUserId, modality: moduleConfig.modality,
          slotConfigs: moduleConfig.slotConfigs ?? "[]", updatedAt: toPgDate(moduleConfig.updatedAt),
        }).onConflictDoNothing();
        existingModalities.add(moduleConfig.modality);
      }
      return { insertedUser };
    });
    if (outcome.insertedUser) importedUsers++;
    else skippedUsers++;
  }

  await pgDb.update(pgSchema.invistaDatabaseIdentity)
    .set({ essentialBackfillCompletedAt: new Date() })
    .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));

  console.info("[SQLITE→NEON] Migração aditiva de dados essenciais concluída", { importedUsers, skippedUsers });
  return { importedUsers, skippedUsers };
}

/**
 * Restore only durable configuration/identity data from Neon to the local SQLite cache.
 * Trading history, market ticks, AI logs, and websocket events are deliberately excluded.
 * Existing local-only data is not uploaded or deleted by this routine.
 */
function localValue(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? null;
}

export async function restoreEssentialDataToSqlite(): Promise<{ users: number; tokens: number; configs: number; moduleConfigs: number }> {
  if (!isPostgresAvailable || !pgDb) {
    throw new Error("NEON_REQUIRED: não é possível restaurar os dados essenciais sem a Neon.");
  }

  const [users, tokens, configs, moduleConfigs] = await Promise.all([
    pgDb.select().from(pgSchema.users),
    pgDb.select().from(pgSchema.derivTokens),
    pgDb.select().from(pgSchema.tradeConfigurations),
    pgDb.select().from(pgSchema.modalityModuleConfigs),
  ]);

  if (tokens.length > 0 && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY?.trim() ?? "")) {
    throw new Error("ENCRYPTION_KEY inválida ou ausente: não é seguro restaurar tokens Deriv criptografados.");
  }

  const userUpsert = sqlite.prepare(`
    INSERT INTO users (
      id,email,password_hash,nome_completo,cpf,telefone,endereco,cidade,estado,cep,chave_pix,tipo_chave_pix,
      telefone_verificado,codigo_verificacao,codigo_expires_at,password_reset_token,password_reset_token_expires_at,
      conta_aprovada,aprovada_por,aprovada_em,documentos_verificados,documentos_aprovados_em,is_admin,
      senha_fallback,usar_senha_fallback,biometria_configurada,saldo,deposito_data,rendimento_saque_automatico,created_at,updated_at
    ) VALUES (
      @id,@email,@password_hash,@nome_completo,@cpf,@telefone,@endereco,@cidade,@estado,@cep,@chave_pix,@tipo_chave_pix,
      @telefone_verificado,@codigo_verificacao,@codigo_expires_at,@password_reset_token,@password_reset_token_expires_at,
      @conta_aprovada,@aprovada_por,@aprovada_em,@documentos_verificados,@documentos_aprovados_em,@is_admin,
      @senha_fallback,@usar_senha_fallback,@biometria_configurada,@saldo,@deposito_data,@rendimento_saque_automatico,@created_at,@updated_at
    ) ON CONFLICT(id) DO UPDATE SET
      email=excluded.email,password_hash=excluded.password_hash,nome_completo=excluded.nome_completo,cpf=excluded.cpf,
      telefone=excluded.telefone,endereco=excluded.endereco,cidade=excluded.cidade,estado=excluded.estado,cep=excluded.cep,
      chave_pix=excluded.chave_pix,tipo_chave_pix=excluded.tipo_chave_pix,telefone_verificado=excluded.telefone_verificado,
      codigo_verificacao=excluded.codigo_verificacao,codigo_expires_at=excluded.codigo_expires_at,
      password_reset_token=excluded.password_reset_token,password_reset_token_expires_at=excluded.password_reset_token_expires_at,
      conta_aprovada=excluded.conta_aprovada,aprovada_por=excluded.aprovada_por,aprovada_em=excluded.aprovada_em,
      documentos_verificados=excluded.documentos_verificados,documentos_aprovados_em=excluded.documentos_aprovados_em,
      is_admin=excluded.is_admin,senha_fallback=excluded.senha_fallback,usar_senha_fallback=excluded.usar_senha_fallback,
      biometria_configurada=excluded.biometria_configurada,saldo=excluded.saldo,deposito_data=excluded.deposito_data,
      rendimento_saque_automatico=excluded.rendimento_saque_automatico,updated_at=excluded.updated_at
  `);

  const tokenUpsert = sqlite.prepare(`
    INSERT INTO deriv_tokens(id,user_id,token,account_type,is_active,slot_index,created_at,updated_at)
    VALUES(@id,@user_id,@token,@account_type,@is_active,@slot_index,@created_at,@updated_at)
    ON CONFLICT(id) DO UPDATE SET token=excluded.token,account_type=excluded.account_type,is_active=excluded.is_active,
      slot_index=excluded.slot_index,updated_at=excluded.updated_at
  `);

  const configUpsert = sqlite.prepare(`
    INSERT INTO trade_configurations(
      id,user_id,mode,is_active,operations_count,interval_type,interval_value,selected_modalities,accu_growth_rates,
      modality_frequency,accu_ticks_per_rate,accu_frequency_per_rate,modality_ticks,enable_martingale,enable_leverage,
      enable_circuit_breaker,enable_recovery_mode,martingale_multipliers,circuit_breaker_losses,circuit_breaker_pause_minutes,
      stake_mode,fixed_stake,created_at,updated_at
    ) VALUES (
      @id,@user_id,@mode,@is_active,@operations_count,@interval_type,@interval_value,@selected_modalities,@accu_growth_rates,
      @modality_frequency,@accu_ticks_per_rate,@accu_frequency_per_rate,@modality_ticks,@enable_martingale,@enable_leverage,
      @enable_circuit_breaker,@enable_recovery_mode,@martingale_multipliers,@circuit_breaker_losses,@circuit_breaker_pause_minutes,
      @stake_mode,@fixed_stake,@created_at,@updated_at
    ) ON CONFLICT(id) DO UPDATE SET
      mode=excluded.mode,is_active=excluded.is_active,operations_count=excluded.operations_count,interval_type=excluded.interval_type,
      interval_value=excluded.interval_value,selected_modalities=excluded.selected_modalities,accu_growth_rates=excluded.accu_growth_rates,
      modality_frequency=excluded.modality_frequency,accu_ticks_per_rate=excluded.accu_ticks_per_rate,
      accu_frequency_per_rate=excluded.accu_frequency_per_rate,modality_ticks=excluded.modality_ticks,
      enable_martingale=excluded.enable_martingale,enable_leverage=excluded.enable_leverage,
      enable_circuit_breaker=excluded.enable_circuit_breaker,enable_recovery_mode=excluded.enable_recovery_mode,
      martingale_multipliers=excluded.martingale_multipliers,circuit_breaker_losses=excluded.circuit_breaker_losses,
      circuit_breaker_pause_minutes=excluded.circuit_breaker_pause_minutes,stake_mode=excluded.stake_mode,
      fixed_stake=excluded.fixed_stake,updated_at=excluded.updated_at
  `);

  const moduleConfigUpsert = sqlite.prepare(`
    INSERT INTO modality_module_configs(id,user_id,modality,slot_configs,updated_at)
    VALUES(@id,@user_id,@modality,@slot_configs,@updated_at)
    ON CONFLICT(id) DO UPDATE SET slot_configs=excluded.slot_configs,updated_at=excluded.updated_at
  `);

  const transaction = sqlite.transaction(() => {
    for (const u of users as any[]) {
      userUpsert.run({
        id:u.id,email:u.email,password_hash:u.passwordHash,nome_completo:u.nomeCompleto,cpf:u.cpf,telefone:u.telefone,
        endereco:u.endereco,cidade:u.cidade,estado:u.estado,cep:u.cep,chave_pix:u.chavePix,tipo_chave_pix:u.tipoChavePix,
        telefone_verificado:localValue(u.telefoneVerificado),codigo_verificacao:u.codigoVerificacao,
        codigo_expires_at:localValue(u.codigoExpiresAt),password_reset_token:u.passwordResetToken,
        password_reset_token_expires_at:localValue(u.passwordResetTokenExpiresAt),conta_aprovada:localValue(u.contaAprovada),
        aprovada_por:u.aprovadaPor,aprovada_em:localValue(u.aprovadaEm),documentos_verificados:localValue(u.documentosVerificados),
        documentos_aprovados_em:localValue(u.documentosAprovadosEm),is_admin:localValue(u.isAdmin),senha_fallback:u.senhaFallback,
        usar_senha_fallback:localValue(u.usarSenhaFallback),biometria_configurada:localValue(u.biometriaConfigurada),
        saldo:u.saldo ?? 0,deposito_data:localValue(u.depositoData),rendimento_saque_automatico:localValue(u.rendimentoSaqueAutomatico),
        created_at:localValue(u.createdAt),updated_at:localValue(u.updatedAt)
      });
    }
    // Reconcile canonical per-user token/config snapshots before rehydrating them.
    // Only users present in Neon are reconciled; trade history and transient tables are untouched.
    for (const u of users as any[]) {
      sqlite.prepare("DELETE FROM deriv_tokens WHERE user_id = ?").run(u.id);
      sqlite.prepare("DELETE FROM trade_configurations WHERE user_id = ?").run(u.id);
      sqlite.prepare("DELETE FROM modality_module_configs WHERE user_id = ?").run(u.id);
    }
    for (const t of tokens as any[]) {
      tokenUpsert.run({id:t.id,user_id:t.userId,token:t.token,account_type:t.accountType,is_active:localValue(t.isActive),
        slot_index:t.slotIndex ?? null,created_at:localValue(t.createdAt),updated_at:localValue(t.updatedAt)});
    }
    for (const c of configs as any[]) {
      configUpsert.run({
        id:c.id,user_id:c.userId,mode:c.mode,is_active:localValue(c.isActive),operations_count:c.operationsCount,
        interval_type:c.intervalType,interval_value:c.intervalValue,selected_modalities:c.selectedModalities ?? "digit_differs",
        accu_growth_rates:c.accuGrowthRates ?? '["1","2","3","4","5"]',modality_frequency:c.modalityFrequency ?? "{}",
        accu_ticks_per_rate:c.accuTicksPerRate ?? '{"1":10,"2":7,"3":5,"4":4,"5":3}',
        accu_frequency_per_rate:c.accuFrequencyPerRate ?? "{}",modality_ticks:c.modalityTicks ?? "{}",
        enable_martingale:localValue(c.enableMartingale ?? true),enable_leverage:localValue(c.enableLeverage ?? true),
        enable_circuit_breaker:localValue(c.enableCircuitBreaker ?? true),enable_recovery_mode:localValue(c.enableRecoveryMode ?? true),
        martingale_multipliers:c.martingaleMultipliers ?? "[1.3,1.6,2.0]",circuit_breaker_losses:c.circuitBreakerLosses ?? 1,
        circuit_breaker_pause_minutes:c.circuitBreakerPauseMinutes ?? 2,stake_mode:c.stakeMode ?? "ai",fixed_stake:c.fixedStake ?? 0.35,
        created_at:localValue(c.createdAt),updated_at:localValue(c.updatedAt)
      });
    }
    for (const m of moduleConfigs as any[]) {
      moduleConfigUpsert.run({id:m.id,user_id:m.userId,modality:m.modality,slot_configs:m.slotConfigs ?? "[]",updated_at:localValue(m.updatedAt)});
    }
  });
  transaction();

  console.info("[NEON→SQLITE] Restauração essencial concluída", {
    users: users.length, tokens: tokens.length, configs: configs.length, moduleConfigs: moduleConfigs.length
  });
  return { users: users.length, tokens: tokens.length, configs: configs.length, moduleConfigs: moduleConfigs.length };
}
