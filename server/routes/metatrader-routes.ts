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

    // ── Aplica filtro do Girassol ────────────────────────────────────────
    // Se o Girassol estiver ativo E der sinal contrário ao da IA → HOLD
    // Se o Girassol confirmar → aumenta confiança
    // Se o Girassol não tiver sinal novo → mantém sinal original da IA
    let finalAction: string = baseSignal?.action || 'HOLD';
    let finalConfidence: number = baseSignal?.confidence || 0;
    let finalReason: string = baseSignal?.reason || 'Aguardando sinal';
    const indicatorNotes: string[] = [];

    if (girassol?.detected && girassolBias !== 'NEUTRAL') {
      if (girassolBias === finalAction) {
        // Girassol CONFIRMA o sinal da IA
        finalConfidence = Math.min(100, finalConfidence * 1.15);
        indicatorNotes.push(`✅ Girassol CONFIRMA ${finalAction} — confiança elevada`);
        finalReason = `${finalReason} | ${girassolDesc}`;
      } else if (finalAction !== 'HOLD' && girassolBias !== finalAction) {
        // Girassol CONTRADIZ o sinal da IA → filtra (HOLD)
        indicatorNotes.push(`🚫 Girassol CONTRADIZ IA (${finalAction}→${girassolBias}) — operação bloqueada`);
        console.log(`[MT5-Indicators] 🚫 Sinal ${finalAction} BLOQUEADO pelo Girassol (indicador diz ${girassolBias})`);
        finalAction     = 'HOLD';
        finalConfidence = 0;
        finalReason     = `Bloqueado: ${girassolDesc}`;
      }
    } else if (girassol?.detected) {
      indicatorNotes.push(girassolDesc);
    }

    // ── Aplica filtro do Fibonacci ───────────────────────────────────────
    // Se preço está muito próximo de um nível de Fibonacci → zona de decisão
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
        timestamp: Date.now()
      });
    }

    res.json({
      id:                    baseSignal.id,
      symbol:                baseSignal.symbol,
      action:                finalAction,
      lotSize:               baseSignal.lotSize,
      stopLoss:              baseSignal.stopLoss,
      takeProfit:            baseSignal.takeProfit,
      stopLossPips:          baseSignal.stopLossPips,
      takeProfitPips:        baseSignal.takeProfitPips,
      entryPrice:            baseSignal.entryPrice,
      confidence:            Math.round(finalConfidence * 10) / 10,
      reason:                finalReason,
      indicatorNotes,
      girassolBias,
      girassolDescription:   girassolDesc,
      fibonacciDescription:  fibDesc,
      fibonacciNearestLevel: fibNearestLevel,
      indicatorsDetected:    indicatorCount || 0,
      aiSources:             baseSignal.aiSources,
      timestamp:             baseSignal.timestamp,
      expiresAt:             baseSignal.expiresAt
    });
  } catch (err: any) {
    console.error('[MT5-Indicators] Erro:', err.message);
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
  const lotSize        = config.defaultLotSize    ?? 0.01;
  const stopLoss       = config.stopLossPips       ?? 30;
  const takeProfit     = config.takeProfitPips     ?? 60;
  const maxPositions   = config.maxOpenPositions   ?? 5;
  const maxDailyLoss   = config.maxDailyLoss       ?? 100;
  const maxDailyProfit = config.maxDailyProfit     ?? 500;
  const useAISL        = config.useAIStopLoss      ? 'true' : 'false';
  const useTrailing    = config.useTrailingStop    ? 'true' : 'false';
  const trailingPips   = config.trailingStopPips   ?? 15;
  const signalTimeout  = config.signalTimeoutSeconds ?? 60;

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

//--- Input Parameters
input string   ServerURL       = "${serverUrl}";
input string   ApiToken        = "${token}";
input string   TradingSymbol   = "";  // Vazio = par atual
input double   LotSize         = ${lotSize};
input int      StopLoss        = ${stopLoss};
input int      TakeProfit      = ${takeProfit};
input int      MaxPositions    = ${maxPositions};
input double   MaxDailyLoss    = ${maxDailyLoss};
input double   MaxDailyProfit  = ${maxDailyProfit};
input bool     UseAIStopLoss   = ${useAISL};
input bool     UseTrailing     = ${useTrailing};
input int      TrailingPips    = ${trailingPips};
input int      SignalTimeout   = ${signalTimeout};
input int      PollIntervalSec = 5;
input int      HeartbeatSec    = 15;
input int      CandlesHistory  = 200;

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
   if(UseTrailing) ManageTrailingStop();
   
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
   if(CountOpenPositions() >= MaxPositions) return;
   
   string symbol  = GetSymbol();
   string url     = ServerURL + "/api/mt5/signal?symbol=" + symbol + "&token=" + ApiToken;
   char   req[], res[];
   string headers = "";
   
   int code = WebRequest("GET", url, headers, 8000, req, res, headers);
   if(code != 200) { Print("⚠️ Falha ao buscar sinal: HTTP ", code); return; }
   
   string response = CharArrayToString(res);
   
   string action     = ExtractJsonString(response, "action");
   string signalId   = ExtractJsonString(response, "id");
   double confidence = ExtractJsonDouble(response, "confidence");
   double slPrice    = ExtractJsonDouble(response, "stopLoss");
   double tpPrice    = ExtractJsonDouble(response, "takeProfit");
   double lotSize    = ExtractJsonDouble(response, "lotSize");
   string reason     = ExtractJsonString(response, "reason");
   
   if(signalId == lastSignalId || action == "HOLD" || action == "") return;
   
   Print("🔔 Sinal recebido: ", action, " ", symbol, " | Confiança: ", DoubleToString(confidence * 100, 1), "% | ", reason);
   
   double entryPrice = (action == "BUY") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   double point      = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int    digits     = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   
   //--- Crash/Boom: spikes pulam stops — operar sem SL e TP
   string symUp = symbol;
   StringToUpper(symUp);
   bool isSpikeIdx = (StringFind(symUp, "CRASH") >= 0 || StringFind(symUp, "BOOM") >= 0);

   if(isSpikeIdx)
   {
      slPrice = 0;
      tpPrice = 0;
      Print("ℹ️ Crash/Boom — sem SL/TP");
   }
   else
   {
      if(!UseAIStopLoss || slPrice <= 0) {
         slPrice = (action == "BUY") ? entryPrice - StopLoss * point : entryPrice + StopLoss * point;
      }
      if(!UseAIStopLoss || tpPrice <= 0) {
         tpPrice = (action == "BUY") ? entryPrice + TakeProfit * point : entryPrice - TakeProfit * point;
      }
      //--- Garantir distância mínima exigida pelo broker
      long   stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
      double minDist    = MathMax((double)stopsLevel * point, (SymbolInfoDouble(symbol, SYMBOL_ASK) - SymbolInfoDouble(symbol, SYMBOL_BID)) * 3.0);
      if(minDist > 0)
      {
         if(action == "BUY")
         {
            if((entryPrice - slPrice) < minDist) slPrice = NormalizeDouble(entryPrice - minDist, digits);
            if((tpPrice - entryPrice) < minDist) tpPrice = NormalizeDouble(entryPrice + minDist, digits);
         }
         else
         {
            if((slPrice - entryPrice) < minDist) slPrice = NormalizeDouble(entryPrice + minDist, digits);
            if((entryPrice - tpPrice) < minDist) tpPrice = NormalizeDouble(entryPrice - minDist, digits);
         }
      }
      slPrice = NormalizeDouble(slPrice, digits);
      tpPrice = NormalizeDouble(tpPrice, digits);
   }
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
//| Trailing stop                                                    |
//+------------------------------------------------------------------+
void ManageTrailingStop() {
   double point = SymbolInfoDouble(GetSymbol(), SYMBOL_POINT);
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;
      double newSL = 0;
      if(posInfo.PositionType() == POSITION_TYPE_BUY) {
         newSL = posInfo.PriceCurrent() - TrailingPips * point;
         if(newSL > posInfo.StopLoss() + point)
            trade.PositionModify(posInfo.Ticket(), newSL, posInfo.TakeProfit());
      } else {
         newSL = posInfo.PriceCurrent() + TrailingPips * point;
         if(newSL < posInfo.StopLoss() - point || posInfo.StopLoss() == 0)
            trade.PositionModify(posInfo.Ticket(), newSL, posInfo.TakeProfit());
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
   
   if(netDayLoss >= MaxDailyLoss) {
      Print("🛑 Limite diário de PERDA LÍQUIDA atingido: -$", DoubleToString(netDayLoss, 2),
            " | Início: $", DoubleToString(startDayBalance, 2),
            " | Atual: $",  DoubleToString(currentBalance, 2),
            " | Limite: $", DoubleToString(MaxDailyLoss, 2));
      return false;
   }
   if(netDayProfit >= MaxDailyProfit) {
      Print("🎯 Meta diária de LUCRO LÍQUIDO atingida: +$", DoubleToString(netDayProfit, 2),
            " | Limite: $", DoubleToString(MaxDailyProfit, 2));
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
