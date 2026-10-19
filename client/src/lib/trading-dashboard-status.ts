export interface BackendActivityEntry {
  time?: string | number | null;
  type?: string;
  message?: string;
}

export interface TradingDashboardStatus {
  schedulerActive?: boolean;
  canExecuteTrades?: boolean;
  tradingBlockers?: string[];
  lastError?: string | null;
  currentPhaseDetail?: string | null;
  activityLog?: BackendActivityEntry[];
  schedulerStatus?: {
    currentPhase?: string | null;
    currentPhaseDetail?: string | null;
    activityLog?: BackendActivityEntry[];
    lastError?: string | null;
    nextCycleAt?: number;
  };
}

export const tradingStatusRefreshOptions = {
  refetchInterval: 3000,
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const;

export function getTradingActivity(status?: TradingDashboardStatus | null) {
  const blockers = status?.tradingBlockers ?? [];
  const errors = [...new Set([status?.lastError, status?.schedulerStatus?.lastError].filter(
    (error): error is string => typeof error === "string" && error.length > 0,
  ))];
  return {
    visible: status != null,
    label: status?.canExecuteTrades === true ? "Operando"
      : blockers.length > 0 || errors.length > 0 ? "Pausado/Bloqueado"
      : status?.schedulerActive === true ? "Bloqueado" : "Pausado",
    phase: status?.schedulerStatus?.currentPhase,
    detail: status?.schedulerStatus?.currentPhaseDetail ?? status?.currentPhaseDetail,
    logs: status?.schedulerStatus?.activityLog ?? status?.activityLog ?? [],
    blockers,
    errors,
  };
}

export interface ExchangeRateResponse {
  success?: boolean;
  rates?: { USD_BRL?: number | null } | null;
}

export function getConfirmedUsdBrl(response?: ExchangeRateResponse | null): number | null {
  const rate = response?.rates?.USD_BRL;
  return response?.success !== false && typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate : null;
}
