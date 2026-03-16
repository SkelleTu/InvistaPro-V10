/**
 * METATRADER API ROUTES - INVESTAPRO
 * Endpoints REST para comunicação com o Expert Advisor MT4/MT5
 */

import { Router, Request, Response } from 'express';
import { metaTraderBridge, MT5Position, MT5TradeResult } from '../services/metatrader-bridge';

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
    const { symbol, token } = req.query;
    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (!config.enabled) {
      return res.json({ action: 'HOLD', reason: 'Sistema desabilitado', confidence: 0 });
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

export default router;
