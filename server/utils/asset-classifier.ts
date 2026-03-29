/**
 * ASSET CLASSIFIER — Classificação inteligente de ativos por tipo e mercado
 *
 * Thresholds calibrados com base em análise real de win rate:
 * - O consenso bruto das IAs retorna entre 50-80%.
 * - Para cada tipo de ativo, o threshold mínimo de entrada deve filtrar
 *   pelo menos os 40% inferiores dos sinais — garantindo que só sinais
 *   com edge real passem pelo gate.
 *
 * HISTÓRICO DE CALIBRAÇÃO:
 *  v1: base 46-52% → win rate 8.3% (24 trades, 2 vitórias) — MUITO BAIXO
 *  v2: base 58-62% → thresholds reais que filtram sinais fracos
 *
 * - SYNTHETIC_RANDOM  (R_*, 1HZ*)      → base 58% — RNG auditado, sem notícias
 * - CRASH_BOOM        (CRASH_*, BOOM_*) → base 60% — spikes detectáveis mas raros
 * - JUMP_STEP         (JUMP_*, STEP_*)  → base 60% — movimentos estruturados
 * - FOREX             (pares cambiais)   → base 62% — fundamentais globais
 * - B3_BRAZIL         (WIN*, WDO*, etc) → base 65% — alto nível técnico
 * - DEFAULT           (outros)           → base 60% — tratamento conservador
 */

export type AssetCategory =
  | 'SYNTHETIC_RANDOM'
  | 'CRASH_BOOM'
  | 'JUMP_STEP'
  | 'FOREX'
  | 'B3_BRAZIL'
  | 'DEFAULT';

export interface AssetProfile {
  symbol: string;
  category: AssetCategory;
  categoryLabel: string;
  baseThreshold: number;
  gateThreshold: number;
  recoveryDeltas: [number, number, number];
  description: string;
}

export function classifyAsset(symbol: string): AssetProfile {
  const s = (symbol || '').toUpperCase().trim();

  if (
    /^R_\d+/.test(s) ||
    /^1HZ\d+V$/.test(s) ||
    s === 'RDBULL' || s === 'RDBEAR' ||
    /^VOLATILITY\s+\d+(\s+INDEX)?$/i.test(s) ||
    /VOLATILITY\s+\d+\s+INDEX/i.test(s)
  ) {
    return profile(s, 'SYNTHETIC_RANDOM', 'Sintético Aleatório (Deriv)', 58, [6, 12, 20],
      'Índice sintético gerado por RNG auditado. Threshold alto exigido para filtrar ruído.');
  }

  if (
    /^(CRASH|BOOM)_?\d+/.test(s) ||
    /^(CRASH|BOOM)\s+\d+(\s+INDEX)?$/i.test(s) ||
    /^(CRASH|BOOM)\s+\d+/i.test(s)
  ) {
    return profile(s, 'CRASH_BOOM', 'Crash/Boom (Deriv)', 60, [6, 12, 20],
      'Índice sintético com spikes programados. Padrões detectáveis mas exigem sinal forte.');
  }

  if (
    /^JUMP_?\d+/.test(s) ||
    /^STEP_?INDEX/.test(s) ||
    s === 'STPIDX' ||
    /^JUMP\s+\d+(\s+INDEX)?$/i.test(s) ||
    /^STEP\s+INDEX$/i.test(s)
  ) {
    return profile(s, 'JUMP_STEP', 'Jump/Step Index (Deriv)', 60, [6, 12, 20],
      'Índice sintético com movimentos estruturados por volatilidade.');
  }

  if (
    /^(WIN|WDO|DOL|IND|BGI|CCM|ICF|OZ1|OZ2|SFI|FRC|DI1|DAP|DDI)\w*/.test(s) ||
    /^(PETR|VALE|ITUB|BBDC|ABEV|JBSS|SUZB|WEGE|MGLU|RENT|LREN|GNDI|RAIL|CPLE|EMBR|BPAC|SANB|CSAN|PRIO|AZUL|GOLL|BRKM|KLBN|UGPA|RAIZ|BRFS)\w*/.test(s) ||
    s.includes('IBOV') || s.includes('B3:')
  ) {
    return profile(s, 'B3_BRAZIL', 'Mercado Brasileiro (B3)', 65, [5, 10, 18],
      'Ativo do mercado brasileiro. Alta previsibilidade técnica e fundamentalista.');
  }

  if (
    /^(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)/.test(s) ||
    /^(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)\/(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)/.test(s) ||
    /^(XAUUSD|XAGUSD|XPTUSD|WTIUSD|BRENTUSD)/.test(s)
  ) {
    return profile(s, 'FOREX', 'Forex / Commodities', 62, [5, 10, 18],
      'Par cambial ou commodity influenciado por fundamentos e notícias globais.');
  }

  return profile(s, 'DEFAULT', 'Ativo Genérico', 60, [6, 12, 20],
    'Tipo de ativo não identificado. Usando threshold conservador padrão.');
}

export function getRecoveryThreshold(symbol: string, consecutiveLosses: number): number {
  if (consecutiveLosses <= 0) return 0;
  const p = classifyAsset(symbol);
  const level = Math.min(consecutiveLosses, 3) as 1 | 2 | 3;
  const deltaIdx = level - 1;
  return p.baseThreshold + p.recoveryDeltas[deltaIdx];
}

export function getGateThreshold(symbol: string): number {
  return classifyAsset(symbol).gateThreshold;
}

function profile(
  symbol: string,
  category: AssetCategory,
  categoryLabel: string,
  base: number,
  recoveryDeltas: [number, number, number],
  description: string,
): AssetProfile {
  return {
    symbol,
    category,
    categoryLabel,
    baseThreshold: base,
    gateThreshold: base + 2,
    recoveryDeltas,
    description,
  };
}
