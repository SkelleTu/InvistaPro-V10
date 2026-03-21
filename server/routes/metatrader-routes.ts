/**
 * METATRADER API ROUTES - INVESTAPRO
 * Endpoints REST para comunicação com o Expert Advisor MT4/MT5
 */

import { Router, Request, Response } from 'express';
import { metaTraderBridge, MT5Position, MT5TradeResult } from '../services/metatrader-bridge';
import {
  analyzeCrashBoomSpike,
  analyzeContinuitySafety,
  storeExternalGirassolPivots,
  getExternalGirassolPivots,
  ExternalGirassolPivot,
} from '../services/crash-boom-spike-engine';

const router = Router();

router.post('/heartbeat', (req: Request, res: Response) => {
  try {
    const { accountId, broker, balance, equity, freeMargin, openPositions, platform, token } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId obrigatório' });
    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    metaTraderBridge.recordHeartbeat({ accountId, broker: broker || 'Unknown', balance, equity, freeMargin });
    const updatedConfig = metaTraderBridge.getConfig();
    console.log(`[MT5Bridge] 💚 Heartbeat: ${broker || 'Unknown'} | Conta: ${accountId} | Saldo: $${balance} | Habilitado: ${updatedConfig.enabled}`);
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
    // Auto-registrar conexão quando o EA chama o endpoint de sinal
    // Funciona mesmo sem heartbeat explícito (compatível com qualquer versão do EA)
    if (!config.enabled) {
      const accId = (accountId as string) || 'EA_AUTO';
      metaTraderBridge.recordHeartbeat({
        accountId: accId,
        broker: 'MT5',
        balance: 0,
        equity: 0,
        freeMargin: 0
      });
      console.log(`[MT5Bridge] 🔌 Conexão auto-registrada via sinal (accountId: ${accId})`);
    }
    const symbolStr = (symbol as string) || config.symbols[0] || 'EURUSD';
    const signal = metaTraderBridge.getPendingSignal(symbolStr);
    if (!signal || signal.action === 'HOLD') {
      return res.json({
        action: 'HOLD',
        reason: signal?.reason || 'Aguardando próximo sinal da IA',
        confidence: signal?.confidence || 0,
        timestamp: Date.now()
      });
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
      token
    } = req.body;

    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (!config.enabled) {
      return res.json({ action: 'HOLD', reason: 'Sistema desabilitado', confidence: 0 });
    }
    if (!symbol) {
      return res.status(400).json({ error: 'symbol é obrigatório' });
    }

    const sym = symbol as string;

    // Atualiza dados de mercado no bridge
    if (Array.isArray(candles) && candles.length > 0) {
      metaTraderBridge.addMarketData(sym, candles);
    }

    // ── Analisa sinais do Girassol ───────────────────────────────────────
    const girassol = indicatorSignals?.girassol;
    const fibonacci = indicatorSignals?.fibonacci;

    let girassolBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let girassolDesc = 'Girassol não detectado no gráfico';
    let fibDesc      = 'Fibonacci não detectado no gráfico';
    let fibNearestLevel: number | null = null;

    if (girassol?.detected) {
      const buySigs  = girassol.signals?.buy_signals  || [];
      const sellSigs = girassol.signals?.sell_signals || [];
      const exitSigs = girassol.signals?.exit_signals || [];

      // Sinal mais recente (bar=0 = barra atual, bar=1 = anterior, etc.)
      const recentBuy  = buySigs.find((s: any)  => s.bar <= 1);
      const recentSell = sellSigs.find((s: any) => s.bar <= 1);
      const recentExit = exitSigs.find((s: any) => s.bar <= 1);

      if (recentExit) {
        girassolBias = 'NEUTRAL';
        girassolDesc = `Girassol: sinal de SAÍDA na barra ${recentExit.bar} (buffer ${recentExit.buffer}, valor ${recentExit.value})`;
      } else if (recentBuy && !recentSell) {
        girassolBias = 'BUY';
        girassolDesc = `Girassol: COMPRA detectada na barra ${recentBuy.bar} (valor ${recentBuy.value})`;
      } else if (recentSell && !recentBuy) {
        girassolBias = 'SELL';
        girassolDesc = `Girassol: VENDA detectada na barra ${recentSell.bar} (valor ${recentSell.value})`;
      } else if (recentBuy && recentSell) {
        girassolBias = 'NEUTRAL';
        girassolDesc = `Girassol: sinais conflitantes (compra e venda simultâneas) — aguardando confirmação`;
      } else {
        girassolBias = 'NEUTRAL';
        girassolDesc = `Girassol ativo (${girassol.name}) — sem sinal novo nas últimas 2 barras`;
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

    // ── Aplica filtro do Girassol ────────────────────────────────────────
    let finalAction: string = baseSignal?.action || 'HOLD';
    let finalConfidence: number = baseSignal?.confidence || 0;
    let finalReason: string = baseSignal?.reason || 'Aguardando sinal';
    const indicatorNotes: string[] = [];

    if (girassol?.detected && girassolBias !== 'NEUTRAL') {
      if (girassolBias === finalAction) {
        // Girassol CONFIRMA o sinal da IA — aumentar confiança
        const girassolBoost = derivProfile?.trendType === 'mean-reverting' ? 1.20 : 1.15;
        finalConfidence = Math.min(100, finalConfidence * girassolBoost);
        indicatorNotes.push(`✅ Girassol CONFIRMA ${finalAction} — confiança elevada (+${((girassolBoost - 1) * 100).toFixed(0)}%)`);
        finalReason = `${finalReason} | ${girassolDesc}`;
      } else if (finalAction !== 'HOLD' && girassolBias !== finalAction) {
        // Girassol CONTRADIZ o sinal da IA → filtra (HOLD)
        indicatorNotes.push(`🚫 Girassol CONTRADIZ IA (${finalAction}→${girassolBias}) — operação bloqueada`);
        console.log(`[MT5-Indicators] 🚫 Sinal ${finalAction} BLOQUEADO pelo Girassol (indicador diz ${girassolBias}) | ${sym}`);
        finalAction     = 'HOLD';
        finalConfidence = 0;
        finalReason     = `Bloqueado: ${girassolDesc}`;
      }
    } else if (girassol?.detected) {
      indicatorNotes.push(girassolDesc);
    }

    // ── Aplica filtro do Fibonacci ───────────────────────────────────────
    if (fibonacci?.detected && fibNearestLevel !== null) {
      const currentPrice = ask || bid || 0;
      if (currentPrice > 0) {
        const distPct = Math.abs(fibNearestLevel - currentPrice) / currentPrice * 100;
        if (distPct < 0.05) {
          indicatorNotes.push(`⚡ Preço em zona de Fibonacci (${distPct.toFixed(3)}% do nível) — zona de reversão/suporte`);
        }
      }
      indicatorNotes.push(fibDesc);
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
        fibonacciNearestLevel: fibNearestLevel,
        indicatorsDetected: indicatorCount || 0,
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
      girassolDescription:   girassolDesc,
      girassolSupportLevel:  girassolSupportLevel ?? null,
      girassolResistLevel:   girassolResistanceLevel ?? null,
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
    res.json(metaTraderBridge.getOpenPositions());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades', (_req: Request, res: Response) => {
  try {
    res.json(metaTraderBridge.getRecentTrades());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (_req: Request, res: Response) => {
  try {
    res.json(metaTraderBridge.getStatus());
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
 * Gera e retorna o EA (.mq5) com ServerURL e ApiToken pré-preenchidos.
 */
router.get('/download-ea', (req: Request, res: Response) => {
  try {
    const config = metaTraderBridge.getConfig();
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    const serverUrl = replitDomain
      ? `https://${replitDomain}`
      : `${req.protocol}://${req.get('host')}`;
    const token = config.apiToken || '';

    const content = generateEAContent(serverUrl, token, config);

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
   long   stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist    = MathMax((double)stopsLevel * point, (SymbolInfoDouble(symbol, SYMBOL_ASK) - SymbolInfoDouble(symbol, SYMBOL_BID)) * 3.0);
   if(minDist > 0)
   {
      if(action == "BUY")
      {
         if(slPrice > 0 && (entryPrice - slPrice) < minDist) slPrice = NormalizeDouble(entryPrice - minDist, digits);
         if(tpPrice > 0 && (tpPrice - entryPrice) < minDist) tpPrice = NormalizeDouble(entryPrice + minDist, digits);
      }
      else
      {
         if(slPrice > 0 && (slPrice - entryPrice) < minDist) slPrice = NormalizeDouble(entryPrice + minDist, digits);
         if(tpPrice > 0 && (entryPrice - tpPrice) < minDist) tpPrice = NormalizeDouble(entryPrice - minDist, digits);
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
      if(dailyLoss >= MaxDailyLoss)     closeReason = "SL";
      if(dailyProfit >= MaxDailyProfit) closeReason = "TP";
      
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
    const log = metaTraderBridge.getAnalysisLog();
    const latest = metaTraderBridge.getLatestAnalysis();
    res.json({ log, latest, total: log.length });
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

export default router;
