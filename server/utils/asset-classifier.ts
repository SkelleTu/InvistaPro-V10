/**
 * ASSET CLASSIFIER — Classificação inteligente de ativos por tipo e mercado
 *
 * Cada tipo de ativo tem características próprias que determinam o ceiling realístico
 * de previsão de IAs. O threshold mínimo de consenso é calibrado por tipo:
 *
 * - SYNTHETIC_RANDOM  (R_*, 1HZ*)    → base 60% — gerados por RNG auditado, sem notícias
 * - CRASH_BOOM        (CRASH_*, BOOM_*) → base 62% — padrões de spike detectáveis
 * - JUMP_STEP         (JUMP_*, STEP_*) → base 62% — movimentos estruturados por parâmetro
 * - FOREX             (pares cambiais)  → base 65% — influenciados por fundamentais globais
 * - B3_BRAZIL         (WIN*, WDO*, etc) → base 70% — mercado técnico com alta previsibilidade
 * - DEFAULT           (outros)          → base 63% — tratamento conservador desconhecido
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
  baseThreshold: number;       // threshold mínimo base para entrar (sem recovery)
  gateThreshold: number;       // threshold do gate principal (base + margem)
  recoveryDeltas: [number, number, number]; // adicionais por streak 1/2/3+ perdas
  description: string;
}

/**
 * Classifica o símbolo e retorna o perfil completo do ativo.
 */
export function classifyAsset(symbol: string): AssetProfile {
  const s = (symbol || '').toUpperCase().trim();

  // ── Sintéticos Aleatórios Deriv ──────────────────────────────────────────
  // Códigos: R_10, R_25, R_50, R_75, R_100 e variantes com 1HZ
  // Nomes completos: "Volatility 10 Index", "Volatility 75 Index", etc.
  if (
    /^R_\d+/.test(s) ||
    /^1HZ\d+V$/.test(s) ||
    s === 'RDBULL' || s === 'RDBEAR' ||
    /^VOLATILITY\s+\d+(\s+INDEX)?$/i.test(s) ||
    /VOLATILITY\s+\d+\s+INDEX/i.test(s)
  ) {
    return profile(s, 'SYNTHETIC_RANDOM', 'Sintético Aleatório (Deriv)', 60, [2, 8, 15],
      'Índice sintético gerado por RNG auditado. Sem influência de notícias externas.');
  }

  // ── Crash & Boom ──────────────────────────────────────────────────────────
  // Códigos: CRASH_300, BOOM_500, etc. | Nomes: "Crash 50 Index", "Boom 100 Index"
  if (
    /^(CRASH|BOOM)_?\d+/.test(s) ||
    /^(CRASH|BOOM)\s+\d+(\s+INDEX)?$/i.test(s) ||
    /^(CRASH|BOOM)\s+\d+/i.test(s)
  ) {
    return profile(s, 'CRASH_BOOM', 'Crash/Boom (Deriv)', 62, [2, 8, 15],
      'Índice sintético com spikes programados. Padrões detectáveis mas raros.');
  }

  // ── Jump & Step ───────────────────────────────────────────────────────────
  // Códigos: JUMP_10, STEP_INDEX | Nomes: "Jump 50 Index", "Step Index"
  if (
    /^JUMP_?\d+/.test(s) ||
    /^STEP_?INDEX/.test(s) ||
    s === 'STPIDX' ||
    /^JUMP\s+\d+(\s+INDEX)?$/i.test(s) ||
    /^STEP\s+INDEX$/i.test(s)
  ) {
    return profile(s, 'JUMP_STEP', 'Jump/Step Index (Deriv)', 62, [2, 8, 15],
      'Índice sintético com movimentos estruturados por parâmetro de volatilidade.');
  }

  // ── Ativos Brasileiros B3 ─────────────────────────────────────────────────
  if (
    /^(WIN|WDO|DOL|IND|BGI|CCM|ICF|OZ1|OZ2|SFI|FRC|DI1|DAP|DDI)\w*/.test(s) ||
    /^(PETR|VALE|ITUB|BBDC|ABEV|JBSS|SUZB|WEGE|MGLU|RENT|LREN|GNDI|RAIL|CPLE|EMBR|BPAC|SANB|CSAN|PRIO|AZUL|GOLL|BRKM|KLBN|UGPA|RAIZ|BRFS)\w*/.test(s) ||
    s.includes('IBOV') || s.includes('B3:')
  ) {
    return profile(s, 'B3_BRAZIL', 'Mercado Brasileiro (B3)', 70, [2, 8, 15],
      'Ativo do mercado brasileiro. Alta previsibilidade técnica e fundamentalista.');
  }

  // ── Forex ─────────────────────────────────────────────────────────────────
  if (
    /^(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)/.test(s) ||
    /^(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)\/(EUR|GBP|USD|JPY|CHF|AUD|NZD|CAD)/.test(s) ||
    /^(XAUUSD|XAGUSD|XPTUSD|WTIUSD|BRENTUSD)/.test(s)
  ) {
    return profile(s, 'FOREX', 'Forex / Commodities', 65, [2, 8, 15],
      'Par cambial ou commodity influenciado por fundamentos e notícias globais.');
  }

  // ── Default ───────────────────────────────────────────────────────────────
  return profile(s, 'DEFAULT', 'Ativo Genérico', 63, [2, 8, 15],
    'Tipo de ativo não identificado. Usando threshold conservador padrão.');
}

/**
 * Retorna os thresholds de recovery para um dado streak de perdas e símbolo.
 * streak 0 = fora do recovery (retorna 0)
 */
export function getRecoveryThreshold(symbol: string, consecutiveLosses: number): number {
  if (consecutiveLosses <= 0) return 0;
  const p = classifyAsset(symbol);
  const level = Math.min(consecutiveLosses, 3) as 1 | 2 | 3;
  const deltaIdx = level - 1; // 0, 1, 2
  return p.baseThreshold + p.recoveryDeltas[deltaIdx];
}

/**
 * Retorna o gate threshold (limiar mínimo para entrar num trade) para o símbolo.
 * É base + 2% por padrão em todos os tipos.
 */
export function getGateThreshold(symbol: string): number {
  return classifyAsset(symbol).gateThreshold;
}

// ── Helper interno ─────────────────────────────────────────────────────────
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
    gateThreshold: base + 2, // gate sempre 2% acima da base
    recoveryDeltas,
    description,
  };
}
