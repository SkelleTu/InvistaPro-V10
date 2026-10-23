/**
 * Independent MT5 mode gates: DEMO may be used for operational validation,
 * while REAL requires a separate explicit production enable flag.
 */
export interface Mt5ProductionBlock {
  status: 503;
  code: "MT5_PRODUCTION_TRADING_DISABLED" | "MT5_DEMO_TRADING_DISABLED" | "MT5_API_TOKEN_NOT_CONFIGURED" | "MT5_ACCOUNT_MODE_BLOCKED";
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
  accountType: "demo" | "real" | "contest" = "real",
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

  if (accountType === "contest") {
    return {
      status: 503,
      code: "MT5_ACCOUNT_MODE_BLOCKED",
      reason: "Contas de competição não são autorizadas para execução pelo Invista Pro.",
      executionEnabled: false,
    };
  }

  if (accountType === "demo") {
    if (String(env.MT5_DEMO_TRADING_ENABLED ?? "true").trim().toLowerCase() === "false") {
      return {
        status: 503,
        code: "MT5_DEMO_TRADING_DISABLED",
        reason: "A entrega de sinais DEMO foi desativada explicitamente no servidor.",
        executionEnabled: false,
      };
    }
    return null;
  }

  if (!isMt5ProductionTradingEnabled(env)) {
    return {
      status: 503,
      code: "MT5_PRODUCTION_TRADING_DISABLED",
      reason: "A entrega de sinais para conta REAL permanece bloqueada. A flag MT5_PRODUCTION_TRADING_ENABLED=true é exigida separadamente.",
      executionEnabled: false,
    };
  }

  return null;
}
