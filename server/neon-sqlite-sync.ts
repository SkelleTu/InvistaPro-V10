import { pgDb, pgSchema, isPostgresAvailable } from "./db-postgres";
import { sqlite } from "./db";

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
