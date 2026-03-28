/**
 * METATRADER API ROUTES - INVESTAPRO
 * Endpoints REST para comunicação com o Expert Advisor MT4/MT5
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { metaTraderBridge, MT5Position, MT5TradeResult } from '../services/metatrader-bridge';
import {
  analyzeCrashBoomSpike,
  analyzeContinuitySafety,
  storeExternalGirassolPivots,
  getExternalGirassolPivots,
  ExternalGirassolPivot,
} from '../services/crash-boom-spike-engine';
import { brazilNewsService } from '../services/brazil-news-service';
import { computeSyntheticGirassol } from '../services/synthetic-girassol';
import { consensusCache } from '../services/consensus-cache';


const router = Router();

router.post('/heartbeat', (req: Request, res: Response) => {
  try {
    const { accountId, broker, balance, equity, freeMargin, openPositions, platform, token } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId obrigatório' });
    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    metaTraderBridge.recordHeartbeat({ accountId, broker: broker || 'Unknown', balance, equity, freeMargin, openPositionsCount: typeof openPositions === 'number' ? openPositions : undefined });
    const updatedConfig = metaTraderBridge.getConfig();
    console.log(`[MT5Bridge] 💚 Heartbeat: ${broker || 'Unknown'} | Conta: ${accountId} | Saldo: $${balance} | Posições abertas EA: ${openPositions ?? '?'} | Habilitado: ${updatedConfig.enabled}`);
    res.json({
      ok: true,
      serverTime: Date.now(),
      enabled: updatedConfig.enabled,
      pollingIntervalMs: updatedConfig.pollingIntervalMs,
      maxOpenPositions: updatedConfig.maxOpenPositions,
      message: updatedConfig.enabled ? 'Sistema ativo — IAs gerando sinais' : 'Heartbeat registrado'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/signal', (req: Request, res: Response) => {
  try {
    const { symbol, token, accountId } = req.query;
    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    // Registrar heartbeat apenas quando o EA faz polling (tem parâmetro symbol)
    // Isso evita que o dashboard (sem symbol) mantenha o heartbeat vivo falsamente
    const symbolStr = (symbol as string) || '';
    if (symbolStr) {
      const accId = (accountId as string) || 'EA_AUTO';
      metaTraderBridge.recordHeartbeat({
        accountId: accId,
        broker: 'MT5',
        balance: 0,
        equity: 0,
        freeMargin: 0
      });
    }
    const resolvedSymbol = symbolStr || config.symbols[0] || 'EURUSD';
    const signal = metaTraderBridge.getPendingSignal(resolvedSymbol);

    // Se não há sinal pendente, gerar sob demanda (modo IA pura ou com candles)
    if ((!signal || signal.action === 'HOLD') && symbolStr && config.enabled) {
      // Dispara geração em segundo plano; próximo poll do EA receberá o sinal
      setImmediate(() => {
        metaTraderBridge.generateSignal(resolvedSymbol).catch(() => {});
      });
    }

    if (!signal || signal.action === 'HOLD') {
      return res.json({
        action: 'HOLD',
        reason: signal?.reason || 'Aguardando próximo sinal da IA',
        confidence: signal?.confidence || 0,
        timestamp: Date.now()
      });
    }

    // ── Validação Girassol no polling simples ──────────────────────────────
    // O Girassol é o GATILHO PRIMÁRIO. Mesmo no endpoint /signal, o sinal
    // da IA deve ser bloqueado se o Girassol contradiz ou está NEUTRO.
    const girassolStored = metaTraderBridge.getGirassolBias(resolvedSymbol);
    if (girassolStored) {
      const signalDir = signal.action === 'BUY' ? 'BUY' : 'SELL';
      if (girassolStored.bias === 'NEUTRAL') {
        console.log(`[MT5-Signal] ⏸️ ${resolvedSymbol}: Girassol NEUTRO — sinal ${signalDir} bloqueado no polling`);
        return res.json({
          action: 'HOLD',
          reason: 'Girassol NEUTRO — aguardando gatilho direcional do indicador',
          confidence: 0,
          timestamp: Date.now()
        });
      }
      if (girassolStored.bias !== signalDir) {
        console.log(`[MT5-Signal] 🚫 ${resolvedSymbol}: Girassol ${girassolStored.bias} contradiz sinal ${signalDir} — bloqueado no polling`);
        return res.json({
          action: 'HOLD',
          reason: `Bloqueado: Girassol ${girassolStored.bias} contradiz sinal IA ${signalDir}`,
          confidence: 0,
          timestamp: Date.now()
        });
      }
    } else {
      // Sem dados do Girassol E ele é obrigatório → bloquear
      const requireGirassol = metaTraderBridge.getConfig().requireGirassolConfirmation;
      if (requireGirassol) {
        console.log(`[MT5-Signal] 🚫 ${resolvedSymbol}: Girassol obrigatório mas sem dados — sinal bloqueado no polling`);
        return res.json({
          action: 'HOLD',
          reason: 'Girassol obrigatório mas sem dados do indicador — instale o Girassol no gráfico MT5',
          confidence: 0,
          timestamp: Date.now()
        });
      }
    }

    // ── Gate: Duplo Padrão da bolinha_media ──────────────────────────────────
    // Mesmo no polling simples, verificar se o duplo topo/fundo está confirmado
    // antes de entregar o sinal em cache. Isso evita que generateSignal() em background
    // armazene sinais que depois saem por esta rota sem a validação completa.
    {
      const signalDir = signal.action as 'BUY' | 'SELL';
      const dp = metaTraderBridge.checkBolinhaMediaDoublePattern(resolvedSymbol, signalDir);
      const bolinhaHistLen = metaTraderBridge.getBolinhaMediaHistoryLength(resolvedSymbol);
      // Só aplica o gate quando há histórico da bolinha_media (EA enviando buffers reais)
      if (bolinhaHistLen > 0 && !dp.detected) {
        console.log(`[MT5-Signal] ⏳ ${resolvedSymbol}: duplo padrão pendente — sinal ${signalDir} retido no polling`);
        return res.json({
          action: 'HOLD',
          reason: `Aguardando duplo padrão: bolinha_media ${signalDir} registrou 1º pivô — entrada somente com 2º pivô confirmado`,
          confidence: 0,
          timestamp: Date.now()
        });
      }
    }

    res.json({
      id: signal.id,
      symbol: signal.symbol,
      action: signal.action,
      lotSize: signal.lotSize,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      stopLossPips: signal.stopLossPips,
      takeProfitPips: signal.takeProfitPips,
      entryPrice: signal.entryPrice,
      confidence: signal.confidence,
      reason: signal.reason,
      aiSources: signal.aiSources,
      indicators: signal.indicators,
      timestamp: signal.timestamp,
      expiresAt: signal.expiresAt
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/metatrader/signal-with-indicators
 * Endpoint principal para o EA v5.0.
 * Recebe candles + dados reais dos indicadores instalados no gráfico
 * (Girassol, Fibonacci automático e qualquer outro) e retorna sinal da IA.
 */
router.post('/signal-with-indicators', async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      ask,
      bid,
      candles,
      indicatorSignals,   // { girassol: {...}, fibonacci: {...} }
      indicatorBuffers,   // array bruto de todos os buffers
      indicatorCount,
      accountId: bodyAccountId,
      token
    } = req.body;

    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (!symbol) {
      return res.status(400).json({ error: 'symbol é obrigatório' });
    }

    // Registrar heartbeat — EA v5.0 usa este endpoint como canal principal
    metaTraderBridge.recordHeartbeat({
      accountId: bodyAccountId || 'EA_AUTO',
      broker: 'MT5',
      balance: 0,
      equity: 0,
      freeMargin: 0
    });

    if (!config.enabled) {
      return res.json({ action: 'HOLD', reason: 'Sistema desabilitado', confidence: 0 });
    }

    const sym = symbol as string;

    // Atualiza dados de mercado no bridge
    if (Array.isArray(candles) && candles.length > 0) {
      metaTraderBridge.addMarketData(sym, candles);
    }

    // ── Analisa sinais do Girassol (v7.0 — 3 níveis = o semáforo) ────────
    // O Girassol É o semáforo: seus 3 níveis representam 3 graus de sinal:
    // Nível 1: girassol_extremo      — LowSymbol(azul/compra) + HighSymbol(vermelho/venda)
    // Nível 2: bolinha_media_pivot   — topos e fundos de pivot (mesmo indicador)
    // Nível 3: bolinha_pequena_micro — micro-estruturas de mercado (mesmo indicador)
    const girassol = indicatorSignals?.girassol;
    const fibonacci = indicatorSignals?.fibonacci;

    let girassolBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let girassolDesc = 'Girassol não detectado no gráfico';
    let fibDesc      = 'Fibonacci não detectado no gráfico';
    let fibNearestLevel: number | null = null;

    // Diagnóstico dos buffers brutos do Girassol para exibir no painel
    let girassolRawBufferDiag: { buffer: number; bar: number; value: number }[] = [];

    // Metadados dos 3 níveis detectados (para enriquecer resposta à IA)
    let girassolLevelSummary: {
      level_id: number;
      level_name: string;
      recent_buy: any;
      recent_sell: any;
      active: boolean;
    }[] = [];

    if (girassol?.detected) {
      const invertBuffers = metaTraderBridge.getConfig().invertGirassolBuffers;

      // ── Leitura nova (v7.0): usa estrutura levels[] com buy_signals/sell_signals por nível
      const levels = Array.isArray(girassol.levels) ? girassol.levels : [];

      // ── Compatibilidade retroativa (v6.0 e anteriores): usa signals.buy_signals/sell_signals
      let legacyBuySigs  = girassol.signals?.buy_signals  || [];
      let legacySellSigs = girassol.signals?.sell_signals || [];
      const legacyExitSigs = girassol.signals?.exit_signals || [];

      // Se temos a estrutura de 3 níveis (v7.0), extraímos por nível
      if (levels.length > 0) {
        const levelPriority = ['girassol_extremo', 'bolinha_media_pivot', 'bolinha_pequena_micro'];

        for (const lv of levels) {
          let buySigs  = (lv.buy_signals  || []) as any[];
          let sellSigs = (lv.sell_signals || []) as any[];

          if (invertBuffers) {
            [buySigs, sellSigs] = [sellSigs, buySigs];
          }

          const recentBuy  = buySigs.find((s: any)  => s.bar <= 5 && s.value !== 0);
          const recentSell = sellSigs.find((s: any) => s.bar <= 5 && s.value !== 0);

          girassolLevelSummary.push({
            level_id:    lv.level_id,
            level_name:  lv.level_name,
            recent_buy:  recentBuy  || null,
            recent_sell: recentSell || null,
            active:      !!(recentBuy || recentSell)
          });

          // Diagnóstico: adiciona entradas de barra <= 4
          [...buySigs, ...sellSigs]
            .filter((s: any) => s.bar <= 4 && s.value !== 0)
            .forEach((s: any) => girassolRawBufferDiag.push({ buffer: lv.level_id * 2, bar: s.bar, value: s.value }));

          // ── Registrar bolinha_media_pivot para detecção de duplo topo/fundo ──
          if (lv.level_name === 'bolinha_media_pivot') {
            const entryPrice = ask || bid || 0;
            if (recentBuy && !recentSell && entryPrice > 0) {
              const pivotPrice = recentBuy.value > 0 ? recentBuy.value : entryPrice;
              const isNew = metaTraderBridge.recordBolinhaMedia(sym, pivotPrice, 'BUY');
              if (isNew) console.log(`[MT5-Indicators] 🔵 ${sym}: bolinha_media BUY registrada @ ${pivotPrice.toFixed(5)} (barra ${recentBuy.bar})`);
            } else if (recentSell && !recentBuy && entryPrice > 0) {
              const pivotPrice = recentSell.value > 0 ? recentSell.value : entryPrice;
              const isNew = metaTraderBridge.recordBolinhaMedia(sym, pivotPrice, 'SELL');
              if (isNew) console.log(`[MT5-Indicators] 🔵 ${sym}: bolinha_media SELL registrada @ ${pivotPrice.toFixed(5)} (barra ${recentSell.bar})`);
            }
          }
        }

        // Determina viés por PRIORIDADE: Girassol extremo > Bolinha média > Bolinha pequena
        let decisiveLevel: typeof girassolLevelSummary[0] | undefined;
        for (const ln of levelPriority) {
          const lv = girassolLevelSummary.find(l => l.level_name === ln);
          if (lv && lv.active) { decisiveLevel = lv; break; }
        }

        if (decisiveLevel) {
          const { recent_buy, recent_sell, level_name } = decisiveLevel;
          const friendlyName = level_name === 'girassol_extremo'      ? '🌻 Girassol extremo'
                             : level_name === 'bolinha_media_pivot'    ? '🔵 Bolinha média (pivot)'
                             :                                            '⚪ Bolinha pequena (micro)';

          if (recent_buy && !recent_sell) {
            girassolBias = 'BUY';
            girassolDesc = `${friendlyName}: COMPRA (LowSymbol/azul) na barra ${recent_buy.bar} @ ${recent_buy.value}`;
          } else if (recent_sell && !recent_buy) {
            girassolBias = 'SELL';
            girassolDesc = `${friendlyName}: VENDA (HighSymbol/vermelho) na barra ${recent_sell.bar} @ ${recent_sell.value}`;
          } else if (recent_buy && recent_sell) {
            girassolBias = 'NEUTRAL';
            girassolDesc = `${friendlyName}: sinais conflitantes (compra e venda simultâneas) — aguardando confirmação`;
          }
        } else {
          girassolBias = 'NEUTRAL';
          girassolDesc = `Girassol ativo (${girassol.name}) — sem sinal novo nos 3 níveis nas últimas 5 barras`;
        }

        // Conta sinais ativos por nível para informar a IA
        const activeLevels = girassolLevelSummary.filter(l => l.active).length;
        if (activeLevels > 1) {
          girassolDesc += ` | Confluência: ${activeLevels}/3 níveis ativos`;
        }

      } else {
        // ── Compatibilidade v6.0: usa formato antigo se não há levels
        if (invertBuffers) {
          [legacyBuySigs, legacySellSigs] = [legacySellSigs, legacyBuySigs];
          console.log(`[MT5-Indicators] 🔄 Buffers do Girassol INVERTIDOS (modo legado)`);
        }

        [...legacyBuySigs, ...legacySellSigs, ...legacyExitSigs]
          .filter((s: any) => s.bar <= 4 && s.value !== 0)
          .forEach((s: any) => girassolRawBufferDiag.push({ buffer: s.buffer, bar: s.bar, value: s.value }));

        const recentBuy  = legacyBuySigs.find((s: any)  => s.bar <= 5 && s.value !== 0);
        const recentSell = legacySellSigs.find((s: any) => s.bar <= 5 && s.value !== 0);
        const recentExit = legacyExitSigs.find((s: any) => s.bar <= 5 && s.value !== 0);

        if (recentExit) {
          girassolBias = 'NEUTRAL';
          girassolDesc = `Girassol: sinal de SAÍDA na barra ${recentExit.bar} (buffer ${recentExit.buffer})`;
        } else if (recentBuy && !recentSell) {
          girassolBias = 'BUY';
          girassolDesc = `Girassol: COMPRA na barra ${recentBuy.bar} (valor ${recentBuy.value})`;
        } else if (recentSell && !recentBuy) {
          girassolBias = 'SELL';
          girassolDesc = `Girassol: VENDA na barra ${recentSell.bar} (valor ${recentSell.value})`;
        } else if (recentBuy && recentSell) {
          girassolBias = 'NEUTRAL';
          girassolDesc = `Girassol: sinais conflitantes — aguardando confirmação`;
        } else {
          girassolBias = 'NEUTRAL';
          girassolDesc = `Girassol ativo (${girassol.name}) — sem sinal novo nas últimas 5 barras`;
        }
      }

      console.log(`[MT5-Indicators] 🌻 ${girassolDesc}`);
    }

    if (fibonacci?.detected && Array.isArray(fibonacci.levels) && fibonacci.levels.length > 0) {
      const currentPrice = ask || bid || 0;
      const levels = fibonacci.levels as Array<{ level: string; price: number; buffer: number }>;

      if (currentPrice > 0) {
        // Encontra o nível de Fibonacci mais próximo do preço atual
        let minDist = Infinity;
        let nearest = levels[0];
        for (const lv of levels) {
          const dist = Math.abs(lv.price - currentPrice);
          if (dist < minDist) { minDist = dist; nearest = lv; }
        }
        fibNearestLevel = nearest.price;
        const pct = ((minDist / currentPrice) * 100).toFixed(3);
        fibDesc = `Fibonacci (${fibonacci.name}): ${levels.length} níveis | Mais próximo: ${nearest.level} @ ${nearest.price.toFixed(5)} (${pct}% de distância)`;
      } else {
        fibDesc = `Fibonacci (${fibonacci.name}): ${levels.length} níveis detectados`;
      }

      console.log(`[MT5-Indicators] 📐 ${fibDesc}`);
    }

    // ── Consulta sinal pendente da IA ────────────────────────────────────
    const baseSignal = metaTraderBridge.getPendingSignal(sym);

    // ── Perfil do ativo sintético Deriv ──────────────────────────────────
    const derivProfile = metaTraderBridge.getDerivSyntheticProfile(sym);
    const assetContext = metaTraderBridge.getAssetAIContext(sym);
    if (derivProfile) {
      console.log(`[MT5-Indicators] 📊 Ativo: ${derivProfile.family} | ${derivProfile.volClass} | ${derivProfile.trendType}`);
    }

    // ── Extração de níveis de suporte/resistência dos buffers brutos ──────
    let girassolSupportLevel: number | undefined;
    let girassolResistanceLevel: number | undefined;

    if (girassol?.detected && Array.isArray(girassol.support_resistance_levels)) {
      const srLevels = girassol.support_resistance_levels as Array<{ type: string; price: number }>;
      const supportEntry = srLevels.find(l => l.type === 'support' || l.type === 'S');
      const resistEntry  = srLevels.find(l => l.type === 'resistance' || l.type === 'R');
      if (supportEntry && supportEntry.price > 0) girassolSupportLevel = supportEntry.price;
      if (resistEntry  && resistEntry.price  > 0) girassolResistanceLevel = resistEntry.price;
    }

    // Tentar extrair também de buffer bruto
    const rawBuffers = Array.isArray(indicatorBuffers)
      ? (indicatorBuffers as Array<{ name?: string; buffer?: number; value?: number; bar?: number; index?: number }>)
          .filter(b => b.bar === 0 || b.index === 0)
          .map(b => ({ name: b.name ?? '', value: b.value ?? b.buffer ?? 0, bar: b.bar ?? 0 }))
      : [];

    if (!girassolSupportLevel) {
      const supBuf = rawBuffers.find(b => b.name?.toLowerCase().includes('support') || b.name?.toLowerCase().includes('suporte'));
      if (supBuf && supBuf.value > 0) girassolSupportLevel = supBuf.value;
    }
    if (!girassolResistanceLevel) {
      const resBuf = rawBuffers.find(b => b.name?.toLowerCase().includes('resistance') || b.name?.toLowerCase().includes('resistencia'));
      if (resBuf && resBuf.value > 0) girassolResistanceLevel = resBuf.value;
    }

    // ── GATILHO PRIMÁRIO: Girassol com peso máximo + confirmação Fibonacci ─
    //
    // Hierarquia de decisão:
    //  1. Girassol com sinal claro (BUY/SELL) → gatilho de entrada (peso primário)
    //     Confluência dos 3 níveis amplifica a confiança:
    //       1 nível ativo  → +25% boost
    //       2 níveis ativos → +40% boost
    //       3 níveis ativos → +60% boost (sinal de máxima força)
    //  2. Fibonacci próximo → +10-20% adicional por confluência de zona
    //     Chave (38.2%, 50%, 61.8%) em distância < 0.1%: +20%
    //     Qualquer nível em distância < 0.5%: +10%
    //  3. Girassol NEUTRO (instalado mas sem sinal) → HOLD obrigatório
    //     (IA não opera sem o gatilho do Girassol quando o indicador está presente)
    //  4. Girassol CONTRADIZ a IA → HOLD obrigatório
    //  5. Girassol NÃO detectado → fallback para IA + Técnica (threshold 70%)

    let finalAction: string = baseSignal?.action || 'HOLD';
    let finalConfidence: number = baseSignal?.confidence || 0;
    let finalReason: string = baseSignal?.reason || 'Aguardando sinal';
    const indicatorNotes: string[] = [];

    // Quantos dos 3 níveis do Girassol estão ativos e na mesma direção
    const activeLevels = girassolLevelSummary.filter(l => l.active).length;
    const activeBuyLevels  = girassolLevelSummary.filter(l => l.active && l.recent_buy  && !l.recent_sell).length;
    const activeSellLevels = girassolLevelSummary.filter(l => l.active && l.recent_sell && !l.recent_buy).length;
    const girassolConfluence = girassolBias === 'BUY' ? activeBuyLevels : girassolBias === 'SELL' ? activeSellLevels : 0;

    // Registrar estado do Girassol no bridge para uso no próximo generateSignal
    if (girassol?.detected) {
      metaTraderBridge.setGirassolBias(sym, girassolBias, girassolConfluence);
    }

    // ── GATE: exigir Duplo Topo / Duplo Fundo na bolinha_media para entrada ────
    // Entradas só são aprovadas quando o nível médio do Girassol (bolinha_media_pivot)
    // confirma dois pivôs consecutivos na mesma direção e em preços similares.
    // Isso elimina entradas prematuras baseadas em sinal único (sem estrutura confirmada).
    let doublePatternDetected = false;
    let doublePatternNote = '';

    if (girassol?.detected && girassolBias !== 'NEUTRAL' && finalAction !== 'HOLD') {
      const dp = metaTraderBridge.checkBolinhaMediaDoublePattern(sym, girassolBias as 'BUY' | 'SELL');
      doublePatternDetected = dp.detected;

      if (dp.detected) {
        const patternLabel = dp.patternType === 'double_top' ? 'DUPLO TOPO' : 'DUPLO FUNDO';
        const ageMin = Math.round(dp.ageMs / 60_000);
        doublePatternNote = `🌻 ${patternLabel} confirmado @ ${dp.pivotPrice.toFixed(5)} (${ageMin}min entre pivôs) — entrada autorizada`;
        console.log(`[MT5-Indicators] 🌻 ${sym}: ${patternLabel} bolinha_media confirmado — entrada liberada`);
      } else {
        // Ainda não há duplo padrão — bloquear e aguardar o segundo pivô
        const biasLabel = girassolBias === 'SELL' ? 'SELL (aguardando duplo topo)' : 'BUY (aguardando duplo fundo)';
        doublePatternNote = `⏳ bolinha_media ${biasLabel} — 1º pivô registrado, aguardando confirmação do 2º`;
        console.log(`[MT5-Indicators] ⏳ ${sym}: bolinha_media ${girassolBias} — aguardando 2º pivô para duplo padrão`);
        finalAction     = 'HOLD';
        finalConfidence = 0;
        finalReason     = `Aguardando duplo padrão: bolinha_media ${girassolBias} registrou 1º pivô — entrada somente quando 2º pivô em nível similar confirmar`;
      }
    }

    // ── Calcular bônus do Fibonacci ──────────────────────────────────────
    let fibBonus = 0;
    let fibBonusNote = '';
    if (girassolBias !== 'NEUTRAL' && fibonacci?.detected && fibNearestLevel !== null) {
      const currentPrice = ask || bid || 0;
      if (currentPrice > 0) {
        const distPct = Math.abs(fibNearestLevel - currentPrice) / currentPrice * 100;
        const fibLevels = (fibonacci.levels || []) as Array<{ level: string; price: number }>;
        const nearestFib = fibLevels.reduce((best: any, lv: any) => {
          const d = Math.abs(lv.price - currentPrice);
          return (!best || d < Math.abs(best.price - currentPrice)) ? lv : best;
        }, null as any);
        const isKeyLevel = nearestFib && ['38.2%', '50%', '61.8%'].includes(nearestFib.level);
        if (distPct < 0.1) {
          fibBonus = isKeyLevel ? 0.20 : 0.10;
          fibBonusNote = `📐 Fibonacci ${isKeyLevel ? 'CHAVE (' + nearestFib.level + ')' : 'próximo'} @ ${fibNearestLevel.toFixed(5)} (Δ${distPct.toFixed(3)}%) → confluência com Girassol +${(fibBonus * 100).toFixed(0)}%`;
        } else if (distPct < 0.5) {
          fibBonus = isKeyLevel ? 0.10 : 0.05;
          fibBonusNote = `📐 Fibonacci ${isKeyLevel ? nearestFib.level : ''} @ ${fibNearestLevel.toFixed(5)} (Δ${distPct.toFixed(3)}%) → zona próxima +${(fibBonus * 100).toFixed(0)}%`;
        }
      }
    }

    // ── VALIDAÇÃO FIBONACCI: bloquear contra S/R E confirmar timing de entrada ─
    //
    // O Fibonacci automático tem DUPLA FUNÇÃO no sistema:
    //  A) BLOQUEIO: impede operações contra zonas de suporte/resistência
    //     • Preço em SUPORTE Fibonacci → SELL bloqueado
    //     • Preço em RESISTÊNCIA Fibonacci → BUY bloqueado
    //  B) CONFIRMAÇÃO DE TIMING: quando o Girassol dispara, o Fibonacci diz
    //     se o MOMENTO é ideal (preço no nível certo) ou prematuro (meio do range)
    //     • Girassol BUY + preço em suporte Fibonacci → GATILHO IDEAL ✅
    //     • Girassol SELL + preço em resistência Fibonacci → GATILHO IDEAL ✅
    //     • Girassol ativo mas preço longe de qualquer nível → timing prematuro ⏳
    let fibTimingStatus: 'confirmed' | 'premature' | 'no_data' = 'no_data';
    let fibTimingLevelName  = '';
    let fibTimingLevelPrice = 0;
    let fibTimingDistPct    = 0;

    if (fibonacci?.detected && Array.isArray(fibonacci.levels) && fibonacci.levels.length > 0) {
      const currentPrice = ask || bid || 0;
      if (currentPrice > 0) {
        const fibLevels = (fibonacci.levels as Array<{ level: string; price: number }>).filter(l => l.price > 0);
        const fib0   = fibLevels.find(l => l.level === '0.0%'   || l.level === '0%');
        const fib100 = fibLevels.find(l => l.level === '100.0%' || l.level === '100%');

        const getSRType = (levelName: string, topToBottom: boolean): 'support' | 'resistance' | null => {
          if (topToBottom) {
            if (['0.0%', '0%', '23.6%', '38.2%'].includes(levelName)) return 'resistance';
            if (['61.8%', '78.6%', '100.0%', '100%'].includes(levelName)) return 'support';
          } else {
            if (['0.0%', '0%', '23.6%', '38.2%'].includes(levelName)) return 'support';
            if (['61.8%', '78.6%', '100.0%', '100%'].includes(levelName)) return 'resistance';
          }
          return null;
        };

        if (fib0 && fib100) {
          const fibDrawnTopToBottom = fib0.price > fib100.price;
          const keyFibNames = ['0.0%', '0%', '23.6%', '38.2%', '50%', '50.0%', '61.8%', '78.6%', '100.0%', '100%'];
          let foundNearLevel = false;

          for (const lv of fibLevels) {
            if (!keyFibNames.includes(lv.level)) continue;
            const distPct = Math.abs(lv.price - currentPrice) / currentPrice * 100;
            if (distPct >= 0.5) continue; // fora da zona de influência
            const srType = getSRType(lv.level, fibDrawnTopToBottom);
            if (!srType) continue;

            foundNearLevel = true;

            // ── A) BLOQUEIO: trade contra a zona ────────────────────────────
            if (finalAction !== 'HOLD') {
              if (srType === 'support' && finalAction === 'SELL') {
                indicatorNotes.push(`🛑 Fibonacci BLOQUEOU VENDA: preço em SUPORTE ${lv.level} @ ${lv.price.toFixed(5)} (Δ${distPct.toFixed(3)}%) — operar contra suporte é de alto risco`);
                console.log(`[MT5-Indicators] 🛑 ${sym}: SELL BLOQUEADO pelo Fibonacci — suporte ${lv.level}`);
                finalAction = 'HOLD'; finalConfidence = 0;
                finalReason = `Fibonacci bloqueia SELL: preço em suporte ${lv.level} @ ${lv.price.toFixed(5)} — aguardar rompimento`;
                break;
              } else if (srType === 'resistance' && finalAction === 'BUY') {
                indicatorNotes.push(`🛑 Fibonacci BLOQUEOU COMPRA: preço em RESISTÊNCIA ${lv.level} @ ${lv.price.toFixed(5)} (Δ${distPct.toFixed(3)}%) — operar contra resistência é de alto risco`);
                console.log(`[MT5-Indicators] 🛑 ${sym}: BUY BLOQUEADO pelo Fibonacci — resistência ${lv.level}`);
                finalAction = 'HOLD'; finalConfidence = 0;
                finalReason = `Fibonacci bloqueia BUY: preço em resistência ${lv.level} @ ${lv.price.toFixed(5)} — aguardar rompimento`;
                break;
              }
            }

            // ── B) CONFIRMAÇÃO DE TIMING: trade alinhado com a zona ──────────
            // Se chegou aqui, trade NÃO foi bloqueado → zona confirma o timing
            if (finalAction !== 'HOLD') {
              const matchesBuy  = srType === 'support'    && finalAction === 'BUY';
              const matchesSell = srType === 'resistance' && finalAction === 'SELL';
              if (matchesBuy || matchesSell) {
                fibTimingStatus     = 'confirmed';
                fibTimingLevelName  = lv.level;
                fibTimingLevelPrice = lv.price;
                fibTimingDistPct    = distPct;
                console.log(`[MT5-Indicators] ✅ ${sym}: Fibonacci CONFIRMA timing ${finalAction} — ${srType} ${lv.level} @ ${lv.price.toFixed(5)} (Δ${distPct.toFixed(3)}%)`);
              }
            }
            break;
          }

          // Fibonacci detectado mas preço longe de qualquer nível chave → timing prematuro
          if (!foundNearLevel && finalAction !== 'HOLD') {
            fibTimingStatus = 'premature';
          }
        }
      }
    }

    if (girassol?.detected && girassolBias !== 'NEUTRAL') {
      // ── CASO 1: Girassol com sinal claro ────────────────────────────────
      if (girassolBias === finalAction) {
        // ── Boost escalonado por Girassol + confirmação de timing do Fibonacci ──
        //
        // Hierarquia de boost:
        //  MÁXIMO (Girassol 3/3 + Fibonacci confirma timing) → +80% confiança
        //  ÓTIMO  (Girassol 2-3/3 + Fibonacci confirma)      → +65% confiança
        //  BOM    (Girassol 1-2/3 + Fibonacci confirma)      → +45% confiança
        //  NORMAL (Girassol 3/3, sem Fibonacci)              → +60% (padrão)
        //  REDUZIDO (Fibonacci detectado mas timing prematuro) → +15% máx (aguardar)
        //  MÍNIMO (Girassol 1/3, sem Fibonacci)              → +25%
        let baseBoost: number;
        let confluenceNote: string;

        if (fibTimingStatus === 'confirmed') {
          // GATILHO IDEAL: Girassol + Fibonacci no nível certo → máxima certeza
          baseBoost = girassolConfluence >= 3 ? 1.80   // 3/3 + Fibonacci: +80%
                    : girassolConfluence >= 2 ? 1.65   // 2/3 + Fibonacci: +65%
                    : 1.45;                            // 1/3 + Fibonacci: +45%
          confluenceNote = `🎯 GATILHO CONFIRMADO: Girassol (${girassolConfluence}/3 níveis) + Fibonacci ${fibTimingLevelName} @ ${fibTimingLevelPrice.toFixed(5)} (Δ${fibTimingDistPct.toFixed(3)}%) → ENTRADA IDEAL`;
          finalReason = `GATILHO CONFLUENTE: ${finalReason} | ${girassolDesc} | Fibonacci confirma timing`;
        } else if (fibTimingStatus === 'premature') {
          // Fibonacci detectado mas preço não está no nível certo → timing prematuro
          // Reduz o boost: Girassol disparou mas o momento ainda não chegou
          baseBoost = girassolConfluence >= 3 ? 1.15   // 3/3 mas timing prematuro: +15%
                    : girassolConfluence >= 2 ? 1.10   // 2/3 mas timing prematuro: +10%
                    : 0.90;                            // 1/3 e timing prematuro: -10% (aguardar)
          confluenceNote = `⏳ Girassol ATIVO (${girassolConfluence}/3 níveis ${finalAction}) mas Fibonacci indica timing PREMATURO — preço não está em zona S/R chave. Aguardar confluência.`;
          finalReason = `${finalReason} | ${girassolDesc} | ⏳ Fibonacci: aguardar zona`;
        } else {
          // Fibonacci não detectado → boost padrão do Girassol
          baseBoost = girassolConfluence >= 3 ? 1.60   // 3/3 níveis: +60%
                    : girassolConfluence >= 2 ? 1.40   // 2/3 níveis: +40%
                    : 1.25;                            // 1/3 nível:  +25%
          confluenceNote = `✅ Girassol CONFIRMA ${finalAction} (${girassolConfluence}/3 níveis) → +${((baseBoost - 1) * 100).toFixed(0)}% confiança`;
          finalReason = `${finalReason} | ${girassolDesc}`;
        }

        finalConfidence = Math.min(100, finalConfidence * baseBoost);
        indicatorNotes.push(confluenceNote);

        // Bônus adicional do Fibonacci por proximidade (quando timing confirmado, bônus maior)
        if (fibBonus > 0 && fibTimingStatus !== 'premature') {
          const adjustedFibBonus = fibTimingStatus === 'confirmed' ? fibBonus * 1.5 : fibBonus;
          finalConfidence = Math.min(100, finalConfidence * (1 + adjustedFibBonus));
          indicatorNotes.push(fibBonusNote);
        }

        // Se boost ficou menor que 1 (timing prematuro + 1 nível), bloquear
        if (baseBoost < 1.0 && fibTimingStatus === 'premature') {
          finalAction     = 'HOLD';
          finalConfidence = 0;
          finalReason     = `Timing prematuro: Girassol ${girassolBias} (${girassolConfluence}/3) ativo mas Fibonacci indica preço fora de zona chave — aguardar nível`;
        }
      } else if (finalAction === 'HOLD') {
        // IA ainda sem sinal mas Girassol disparou: nenhuma acão adicional aqui.
        // O bridge vai gerar sinal com threshold reduzido no próximo ciclo.
        const fibHint = fibTimingStatus === 'confirmed' ? ` | 📐 Fibonacci confirma zona — pronto para gatilho` : fibTimingStatus === 'premature' ? ` | ⏳ Fibonacci: aguardar zona` : '';
        indicatorNotes.push(`🌻 Girassol ATIVO (${girassolConfluence}/3 níveis ${girassolBias}) — aguardando confirmação da IA (threshold reduzido para próximo ciclo)${fibHint}`);
      } else {
        // Girassol CONTRADIZ o sinal da IA → bloquear SEMPRE
        indicatorNotes.push(`🚫 Girassol CONTRADIZ IA: ${finalAction}→${girassolBias} (${girassolConfluence}/3 níveis) — operação bloqueada`);
        console.log(`[MT5-Indicators] 🚫 Sinal ${finalAction} BLOQUEADO pelo Girassol (${girassolBias}, ${girassolConfluence} níveis) | ${sym}`);
        finalAction     = 'HOLD';
        finalConfidence = 0;
        finalReason     = `Bloqueado: Girassol ${girassolBias} contradiz IA ${baseSignal?.action || '?'} — ${girassolDesc}`;
      }
    } else if (girassol?.detected && girassolBias === 'NEUTRAL') {
      // ── CASO 2: Girassol instalado mas NEUTRO → HOLD obrigatório ────────
      // Quando o Girassol está presente no gráfico, ele É o gatilho.
      // Sem sinal do Girassol = sem entrada, independentemente do consenso da IA.
      indicatorNotes.push(`⏸️ Girassol NEUTRO — ${girassolDesc}`);
      console.log(`[MT5-Indicators] ⏸️ ${sym}: Girassol detectado mas sem sinal direcional (NEUTRO) — IA aguarda gatilho`);
      finalAction     = 'HOLD';
      finalConfidence = 0;
      finalReason     = `Aguardando gatilho: Girassol ativo mas sem sinal nos 3 níveis — ${girassolDesc}`;
    } else if (!girassol?.detected) {
      // ── CASO 3: Girassol não instalado no gráfico → fallback ────────────
      // Sem o indicador instalado, a IA opera com threshold normal (70%).
      const requireGirassol = metaTraderBridge.getConfig().requireGirassolConfirmation;
      if (requireGirassol && finalAction !== 'HOLD') {
        indicatorNotes.push(`⚠️ Girassol NÃO DETECTADO — operação bloqueada (modo Girassol Obrigatório ativo)`);
        console.log(`[MT5-Indicators] ⚠️ ${sym}: Girassol obrigatório mas não encontrado no gráfico`);
        finalAction     = 'HOLD';
        finalConfidence = 0;
        finalReason     = `Bloqueado: Girassol não detectado no gráfico MT5 — instalar o indicador para ativar o sistema`;
      } else {
        indicatorNotes.push(`ℹ️ Girassol não detectado no gráfico — IA operando em modo fallback (threshold 70%). Instale o Girassol para ativar o gatilho primário.`);
      }
    }

    // ── Log do Fibonacci (integração de entrada já aplicada acima) ──────
    if (fibonacci?.detected) {
      indicatorNotes.push(fibDesc);
    }

    // ── Sentimento de Mercado Brasileiro (noticiário em tempo real) ───────
    // REGRA POR MODALIDADE:
    //  • Day Trade / Scalp: notícias são CONTEXTO — apenas ajustam confiança (±30%).
    //    Nunca bloqueiam a entrada. Girassol + Fibonacci + IA são os gatilhos primários.
    //    Scalp opera em janelas de minutos; o macro do dia inteiro é contexto, não veto.
    //  • Swing / Posição: notícias podem BLOQUEAR operações na direção contrária
    //    quando o sentimento macro BR é forte (≥60%). Horizonte mais longo = maior peso macro.
    if (finalAction !== 'HOLD') {
      try {
        const brazilSentiment = await brazilNewsService.getBrazilMarketSentiment();
        const { aiInfluence, direction, strength, topHeadline, newsCount } = brazilSentiment;

        const bridgeConfig     = metaTraderBridge.getConfig();
        const tradingTimeframe = bridgeConfig.tradingTimeframe ?? 'day_trade';
        const tradingStyle     = bridgeConfig.tradingStyle     ?? 'scalp';
        const isScalpMode      = tradingTimeframe === 'day_trade' && tradingStyle === 'scalp';

        if (isScalpMode) {
          // SCALP: noticiário é contexto, nunca veto — Girassol + Fibonacci + IA prioridade máxima
          if (Math.abs(aiInfluence.confidenceModifier) > 0.02) {
            finalConfidence = Math.max(0, Math.min(100, finalConfidence * (1 + aiInfluence.confidenceModifier)));
            const modStr = aiInfluence.confidenceModifier > 0
              ? `+${(aiInfluence.confidenceModifier * 100).toFixed(0)}%`
              : `${(aiInfluence.confidenceModifier * 100).toFixed(0)}%`;
            indicatorNotes.push(`🇧🇷 [SCALP] Noticiário BR ${direction.toUpperCase()} (${strength}% força, ${newsCount} notícias) → confiança ${modStr} | Girassol é o gatilho primário — sem veto macro | "${topHeadline.substring(0, 45)}..."`);
          } else {
            indicatorNotes.push(`🇧🇷 [SCALP] Noticiário BR ${direction.toUpperCase()} (${newsCount} notícias) — contexto diário, sem impacto no scalp`);
          }
          if (aiInfluence.blocksBuy && finalAction === 'BUY') {
            console.log(`[MT5-Indicators] 🇧🇷 [SCALP] ${sym}: notícia BR BEARISH ${strength}% — registrado como contexto, Girassol permite entrada`);
          } else if (aiInfluence.blocksSell && finalAction === 'SELL') {
            console.log(`[MT5-Indicators] 🇧🇷 [SCALP] ${sym}: notícia BR BULLISH ${strength}% — registrado como contexto, Girassol permite entrada`);
          }
        } else {
          // SWING / POSIÇÃO: bloqueio por sentimento macro BR extremo
          if (aiInfluence.blocksBuy && finalAction === 'BUY') {
            indicatorNotes.push(`🇧🇷 Noticiário BR BEARISH (${strength}%) bloqueia COMPRA — risco macroeconômico elevado`);
            console.log(`[MT5-Indicators] 🇧🇷 ${sym}: BUY BLOQUEADO por sentimento BR BEARISH (${strength}%)`);
            finalAction     = 'HOLD';
            finalConfidence = 0;
            finalReason     = `${aiInfluence.reason} | "${topHeadline.substring(0, 60)}..."`;
          } else if (aiInfluence.blocksSell && finalAction === 'SELL') {
            indicatorNotes.push(`🇧🇷 Noticiário BR BULLISH (${strength}%) bloqueia VENDA — ambiente de mercado positivo`);
            console.log(`[MT5-Indicators] 🇧🇷 ${sym}: SELL BLOQUEADO por sentimento BR BULLISH (${strength}%)`);
            finalAction     = 'HOLD';
            finalConfidence = 0;
            finalReason     = `${aiInfluence.reason} | "${topHeadline.substring(0, 60)}..."`;
          } else if (Math.abs(aiInfluence.confidenceModifier) > 0.02) {
            finalConfidence = Math.max(0, Math.min(100, finalConfidence * (1 + aiInfluence.confidenceModifier)));
            const modStr = aiInfluence.confidenceModifier > 0
              ? `+${(aiInfluence.confidenceModifier * 100).toFixed(0)}%`
              : `${(aiInfluence.confidenceModifier * 100).toFixed(0)}%`;
            indicatorNotes.push(`🇧🇷 Noticiário BR ${direction.toUpperCase()} (${strength}% força, ${newsCount} notícias) → confiança ${modStr} | "${topHeadline.substring(0, 50)}..."`);
          } else {
            indicatorNotes.push(`🇧🇷 Noticiário BR NEUTRO (${newsCount} notícias analisadas) — sem impacto direcional`);
          }
        }
      } catch (brazilErr) {
        // Não bloquear trade por falha no serviço de notícias
        indicatorNotes.push(`🇧🇷 Noticiário BR: serviço temporariamente indisponível`);
      }
    }

    // ── Recalcular SL/TP usando indicadores reais do EA ──────────────────
    let refinedSL   = baseSignal?.stopLoss    ?? 0;
    let refinedTP   = baseSignal?.takeProfit  ?? 0;
    let refinedSLPips = baseSignal?.stopLossPips   ?? 0;
    let refinedTPPips = baseSignal?.takeProfitPips  ?? 0;
    let slTpSource  = 'signal_original';

    if (baseSignal && finalAction !== 'HOLD' && (finalAction === 'BUY' || finalAction === 'SELL')) {
      const currentPrice = ask || bid || baseSignal.entryPrice || 0;

      if (currentPrice > 0) {
        const atr = metaTraderBridge.getSymbolATR(sym) || currentPrice * 0.002;

        const fibLevels = fibonacci?.detected && Array.isArray(fibonacci.levels)
          ? (fibonacci.levels as Array<{ level: string; price: number }>).filter(l => l.price > 0)
          : undefined;

        const sltp = metaTraderBridge.calcIndicatorDrivenSLTP({
          symbol:                sym,
          action:                finalAction as 'BUY' | 'SELL',
          entryPrice:            currentPrice,
          atr,
          girassolSupportLevel,
          girassolResistanceLevel,
          fibonacciLevels:       fibLevels,
          indicatorBuffers:      rawBuffers,
        });

        refinedSL     = sltp.stopLoss;
        refinedTP     = sltp.takeProfit;
        refinedSLPips = sltp.slPips;
        refinedTPPips = sltp.tpPips;
        slTpSource    = sltp.source;

        indicatorNotes.push(`📍 SL/TP recalculado via indicadores reais (${sltp.source}): SL=${sltp.stopLoss.toFixed(5)} TP=${sltp.takeProfit.toFixed(5)}`);
        console.log(`[MT5-Indicators] 📍 ${sym} SL/TP: ${sltp.source} | SL=${sltp.stopLoss.toFixed(5)} (${sltp.slPips}pip) | TP=${sltp.takeProfit.toFixed(5)} (${sltp.tpPips}pip)`);

        // ── TP por microestrutura (45% do swing range + âncora Fibonacci) ──────
        // Só aplica quando o duplo padrão da bolinha_media foi confirmado,
        // garantindo que a entrada é de qualidade e o alvo respeita a estrutura.
        if (doublePatternDetected) {
          const microCandles = metaTraderBridge.getMarketData(sym);
          if (microCandles.length >= 10) {
            const microTP = metaTraderBridge.calcMicrostructureTP(
              microCandles,
              finalAction as 'BUY' | 'SELL',
              currentPrice,
              fibLevels
            );
            if (microTP > 0) {
              const pipUnit = sym.includes('JPY') ? 0.01 : 0.00001;
              refinedTP     = microTP;
              refinedTPPips = Math.round(Math.abs(microTP - currentPrice) / pipUnit);
              slTpSource    = sltp.source + '+microstructure_tp';
              indicatorNotes.push(`🎯 TP microestrutura (duplo padrão confirmado): 45% swing range${fibLevels && fibLevels.length > 0 ? ' + âncora Fibonacci' : ''} → ${microTP.toFixed(5)} (${refinedTPPips}pip)`);
              console.log(`[MT5-Indicators] 🎯 ${sym}: TP microestrutura=${microTP.toFixed(5)} (${refinedTPPips}pip) | candles=${microCandles.length}`);
            }
          }
        }
      }
    }

    // Adicionar contexto do ativo ao log
    if (derivProfile) {
      indicatorNotes.push(`📊 ${derivProfile.family} (${derivProfile.volClass}) — ${derivProfile.trendType} | RSI thr: ${derivProfile.rsiOversold}/${derivProfile.rsiOverbought}`);
    }

    // Monta resposta final
    if (!baseSignal || finalAction === 'HOLD') {
      return res.json({
        action: 'HOLD',
        reason: finalReason,
        confidence: finalConfidence,
        indicatorNotes,
        girassolBias,
        girassolConfluence,
        girassolDescription:   girassolDesc,
        girassolLevels:        girassolLevelSummary,
        girassolSupportLevel:  girassolSupportLevel ?? null,
        girassolResistLevel:   girassolResistanceLevel ?? null,
        girassolRawBuffers:    girassolRawBufferDiag,
        fibonacciDescription:  fibDesc,
        fibonacciNearestLevel: fibNearestLevel,
        indicatorsDetected:    indicatorCount || 0,
        assetFamily:  derivProfile?.family      ?? null,
        assetTrend:   derivProfile?.trendType   ?? null,
        assetVolClass: derivProfile?.volClass   ?? null,
        timestamp: Date.now()
      });
    }

    res.json({
      id:                    baseSignal.id,
      symbol:                baseSignal.symbol,
      action:                finalAction,
      lotSize:               baseSignal.lotSize,
      stopLoss:              refinedSL,
      takeProfit:            refinedTP,
      stopLossPips:          refinedSLPips,
      takeProfitPips:        refinedTPPips,
      slTpSource,
      entryPrice:            baseSignal.entryPrice,
      confidence:            Math.round(finalConfidence * 10) / 10,
      reason:                finalReason,
      indicatorNotes,
      girassolBias,
      girassolConfluence,
      girassolDescription:   girassolDesc,
      girassolLevels:        girassolLevelSummary,
      girassolSupportLevel:  girassolSupportLevel ?? null,
      girassolResistLevel:   girassolResistanceLevel ?? null,
      girassolRawBuffers:    girassolRawBufferDiag,
      fibonacciDescription:  fibDesc,
      fibonacciNearestLevel: fibNearestLevel,
      indicatorsDetected:    indicatorCount || 0,
      assetFamily:           derivProfile?.family      ?? null,
      assetTrend:            derivProfile?.trendType   ?? null,
      assetVolClass:         derivProfile?.volClass    ?? null,
      assetRsiThresholds:    derivProfile ? { oversold: derivProfile.rsiOversold, overbought: derivProfile.rsiOverbought } : null,
      assetContext,
      aiSources:             baseSignal.aiSources,
      timestamp:             baseSignal.timestamp,
      expiresAt:             baseSignal.expiresAt
    });
  } catch (err: any) {
    console.error('[MT5-Indicators] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metatrader/asset-profile/:symbol
 * Retorna o perfil completo do ativo sintético Deriv, incluindo
 * comportamento, limiares de indicadores, parâmetros de SL/TP e contexto IA.
 */
router.get('/asset-profile/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol;
    const profile = metaTraderBridge.getDerivSyntheticProfile(symbol);
    const aiContext = metaTraderBridge.getAssetAIContext(symbol);
    const atr = metaTraderBridge.getSymbolATR(symbol);

    if (!profile) {
      return res.json({
        symbol,
        found: false,
        message: `Nenhum perfil encontrado para ${symbol}. O ativo pode ser um par Forex ou símbolo não reconhecido.`,
        aiContext,
        atr: atr || null
      });
    }

    res.json({
      symbol,
      found: true,
      profile,
      aiContext,
      atr: atr || null,
      indicatorGuidance: {
        rsiOversold:   profile.rsiOversold,
        rsiOverbought: profile.rsiOverbought,
        slAtrMultiplier: profile.slAtrMultiplier,
        tpAtrMultiplier: profile.tpAtrMultiplier,
        suggestedSLPips: atr > 0 ? Math.round(atr * profile.slAtrMultiplier / 0.0001) : null,
        suggestedTPPips: atr > 0 ? Math.round(atr * profile.tpAtrMultiplier / 0.0001) : null,
        useFibonacci: profile.useFibonacci,
        optimalTimeframe: profile.optimalTimeframe,
        spikeAlert: profile.spikeIndex ? { direction: profile.spikeDirection, frequency: profile.spikeFrequency } : null,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/market-data', (req: Request, res: Response) => {
  try {
    const { symbol, candles } = req.body;
    if (!symbol || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'symbol e candles são obrigatórios' });
    }
    metaTraderBridge.addMarketData(symbol, candles);

    // ── Girassol Sintético: processa candles recebidos do EA antigo ──────────
    // Quando o EA não envia buffers do Girassol (versão antiga), calculamos
    // um sinal equivalente via ZigZag server-side e injetamos no cache.
    const existingGirassol = metaTraderBridge.getGirassolBias(symbol);
    const existingIsStale = !existingGirassol; // sem dados = calcular sintético

    if (existingIsStale && candles.length >= 20) {
      setImmediate(() => {
        try {
          const result = computeSyntheticGirassol(candles);
          if (result.bias !== 'NEUTRAL' || result.adx >= 20) {
            metaTraderBridge.setGirassolBias(symbol, result.bias, result.levelCount);
            console.log(`[MT5Bridge] 🌻 Girassol Sintético ${symbol}: ${result.bias} (${result.levelCount}/3 níveis) | ADX=${result.adx.toFixed(1)} | ${result.description}`);
          }
        } catch (_e) {}
      });
    }

    res.json({ ok: true, received: candles.length, symbol });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trade/open', (req: Request, res: Response) => {
  try {
    const { ticket, symbol, type, lots, openPrice, stopLoss, takeProfit, openTime, signalId, currentPrice } = req.body;
    if (!ticket || !symbol || !type) {
      return res.status(400).json({ error: 'ticket, symbol e type são obrigatórios' });
    }
    const position: MT5Position = {
      ticket: Number(ticket),
      symbol,
      type: type as 'BUY' | 'SELL',
      lots: Number(lots) || 0.01,
      openPrice: Number(openPrice),
      currentPrice: Number(currentPrice || openPrice),
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit),
      profit: 0,
      openTime: Number(openTime) || Date.now(),
      signalId: signalId || ''
    };
    metaTraderBridge.confirmTradeOpen(position);
    res.json({ ok: true, ticket: position.ticket, message: 'Posição registrada com sucesso' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trade/update', (req: Request, res: Response) => {
  try {
    const { ticket, currentPrice, profit, stopLoss, takeProfit } = req.body;
    if (!ticket) return res.status(400).json({ error: 'ticket obrigatório' });
    metaTraderBridge.updatePosition(Number(ticket), {
      currentPrice: Number(currentPrice),
      profit: Number(profit),
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit)
    });
    res.json({ ok: true, ticket });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trade/close', (req: Request, res: Response) => {
  try {
    const { ticket, signalId, symbol, type, lots, openPrice, closePrice, profit, pips, openTime, closeTime, closeReason } = req.body;
    if (!ticket) return res.status(400).json({ error: 'ticket obrigatório' });
    const result: MT5TradeResult = {
      ticket: Number(ticket),
      signalId: signalId || '',
      symbol: symbol || '',
      type: type as 'BUY' | 'SELL',
      lots: Number(lots) || 0.01,
      openPrice: Number(openPrice),
      closePrice: Number(closePrice),
      profit: Number(profit),
      pips: Number(pips),
      openTime: Number(openTime) || 0,
      closeTime: Number(closeTime) || Date.now(),
      closeReason: closeReason as MT5TradeResult['closeReason'] || 'MANUAL'
    };
    metaTraderBridge.confirmTradeClose(result);
    res.json({ ok: true, ticket: result.ticket, profit: result.profit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/positions', (_req: Request, res: Response) => {
  try {
    const bridgePositions = metaTraderBridge.getOpenPositions();
    res.json(bridgePositions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades', (_req: Request, res: Response) => {
  try {
    const bridgeTrades = metaTraderBridge.getRecentTrades();
    res.json(bridgeTrades);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  try {
    const bridgeStatus = metaTraderBridge.getStatus();
    res.json(bridgeStatus);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/config', (_req: Request, res: Response) => {
  try {
    const config = metaTraderBridge.getConfig();
    const { apiToken: _, ...safeConfig } = config;
    res.json(safeConfig);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/download-ea
 * Serve o EA v8.0 com ServerURL pré-preenchida (lê arquivo do disco).
 */
router.get('/download-ea', (req: Request, res: Response) => {
  try {
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    const serverUrl = replitDomain
      ? `https://${replitDomain}`
      : `${req.protocol}://${req.get('host')}`;

    // Lê o EA v8.0 do arquivo estático e substitui a URL do servidor
    const eaPath = path.join(process.cwd(), 'public', 'downloads', 'InvistaPRO_EA.mq5');
    let content: string;
    try {
      content = fs.readFileSync(eaPath, 'utf-8');
      // Injeta URL atual do servidor no parâmetro ServerURL
      content = content.replace(
        /input string   ServerURL        = ".*?";/,
        `input string   ServerURL        = "${serverUrl}"; // URL do servidor InvistaPRO`
      );
    } catch (_e) {
      // Fallback: usa a função legada se o arquivo não for encontrado
      const config = metaTraderBridge.getConfig();
      const token = config.apiToken || '';
      content = generateEAContent(serverUrl, token, config);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="InvistaPRO_EA.mq5"');
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function generateEAContent(serverUrl: string, token: string, config: any): string {
  const lotSize           = config.defaultLotSize       ?? 0.01;
  const stopLoss          = config.stopLossPips          ?? 30;
  const takeProfit        = config.takeProfitPips        ?? 60;
  const maxPositions      = config.maxOpenPositions      ?? 5;
  const maxDailyLoss      = config.maxDailyLoss          ?? 100;
  const maxDailyProfit    = config.maxDailyProfit        ?? 500;
  const useAISL           = config.useAIStopLoss         ? 'true' : 'false';
  const useTrailing       = config.useTrailingStop       ? 'true' : 'false';
  const trailingPips      = config.trailingStopPips      ?? 15;
  const signalTimeout     = config.signalTimeoutSeconds  ?? 60;
  const fullAIMode        = config.fullAIMode            ? 'true' : 'false';
  const useAILotSize      = config.useAILotSize          ? 'true' : 'false';
  const useAITrailing     = config.useAITrailing         ? 'true' : 'false';
  const useAIRiskLimits   = config.useAIRiskLimits       ? 'true' : 'false';

  return `//+------------------------------------------------------------------+
//|                                              InvistaPRO_EA.mq5   |
//|                        Copyright 2025, InvistaPRO Systems        |
//|                     Powered by 5 AI Systems + MetaTrader Bridge  |
//+------------------------------------------------------------------+
#property copyright "InvistaPRO Systems"
#property link      "${serverUrl}"
#property version   "2.00"
#property strict

#include <Trade\\Trade.mqh>
#include <Trade\\PositionInfo.mqh>

//--- ══════════════════════════════════════════════════════════════
//--- MODO DE OPERAÇÃO
//--- ══════════════════════════════════════════════════════════════
input bool     FullAIMode       = ${fullAIMode};  // ✅ IA controla 100% de tudo (lote, SL, TP, trailing, limites)

//--- ══════════════════════════════════════════════════════════════
//--- CONEXÃO COM O SERVIDOR
//--- ══════════════════════════════════════════════════════════════
input string   ServerURL        = "${serverUrl}";
input string   ApiToken         = "${token}";
input string   TradingSymbol    = "";               // Vazio = par atual do gráfico

//--- ══════════════════════════════════════════════════════════════
//--- LOTE
//--- ══════════════════════════════════════════════════════════════
input bool     UseAILotSize     = ${useAILotSize};  // IA define o lote ideal por operação
input double   LotSize          = ${lotSize};        // Lote fixo (ignorado se UseAILotSize=true ou FullAIMode=true)

//--- ══════════════════════════════════════════════════════════════
//--- STOP LOSS / TAKE PROFIT
//--- ══════════════════════════════════════════════════════════════
input bool     UseAIStopLoss    = ${useAISL};        // IA calcula SL/TP baseado em ATR e volatilidade
input int      StopLoss         = ${stopLoss};        // SL em pips (ignorado se UseAIStopLoss=true ou FullAIMode=true)
input int      TakeProfit       = ${takeProfit};      // TP em pips (ignorado se UseAIStopLoss=true ou FullAIMode=true)

//--- ══════════════════════════════════════════════════════════════
//--- TRAILING STOP
//--- ══════════════════════════════════════════════════════════════
input bool     UseAITrailing    = ${useAITrailing};  // IA ativa trailing quando a operação está lucrativa
input bool     UseTrailing      = ${useTrailing};     // Trailing fixo (ignorado se UseAITrailing=true ou FullAIMode=true)
input int      TrailingPips     = ${trailingPips};    // Distância trailing em pips

//--- ══════════════════════════════════════════════════════════════
//--- GESTÃO DE RISCO
//--- ══════════════════════════════════════════════════════════════
input bool     UseAIRiskLimits  = ${useAIRiskLimits}; // IA gerencia posições máx. e limites diários
input int      MaxPositions     = ${maxPositions};     // Máx. posições simultâneas (ignorado se UseAIRiskLimits=true ou FullAIMode=true)
input double   MaxDailyLoss     = ${maxDailyLoss};     // Perda máx. diária em $ (ignorado se UseAIRiskLimits=true ou FullAIMode=true)
input double   MaxDailyProfit   = ${maxDailyProfit};   // Lucro alvo diário em $ (ignorado se UseAIRiskLimits=true ou FullAIMode=true)

//--- ══════════════════════════════════════════════════════════════
//--- TÉCNICO
//--- ══════════════════════════════════════════════════════════════
input int      SignalTimeout    = ${signalTimeout};
input int      PollIntervalSec  = 5;
input int      HeartbeatSec     = 15;
input int      CandlesHistory   = 200;

//--- Global Variables
CTrade         trade;
CPositionInfo  posInfo;
datetime       lastSignalCheck  = 0;
datetime       lastHeartbeat    = 0;
datetime       lastDataUpload   = 0;
double         dailyProfit      = 0;
double         dailyLoss        = 0;
double         startDayBalance  = 0;   // saldo no início do dia
datetime       lastDayReset     = 0;   // último reset diário
string         lastSignalId     = "";
string         accountId        = "";

//--- Variáveis de modo IA (atualizadas via sinal e heartbeat)
bool   aiTrailingEnabled  = false;   // IA recomenda trailing para o trade atual
int    aiTrailingPips     = 15;      // Pips de trailing recomendados pela IA
int    aiMaxPositions     = 5;       // Máx. posições da IA (via heartbeat)
double aiMaxDailyLoss     = 100.0;   // Perda máx. da IA (via sinal)
double aiMaxDailyProfit   = 500.0;   // Lucro alvo da IA (via sinal)

//--- Helpers: obter limite de posições e limites diários conforme o modo ativo
int    GetEffectiveMaxPositions()  { return (FullAIMode || UseAIRiskLimits)  ? aiMaxPositions   : MaxPositions;  }
double GetEffectiveMaxDailyLoss()  { return (FullAIMode || UseAIRiskLimits)  ? aiMaxDailyLoss   : MaxDailyLoss;  }
double GetEffectiveMaxDailyProfit(){ return (FullAIMode || UseAIRiskLimits)  ? aiMaxDailyProfit : MaxDailyProfit; }

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit() {
   accountId = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   trade.SetExpertMagicNumber(20250101);
   trade.SetDeviationInPoints(10);
   
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) {
      Alert("⚠️ AlgoTrading não está habilitado! Habilite nas configurações do MetaTrader.");
      return INIT_FAILED;
   }
   
   // Capturar saldo inicial do dia
   startDayBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   lastDayReset    = TimeCurrent();
   
   Print("✅ InvistaPRO EA iniciado | Servidor: ", ServerURL);
   Print("📡 Conta: ", accountId, " | Par: ", GetSymbol());
   Print("💰 Saldo inicial do dia: $", DoubleToString(startDayBalance, 2));

   // Resumo do modo de operação ativo
   if(FullAIMode) {
      Print("🤖 MODO COMPLETO IA — A IA controla: lote, SL/TP, trailing, limites");
   } else {
      if(UseAILotSize)    Print("🤖 Lote: controlado pela IA");
      else                Print("💰 Lote: fixo em ", DoubleToString(LotSize, 2));
      if(UseAIStopLoss)   Print("🛡️ SL/TP: dinâmico pela IA");
      else                Print("🛡️ SL/TP: fixo ", StopLoss, "/", TakeProfit, " pips");
      if(UseAITrailing)   Print("📈 Trailing: controlado pela IA");
      else if(UseTrailing) Print("📈 Trailing: fixo em ", TrailingPips, " pips");
      if(UseAIRiskLimits) Print("⚠️ Limites: controlados pela IA");
      else                Print("⚠️ Limites: Máx.", MaxPositions, " pos | SL $", DoubleToString(MaxDailyLoss,2), " | TP $", DoubleToString(MaxDailyProfit,2));
   }
   
   SendHeartbeat();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
   Print("⏹️ InvistaPRO EA finalizado. Razão: ", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick() {
   datetime now = TimeCurrent();
   
   // Reset diário à meia-noite (novo dia de trading)
   MqlDateTime tmNow, tmLast;
   TimeToStruct(now, tmNow);
   TimeToStruct(lastDayReset, tmLast);
   if(tmNow.day != tmLast.day || tmNow.mon != tmLast.mon) {
      startDayBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      dailyProfit     = 0;
      dailyLoss       = 0;
      lastDayReset    = now;
      Print("🔄 Novo dia — saldo inicial resetado: $", DoubleToString(startDayBalance, 2));
   }
   
   // Heartbeat
   if(now - lastHeartbeat >= HeartbeatSec) {
      SendHeartbeat();
      lastHeartbeat = now;
   }
   
   // Upload de dados de mercado
   if(now - lastDataUpload >= 60) {
      UploadMarketData();
      lastDataUpload = now;
   }
   
   // Atualizar posições abertas
   UpdateOpenPositions();
   
   // Verificar trailing stop
   // Usar trailing se: manual ativado OU (modo IA ativado E IA recomendou trailing)
   bool doTrailing = UseTrailing || ((FullAIMode || UseAITrailing) && aiTrailingEnabled);
   if(doTrailing) ManageTrailingStop();
   
   // Checar limites diários
   if(!CheckDailyLimits()) return;
   
   // Verificar sinal das IAs
   if(now - lastSignalCheck >= PollIntervalSec) {
      CheckAndExecuteSignal();
      lastSignalCheck = now;
   }
}

//+------------------------------------------------------------------+
//| Envia heartbeat para o servidor                                  |
//+------------------------------------------------------------------+
void SendHeartbeat() {
   string symbol   = GetSymbol();
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin   = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   string broker   = AccountInfoString(ACCOUNT_COMPANY);
   int    platform = (int)TerminalInfoInteger(TERMINAL_BUILD);
   int    open     = CountOpenPositions();
   
   string body = StringFormat(
      "{\\\"accountId\\\":\\\"%s\\\",\\\"broker\\\":\\\"%s\\\","
      "\\\"balance\\\":%.2f,\\\"equity\\\":%.2f,\\\"freeMargin\\\":%.2f,"
      "\\\"openPositions\\\":%d,\\\"platform\\\":%d}",
      accountId, broker, balance, equity, margin, open, platform
   );
   
   char   req[];
   char   res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   
   int result = WebRequest("POST", ServerURL + "/api/mt5/heartbeat", headers, 5000, req, res, headers);
   if(result == 200) Print("💚 Heartbeat OK | Balance: $", DoubleToString(balance, 2));
   else              Print("⚠️ Heartbeat falhou: ", result);
}

//+------------------------------------------------------------------+
//| Upload dados de mercado para as IAs                              |
//+------------------------------------------------------------------+
void UploadMarketData() {
   string symbol = GetSymbol();
   MqlRates rates[];
   int copied = CopyRates(symbol, PERIOD_H1, 0, CandlesHistory, rates);
   if(copied <= 0) return;
   
   string candlesJson = "[";
   for(int i = 0; i < MathMin(copied, 100); i++) {
      if(i > 0) candlesJson += ",";
      candlesJson += StringFormat(
         "{\\\"open\\\":%.5f,\\\"high\\\":%.5f,\\\"low\\\":%.5f,\\\"close\\\":%.5f,\\\"volume\\\":%d,\\\"time\\\":%d}",
         rates[i].open, rates[i].high, rates[i].low, rates[i].close, (int)rates[i].tick_volume, (int)rates[i].time
      );
   }
   candlesJson += "]";
   
   string body = StringFormat("{\\\"symbol\\\":\\\"%s\\\",\\\"candles\\\":%s}", symbol, candlesJson);
   char req[], res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", ServerURL + "/api/mt5/market-data", headers, 10000, req, res, headers);
   Print("📊 Dados enviados: ", copied, " candles de ", symbol);
}

//+------------------------------------------------------------------+
//| Consulta e executa sinal das IAs                                 |
//+------------------------------------------------------------------+
void CheckAndExecuteSignal() {
   if(CountOpenPositions() >= GetEffectiveMaxPositions()) return;
   
   string symbol  = GetSymbol();
   string url     = ServerURL + "/api/mt5/signal?symbol=" + symbol + "&token=" + ApiToken;
   char   req[], res[];
   string headers = "";
   
   int code = WebRequest("GET", url, headers, 8000, req, res, headers);
   if(code != 200) { Print("⚠️ Falha ao buscar sinal: HTTP ", code); return; }
   
   string response = CharArrayToString(res);
   
   string action            = ExtractJsonString(response, "action");
   string signalId          = ExtractJsonString(response, "id");
   double confidence        = ExtractJsonDouble(response, "confidence");
   double slPrice           = ExtractJsonDouble(response, "stopLoss");
   double tpPrice           = ExtractJsonDouble(response, "takeProfit");
   double aiLotSize         = ExtractJsonDouble(response, "lotSize");
   string reason            = ExtractJsonString(response, "reason");
   // Campos de controle autônomo da IA
   bool   sigAITrail        = ExtractJsonBool(response, "aiTrailingEnabled");
   int    sigAITrailPips    = (int)ExtractJsonDouble(response, "aiTrailingPips");
   double sigAIMaxLoss      = ExtractJsonDouble(response, "aiMaxDailyLoss");
   double sigAIMaxProfit    = ExtractJsonDouble(response, "aiMaxDailyProfit");
   int    sigAIMaxPos       = (int)ExtractJsonDouble(response, "aiMaxPositions");

   if(signalId == lastSignalId || action == "HOLD" || action == "") return;

   // Atualizar limites da IA com valores do sinal (quando modo IA ativo)
   if(FullAIMode || UseAITrailing) {
      aiTrailingEnabled = sigAITrail;
      if(sigAITrailPips > 0) aiTrailingPips = sigAITrailPips;
   }
   if(FullAIMode || UseAIRiskLimits) {
      if(sigAIMaxLoss   > 0) aiMaxDailyLoss   = sigAIMaxLoss;
      if(sigAIMaxProfit > 0) aiMaxDailyProfit  = sigAIMaxProfit;
      if(sigAIMaxPos    > 0) aiMaxPositions    = sigAIMaxPos;
   }

   // Determinar lote efetivo
   double lotSize = (FullAIMode || UseAILotSize) ? (aiLotSize > 0 ? aiLotSize : LotSize) : LotSize;

   Print("🔔 Sinal recebido: ", action, " ", symbol, " | Confiança: ", DoubleToString(confidence * 100, 1), "% | Lote: ", DoubleToString(lotSize, 2), " | ", reason);
   if(FullAIMode) Print("🤖 Modo IA: trailing=", aiTrailingEnabled ? "SIM" : "NÃO", " pips=", aiTrailingPips, " | MaxPos=", aiMaxPositions);
   
   double entryPrice = (action == "BUY") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   double point      = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int    digits     = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   
   //--- Determinar se é índice de spike (Crash/Boom)
   string symUp = symbol;
   StringToUpper(symUp);
   bool isSpikeIdx = (StringFind(symUp, "CRASH") >= 0 || StringFind(symUp, "BOOM") >= 0);

   //--- Para TODOS os ativos (inclusive Crash/Boom): usar SL/TP calculados pela IA.
   //--- A IA calcula SL/TP adaptativos para cada tipo de operação:
   //---  • CONTINUIDADE em Crash/Boom: SL/TP moderados para seguir a tendência natural
   //---  • SPIKE em Crash/Boom: SL/TP apertados para capturar o movimento rápido
   //--- Se a IA não forneceu valores, usar os parâmetros manuais configurados.
   bool useAISL = (FullAIMode || UseAIStopLoss);
   if(!useAISL || slPrice <= 0) {
      slPrice = (action == "BUY") ? entryPrice - StopLoss * point : entryPrice + StopLoss * point;
   }
   if(!useAISL || tpPrice <= 0) {
      tpPrice = (action == "BUY") ? entryPrice + TakeProfit * point : entryPrice - TakeProfit * point;
   }

   //--- Garantir distância mínima exigida pelo broker
   //--- IMPORTANTE: Deriv retorna SYMBOL_TRADE_STOPS_LEVEL=0 para índices sintéticos,
   //--- por isso usamos mínimos fixos por família de ativo como fallback obrigatório.
   long   stopsLevel  = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double brokerMin   = (double)stopsLevel * point;

   //--- Mínimos por família baseados em % do preço atual (Deriv retorna STOPS_LEVEL=0)
   //--- Usando percentual do preço porque os índices sintéticos têm preços muito variados.
   double fixedMinSL = 0;
   string symUpLocal = symbol; StringToUpper(symUpLocal);
   if(StringFind(symUpLocal, "JUMP 100") >= 0 || StringFind(symUpLocal, "JUMP100") >= 0 || StringFind(symUpLocal, "JD100") >= 0)
      fixedMinSL = entryPrice * 0.040;   // Jump 100: 4% do preço
   else if(StringFind(symUpLocal, "JUMP 75") >= 0  || StringFind(symUpLocal, "JUMP75") >= 0  || StringFind(symUpLocal, "JD75") >= 0)
      fixedMinSL = entryPrice * 0.030;   // Jump 75:  3% do preço
   else if(StringFind(symUpLocal, "JUMP 50") >= 0  || StringFind(symUpLocal, "JUMP50") >= 0  || StringFind(symUpLocal, "JD50") >= 0)
      fixedMinSL = entryPrice * 0.020;   // Jump 50:  2% do preço (~600 pts em 30000)
   else if(StringFind(symUpLocal, "JUMP 25") >= 0  || StringFind(symUpLocal, "JUMP25") >= 0  || StringFind(symUpLocal, "JD25") >= 0)
      fixedMinSL = entryPrice * 0.015;   // Jump 25:  1.5% do preço
   else if(StringFind(symUpLocal, "JUMP 10") >= 0  || StringFind(symUpLocal, "JUMP10") >= 0  || StringFind(symUpLocal, "JD10") >= 0)
      fixedMinSL = entryPrice * 0.010;   // Jump 10:  1% do preço
   else if(StringFind(symUpLocal, "CRASH") >= 0 || StringFind(symUpLocal, "BOOM") >= 0)
      fixedMinSL = entryPrice * 0.005;   // Crash/Boom: 0.5% do preço
   else if(StringFind(symUpLocal, "VOLATILITY") >= 0 || StringFind(symUpLocal, "R_") >= 0)
      fixedMinSL = entryPrice * 0.002;   // Volatility (R_X): 0.2% do preço

   double minDist = MathMax(MathMax(brokerMin, fixedMinSL),
                            (SymbolInfoDouble(symbol, SYMBOL_ASK) - SymbolInfoDouble(symbol, SYMBOL_BID)) * 3.0);

   if(minDist > 0)
   {
      if(action == "BUY")
      {
         if(slPrice > 0 && (entryPrice - slPrice) < minDist) { slPrice = NormalizeDouble(entryPrice - minDist, digits); Print("⚠️ SL ajustado para mínimo broker: ", DoubleToString(slPrice, digits)); }
         if(tpPrice > 0 && (tpPrice - entryPrice) < minDist) { tpPrice = NormalizeDouble(entryPrice + minDist, digits); Print("⚠️ TP ajustado para mínimo broker: ", DoubleToString(tpPrice, digits)); }
      }
      else
      {
         if(slPrice > 0 && (slPrice - entryPrice) < minDist) { slPrice = NormalizeDouble(entryPrice + minDist, digits); Print("⚠️ SL ajustado para mínimo broker: ", DoubleToString(slPrice, digits)); }
         if(tpPrice > 0 && (entryPrice - tpPrice) < minDist) { tpPrice = NormalizeDouble(entryPrice - minDist, digits); Print("⚠️ TP ajustado para mínimo broker: ", DoubleToString(tpPrice, digits)); }
      }
   }
   if(slPrice > 0) slPrice = NormalizeDouble(slPrice, digits);
   if(tpPrice > 0) tpPrice = NormalizeDouble(tpPrice, digits);
   if(isSpikeIdx) Print("ℹ️ Crash/Boom — SL: ", DoubleToString(slPrice, digits), " TP: ", DoubleToString(tpPrice, digits));
   if(lotSize <= 0) lotSize = LotSize;

   bool ok = false;
   if(action == "BUY")  ok = trade.Buy(lotSize, symbol, entryPrice, slPrice, tpPrice, "InvistaPRO_" + signalId);
   if(action == "SELL") ok = trade.Sell(lotSize, symbol, entryPrice, slPrice, tpPrice, "InvistaPRO_" + signalId);
   
   if(ok) {
      lastSignalId = signalId;
      ulong ticket = trade.ResultOrder();
      Print("✅ Ordem executada: #", ticket, " ", action, " @ ", entryPrice);
      ReportTradeOpen(ticket, signalId, symbol, action, lotSize, entryPrice, slPrice, tpPrice);
   } else {
      Print("❌ Erro ao executar ordem: ", trade.ResultRetcode(), " - ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| Reporta abertura de trade para o servidor                        |
//+------------------------------------------------------------------+
void ReportTradeOpen(ulong ticket, string signalId, string symbol, string type, double lots, double openPrice, double sl, double tp) {
   string body = StringFormat(
      "{\\\"ticket\\\":%llu,\\\"signalId\\\":\\\"%s\\\",\\\"symbol\\\":\\\"%s\\\","
      "\\\"type\\\":\\\"%s\\\",\\\"lots\\\":%.2f,\\\"openPrice\\\":%.5f,"
      "\\\"stopLoss\\\":%.5f,\\\"takeProfit\\\":%.5f,\\\"openTime\\\":%d}",
      ticket, signalId, symbol, type, lots, openPrice, sl, tp, (int)TimeCurrent()
   );
   char req[], res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", ServerURL + "/api/mt5/trade/open", headers, 5000, req, res, headers);
}

//+------------------------------------------------------------------+
//| Atualiza posições abertas                                        |
//+------------------------------------------------------------------+
void UpdateOpenPositions() {
   // Calcular P&L líquido do dia (saldo atual vs saldo do início do dia)
   double currentBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   double floatingPL     = 0;
   
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;
      floatingPL += posInfo.Profit();
   }
   
   double netDayPL = (currentBalance + floatingPL) - startDayBalance;
   
   // Atualizar variáveis diárias com P&L líquido real
   if(netDayPL >= 0) {
      dailyProfit = netDayPL;
      dailyLoss   = 0;
   } else {
      dailyLoss   = MathAbs(netDayPL);
      dailyProfit = 0;
   }
   
   // Fechar posições se limites atingidos
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;
      
      ulong  ticket  = posInfo.Ticket();
      double profit  = posInfo.Profit();
      double current = posInfo.PriceCurrent();
      
      string closeReason = "";
      if(dailyLoss >= GetEffectiveMaxDailyLoss())     closeReason = "SL";
      if(dailyProfit >= GetEffectiveMaxDailyProfit()) closeReason = "TP";
      
      if(closeReason != "") {
         trade.PositionClose(ticket);
         ReportTradeClose(ticket, posInfo.Symbol(), posInfo.TypeDescription(),
                          posInfo.Volume(), posInfo.PriceOpen(), current,
                          profit, closeReason);
      }
   }
}

//+------------------------------------------------------------------+
//| Trailing stop — só ativa quando a posição está no lucro         |
//| TrailingPips: distância do SL ao preço atual (em pips)          |
//| TrailingActivation: lucro mínimo em pips para ativar trailing   |
//+------------------------------------------------------------------+
void ManageTrailingStop() {
   string sym   = GetSymbol();
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double activationDist = TrailingPips * 0.5 * point; // Ativar quando lucro >= 50% do trailing

   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;

      double openPrice    = posInfo.PriceOpen();
      double currentPrice = posInfo.PriceCurrent();
      double currentSL    = posInfo.StopLoss();
      double currentTP    = posInfo.TakeProfit();
      ulong  ticket       = posInfo.Ticket();
      double newSL        = 0;
      bool   shouldModify = false;

      if(posInfo.PositionType() == POSITION_TYPE_BUY) {
         double profit = currentPrice - openPrice;
         // Só ativar trailing se a posição já tem lucro mínimo de TrailingPips/2
         if(profit < activationDist) continue;
         newSL = NormalizeDouble(currentPrice - TrailingPips * point, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
         // Mover SL apenas se o novo SL for MELHOR que o atual (mais alto para BUY)
         if(newSL > currentSL + point) shouldModify = true;
      } else {
         double profit = openPrice - currentPrice;
         // Só ativar trailing se a posição já tem lucro mínimo de TrailingPips/2
         if(profit < activationDist) continue;
         newSL = NormalizeDouble(currentPrice + TrailingPips * point, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
         // Mover SL apenas se o novo SL for MELHOR que o atual (mais baixo para SELL)
         if(currentSL == 0 || newSL < currentSL - point) shouldModify = true;
      }

      if(shouldModify) {
         trade.PositionModify(ticket, newSL, currentTP);
         Print("📉 Trailing stop movido: #", ticket, " → SL=", DoubleToString(newSL, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)));
      }
   }
}

//+------------------------------------------------------------------+
//| Reporta fechamento de trade                                      |
//+------------------------------------------------------------------+
void ReportTradeClose(ulong ticket, string symbol, string type, double lots, double openPrice, double closePrice, double profit, string closeReason) {
   double pips = MathAbs(closePrice - openPrice) / SymbolInfoDouble(symbol, SYMBOL_POINT) / 10;
   string body = StringFormat(
      "{\\\"ticket\\\":%llu,\\\"symbol\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\","
      "\\\"lots\\\":%.2f,\\\"openPrice\\\":%.5f,\\\"closePrice\\\":%.5f,"
      "\\\"profit\\\":%.2f,\\\"pips\\\":%.1f,\\\"closeTime\\\":%d,\\\"closeReason\\\":\\\"%s\\\"}",
      ticket, symbol, type, lots, openPrice, closePrice, profit, pips, (int)TimeCurrent(), closeReason
   );
   char req[], res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", ServerURL + "/api/mt5/trade/close", headers, 5000, req, res, headers);
   Print("📋 Fechamento reportado: #", ticket, " | P&L: $", DoubleToString(profit, 2));
}

//+------------------------------------------------------------------+
//| Verifica limites diários                                         |
//+------------------------------------------------------------------+
bool CheckDailyLimits() {
   double currentBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   double netDayPL       = currentBalance - startDayBalance;
   double netDayLoss     = netDayPL < 0 ? MathAbs(netDayPL) : 0;
   double netDayProfit   = netDayPL > 0 ? netDayPL          : 0;
   double effLoss        = GetEffectiveMaxDailyLoss();
   double effProfit      = GetEffectiveMaxDailyProfit();

   if(netDayLoss >= effLoss) {
      Print("🛑 Limite diário de PERDA LÍQUIDA atingido: -$", DoubleToString(netDayLoss, 2),
            " | Início: $", DoubleToString(startDayBalance, 2),
            " | Atual: $",  DoubleToString(currentBalance, 2),
            " | Limite: $", DoubleToString(effLoss, 2),
            (FullAIMode || UseAIRiskLimits) ? " [IA]" : " [Manual]");
      return false;
   }
   if(netDayProfit >= effProfit) {
      Print("🎯 Meta diária de LUCRO LÍQUIDO atingida: +$", DoubleToString(netDayProfit, 2),
            " | Limite: $", DoubleToString(effProfit, 2),
            (FullAIMode || UseAIRiskLimits) ? " [IA]" : " [Manual]");
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Conta posições abertas deste EA                                  |
//+------------------------------------------------------------------+
int CountOpenPositions() {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(posInfo.SelectByIndex(i) && posInfo.Magic() == 20250101) count++;
   }
   return count;
}

//+------------------------------------------------------------------+
//| Obtém símbolo a usar                                             |
//+------------------------------------------------------------------+
string GetSymbol() {
   return (TradingSymbol == "" || TradingSymbol == NULL) ? Symbol() : TradingSymbol;
}

//+------------------------------------------------------------------+
//| Extrai string de JSON simples                                    |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key) {
   string search = "\\"" + key + "\\":\\"";
   int start = StringFind(json, search);
   if(start < 0) return "";
   start += StringLen(search);
   int end = StringFind(json, "\\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

//+------------------------------------------------------------------+
//| Extrai double de JSON simples                                    |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key) {
   string search = "\\"" + key + "\\":";
   int start = StringFind(json, search);
   if(start < 0) return 0;
   start += StringLen(search);
   int end = start;
   while(end < StringLen(json) && StringGetCharacter(json, end) != ',' && StringGetCharacter(json, end) != '}') end++;
   string val = StringSubstr(json, start, end - start);
   return StringToDouble(val);
}

//+------------------------------------------------------------------+
//| Extrai bool de JSON simples                                      |
//+------------------------------------------------------------------+
bool ExtractJsonBool(string json, string key) {
   string search = "\\"" + key + "\\":";
   int start = StringFind(json, search);
   if(start < 0) return false;
   start += StringLen(search);
   string val = StringSubstr(json, start, 4);
   return (StringFind(val, "true") == 0);
}
`;
}

router.post('/config', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    metaTraderBridge.updateConfig(updates);
    res.json({ ok: true, message: 'Configuração atualizada' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/signal/generate', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;
    const config = metaTraderBridge.getConfig();
    const targetSymbol = symbol || config.symbols[0] || 'EURUSD';
    const signal = await metaTraderBridge.generateSignal(targetSymbol);
    if (!signal) return res.json({ action: 'HOLD', reason: 'Análise em progresso' });
    res.json(signal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ai-analysis', (_req: Request, res: Response) => {
  try {
    const bridgeLog = metaTraderBridge.getAnalysisLog();
    const bridgeLatest = metaTraderBridge.getLatestAnalysis();

    // Fallback: quando o MT5 EA não está conectado, usar o cache do auto-trading-scheduler
    const cacheLatest = consensusCache.getLatest();
    const cacheAll = consensusCache.getLatestPerSymbol();

    // Enriquecer com dados do cache quando o bridge não tem análises recentes (EA offline)
    const hasBridgeData = bridgeLatest !== null && (bridgeLatest as any).aiConsensus > 0;
    const effectiveLatest = hasBridgeData ? bridgeLatest : (cacheLatest ? {
      id: `cache_${cacheLatest.timestamp}`,
      timestamp: cacheLatest.timestamp,
      symbol: cacheLatest.symbol,
      phase: 'auto_trading',
      status: cacheLatest.aiConsensus >= cacheLatest.requiredConsensus ? 'approved' : 'hold',
      aiConsensus: cacheLatest.aiConsensus,
      requiredConsensus: cacheLatest.requiredConsensus,
      aiDirection: cacheLatest.aiDirection,
      aiReasoning: cacheLatest.reasoning,
      participatingModels: cacheLatest.participatingModels,
      decisionReason: `[Deriv] ${cacheLatest.aiDirection.toUpperCase()} ${cacheLatest.symbol} — ${cacheLatest.aiConsensus.toFixed(1)}% / ${cacheLatest.requiredConsensus}% exigido`,
      source: cacheLatest.source,
    } : null);

    // Log extra: uma entrada por ativo analisado recentemente pelo scheduler
    const extraLog = cacheAll.map(e => ({
      id: `cache_${e.symbol}_${e.timestamp}`,
      timestamp: e.timestamp,
      symbol: e.symbol,
      phase: 'auto_trading',
      status: e.aiConsensus >= e.requiredConsensus ? 'approved' : 'hold',
      aiConsensus: e.aiConsensus,
      requiredConsensus: e.requiredConsensus,
      aiDirection: e.aiDirection,
      aiReasoning: e.reasoning,
      participatingModels: e.participatingModels,
      decisionReason: `[Deriv] ${e.aiDirection.toUpperCase()} ${e.symbol} — ${e.aiConsensus.toFixed(1)}% / ${e.requiredConsensus}% exigido`,
      source: e.source,
    }));

    const mergedLog = hasBridgeData ? bridgeLog : [...extraLog, ...bridgeLog];

    res.json({ log: mergedLog, latest: effectiveLatest, total: mergedLog.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mt5/position/monitor
 * Real-time position monitor called by the EA on every tick while a position is open.
 * Body: { position: MT5Position, marketData: candle[], symbol: string }
 * Returns: PositionMonitorResult with action (HOLD/CLOSE_PROFIT/CLOSE_SPIKE_EXIT/CLOSE_LOSS_PREVENTION)
 */
router.post('/position/monitor', (req: Request, res: Response) => {
  try {
    const { position, marketData, symbol } = req.body;
    if (!position || !marketData || !symbol) {
      return res.status(400).json({ error: 'position, marketData e symbol são obrigatórios' });
    }
    const result = metaTraderBridge.monitorOpenPosition(position, marketData, symbol);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/spike-analysis?symbol=Crash+1000+Index
 * Retorna análise completa de spike para um símbolo Crash/Boom.
 * Usa dados de mercado já carregados via /market-data.
 * Se não houver dados, retorna análise vazia com isSpikeIndex=false.
 */
router.get('/spike-analysis', (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || '';
    if (!symbol) return res.status(400).json({ error: 'symbol é obrigatório' });
    const candles = metaTraderBridge.getMarketData(symbol);
    const openPositions = metaTraderBridge.getOpenPositions();
    const openPos = openPositions.find((p: any) => p.symbol === symbol);
    const result = analyzeCrashBoomSpike(
      symbol,
      candles,
      openPos ? { type: openPos.type, profit: openPos.profit } : null
    );
    res.json({ ...result, candlesLoaded: candles.length, cachedSymbols: metaTraderBridge.getCachedSymbols() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mt5/spike-analysis
 * Análise de spike com candles fornecidos diretamente no body.
 * Body: { symbol, candles, openPosition? }
 */
router.post('/spike-analysis', (req: Request, res: Response) => {
  try {
    const { symbol, candles, openPosition } = req.body;
    if (!symbol || !Array.isArray(candles) || candles.length === 0) {
      return res.status(400).json({ error: 'symbol e candles são obrigatórios' });
    }
    const result = analyzeCrashBoomSpike(symbol, candles, openPosition || null);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mt5/spike-continuity-check
 * Verifica se é seguro manter uma operação de continuidade aberta dado o risco de spike.
 * Body: { symbol, candles, positionType: 'BUY' | 'SELL' }
 */
router.post('/spike-continuity-check', (req: Request, res: Response) => {
  try {
    const { symbol, candles, positionType } = req.body;
    if (!symbol || !positionType) {
      return res.status(400).json({ error: 'symbol e positionType são obrigatórios' });
    }
    const data = Array.isArray(candles) && candles.length > 0
      ? candles
      : metaTraderBridge.getMarketData(symbol);
    const result = analyzeContinuitySafety(symbol, data, positionType);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/spike-dashboard
 * Retorna análise de spike para todos os símbolos Crash/Boom com dados carregados.
 */
router.get('/spike-dashboard', (_req: Request, res: Response) => {
  try {
    const cachedSymbols = metaTraderBridge.getCachedSymbols();
    const spikeSymbols = cachedSymbols.filter(s => {
      const u = s.toUpperCase();
      return u.includes('CRASH') || u.includes('BOOM');
    });

    const openPositions = metaTraderBridge.getOpenPositions();

    const analyses = spikeSymbols.map(symbol => {
      const candles = metaTraderBridge.getMarketData(symbol);
      const openPos = openPositions.find((p: any) => p.symbol === symbol);
      return analyzeCrashBoomSpike(
        symbol,
        candles,
        openPos ? { type: openPos.type, profit: openPos.profit } : null
      );
    });

    const criticalAlerts = analyses
      .filter(a => a.spikeExpected && a.overallConfidence >= 70)
      .map(a => ({ symbol: a.symbol, confidence: a.overallConfidence, imminence: a.imminencePercent, direction: a.spikeDirection }));

    res.json({
      analyses,
      criticalAlerts,
      totalSymbolsMonitored: spikeSymbols.length,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mt5/girassol-pivots
 * O EA com o indicador Girassol carregado envia os pivôs detectados diretamente.
 * Body: { symbol, pivots: [{ type: 'high'|'low', price, time, group: 1|2|3 }] }
 *
 * MQL5 example (no EA):
 *   string body = "{\"symbol\":\"Crash 1000 Index\",\"pivots\":[{\"type\":\"high\",\"price\":5432.1,\"time\":1710000000,\"group\":1}]}";
 *   WebRequest("POST", URL + "/api/mt5/girassol-pivots", ..., body, ...);
 */
router.post('/girassol-pivots', (req: Request, res: Response) => {
  try {
    const { symbol, pivots } = req.body;
    if (!symbol || !Array.isArray(pivots)) {
      return res.status(400).json({ error: 'symbol e pivots[] são obrigatórios' });
    }
    const validated: ExternalGirassolPivot[] = pivots.filter(
      (p: any) => p && ['high', 'low'].includes(p.type) && typeof p.price === 'number' && [1, 2, 3].includes(p.group)
    ).map((p: any) => ({ type: p.type, price: p.price, time: p.time || Date.now(), group: p.group }));

    storeExternalGirassolPivots(symbol.toUpperCase(), validated);

    res.json({
      received: validated.length,
      symbol: symbol.toUpperCase(),
      message: `${validated.length} pivôs do Girassol armazenados com sucesso. Serão usados na próxima análise de spike.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/girassol-pivots?symbol=Crash+1000+Index
 * Retorna os pivôs externos armazenados para um símbolo.
 */
router.get('/girassol-pivots', (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || '').toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'symbol é obrigatório' });
    const pivots = getExternalGirassolPivots(symbol);
    res.json({ symbol, pivots, count: pivots.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mt5/reset-session
 * Zera o estado operacional de sessão de testes sem apagar dados de aprendizado da IA.
 *
 * O que é zerado:
 *   - Perdas consecutivas (remove modo Recovery e thresholds elevados)
 *   - Circuit Breaker (remove bloqueio de pausa)
 *   - Log de análise em memória da sessão atual
 *   - Modo pós-perda e ativo bloqueado do RealStatsTracker
 *
 * O que NÃO é alterado:
 *   - Dados de aprendizado da IA (pesos, acurácia, padrões)
 *   - Banco de dados (trades, configurações, usuários)
 *   - Contadores cumulativos de sinais e trades
 */
router.post('/reset-session', async (req: Request, res: Response) => {
  try {
    const result = await metaTraderBridge.resetSessionState();
    res.json({
      ok: true,
      message: 'Estado de sessão zerado com sucesso',
      cleared: result.cleared,
      resetAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/brazil-news
 * Retorna o sentimento atual do mercado brasileiro baseado em noticiário em tempo real.
 * Atualizado automaticamente a cada 60 segundos pelo BrazilNewsService.
 *
 * Response:
 *   { score, direction, strength, topHeadline, newsCount, updatedAt, categories, aiInfluence }
 */
router.get('/brazil-news', async (req: Request, res: Response) => {
  try {
    const sentiment = await brazilNewsService.getBrazilMarketSentiment();
    res.json({
      success: true,
      ...sentiment,
      headlines: sentiment.headlines.map(h => ({
        title:       h.title,
        source:      h.source,
        sentiment:   h.sentiment,
        score:       h.score,
        publishedAt: h.publishedAt,
        keywords:    h.keywords.slice(0, 5),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
