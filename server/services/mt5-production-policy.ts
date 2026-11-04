/**
 * MT5 account-mode policy.
 * DEMO and REAL share the same execution path. The connected terminal is the
 * source of truth for account mode; only contest/unknown modes are rejected.
 * MT5_PRODUCTION_TRADING_ENABLED=false is a global emergency stop for BOTH modes.
 */
export interface Mt5ProductionBlock {
  status: 503;
  code: "MT5_PRODUCTION_TRADING_DISABLED" | "MT5_API_TOKEN_NOT_CONFIGURED" | "MT5_ACCOUNT_MODE_BLOCKED";
  reason: string;
  executionEnabled: false;
}

export interface Mt5ProductionEnvironment {
  MT5_PRODUCTION_TRADING_ENABLED?: string;
  MT5_DEMO_TRADING_ENABLED?: string;
  NODE_ENV?: string;
}

export function isMt5ProductionTradingEnabled(
  env: Mt5ProductionEnvironment = process.env,
): boolean {
  return String(env.MT5_PRODUCTION_TRADING_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function getMt5ProductionBlock(
  apiToken: string | null | undefined,
  env: Mt5ProductionEnvironment = process.env,
  accountType: "demo" | "real" | "contest" = "demo",
  _legacyRealTradingAuthorized?: boolean,
): Mt5ProductionBlock | null {
  if (env.NODE_ENV !== "production") return null;

  if (!String(apiToken ?? "").trim()) {
    return {
      status: 503,
      code: "MT5_API_TOKEN_NOT_CONFIGURED",
      reason: "Configure um Token de Segurança no painel MetaTrader e use o mesmo token no Expert Advisor.",
      executionEnabled: false,
    };
  }

  if (accountType !== "demo" && accountType !== "real") {
    return {
      status: 503,
      code: "MT5_ACCOUNT_MODE_BLOCKED",
      reason: "O terminal MT5 precisa confirmar uma conta DEMO ou REAL válida.",
      executionEnabled: false,
    };
  }

  // This is a single emergency stop, deliberately independent of account mode.
  if (String(env.MT5_PRODUCTION_TRADING_ENABLED ?? "").trim().toLowerCase() === "false") {
    return {
      status: 503,
      code: "MT5_PRODUCTION_TRADING_DISABLED",
      reason: "A execução MT5 foi interrompida pelo interruptor global de emergência.",
      executionEnabled: false,
    };
  }

  return null;
}
