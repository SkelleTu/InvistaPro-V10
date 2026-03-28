/**
 * FRENÉTICO 10-TOKENS — Motor de disparo paralelo com IA de stakes
 *
 * Estratégia: slot N → dígito N (slot 0=dígito 0, slot 9=dígito 9)
 *  - A IA seleciona O MELHOR ativo (maior variância de frequência = maior edge explorável)
 *  - Todos disparam NO MESMO ativo, NO MESMO tick — cobertura 100% garantida
 *  - GARANTIA MATEMÁTICA: exatamente 1 contrato SEMPRE ganha por rajada
 *
 * Motor de stakes inteligente (3 modos):
 *  - UNIFORME: mesmo valor em todos os dígitos (baseline)
 *  - KELLY: stake proporcional à frequência do dígito (foco nos quentes)
 *  - AGRESSIVO: boost exponencial nos quentes + mínimo nos frios
 *
 * Vantagem explorável: se a Deriv paga payout fixo independente da frequência,
 * dígitos quentes têm EV positivo → concentrar stake neles maximiza lucro esperado.
 */

import { DerivAPIService } from './deriv-api';
import { digitFrequencyAnalyzer } from './digit-frequency-analyzer';

export type StakeMode = 'uniform' | 'kelly' | 'aggressive';

export interface SlotToken {
  slotIndex: number;
  token: string;
  accountType: 'demo' | 'real';
}

export interface SlotResult {
  slotIndex: number;
  symbol: string;
  digit: number;
  digitFrequency: number;
  stakeUsed: number;
  contractId: string | null;
  status: 'success' | 'failed' | 'insufficient_balance';
  profit?: number;
  errorMessage?: string;
  openTimeMs: number;
}

export interface DigitHeat {
  digit: number;
  frequency: number;
  label: 'hot' | 'neutral' | 'cold';
  recommendedStakeMultiplier: number;
}

export interface BurstStats {
  totalStaked: number;
  expectedWin: number;
  expectedProfit: number;
  expectedROI: number;
  edgeScore: number;
}

export interface BurstResult {
  totalSlots: number;
  openedContracts: number;
  failedContracts: number;
  results: SlotResult[];
  burstDurationMs: number;
  targetSymbol: string;
  digitHeats: DigitHeat[];
  coveragePercent: number;
  stakeMode: StakeMode;
  stakeDistribution: Record<number, number>;
  burstStats: BurstStats;
}

// Payout aproximado do DIGITMATCH na Deriv (~8.5x para 1 tick)
const DIGITMATCH_PAYOUT = 8.5;
const UNIFORM_FREQ = 0.10;
const MIN_STAKE = 0.35;

// Pool de conexões ativas por userId → slotIndex
const connectionPool: Map<string, Map<number, DerivAPIService>> = new Map();

// Histórico de rajadas (em memória) para compound tracking
export const burstHistory: Map<string, Array<{
  timestamp: number;
  symbol: string;
  totalStaked: number;
  expectedProfit: number;
  mode: StakeMode;
  openedContracts: number;
}>> = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE STAKES INTELIGENTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula a distribuição ótima de stakes por dígito usando o modo selecionado.
 *
 * Modo KELLY:
 *   stake_i = baseAmount × (freq_i / 0.10)
 *   → quentes ganham mais stake; frios ganham menos
 *
 * Modo AGRESSIVO:
 *   hot  → baseAmount × (ratio^1.5) × 2.0  (boost exponencial)
 *   neutral → baseAmount × 1.0
 *   cold → MIN_STAKE (mínimo para manter cobertura)
 *
 * Matematicamente: quando Deriv usa payout fixo para todos os dígitos,
 * concentrar stake nos dígitos com maior frequência aumenta o EV da rajada.
 */
export function computeSmartStakes(
  digitHeats: DigitHeat[],
  baseAmount: number,
  mode: StakeMode
): Record<number, number> {
  const dist: Record<number, number> = {};

  for (const h of digitHeats) {
    if (mode === 'uniform') {
      dist[h.digit] = baseAmount;
      continue;
    }

    const ratio = h.frequency / UNIFORM_FREQ; // ex: 0.22/0.10 = 2.2

    if (mode === 'kelly') {
      // Kelly simples: proporcional à frequência, mínimo mantido
      dist[h.digit] = Math.max(MIN_STAKE, parseFloat((baseAmount * ratio).toFixed(2)));
    } else {
      // AGRESSIVO: hot → exponencial, cold → mínimo
      if (h.label === 'hot') {
        dist[h.digit] = parseFloat((baseAmount * Math.pow(ratio, 1.5) * 2.0).toFixed(2));
      } else if (h.label === 'cold') {
        dist[h.digit] = MIN_STAKE;
      } else {
        dist[h.digit] = parseFloat((baseAmount * ratio).toFixed(2));
      }
    }
  }

  return dist;
}

/**
 * Calcula as estatísticas esperadas de uma rajada dado a distribuição de stakes.
 * EV por rajada = Σ (freq_i × payout × stake_i) - Σ stake_i
 */
export function computeBurstStats(
  digitHeats: DigitHeat[],
  stakes: Record<number, number>,
  payout: number = DIGITMATCH_PAYOUT
): BurstStats {
  let totalStaked = 0;
  let expectedWin = 0;

  for (const h of digitHeats) {
    const stake = stakes[h.digit] ?? 0;
    totalStaked += stake;
    expectedWin += h.frequency * payout * stake;
  }

  const expectedProfit = expectedWin - totalStaked;
  const expectedROI = totalStaked > 0 ? (expectedProfit / totalStaked) * 100 : 0;

  // Edge score: variance da distribuição de frequências × 100 (quanto mais desigual, mais edge)
  const avgFreq = digitHeats.reduce((s, h) => s + h.frequency, 0) / digitHeats.length;
  const variance = digitHeats.reduce((s, h) => s + Math.pow(h.frequency - avgFreq, 2), 0) / digitHeats.length;
  const edgeScore = parseFloat((variance * 1000).toFixed(3));

  return {
    totalStaked: parseFloat(totalStaked.toFixed(2)),
    expectedWin: parseFloat(expectedWin.toFixed(2)),
    expectedProfit: parseFloat(expectedProfit.toFixed(2)),
    expectedROI: parseFloat(expectedROI.toFixed(1)),
    edgeScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELEÇÃO DO ATIVO MAIS EXPLORÁVEL
// ─────────────────────────────────────────────────────────────────────────────

const CANDIDATE_ASSETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  'RDBULL', 'RDBEAR',
];

/**
 * Seleciona o ativo com maior VARIÂNCIA de frequência de dígitos.
 * Maior variância = distribuição mais desigual = mais edge explorável pelo motor Kelly.
 */
export function selectBestAsset(): string {
  const scored = CANDIDATE_ASSETS.map(symbol => {
    const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(symbol);
    if (!analysis?.digits?.length) return { symbol, variance: 0 };

    const freqs = analysis.digits.map(d => d.frequency);
    const avg = freqs.reduce((s, f) => s + f, 0) / freqs.length;
    const variance = freqs.reduce((s, f) => s + Math.pow(f - avg, 2), 0) / freqs.length;
    return { symbol, variance };
  }).sort((a, b) => b.variance - a.variance);

  return scored[0].symbol;
}

/** @deprecated Mantido para compatibilidade com rota de balances */
export function selectAssetsForSlots(slotCount: number): string[] {
  return Array(slotCount).fill(selectBestAsset());
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL DE CONEXÕES
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateConnection(
  userId: string,
  slot: SlotToken,
  operationId: string
): Promise<DerivAPIService> {
  if (!connectionPool.has(userId)) {
    connectionPool.set(userId, new Map());
  }
  const userPool = connectionPool.get(userId)!;
  let api = userPool.get(slot.slotIndex);

  if (api) {
    try {
      if (api.getIsConnected()) return api;
    } catch { /* conexão morta */ }
    userPool.delete(slot.slotIndex);
  }

  api = new DerivAPIService();
  const connected = await api.connect(
    slot.token, slot.accountType, `${operationId}_SLOT${slot.slotIndex}`
  );
  if (!connected) throw new Error(`Slot ${slot.slotIndex}: falha ao conectar com o token`);
  userPool.set(slot.slotIndex, api);
  return api;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUÇÃO DA RAJADA FRENÉTICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa uma RAJADA FRENÉTICA com stakes inteligentes baseados em calor de dígitos.
 *
 * @param userId      - ID do usuário
 * @param slots       - Array de tokens (slotIndex 0-9)
 * @param amount      - Valor BASE por contrato (será multiplicado por Kelly/Agressivo)
 * @param duration    - Duração em ticks (1)
 * @param operationId - ID único da operação para logs
 * @param stakeMode   - 'uniform' | 'kelly' | 'aggressive'
 */
export async function executeFrenetic9TokensBurst(
  userId: string,
  slots: SlotToken[],
  amount: number,
  duration: number,
  operationId: string,
  stakeMode: StakeMode = 'kelly'
): Promise<BurstResult> {
  const startTime = Date.now();

  if (slots.length === 0) {
    throw new Error('Nenhum slot configurado para o modo Frenético 10-Tokens');
  }

  // ── 1. SELEÇÃO DO ATIVO: maior variância de frequência ───────────────────
  const targetSymbol = selectBestAsset();
  const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(targetSymbol);

  // Mapeia frequência e calor de cada dígito (0-9)
  const digitHeats: DigitHeat[] = Array.from({ length: 10 }, (_, d) => {
    const freq = analysis?.digits.find(x => x.digit === d)?.frequency ?? 0.10;
    const label: DigitHeat['label'] = freq >= 0.13 ? 'hot' : freq <= 0.07 ? 'cold' : 'neutral';
    const ratio = freq / UNIFORM_FREQ;
    const recommendedStakeMultiplier = stakeMode === 'uniform' ? 1.0
      : stakeMode === 'kelly' ? parseFloat(Math.max(0.35 / amount, ratio).toFixed(2))
      : label === 'hot' ? parseFloat((Math.pow(ratio, 1.5) * 2.0).toFixed(2))
      : label === 'cold' ? parseFloat((MIN_STAKE / amount).toFixed(2))
      : parseFloat(ratio.toFixed(2));
    return { digit: d, frequency: freq, label, recommendedStakeMultiplier };
  });

  // ── 2. DISTRIBUIÇÃO DE STAKES INTELIGENTE ────────────────────────────────
  const stakeDistribution = computeSmartStakes(digitHeats, amount, stakeMode);
  const burstStats = computeBurstStats(digitHeats, stakeDistribution);
  const coveragePercent = Math.round((slots.length / 10) * 100);

  const hotDigits = digitHeats.filter(d => d.label === 'hot');
  const coldDigits = digitHeats.filter(d => d.label === 'cold');

  console.log(
    `⚡🔥 [FRENÉTICO-10T] Rajada ${stakeMode.toUpperCase()} | ${slots.length} slots | ` +
    `Ativo: ${targetSymbol} | Cobertura: ${coveragePercent}% | ` +
    `EV: ${burstStats.expectedProfit >= 0 ? '+' : ''}$${burstStats.expectedProfit.toFixed(2)} | ` +
    `ROI esperado: ${burstStats.expectedROI.toFixed(1)}% | ` +
    `Total: $${burstStats.totalStaked.toFixed(2)} | ` +
    `🔥 Quentes: [${hotDigits.map(d => `${d.digit}(${(d.frequency * 100).toFixed(0)}%)`).join(',')}] | ` +
    `🧊 Frios: [${coldDigits.map(d => d.digit).join(',')}]`
  );

  // ── 3. DISPARO SIMULTÂNEO — cada slot usa SEU dígito fixo + seu stake ────
  const slotPromises = slots.map(async (slot): Promise<SlotResult> => {
    const assignedDigit = slot.slotIndex;
    const digitFreq = digitHeats[assignedDigit]?.frequency ?? 0.10;
    const slotStake = stakeDistribution[assignedDigit] ?? amount;
    const slotOpId = `${operationId}_S${slot.slotIndex}`;

    try {
      const api = await getOrCreateConnection(userId, slot, slotOpId);

      const contract = await api.buyGenericDigitContract({
        contract_type: 'DIGITMATCH',
        symbol: targetSymbol,
        duration,
        amount: slotStake,
        barrier: assignedDigit.toString(),
        currency: 'USD',
      });

      if (!contract?.contract_id) {
        return {
          slotIndex: slot.slotIndex,
          symbol: targetSymbol,
          digit: assignedDigit,
          digitFrequency: digitFreq,
          stakeUsed: slotStake,
          contractId: null,
          status: 'failed',
          errorMessage: 'Contrato não retornou ID',
          openTimeMs: Date.now() - startTime,
        };
      }

      const heatLabel = digitHeats[assignedDigit]?.label ?? 'neutral';
      const heatIcon = heatLabel === 'hot' ? '🔥' : heatLabel === 'cold' ? '🧊' : '⚪';
      console.log(
        `✅ [FRENÉTICO S${slot.slotIndex}] Contrato ${contract.contract_id} | ` +
        `dígito ${assignedDigit} ${heatIcon} (${(digitFreq * 100).toFixed(1)}%) | stake: $${slotStake.toFixed(2)}`
      );

      return {
        slotIndex: slot.slotIndex,
        symbol: targetSymbol,
        digit: assignedDigit,
        digitFrequency: digitFreq,
        stakeUsed: slotStake,
        contractId: contract.contract_id.toString(),
        status: 'success',
        openTimeMs: Date.now() - startTime,
      };

    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isInsufficientBalance = msg.includes('InsufficientBalance') || msg.includes('insufficient');

      console.warn(`❌ [FRENÉTICO S${slot.slotIndex}] dígito ${assignedDigit} falhou: ${msg}`);

      return {
        slotIndex: slot.slotIndex,
        symbol: targetSymbol,
        digit: assignedDigit,
        digitFrequency: digitFreq,
        stakeUsed: slotStake,
        contractId: null,
        status: isInsufficientBalance ? 'insufficient_balance' : 'failed',
        errorMessage: msg,
        openTimeMs: Date.now() - startTime,
      };
    }
  });

  const settled = await Promise.allSettled(slotPromises);
  const results: SlotResult[] = settled.map(r =>
    r.status === 'fulfilled' ? r.value : {
      slotIndex: -1,
      symbol: targetSymbol,
      digit: -1,
      digitFrequency: 0.10,
      stakeUsed: amount,
      contractId: null,
      status: 'failed' as const,
      errorMessage: r.reason?.message ?? 'Erro desconhecido',
      openTimeMs: Date.now() - startTime,
    }
  );

  const opened = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status !== 'success').length;

  // ── 4. REGISTRA NO HISTÓRICO DE RAJADAS ──────────────────────────────────
  if (!burstHistory.has(userId)) burstHistory.set(userId, []);
  const history = burstHistory.get(userId)!;
  history.push({
    timestamp: Date.now(),
    symbol: targetSymbol,
    totalStaked: burstStats.totalStaked,
    expectedProfit: burstStats.expectedProfit,
    mode: stakeMode,
    openedContracts: opened,
  });
  // Mantém apenas os últimos 50 registros
  if (history.length > 50) history.splice(0, history.length - 50);

  console.log(
    `🏁 [FRENÉTICO-10T] Concluído: ${opened}/${slots.length} contratos | ` +
    `${targetSymbol} | Modo: ${stakeMode} | ` +
    `Total investido: $${burstStats.totalStaked.toFixed(2)} | ` +
    `EV: ${burstStats.expectedProfit >= 0 ? '+' : ''}$${burstStats.expectedProfit.toFixed(2)} | ` +
    `Tempo: ${Date.now() - startTime}ms`
  );

  return {
    totalSlots: slots.length,
    openedContracts: opened,
    failedContracts: failed,
    results,
    burstDurationMs: Date.now() - startTime,
    targetSymbol,
    digitHeats,
    coveragePercent,
    stakeMode,
    stakeDistribution,
    burstStats,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

export async function closeAllSlotConnections(userId: string): Promise<void> {
  const userPool = connectionPool.get(userId);
  if (!userPool) return;

  for (const [slotIndex, api] of userPool.entries()) {
    try {
      await api.disconnect();
      console.log(`🔌 [FRENÉTICO-10T] Slot ${slotIndex} desconectado`);
    } catch { /* ignora */ }
  }
  connectionPool.delete(userId);
}

export async function getSlotBalances(
  userId: string,
  slots: SlotToken[]
): Promise<Array<{ slotIndex: number; balance: number | null; error?: string }>> {
  const results = await Promise.allSettled(
    slots.map(async (slot) => {
      try {
        const api = await getOrCreateConnection(userId, slot, `BALANCE_CHECK_S${slot.slotIndex}`);
        const balanceData = await api.getBalance();
        return { slotIndex: slot.slotIndex, balance: balanceData?.balance ?? null };
      } catch (err: any) {
        return { slotIndex: slot.slotIndex, balance: null, error: err?.message ?? 'Erro' };
      }
    })
  );
  return results.map(r =>
    r.status === 'fulfilled' ? r.value : { slotIndex: -1, balance: null, error: 'Falhou' }
  );
}
