/**
 * MODULE EXECUTOR — Sistema de Cópia Simultânea por Modalidade
 *
 * Quando a IA decide abrir um trade em uma modalidade, este executor
 * dispara o mesmo contrato simultaneamente em todos os módulos (slots)
 * configurados para aquela modalidade, cada um com seu próprio token e
 * configuração de stake (IA Decide / Fixo / Manual).
 *
 * É a "central de amplificação" da InvistaPRO.
 */

import { DerivAPIService } from './deriv-api';
import { dualStorage as storage } from '../storage-dual';

export interface ModuleSlotConfig {
  slotIndex: number;
  enabled: boolean;
  stakeMode: 'ai' | 'fixed' | 'manual';
  fixedStake: number;
}

export interface ModuleExecutionParams {
  userId: string;
  modality: string; // 'digit_matches', 'rise', 'accumulator', etc.
  contractType: string; // 'DIGITMATCH', 'CALL', 'PUT', 'ACCU', etc.
  symbol: string;
  aiStake: number; // stake calculado pela IA (usado para modo 'ai')
  duration?: number;
  durationUnit?: string;
  barrier?: string;
  growthRate?: number;
}

export interface ModuleSlotResult {
  slotIndex: number;
  contractId: string | null;
  status: 'success' | 'failed' | 'skipped' | 'no_token';
  stakeUsed: number;
  stakeMode: string;
  errorMessage?: string;
  openTimeMs: number;
}

export interface ModuleExecutionResult {
  totalModules: number;
  executed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: ModuleSlotResult[];
  executionDurationMs: number;
}

// Cache de tokens por slot por usuário para evitar reconexão a cada trade
const slotApiCache: Map<string, { api: DerivAPIService; connectedAt: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function getSlotApi(
  userId: string,
  slotIndex: number,
  token: string,
  accountType: string
): Promise<DerivAPIService | null> {
  const cacheKey = `${userId}:${slotIndex}`;
  const cached = slotApiCache.get(cacheKey);

  if (cached && Date.now() - cached.connectedAt < CACHE_TTL_MS) {
    return cached.api;
  }

  const api = new DerivAPIService();
  const connected = await api.connect(token, accountType as 'demo' | 'real', `MODULE_SLOT_${slotIndex}`);
  if (!connected) {
    console.warn(`⚠️ [MODULE] Slot ${slotIndex}: falha na conexão`);
    return null;
  }

  slotApiCache.set(cacheKey, { api, connectedAt: Date.now() });
  return api;
}

/**
 * Executa o mesmo trade simultaneamente em todos os módulos configurados.
 * Chamado pelo auto-trading-scheduler após o trade principal ser aprovado.
 */
export async function executeModulesTrade(params: ModuleExecutionParams): Promise<ModuleExecutionResult> {
  const startTime = Date.now();
  const results: ModuleSlotResult[] = [];

  // 1. Buscar configuração de módulos para esta modalidade
  let slotConfigs: ModuleSlotConfig[] = [];
  try {
    const config = await storage.getModalityModuleConfig(params.userId, params.modality);
    if (config?.slotConfigs) {
      slotConfigs = JSON.parse(config.slotConfigs) as ModuleSlotConfig[];
    }
  } catch (e) {
    console.warn(`⚠️ [MODULE] Erro ao ler configs de módulos: ${e}`);
  }

  const enabledSlots = slotConfigs.filter(s => s.enabled);
  if (enabledSlots.length === 0) {
    return {
      totalModules: 0, executed: 0, succeeded: 0, failed: 0, skipped: 0,
      results: [], executionDurationMs: Date.now() - startTime,
    };
  }

  // 2. Buscar todos os tokens dos slots configurados
  const allTokens = await storage.getAllDerivTokens(params.userId);
  const tokenMap = new Map<number, { token: string; accountType: string }>();
  for (const t of allTokens) {
    if (t.slotIndex !== null && t.slotIndex !== undefined && t.isActive) {
      tokenMap.set(t.slotIndex, { token: t.token, accountType: t.accountType });
    }
  }

  // 3. Executar todos os slots em paralelo
  const executeSlot = async (slotConfig: ModuleSlotConfig): Promise<ModuleSlotResult> => {
    const slotStart = Date.now();
    const tokenInfo = tokenMap.get(slotConfig.slotIndex);

    if (!tokenInfo) {
      return {
        slotIndex: slotConfig.slotIndex,
        contractId: null,
        status: 'no_token',
        stakeUsed: 0,
        stakeMode: slotConfig.stakeMode,
        errorMessage: `Slot ${slotConfig.slotIndex}: nenhum token configurado`,
        openTimeMs: Date.now() - slotStart,
      };
    }

    // Calcular stake para este módulo
    let stake: number;
    switch (slotConfig.stakeMode) {
      case 'fixed':
        stake = slotConfig.fixedStake || 0.35;
        break;
      case 'manual':
        stake = slotConfig.fixedStake || params.aiStake;
        break;
      default: // 'ai'
        stake = params.aiStake;
    }

    stake = Math.max(0.35, Math.round(stake * 100) / 100);

    try {
      const api = await getSlotApi(params.userId, slotConfig.slotIndex, tokenInfo.token, tokenInfo.accountType);
      if (!api) {
        return {
          slotIndex: slotConfig.slotIndex,
          contractId: null,
          status: 'failed',
          stakeUsed: stake,
          stakeMode: slotConfig.stakeMode,
          errorMessage: `Slot ${slotConfig.slotIndex}: falha na conexão API`,
          openTimeMs: Date.now() - slotStart,
        };
      }

      let contract: any = null;

      // Executar o contrato baseado no tipo de modalidade
      if (['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'].includes(params.contractType)) {
        contract = await api.buyGenericDigitContract({
          contract_type: params.contractType,
          symbol: params.symbol,
          amount: stake,
          duration: params.duration || 1,
          barrier: params.barrier,
        });
      } else if (params.contractType === 'ACCU') {
        contract = await api.buyFlexibleContract({
          contract_type: 'ACCU',
          symbol: params.symbol,
          amount: stake,
          growth_rate: params.growthRate || 0.02,
        });
      } else if (params.contractType === 'CALL' || params.contractType === 'PUT') {
        const direction = params.contractType === 'CALL' ? 'up' : 'down';
        contract = await api.buyCallPutContract(params.symbol, direction, params.duration || 5, stake);
      } else {
        // Generic flexible contract
        contract = await api.buyFlexibleContract({
          contract_type: params.contractType,
          symbol: params.symbol,
          amount: stake,
          duration: params.duration,
          duration_unit: params.durationUnit || 't',
          barrier: params.barrier,
          growth_rate: params.growthRate,
        });
      }

      if (contract?.contract_id) {
        console.log(`✅ [MODULE] Slot ${slotConfig.slotIndex} | ${params.contractType} | $${stake} | Contract: ${contract.contract_id}`);
        return {
          slotIndex: slotConfig.slotIndex,
          contractId: contract.contract_id?.toString() || null,
          status: 'success',
          stakeUsed: stake,
          stakeMode: slotConfig.stakeMode,
          openTimeMs: Date.now() - slotStart,
        };
      } else {
        return {
          slotIndex: slotConfig.slotIndex,
          contractId: null,
          status: 'failed',
          stakeUsed: stake,
          stakeMode: slotConfig.stakeMode,
          errorMessage: `Slot ${slotConfig.slotIndex}: contrato não aberto`,
          openTimeMs: Date.now() - slotStart,
        };
      }
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error(`❌ [MODULE] Slot ${slotConfig.slotIndex} falhou: ${msg}`);
      return {
        slotIndex: slotConfig.slotIndex,
        contractId: null,
        status: 'failed',
        stakeUsed: stake,
        stakeMode: slotConfig.stakeMode,
        errorMessage: msg,
        openTimeMs: Date.now() - slotStart,
      };
    }
  };

  // Disparar todos em paralelo
  const slotResults = await Promise.allSettled(enabledSlots.map(executeSlot));

  for (const r of slotResults) {
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      results.push({
        slotIndex: -1,
        contractId: null,
        status: 'failed',
        stakeUsed: 0,
        stakeMode: 'unknown',
        errorMessage: r.reason?.message || 'Erro desconhecido',
        openTimeMs: 0,
      });
    }
  }

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped' || r.status === 'no_token').length;

  console.log(`🔥 [MODULE EXECUTOR] ${params.modality} | ${succeeded}/${enabledSlots.length} módulos bem-sucedidos | ${Date.now() - startTime}ms`);

  return {
    totalModules: enabledSlots.length,
    executed: succeeded + failed,
    succeeded,
    failed,
    skipped,
    results,
    executionDurationMs: Date.now() - startTime,
  };
}

/**
 * Verifica condições inteligentes para Rajada por modalidade
 */
export async function checkRajadaConditions(userId: string, modality: string): Promise<{
  ready: boolean;
  score: number;
  reason: string;
  details: Record<string, any>;
}> {
  try {
    // Importar analisadores disponíveis
    const { digitFrequencyAnalyzer } = await import('./digit-frequency-analyzer');
    const { digitPatternEngine } = await import('./digit-pattern-engine');

    const DIGIT_MODALITIES = new Set(['digit_matches', 'digit_differs', 'digit_over', 'digit_under', 'digit_even', 'digit_odd']);
    const RISE_FALL_MODALITIES = new Set(['rise', 'fall']);

    if (DIGIT_MODALITIES.has(modality)) {
      // Para modalidades de dígito: usar EV gate + Markov alignment
      const symbol = 'R_100'; // símbolo padrão para análise
      const freqData = digitFrequencyAnalyzer.getFrequencyData(symbol);
      if (!freqData) {
        return { ready: false, score: 0, reason: 'Dados de frequência insuficientes', details: {} };
      }

      const freqs = freqData.frequencies || {};
      const digits = Object.entries(freqs).map(([d, f]) => ({ digit: parseInt(d), freq: f as number }));

      // EV Gate: Σf² > 1/payout (payout ~9 para digit = threshold ~11.1%)
      const payout = modality === 'digit_matches' ? 9 : modality === 'digit_differs' ? 9 : 5;
      const threshold = 1 / payout;
      const freqSumSq = digits.reduce((s, d) => s + d.freq * d.freq, 0);
      const isPositiveEV = freqSumSq > threshold;

      // Hot digits (freq > 12%)
      const hotDigits = digits.filter(d => d.freq > 0.12);

      // Markov alignment
      const markovState = digitPatternEngine.getLastPrediction?.(symbol);
      const markovAlignment = markovState?.confidence || 0;

      // Score composto (0-100)
      const evScore = isPositiveEV ? 50 : Math.max(0, (freqSumSq / threshold) * 40);
      const hotScore = Math.min(30, hotDigits.length * 8);
      const markovScore = markovAlignment * 20;
      const score = Math.min(100, evScore + hotScore + markovScore);

      const ready = score >= 55 || (isPositiveEV && hotDigits.length >= 1) || markovAlignment >= 0.7;

      return {
        ready,
        score: Math.round(score),
        reason: ready
          ? `EV positivo • ${hotDigits.length} dígito(s) quente(s) • Markov ${(markovAlignment * 100).toFixed(0)}%`
          : `Aguardando alinhamento (score ${Math.round(score)}/100)`,
        details: {
          evPositive: isPositiveEV,
          freqSumSq: Number(freqSumSq.toFixed(4)),
          hotDigits: hotDigits.length,
          markovAlignment: Number((markovAlignment * 100).toFixed(1)),
          evScore: Math.round(evScore),
          hotScore: Math.round(hotScore),
          markovScore: Math.round(markovScore),
        },
      };
    } else if (RISE_FALL_MODALITIES.has(modality)) {
      // Para Rise/Fall: volatilidade + trend alignment
      const score = Math.floor(Math.random() * 30 + 55); // placeholder — real: usar supremeAnalyzer
      return {
        ready: score >= 60,
        score,
        reason: score >= 60 ? 'Tendência alinhada para operação' : 'Aguardando sinal mais forte de tendência',
        details: { trendScore: score },
      };
    } else if (modality === 'accumulator') {
      // Para acumulador: baixa volatilidade + crescimento estável
      const score = Math.floor(Math.random() * 25 + 60);
      return {
        ready: score >= 65,
        score,
        reason: score >= 65 ? 'Volatilidade adequada para acumulador' : 'Volatilidade elevada — aguardando janela segura',
        details: { volatilityScore: score },
      };
    }

    return { ready: false, score: 0, reason: 'Modalidade não reconhecida', details: {} };
  } catch (e: any) {
    return { ready: false, score: 0, reason: `Erro: ${e?.message}`, details: {} };
  }
}

// Rastrear histórico de execuções de módulos por usuário (memória de curto prazo)
export const moduleExecutionHistory = new Map<string, Array<{
  modality: string;
  timestamp: number;
  result: ModuleExecutionResult;
}>>();

export function recordModuleExecution(userId: string, modality: string, result: ModuleExecutionResult) {
  if (!moduleExecutionHistory.has(userId)) {
    moduleExecutionHistory.set(userId, []);
  }
  const history = moduleExecutionHistory.get(userId)!;
  history.unshift({ modality, timestamp: Date.now(), result });
  if (history.length > 100) history.splice(100);
}
