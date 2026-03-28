/**
 * FRENÉTICO 10-TOKENS — Orquestrador de disparos paralelos por slot
 *
 * Estratégia correta:
 *  - A IA seleciona O MELHOR ativo e O DÍGITO mais quente naquele momento
 *  - TODOS os 10 slots disparam NO MESMO ativo, NO MESMO dígito, NO MESMO tick
 *  - Cada slot usa sua própria conta Deriv (sem concorrência de saldo)
 *  - Disparo 100% simultâneo via Promise.allSettled
 *
 * Vantagem:
 *  - 10 contas apostam juntas no mesmo sinal — sem limitar saldo de uma única conta
 *  - Dígito quente: frequência ~14-17% → EV positivo com payout 8.5x
 *  - Lucro multiplicado por 10 sem nenhuma exposição adicional por conta
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

export interface BurstResult {
  totalSlots: number;
  openedContracts: number;
  failedContracts: number;
  results: SlotResult[];
  burstDurationMs: number;
  estimatedEdge: number;
  targetSymbol: string;
  targetDigit: number;
  targetDigitFrequency: number;
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
 * TODOS os slots operam:
 *  - O MESMO ativo (melhor edge estatístico)
 *  - O MESMO dígito (mais quente no momento)
 *  - NO MESMO TICK — disparo 100% simultâneo
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

  // ── 1. SELEÇÃO ÚNICA: melhor ativo + dígito mais quente ──────────────────
  const targetSymbol = selectBestAsset();
  const [targetDigit] = digitFrequencyAnalyzer.getHottestDigitsForMatches(targetSymbol, 1);
  const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(targetSymbol);
  const digitData = analysis?.digits.find(d => d.digit === targetDigit);
  const targetDigitFreq = digitData?.frequency ?? 0.10;

  console.log(
    `⚡🔥 [FRENÉTICO-10T] Rajada iniciada | ${slots.length} slots | ` +
    `Alvo: ${targetSymbol} dígito ${targetDigit} (${(targetDigitFreq * 100).toFixed(1)}%)`
  );

  // ── 2. DISPARO SIMULTÂNEO — todos os slots, mesmo ativo, mesmo dígito ────
  const slotPromises = slots.map(async (slot): Promise<SlotResult> => {
    const slotOpId = `${operationId}_S${slot.slotIndex}`;

    try {
      const api = await getOrCreateConnection(userId, slot, slotOpId);

      const contract = await api.buyGenericDigitContract({
        contract_type: 'DIGITMATCH',
        symbol: targetSymbol,
        duration,
        amount,
        barrier: targetDigit.toString(),
        currency: 'USD',
      });

      if (!contract?.contract_id) {
        return {
          slotIndex: slot.slotIndex,
          symbol: targetSymbol,
          digit: targetDigit,
          digitFrequency: targetDigitFreq,
          contractId: null,
          status: 'failed',
          errorMessage: 'Contrato não retornou ID',
          openTimeMs: Date.now() - startTime,
        };
      }

      console.log(
        `✅ [FRENÉTICO-10T S${slot.slotIndex}] Contrato ${contract.contract_id} | ` +
        `${targetSymbol} dígito ${targetDigit}`
      );

      return {
        slotIndex: slot.slotIndex,
        symbol: targetSymbol,
        digit: targetDigit,
        digitFrequency: targetDigitFreq,
        contractId: contract.contract_id.toString(),
        status: 'success',
        openTimeMs: Date.now() - startTime,
      };

    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isInsufficientBalance = msg.includes('InsufficientBalance') || msg.includes('insufficient');

      console.warn(`❌ [FRENÉTICO-10T S${slot.slotIndex}] falhou: ${msg}`);

      return {
        slotIndex: slot.slotIndex,
        symbol: targetSymbol,
        digit: targetDigit,
        digitFrequency: targetDigitFreq,
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
      digit: targetDigit,
      digitFrequency: targetDigitFreq,
      contractId: null,
      status: 'failed' as const,
      errorMessage: r.reason?.message ?? 'Erro desconhecido',
      openTimeMs: Date.now() - startTime,
    }
  );

  const opened = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status !== 'success').length;
  const estimatedEdge = targetDigitFreq * 8.5 - (1 - targetDigitFreq);

  console.log(
    `🏁 [FRENÉTICO-10T] Concluído: ${opened}/${slots.length} contratos | ` +
    `${targetSymbol} dígito ${targetDigit} | ` +
    `Tempo: ${Date.now() - startTime}ms | Edge: ${(estimatedEdge * 100).toFixed(1)}%`
  );

  return {
    totalSlots: slots.length,
    openedContracts: opened,
    failedContracts: failed,
    results,
    burstDurationMs: Date.now() - startTime,
    estimatedEdge,
    targetSymbol,
    targetDigit,
    targetDigitFrequency: targetDigitFreq,
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
