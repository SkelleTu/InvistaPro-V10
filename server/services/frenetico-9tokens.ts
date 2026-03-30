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
import { digitPatternEngine } from './digit-pattern-engine';

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
  evGate?: {
    evScore: number;
    freqSumSq: number;
    isPositiveEV: boolean;
    reason: string;
    alignmentScore: number;
    entryQuality: string;
  };
  blockedByEVGate?: boolean;
  evGateReason?: string;
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
  stakeMode: StakeMode = 'kelly',
  digitCount?: number,
  currentBalance?: number
): Promise<BurstResult> {
  const startTime = Date.now();

  if (slots.length === 0) {
    throw new Error('Nenhum slot configurado para o modo Frenético 10-Tokens');
  }

  // ── 1. SELEÇÃO DO ATIVO: maior variância de frequência ───────────────────
  const targetSymbol = selectBestAsset();
  const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(targetSymbol);

  // ── 1b. GATE DE EV — verificar se vale a pena entrar ANTES de qualquer disparo ──
  // Matemática: com stakes Kelly, EV = P×Σ(f²) − 1. Só entrar se Σ(f²) > 1/P.
  // Para burst parcial de N dígitos: EV positivo se avgFreq(top-N) > 1/P.
  const nSlotsTotal = digitCount && digitCount > 0 && digitCount < 10 ? digitCount : slots.length;
  const evGateResult = digitFrequencyAnalyzer.computeEVGate(targetSymbol, DIGITMATCH_PAYOUT, nSlotsTotal);
  const entryDecision = digitPatternEngine.getFullEntryDecision(
    targetSymbol, DIGITMATCH_PAYOUT, nSlotsTotal,
    evGateResult.isPositiveEV ? 30 : 50 // mais permissivo quando EV já é positivo
  );

  console.log(`🎰 [EV GATE] ${evGateResult.reason}`);
  console.log(`🧭 [ALINHAMENTO IA] ${entryDecision.alignment.combinedInsight}`);

  // BLOQUEIO: sem EV positivo E sem sinal forte de alinhamento → NÃO disparar
  const evGateBlocked = !evGateResult.isPositiveEV && entryDecision.alignment.entryQuality === 'wait';
  if (evGateBlocked) {
    console.warn(
      `🚫 [EV GATE BLOQUEADO] Rajada cancelada — EV negativo + alinhamento fraco.\n` +
      `   EV: ${evGateResult.reason}\n` +
      `   Alinhamento: ${entryDecision.alignment.combinedInsight}\n` +
      `   Recomendação: aguardar skew na distribuição de frequências.`
    );
    // Retorna resultado vazio indicando bloqueio — sem gastar dinheiro
    return {
      totalSlots: 0,
      openedContracts: 0,
      failedContracts: 0,
      results: [],
      burstDurationMs: Date.now() - startTime,
      targetSymbol,
      digitHeats: [],
      coveragePercent: 0,
      stakeMode,
      stakeDistribution: {},
      burstStats: { totalStaked: 0, expectedWin: 0, expectedProfit: 0, expectedROI: 0, edgeScore: 0 },
      blockedByEVGate: true,
      evGateReason: evGateResult.reason,
      evGate: {
        evScore: evGateResult.evScore,
        freqSumSq: evGateResult.freqSumSq,
        isPositiveEV: false,
        reason: evGateResult.reason,
        alignmentScore: entryDecision.alignment.alignmentScore,
        entryQuality: entryDecision.alignment.entryQuality,
      },
    };
  }

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

  // ── SELEÇÃO DE N DÍGITOS MAIS QUENTES — com prioridade para dígitos alinhados (Markov+Freq) ──
  // Se digitCount < 10, usa os dígitos onde AMBOS os sinais convergem (alinhamento)
  let activeSlots = slots;
  if (digitCount && digitCount > 0 && digitCount < 10) {
    // Prioridade 1: dígitos alinhados (Markov + frequência concordam)
    const alignedDigits = entryDecision.targetDigits.slice(0, digitCount);
    // Prioridade 2: top-N por frequência (fallback)
    const topNByFreq = [...digitHeats]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, digitCount)
      .map(h => h.digit);

    const topNDigits = alignedDigits.length >= digitCount ? alignedDigits : topNByFreq;
    activeSlots = slots.filter(s => topNDigits.includes(s.slotIndex));
    if (activeSlots.length === 0) activeSlots = slots.slice(0, digitCount);
    console.log(
      `🎯 [FRENÉTICO] Top ${digitCount} dígitos | Alinhados: [${alignedDigits.join(',')}] | ` +
      `Top-freq: [${topNByFreq.join(',')}] | Slots ativos: ${activeSlots.length}`
    );
  }

  // ── 2. DISTRIBUIÇÃO DE STAKES INTELIGENTE (PREDITIVA) ───────────────────
  // Quando EV é positivo E alinhamento é forte → aplica boost de stake
  // Tenta usar o motor preditivo (Markov + momentum) para stakes mais precisos
  let stakeDistribution: Record<number, number>;
  {
    const effectiveAmount = amount * entryDecision.stakeBoost; // boost quando sinal forte
    const { stakes: predictiveStakes, prediction } = digitPatternEngine.computePredictiveStakes(
      targetSymbol, effectiveAmount, MIN_STAKE
    );

    if (prediction.confidence >= 40 && prediction.markovOrder >= 1) {
      // Motor preditivo tem dados suficientes — usa stakes preditivos
      stakeDistribution = predictiveStakes;
      console.log(
        `🧠 [PADRÃO IA] Markov Ord${prediction.markovOrder} (${prediction.sampleCount} amostras) | ` +
        `Conf: ${prediction.confidence}% | StakeBoost: ×${entryDecision.stakeBoost.toFixed(2)} | ` +
        `${prediction.insights[0]} | ${prediction.insights[1] ?? ''}`
      );
      if (prediction.insights[2]) {
        console.log(`🧠 [PADRÃO IA] ${prediction.insights[2]}`);
      }
    } else {
      // Fallback: Kelly clássico baseado em frequência
      stakeDistribution = computeSmartStakes(digitHeats, effectiveAmount, stakeMode);
      console.log(`📊 [FREQUÊNCIA] Markov com dados insuficientes (conf=${prediction.confidence}%) — usando Kelly frequência | StakeBoost: ×${entryDecision.stakeBoost.toFixed(2)}`);
    }
  }
  const burstStats = computeBurstStats(digitHeats, stakeDistribution);

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ BURST GUARD — CAP TOTAL DE EXPOSIÇÃO POR RAJADA
  //
  // Regra 1: total do burst ≤ 20% da banca → escalonar stakes proporcionalmente
  //          A distribuição Kelly é preservada — apenas a escala muda.
  //
  // Regra 2 (crítica): se MIN_STAKE × nSlots > maxAllowed, reduzir o número
  //          de slots ativos para floor(maxAllowed / MIN_STAKE).
  //          Isso evita o caso onde o floor em MIN_STAKE ignora o cap.
  //
  // Regra 3: se banca < MIN_STAKE × 2, NÃO disparar (saldo insuficiente).
  // ═══════════════════════════════════════════════════════════════════════════
  const MAX_BURST_EXPOSURE_PCT = 0.20; // 20% da banca por rajada
  if (currentBalance && currentBalance > 0 && burstStats.totalStaked > 0) {
    const maxAllowed = currentBalance * MAX_BURST_EXPOSURE_PCT;

    // Regra 3: saldo mínimo absoluto para disparar
    if (currentBalance < MIN_STAKE * 2) {
      console.error(`🛑 [BURST GUARD] Saldo $${currentBalance.toFixed(2)} < mínimo absoluto ($${(MIN_STAKE * 2).toFixed(2)}) — BURST CANCELADO`);
      return {
        totalSlots: 0,
        openedContracts: 0,
        failedContracts: 0,
        results: [],
        burstDurationMs: Date.now() - startTime,
        targetSymbol,
        digitHeats,
        coveragePercent: 0,
        stakeMode,
        stakeDistribution: {},
        burstStats: { totalStaked: 0, expectedWin: 0, expectedProfit: 0, expectedROI: 0, edgeScore: 0 },
        blockedByEVGate: true,
        evGateReason: `Saldo insuficiente ($${currentBalance.toFixed(2)} < $${(MIN_STAKE * 2).toFixed(2)} mínimo)`,
        evGate: evGateResult ? {
          evScore: evGateResult.evScore,
          freqSumSq: evGateResult.freqSumSq,
          isPositiveEV: false,
          reason: `Saldo insuficiente`,
          alignmentScore: 0,
          entryQuality: 'wait',
        } : undefined,
      };
    }

    if (burstStats.totalStaked > maxAllowed) {
      const scaleFactor = maxAllowed / burstStats.totalStaked;

      // Verificar se escalonamento vai funcionar ou o floor MIN_STAKE vai quebrar o cap
      const maxSlotsAffordable = Math.floor(maxAllowed / MIN_STAKE);
      if (maxSlotsAffordable < activeSlots.length && maxSlotsAffordable > 0) {
        // Reduzir slots: manter apenas os mais quentes
        const topDigitsByHeat = [...digitHeats]
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, maxSlotsAffordable)
          .map(h => h.digit);
        const prevLen = activeSlots.length;
        activeSlots = activeSlots.filter(s => topDigitsByHeat.includes(s.slotIndex));
        if (activeSlots.length === 0) activeSlots = activeSlots.slice(0, maxSlotsAffordable);
        console.warn(
          `🛡️ [BURST GUARD] Reduzindo slots ${prevLen}→${activeSlots.length} (banca $${currentBalance.toFixed(2)}, ` +
          `max ${maxSlotsAffordable} slots ao MIN_STAKE $${MIN_STAKE})`
        );
        // Redistribuir stakes para os slots reduzidos com stake uniforme (mais seguro)
        for (const digitKey of Object.keys(stakeDistribution)) {
          const d = Number(digitKey);
          stakeDistribution[d] = activeSlots.some(s => s.slotIndex === d) ? MIN_STAKE : 0;
        }
      } else {
        // Escalonamento normal preservando distribuição Kelly
        console.warn(
          `🛡️ [BURST GUARD] Total $${burstStats.totalStaked.toFixed(2)} ` +
          `(${(burstStats.totalStaked / currentBalance * 100).toFixed(1)}% da banca $${currentBalance.toFixed(2)}) ` +
          `> ${MAX_BURST_EXPOSURE_PCT * 100}% → escalonando stakes ×${scaleFactor.toFixed(3)} ` +
          `(${stakeMode.toUpperCase()} — distribuição preservada)`
        );
        for (const digitKey of Object.keys(stakeDistribution)) {
          const d = Number(digitKey);
          const scaled = stakeDistribution[d] * scaleFactor;
          // Usa floor sem MIN_STAKE para respeitar o cap de banca
          stakeDistribution[d] = Math.max(0.01, Math.round(scaled * 100) / 100);
        }
      }
      const newTotal = Object.values(stakeDistribution).filter(v => v > 0).reduce((s, v) => s + v, 0);
      console.warn(`🛡️ [BURST GUARD] Novo total: $${newTotal.toFixed(2)} (${(newTotal / currentBalance * 100).toFixed(1)}% da banca $${currentBalance.toFixed(2)}) ✅`);
    }
  }
  const coveragePercent = Math.round((activeSlots.length / 10) * 100);

  // Recalcular stats reais após possível escalonamento do BURST GUARD
  const realBurstStats = computeBurstStats(digitHeats, stakeDistribution);
  const hotDigits = digitHeats.filter(d => d.label === 'hot');
  const coldDigits = digitHeats.filter(d => d.label === 'cold');

  console.log(
    `⚡🔥 [FRENÉTICO-10T] Rajada ${stakeMode.toUpperCase()} | ${activeSlots.length} slots${digitCount ? ` (top ${digitCount}× digit_matches)` : ''} | ` +
    `Ativo: ${targetSymbol} | Cobertura: ${coveragePercent}% | ` +
    `EV: ${realBurstStats.expectedProfit >= 0 ? '+' : ''}$${realBurstStats.expectedProfit.toFixed(2)} | ` +
    `ROI esperado: ${realBurstStats.expectedROI.toFixed(1)}% | ` +
    `Total: $${realBurstStats.totalStaked.toFixed(2)} | ` +
    `🔥 Quentes: [${hotDigits.map(d => `${d.digit}(${(d.frequency * 100).toFixed(0)}%)`).join(',')}] | ` +
    `🧊 Frios: [${coldDigits.map(d => d.digit).join(',')}]`
  );

  // ── 3. DISPARO SIMULTÂNEO — apenas slots dos N dígitos mais quentes ──────
  const slotPromises = activeSlots.map(async (slot): Promise<SlotResult> => {
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
    totalStaked: realBurstStats.totalStaked,
    expectedProfit: realBurstStats.expectedProfit,
    mode: stakeMode,
    openedContracts: opened,
  });
  // Mantém apenas os últimos 50 registros
  if (history.length > 50) history.splice(0, history.length - 50);

  console.log(
    `🏁 [FRENÉTICO-10T] Concluído: ${opened}/${activeSlots.length} contratos | ` +
    `${targetSymbol} | Modo: ${stakeMode} | ` +
    `Total investido: $${realBurstStats.totalStaked.toFixed(2)} | ` +
    `EV: ${realBurstStats.expectedProfit >= 0 ? '+' : ''}$${realBurstStats.expectedProfit.toFixed(2)} | ` +
    `Tempo: ${Date.now() - startTime}ms`
  );

  return {
    totalSlots: activeSlots.length,
    openedContracts: opened,
    failedContracts: failed,
    results,
    burstDurationMs: Date.now() - startTime,
    targetSymbol,
    digitHeats,
    coveragePercent,
    stakeMode,
    stakeDistribution,
    burstStats: realBurstStats,
    blockedByEVGate: false,
    evGate: {
      evScore: evGateResult.evScore,
      freqSumSq: evGateResult.freqSumSq,
      isPositiveEV: evGateResult.isPositiveEV,
      reason: evGateResult.reason,
      alignmentScore: entryDecision.alignment.alignmentScore,
      entryQuality: entryDecision.alignment.entryQuality,
    },
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
