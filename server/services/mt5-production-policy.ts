/**
 * Explicit production gate for MT5 BUY/SELL signal delivery.
 *
 * MT5 uses the user's logged-in terminal/account and is distinct from Deriv's
 * ACCU/DIGITDIFF contract policy. Production signals remain fail-closed until
 * the operator enables the feature and configures the EA API token.
 */
export interface Mt5ProductionBlock {
  status: 503;
  code: "MT5_PRODUCTION_TRADING_DISABLED" | "MT5_API_TOKEN_NOT_CONFIGURED";
  reason: string;
  executionEnabled: false;
}

export function isMt5ProductionTradingEnabled(
  env: Pick<NodeJS.ProcessEnv, "MT5_PRODUCTION_TRADING_ENABLED"> = process.env,
): boolean {
  return String(env.MT5_PRODUCTION_TRADING_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function getMt5ProductionBlock(
  apiToken: string | null | undefined,
  env: Pick<NodeJS.ProcessEnv, "NODE_ENV" | "MT5_PRODUCTION_TRADING_ENABLED"> = process.env,
): Mt5ProductionBlock | null {
  if (env.NODE_ENV !== "production") return null;

  if (!isMt5ProductionTradingEnabled(env)) {
    return {
      status: 503,
      code: "MT5_PRODUCTION_TRADING_DISABLED",
      reason: "A entrega de sinais BUY/SELL do MT5 em produção está desativada. Habilite MT5_PRODUCTION_TRADING_ENABLED=true após configurar o MT5 e os limites de risco.",
      executionEnabled: false,
    };
  }

  if (!String(apiToken ?? "").trim()) {
    return {
      status: 503,
      code: "MT5_API_TOKEN_NOT_CONFIGURED",
      reason: "Configure um Token de Segurança no painel MetaTrader e use o mesmo token no Expert Advisor antes de habilitar sinais de produção.",
      executionEnabled: false,
    };
  }

  return null;
}
