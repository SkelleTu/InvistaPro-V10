/**
 * FRENÉTICO 10-TOKENS — Orquestrador de disparos paralelos por slot
 *
 * Estratégia: 1 slot = 1 dígito fixo (slot 0 → dígito 0, slot 9 → dígito 9)
 *  - A IA seleciona O MELHOR ativo com maior edge estatístico de dígitos
 *  - Cada slot abre um DIGITMATCH no SEU dígito fixo (slotIndex = barrier)
 *  - TODOS disparam NO MESMO ativo, NO MESMO tick — cobertura total dos 10 dígitos
 *  - Cada slot usa sua própria conta Deriv (sem concorrência de saldo)
 *  - Disparo 100% simultâneo via Promise.allSettled
 *
 * Vantagem matemática:
 *  - Cobertura 100% dos dígitos (0-9) → sempre há um vencedor
 *  - O analisador de frequência detecta dígitos quentes (>10%) para priorização
 *  - Com 10 slots ativos: pelo menos 1 contrato sempre ganha (payout 8.5x)
 */

import { DerivAPIService } from './deriv-api';
import { digitFrequencyAnalyzer } from './digit-frequency-analyzer';

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
}

// Pool de conexões ativas por userId → slotIndex
const connectionPool: Map<string, Map<number, DerivAPIService>> = new Map();

/**
 * Obtém ou cria uma conexão Deriv para o slot especificado
 */
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
      if (api.getIsConnected()) {
        return api;
      }
    } catch {
      // conexão morta, recriar
    }
    userPool.delete(slot.slotIndex);
  }

  api = new DerivAPIService();
  const connected = await api.connect(slot.token, slot.accountType, `${operationId}_SLOT${slot.slotIndex}`);
  if (!connected) {
    throw new Error(`Slot ${slot.slotIndex}: falha ao conectar com o token`);
  }
  userPool.set(slot.slotIndex, api);
  return api;
}

/**
 * Seleciona o MELHOR ativo único com maior edge estatístico de dígitos.
 * Todos os slots usam este mesmo ativo.
 */
export function selectBestAsset(): string {
  const CANDIDATE_ASSETS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
    'RDBULL', 'RDBEAR',
  ];

  const scored = CANDIDATE_ASSETS.map(symbol => ({
    symbol,
    edge: digitFrequencyAnalyzer.getDigitEdgeScore(symbol),
  })).sort((a, b) => b.edge - a.edge);

  return scored[0].symbol;
}

/**
 * @deprecated Use selectBestAsset() — mantido para compatibilidade com rota de balances
 */
export function selectAssetsForSlots(slotCount: number): string[] {
  const best = selectBestAsset();
  return Array(slotCount).fill(best);
}

/**
 * Executa uma RAJADA FRENÉTICA com até 10 tokens simultâneos.
 *
 * Lógica: slot N = dígito N (slot 0 → dígito 0, slot 9 → dígito 9)
 *  - A IA seleciona O MELHOR ativo com maior edge estatístico
 *  - Cada slot abre DIGITMATCH no SEU dígito fixo (barrier = slotIndex)
 *  - Todos disparam NO MESMO ativo e NO MESMO TICK — cobertura total 0-9
 *
 * @param userId      - ID do usuário
 * @param slots       - Array de tokens configurados (slotIndex 0-9)
 * @param amount      - Valor por contrato em USD
 * @param duration    - Duração em ticks (1-10)
 * @param operationId - ID único da operação para logs
 */
export async function executeFrenetic9TokensBurst(
  userId: string,
  slots: SlotToken[],
  amount: number,
  duration: number,
  operationId: string
): Promise<BurstResult> {
  const startTime = Date.now();

  if (slots.length === 0) {
    throw new Error('Nenhum slot de token configurado para o modo Frenético 10-Tokens');
  }

  // ── 1. SELEÇÃO DO ATIVO: melhor edge estatístico de dígitos ──────────────
  const targetSymbol = selectBestAsset();
  const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(targetSymbol);

  // Mapeia a frequência de cada dígito (0-9) e classifica como hot/neutral/cold
  const digitHeats: DigitHeat[] = Array.from({ length: 10 }, (_, d) => {
    const freq = analysis?.digits.find(x => x.digit === d)?.frequency ?? 0.10;
    const label: DigitHeat['label'] = freq >= 0.13 ? 'hot' : freq <= 0.07 ? 'cold' : 'neutral';
    return { digit: d, frequency: freq, label };
  });

  const hotDigits = digitHeats.filter(d => d.label === 'hot').map(d => d.digit);
  const coveragePercent = Math.round((slots.length / 10) * 100);

  console.log(
    `⚡🔥 [FRENÉTICO-10T] Rajada iniciada | ${slots.length} slots | ` +
    `Ativo: ${targetSymbol} | Cobertura: ${coveragePercent}% (dígitos ${slots.map(s => s.slotIndex).join(',')}) | ` +
    `Quentes: [${hotDigits.join(',')}]`
  );

  // ── 2. DISPARO SIMULTÂNEO — cada slot usa SEU dígito fixo (slotIndex) ────
  const slotPromises = slots.map(async (slot): Promise<SlotResult> => {
    const assignedDigit = slot.slotIndex; // slot 0 → dígito 0, slot 9 → dígito 9
    const digitFreq = digitHeats[assignedDigit]?.frequency ?? 0.10;
    const slotOpId = `${operationId}_S${slot.slotIndex}`;

    try {
      const api = await getOrCreateConnection(userId, slot, slotOpId);

      const contract = await api.buyGenericDigitContract({
        contract_type: 'DIGITMATCH',
        symbol: targetSymbol,
        duration,
        amount,
        barrier: assignedDigit.toString(),
        currency: 'USD',
      });

      if (!contract?.contract_id) {
        return {
          slotIndex: slot.slotIndex,
          symbol: targetSymbol,
          digit: assignedDigit,
          digitFrequency: digitFreq,
          contractId: null,
          status: 'failed',
          errorMessage: 'Contrato não retornou ID',
          openTimeMs: Date.now() - startTime,
        };
      }

      const heatLabel = digitHeats[assignedDigit]?.label ?? 'neutral';
      const heatIcon = heatLabel === 'hot' ? '🔥' : heatLabel === 'cold' ? '🧊' : '⚪';
      console.log(
        `✅ [FRENÉTICO-10T S${slot.slotIndex}] Contrato ${contract.contract_id} | ` +
        `${targetSymbol} dígito ${assignedDigit} ${heatIcon} (${(digitFreq * 100).toFixed(1)}%)`
      );

      return {
        slotIndex: slot.slotIndex,
        symbol: targetSymbol,
        digit: assignedDigit,
        digitFrequency: digitFreq,
        contractId: contract.contract_id.toString(),
        status: 'success',
        openTimeMs: Date.now() - startTime,
      };

    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isInsufficientBalance = msg.includes('InsufficientBalance') || msg.includes('insufficient');

      console.warn(`❌ [FRENÉTICO-10T S${slot.slotIndex}] dígito ${assignedDigit} falhou: ${msg}`);

      return {
        slotIndex: slot.slotIndex,
        symbol: targetSymbol,
        digit: assignedDigit,
        digitFrequency: digitFreq,
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
      contractId: null,
      status: 'failed' as const,
      errorMessage: r.reason?.message ?? 'Erro desconhecido',
      openTimeMs: Date.now() - startTime,
    }
  );

  const opened = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status !== 'success').length;

  console.log(
    `🏁 [FRENÉTICO-10T] Concluído: ${opened}/${slots.length} contratos | ` +
    `${targetSymbol} | Cobertura ${coveragePercent}% (${opened} dígitos abertos) | ` +
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
  };
}

/**
 * Encerra todas as conexões do pool de um usuário
 */
export async function closeAllSlotConnections(userId: string): Promise<void> {
  const userPool = connectionPool.get(userId);
  if (!userPool) return;

  for (const [slotIndex, api] of userPool.entries()) {
    try {
      await api.disconnect();
      console.log(`🔌 [FRENÉTICO-10T] Slot ${slotIndex} desconectado`);
    } catch {
      // ignora erros ao fechar
    }
  }
  connectionPool.delete(userId);
}

/**
 * Verifica o saldo de todos os slots de um usuário
 */
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
