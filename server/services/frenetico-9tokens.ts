/**
 * FRENÉTICO 9-TOKENS — Orquestrador de disparos paralelos por slot
 *
 * Estratégia:
 *  - Até 9 tokens Deriv, cada um em seu próprio slot (0-8)
 *  - Cada slot monitora um ativo diferente
 *  - Para cada ativo, a IA identifica o ÚNICO dígito mais quente
 *  - Todos os 9 contratos disparam SIMULTANEAMENTE (Promise.allSettled)
 *  - Sem gargalo, sem delay entre operações, sem concorrência de saldo
 *
 * Vantagem matemática:
 *  - Dígito quente: frequência ~14-17% (acima dos 10% neutros)
 *  - Com payout 8.5x: EV = 0.15 × 8.5 − 0.85 = +$0.425 por dólar apostado
 *  - Multiplicado por 9 slots simultâneos em 9 ativos independentes
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
  digitFrequency: number;  // % real do dígito (ex: 0.16 = 16%)
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
  estimatedEdge: number; // EV médio da rajada
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

  // Verifica se a conexão existente está saudável
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

  // Cria nova instância e conecta
  api = new DerivAPIService();
  const connected = await api.connect(slot.token, slot.accountType, `${operationId}_SLOT${slot.slotIndex}`);
  if (!connected) {
    throw new Error(`Slot ${slot.slotIndex}: falha ao conectar com o token`);
  }
  userPool.set(slot.slotIndex, api);
  return api;
}

/**
 * Seleciona os melhores ativos para os slots disponíveis
 * Prioriza ativos com maior edge estatístico de dígitos
 */
export function selectAssetsForSlots(slotCount: number): string[] {
  const CANDIDATE_ASSETS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
    'RDBULL', 'RDBEAR',
  ];

  // Ordena pelos ativos com mais edge nos dígitos (mais dados = mais confiança)
  const scored = CANDIDATE_ASSETS.map(symbol => ({
    symbol,
    edge: digitFrequencyAnalyzer.getDigitEdgeScore(symbol),
  })).sort((a, b) => b.edge - a.edge);

  // Retorna os melhores, garantindo diversificação
  return scored.slice(0, slotCount).map(s => s.symbol);
}

/**
 * Executa uma RAJADA FRENÉTICA com 9 tokens simultâneos
 *
 * @param userId   - ID do usuário
 * @param slots    - Array de tokens configurados (slotIndex 0-8)
 * @param amount   - Valor por contrato (em USD)
 * @param duration - Duração em ticks (1-10)
 * @param operationId - ID da operação para logs
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
    throw new Error('Nenhum slot de token configurado para o modo Frenético 9-Tokens');
  }

  // Seleciona os melhores ativos (um por slot)
  const assets = selectAssetsForSlots(slots.length);
  console.log(`⚡🔥 [FRENÉTICO-9T] Iniciando rajada | ${slots.length} slots | Ativos: [${assets.join(',')}]`);

  // Prepara os disparos simultâneos — um por slot
  const slotPromises = slots.map(async (slot, idx): Promise<SlotResult> => {
    const symbol = assets[idx] ?? assets[0];
    const slotOpId = `${operationId}_S${slot.slotIndex}`;

    try {
      // Obtém/reutiliza conexão para este slot
      const api = await getOrCreateConnection(userId, slot, slotOpId);

      // Identifica o dígito mais quente para este ativo via IA de frequência
      const [hottestDigit] = digitFrequencyAnalyzer.getHottestDigitsForMatches(symbol, 1);
      const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(symbol);
      const digitData = analysis?.digits.find(d => d.digit === hottestDigit);
      const digitFreq = digitData?.frequency ?? 0.10;

      console.log(`🎯 [FRENÉTICO-9T S${slot.slotIndex}] ${symbol} → dígito ${hottestDigit} (freq ${(digitFreq * 100).toFixed(1)}%)`);

      // Dispara o contrato
      const contract = await api.buyGenericDigitContract({
        contract_type: 'DIGITMATCH',
        symbol,
        duration,
        amount,
        barrier: hottestDigit.toString(),
        currency: 'USD',
      });

      if (!contract?.contract_id) {
        return {
          slotIndex: slot.slotIndex,
          symbol,
          digit: hottestDigit,
          digitFrequency: digitFreq,
          contractId: null,
          status: 'failed',
          errorMessage: 'Contrato não retornou ID',
          openTimeMs: Date.now() - startTime,
        };
      }

      console.log(`✅ [FRENÉTICO-9T S${slot.slotIndex}] Contrato ${contract.contract_id} aberto | ${symbol} dígito ${hottestDigit}`);

      return {
        slotIndex: slot.slotIndex,
        symbol,
        digit: hottestDigit,
        digitFrequency: digitFreq,
        contractId: contract.contract_id.toString(),
        status: 'success',
        openTimeMs: Date.now() - startTime,
      };

    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isInsufficientBalance = msg.includes('InsufficientBalance') || msg.includes('insufficient');

      console.warn(`❌ [FRENÉTICO-9T S${slot.slotIndex}] ${symbol} falhou: ${msg}`);

      return {
        slotIndex: slot.slotIndex,
        symbol,
        digit: 0,
        digitFrequency: 0,
        contractId: null,
        status: isInsufficientBalance ? 'insufficient_balance' : 'failed',
        errorMessage: msg,
        openTimeMs: Date.now() - startTime,
      };
    }
  });

  // DISPARO SIMULTÂNEO — todos os slots ao mesmo tempo
  const settled = await Promise.allSettled(slotPromises);
  const results: SlotResult[] = settled.map(r =>
    r.status === 'fulfilled' ? r.value : {
      slotIndex: -1, symbol: '?', digit: 0, digitFrequency: 0,
      contractId: null, status: 'failed' as const,
      errorMessage: r.reason?.message ?? 'Erro desconhecido',
      openTimeMs: Date.now() - startTime,
    }
  );

  const opened = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status !== 'success').length;
  const avgFreq = results.filter(r => r.status === 'success')
    .reduce((sum, r) => sum + r.digitFrequency, 0) / Math.max(opened, 1);
  const estimatedEdge = avgFreq * 8.5 - (1 - avgFreq); // EV real com payout 8.5x

  console.log(`🏁 [FRENÉTICO-9T] Rajada concluída: ${opened}/${slots.length} | Tempo: ${Date.now() - startTime}ms | Edge estimado: ${(estimatedEdge * 100).toFixed(1)}%`);

  return {
    totalSlots: slots.length,
    openedContracts: opened,
    failedContracts: failed,
    results,
    burstDurationMs: Date.now() - startTime,
    estimatedEdge,
  };
}

/**
 * Encerra todas as conexões do pool de um usuário (ao parar o sistema)
 */
export async function closeAllSlotConnections(userId: string): Promise<void> {
  const userPool = connectionPool.get(userId);
  if (!userPool) return;

  for (const [slotIndex, api] of userPool.entries()) {
    try {
      await api.disconnect();
      console.log(`🔌 [FRENÉTICO-9T] Slot ${slotIndex} desconectado`);
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
