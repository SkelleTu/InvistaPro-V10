//+------------------------------------------------------------------+
//|                                   InvistaPRO_EA_PriceAction.mq5   |
//|                     InvistaPRO — Expert Advisor Price Action MT5 |
//|  Estratégia multi-timeframe H4/H1/M15/M5/M1                       |
//|  Opera o símbolo do gráfico, respeitando as regras do contrato MT5|
//|  Gestão de risco, execução, proteção e reconciliação de posições  |
//+------------------------------------------------------------------+
#property copyright "InvistaPRO"
#property version   "1.0"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\DealInfo.mqh>

//--- Parâmetros de entrada
input string   ServerURL        = "https://invista-pro-v10-kzlv.onrender.com"; // URL do servidor InvistaPRO
input string   DiscoveryBlobURL = "https://invista-pro-v10-kzlv.onrender.com/api/url"; // URL de descoberta automática
input string   ApiToken         = "";          // Token de autenticação (opcional)
input int      HeartbeatSeconds = 30;          // Intervalo do heartbeat (segundos)
input int      SignalSeconds    = 5;           // Intervalo de busca de sinal (segundos)
input int      MagicNumber      = 20261102;    // Número mágico
input bool     AutoReconnect    = true;        // Reconexão automática de URL
input int      MaxReconnectTries= 5;           // Tentativas máximas de reconexão
input double   PriceActionRiskPercent = 1.0; // Risco por trade: 1% padrão, máximo 2%
input double   EstimatedRoundTripCommissionPerLot = 0.0; // Comissão total ida+volta por lote, na moeda da conta; 0 somente para conta sem comissão
input int      MaxDeviationPoints = 20; // Slippage máximo por ordem, em pontos do símbolo
input int      MaxPositions = 1; // Uma posição por símbolo
input int      WarmupSeconds = 120; // Aquecimento sem operar
input bool     CloseAtEndOfBrasiliaSession = true; // Não carregar day trades para o dia seguinte

//--- Variáveis globais
string   g_serverUrl      = "";
string   g_discoverUrl    = "";
string   g_symbol         = "";
string   g_apiToken       = "";
datetime g_lastHeartbeat  = 0;
datetime g_lastTimerHeartbeat = 0;
datetime g_lastSignal     = 0;
int      g_failCount      = 0;
bool     g_isDiscovering  = false;
string   g_pendingSignalId= "";
datetime g_lastClosedTradeSync = 0;
datetime g_lastSessionCloseAttempt = 0;
datetime g_lastMonitor    = 0;
int      g_monitorSeconds = 2;
datetime g_warmupUntil    = 0;
datetime g_lastWarmupPrint= 0;


CTrade         trade;
CPositionInfo  posInfo;

// Indicator scanning is intentionally absent from this dedicated EA.
//+------------------------------------------------------------------+
//| Inicialização                                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   if (MaxDeviationPoints < 0 || MaxDeviationPoints > 1000
       || EstimatedRoundTripCommissionPerLot < 0.0
       || PriceActionRiskPercent < 1.0 || PriceActionRiskPercent > 2.0
       || SignalSeconds < 1 || HeartbeatSeconds < 5
       || MaxPositions < 1 || WarmupSeconds < 0)
   {
      Print("⛔ Parâmetros inválidos: risco 1–2%, slippage 0–1000 pontos, comissão não negativa, sinal >=1s, heartbeat >=5s, posições >=1 e aquecimento >=0s.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_serverUrl   = ServerURL;
   g_discoverUrl = DiscoveryBlobURL;
   g_symbol      = _Symbol;
   g_apiToken    = ApiToken;
   g_failCount   = 0;

   if (g_symbol == "" || !SymbolSelect(g_symbol, true))
   {
      Print("⛔ Símbolo MT5 indisponível ou não selecionável: ", g_symbol);
      return INIT_FAILED;
   }
   long symbolTradeMode = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_MODE);
   if (symbolTradeMode == SYMBOL_TRADE_MODE_DISABLED)
   {
      Print("⛔ O broker marcou o símbolo como indisponível para negociação: ", g_symbol);
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(g_symbol);
   trade.SetDeviationInPoints(MaxDeviationPoints);
   // Timer keeps connectivity checks alive even when the chart receives no ticks.
   EventSetTimer(1);

   datetime now = TimeCurrent();
   g_lastSignal      = now;
   g_lastHeartbeat   = now;
   g_lastMonitor     = TimeLocal();
   g_lastWarmupPrint = now;

   if (WarmupSeconds > 0)
      g_warmupUntil = now + WarmupSeconds;
   else
      g_warmupUntil = now;

   Print("🚀 InvistaPRO EA Price Action v1.0 iniciado | Símbolo: ", g_symbol);
   Print("   → URL: ", g_serverUrl);
   Print("   → Estratégia: Price Action H4/H1/M15/M5/M1 | Risco: ", DoubleToString(PriceActionRiskPercent, 1), "% | Magic: ", MagicNumber);
   if (WarmupSeconds > 0)
      Print("   ⏳ AQUECIMENTO ATIVO: operações bloqueadas por ", WarmupSeconds, "s");

   Print("🤖 Motor determinístico Price Action ativo | revisão de IA desativada.");

   if (g_discoverUrl == "") FetchDiscoveryUrl();


   SendHeartbeat();
   g_lastHeartbeat = TimeCurrent();

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[MT5-DIAG] EA encerrado. reason=", reason);
}

// Timer independent of market ticks: keep heartbeat/reconnect diagnostics alive.
void OnTimer()
{
   datetime serverNow = TimeCurrent();
   datetime localNow = TimeLocal();
   if (CountManagedPositions() > 0 && localNow - g_lastMonitor >= g_monitorSeconds)
   {
      g_lastMonitor = localNow;
      MonitorOpenPositions();
   }
   if (localNow - g_lastClosedTradeSync >= 30)
   {
      g_lastClosedTradeSync = localNow;
      SyncClosedTradeReports();
      SyncOpenPositionReports();
   }
   if (HeartbeatSeconds > 0 && (g_lastTimerHeartbeat == 0 || localNow - g_lastTimerHeartbeat >= HeartbeatSeconds))
   {
      g_lastTimerHeartbeat = localNow;
      g_lastHeartbeat = serverNow;
      bool ok = SendHeartbeat();
      if (!ok && AutoReconnect && !g_isDiscovering)
         TryReconnect();
   }
}

//+------------------------------------------------------------------+
//| Constrói JSON de candles                                          |
//+------------------------------------------------------------------+
string BuildCandlesJson(MqlRates &rates[], int count)
{
   string json = "[";
   for (int i = 0; i < count; i++)
   {
      if (i > 0) json += ",";
      json += "{";
      json += "\"time\":"   + IntegerToString((long)BrokerTimeToUtc(rates[i].time)) + ",";
      json += "\"open\":"   + DoubleToString(rates[i].open,  ManagedSymbolDigits()) + ",";
      json += "\"high\":"   + DoubleToString(rates[i].high,  ManagedSymbolDigits()) + ",";
      json += "\"low\":"    + DoubleToString(rates[i].low,   ManagedSymbolDigits()) + ",";
      json += "\"close\":"  + DoubleToString(rates[i].close, ManagedSymbolDigits()) + ",";
      json += "\"volume\":" + IntegerToString(rates[i].tick_volume);
      json += "}";
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Serializa candles de um timeframe para a estratégia multi-timeframe|
//+------------------------------------------------------------------+
string BuildTimeframeCandlesJson(ENUM_TIMEFRAMES timeframe, int count)
{
   MqlRates rates[];
   // Exclude the still-forming candle to prevent repainting in the deterministic strategy.
   int copied = CopyRates(g_symbol, timeframe, 1, count, rates);
   if (copied < 30) return "[]";
   return BuildCandlesJson(rates, copied);
}

string BuildMultiTimeframeJson()
{
   string h4 = BuildTimeframeCandlesJson(PERIOD_H4, 80);
   string h1 = BuildTimeframeCandlesJson(PERIOD_H1, 80);
   string m15 = BuildTimeframeCandlesJson(PERIOD_M15, 80);
   string m5 = BuildTimeframeCandlesJson(PERIOD_M5, 120);
   string m1 = BuildTimeframeCandlesJson(PERIOD_M1, 120);
   return "{\"H4\":" + h4 + ",\"H1\":" + h1 + ",\"M15\":" + m15 +
          ",\"M5\":" + m5 + ",\"M1\":" + m1 + "}";
}

//+------------------------------------------------------------------+
//| OnTick — lógica principal                                         |
//+------------------------------------------------------------------+
void OnTick()
{
   datetime now = TimeCurrent();

   // ── Heartbeat ────────────────────────────────────────────────────────
   if (now - g_lastHeartbeat >= HeartbeatSeconds)
   {
      g_lastHeartbeat = now;
      if (!SendHeartbeat() && AutoReconnect && !g_isDiscovering)
         TryReconnect();
   }


   // ── Monitor de posições abertas ────────────────────────────────────────
   datetime localMonitorNow = TimeLocal();
   if (CountManagedPositions() > 0 && (localMonitorNow - g_lastMonitor >= g_monitorSeconds))
   {
      g_lastMonitor = localMonitorNow;
      MonitorOpenPositions();
   }

   // ── Busca de sinal ────────────────────────────────────────────────────
   if (CountManagedPositions() < MaxPositions && CountSymbolPositions() == 0 && (now - g_lastSignal >= SignalSeconds))
   {
      g_lastSignal = now;

      if (now < g_warmupUntil)
      {
         int secsLeft = (int)(g_warmupUntil - now);
         if (now - g_lastWarmupPrint >= 15)
         {
            g_lastWarmupPrint = now;
            Print("⏳ AQUECIMENTO: mais ", secsLeft, "s — observando mercado sem operar");
         }
         return;
      }

      FetchAndProcessSignal();
   }
}

//+------------------------------------------------------------------+
//| Busca e processa sinal com indicadores reais                      |
//+------------------------------------------------------------------+
bool IsPriceActionEnabled()
{
   // Price Action runs on the chart instrument selected by the user.
   // Symbol-specific contract properties are validated by the sizing/execution layer.
   return true;
}

int CountManagedPositions()
{
   int managed = 0;
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Magic() != MagicNumber) continue;
      if (posInfo.Symbol() != g_symbol) continue;
      managed++;
   }
   return managed;
}

int CountSymbolPositions()
{
   int count = 0;
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Symbol() == g_symbol) count++;
   }
   return count;
}

long GetManagedPositionIdentifier()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Magic() != MagicNumber || posInfo.Symbol() != g_symbol) continue;
      return (long)PositionGetInteger(POSITION_IDENTIFIER);
   }
   return 0;
}

int ManagedSymbolDigits()
{
   return (int)SymbolInfoInteger(g_symbol, SYMBOL_DIGITS);
}

double NormalizeManagedPrice(double price, bool roundUp)
{
   if (price <= 0.0) return 0.0;
   double tickSize = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_SIZE);
   if (tickSize <= 0.0) tickSize = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
   if (tickSize <= 0.0) return 0.0;
   double units = price / tickSize;
   double aligned = roundUp
      ? MathCeil(units - 1e-10) * tickSize
      : MathFloor(units + 1e-10) * tickSize;
   return NormalizeDouble(aligned, ManagedSymbolDigits());
}

double CommissionPriceDistance(ENUM_ORDER_TYPE orderType, double entryPrice)
{
   if (EstimatedRoundTripCommissionPerLot < 0.0 || entryPrice <= 0.0) return -1.0;
   if (EstimatedRoundTripCommissionPerLot == 0.0) return 0.0;
   double tickSize = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_SIZE);
   if (tickSize <= 0.0) tickSize = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
   if (tickSize <= 0.0) return -1.0;
   double adverseExit = orderType == ORDER_TYPE_BUY ? entryPrice - tickSize : entryPrice + tickSize;
   if (adverseExit <= 0.0) adverseExit = entryPrice + tickSize;
   double tickProfit = 0.0;
   if (!OrderCalcProfit(orderType, g_symbol, 1.0, entryPrice, adverseExit, tickProfit))
      return -1.0;
   double tickValue = MathAbs(tickProfit);
   if (tickValue <= 0.0) return -1.0;
   return (EstimatedRoundTripCommissionPerLot / tickValue) * tickSize;
}

datetime BrokerTimeToUtc(datetime brokerTime)
{
   long brokerUtcOffsetSeconds = (long)TimeCurrent() - (long)TimeGMT();
   return (datetime)((long)brokerTime - brokerUtcOffsetSeconds);
}

string PriceActionStateKey(string prefix, long identifier)
{
   return prefix + "_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
          + "_" + IntegerToString(identifier);
}

// Derive volume precision from the broker-supported volume step.
int VolumeDigitsFromStep()
{
   double step = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
   if (step <= 0.0) return 2;

   int digits = 0;
   while (digits < 8 && MathAbs(step - MathRound(step)) > 0.0000001)
   {
      step *= 10.0;
      digits++;
   }
   return digits;
}

double CalculatePriceActionRiskLot(double entryPrice, double stopLoss)
{
   if (entryPrice <= 0 || stopLoss <= 0 || PriceActionRiskPercent < 1.0 || PriceActionRiskPercent > 2.0)
      return 0.0;

   double volumeStep = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
   double minVolume = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
   double maxVolume = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MAX);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if (volumeStep <= 0 || minVolume <= 0 || maxVolume <= 0 || equity <= 0 || freeMargin <= 0)
      return 0.0;

   ENUM_ORDER_TYPE orderType = (stopLoss < entryPrice) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double oneLotProfit = 0.0;
   // OrderCalcProfit converts the contract's tick economics into account currency.
   // If the broker cannot calculate the contract, fail closed instead of guessing.
   if (!OrderCalcProfit(orderType, g_symbol, 1.0, entryPrice, stopLoss, oneLotProfit))
      return 0.0;
   double lossPerLot = MathAbs(oneLotProfit) + EstimatedRoundTripCommissionPerLot;
   if (lossPerLot <= 0.0 || EstimatedRoundTripCommissionPerLot < 0.0) return 0.0;

   // Keep 10% of the configured risk budget as execution-friction reserve.
   double riskCash = equity * PriceActionRiskPercent / 100.0 * 0.90;
   double rawVolume = riskCash / lossPerLot;
   double volume = MathFloor(rawVolume / volumeStep) * volumeStep;
   if (volume < minVolume) return 0.0;
   if (volume > maxVolume) volume = MathFloor(maxVolume / volumeStep) * volumeStep;
   int volumeDigits = VolumeDigitsFromStep();
   volume = NormalizeDouble(volume, volumeDigits);
   if (volume < minVolume || volume <= 0.0) return 0.0;

   double requiredMargin = 0.0;
   if (!OrderCalcMargin(orderType, g_symbol, volume, entryPrice, requiredMargin)
       || requiredMargin <= 0.0 || requiredMargin > freeMargin * 0.80)
      return 0.0;
   return volume;
}

double RecoverInitialPositionRisk(long positionIdentifier, double openPrice)
{
   if (positionIdentifier <= 0 || openPrice <= 0.0 || !HistorySelectByPosition(positionIdentifier)) return 0.0;
   datetime earliestEntry = 0;
   double originalStop = 0.0;
   for (int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if (deal == 0) continue;
      if (HistoryDealGetInteger(deal, DEAL_MAGIC) != MagicNumber) continue;
      if (HistoryDealGetString(deal, DEAL_SYMBOL) != g_symbol) continue;
      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if (entry != DEAL_ENTRY_IN && entry != DEAL_ENTRY_INOUT) continue;
      ulong orderTicket = (ulong)HistoryDealGetInteger(deal, DEAL_ORDER);
      double orderStop = HistoryOrderGetDouble(orderTicket, ORDER_SL);
      datetime dealTime = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
      if (orderStop > 0.0 && (earliestEntry == 0 || dealTime < earliestEntry))
      {
         earliestEntry = dealTime;
         originalStop = orderStop;
      }
   }
   return originalStop > 0.0 ? MathAbs(openPrice - originalStop) : 0.0;
}

double RecoverInitialPositionVolume(long positionIdentifier)
{
   if (positionIdentifier <= 0 || !HistorySelectByPosition(positionIdentifier)) return 0.0;
   double openedVolume = 0.0;
   for (int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if (deal == 0) continue;
      if (HistoryDealGetInteger(deal, DEAL_MAGIC) != MagicNumber) continue;
      if (HistoryDealGetString(deal, DEAL_SYMBOL) != g_symbol) continue;
      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if (entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
         openedVolume += HistoryDealGetDouble(deal, DEAL_VOLUME);
   }
   return openedVolume;
}

void PersistPriceActionPositionState()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Magic() != MagicNumber || posInfo.Symbol() != g_symbol) continue;
      ulong ticket = posInfo.Ticket();
      double initialRisk = MathAbs(posInfo.PriceOpen() - posInfo.StopLoss());
      string riskKey = PriceActionStateKey("InvistaPA_R", (long)ticket);
      string volumeKey = PriceActionStateKey("InvistaPA_V", (long)ticket);
      if (initialRisk <= 0.0)
         initialRisk = RecoverInitialPositionRisk(posInfo.Identifier(), posInfo.PriceOpen());
      double recoveredInitialVolume = RecoverInitialPositionVolume(posInfo.Identifier());
      if (initialRisk > 0.0 && !GlobalVariableCheck(riskKey)) GlobalVariableSet(riskKey, initialRisk);
      if (!GlobalVariableCheck(volumeKey))
         GlobalVariableSet(volumeKey, recoveredInitialVolume > 0.0 ? recoveredInitialVolume : posInfo.Volume());
   }
}

// Swing trailing uses only fully confirmed M5 pivots and can only tighten protection.
double CalculatePriceActionSwingStop(string positionType, double currentStop)
{
   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M5, 1, 40, rates);
   if (copied < 10) return 0.0;
   double ranges = 0.0;
   int rangeCount = 0;
   for (int i = MathMax(1, copied - 15); i < copied; i++)
   {
      ranges += MathMax(rates[i].high - rates[i].low,
                        MathMax(MathAbs(rates[i].high - rates[i-1].close),
                                MathAbs(rates[i].low - rates[i-1].close)));
      rangeCount++;
   }
   if (rangeCount <= 0) return 0.0;
   double buffer = (ranges / rangeCount) * 0.10;
   double point = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
   long stopsLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minimumDistance = MathMax((double)stopsLevel * point, point * 2.0);

   for (int i = copied - 3; i >= 2; i--)
   {
      if (positionType == "BUY")
      {
         bool pivot = rates[i].low < rates[i-1].low && rates[i].low < rates[i-2].low
                   && rates[i].low <= rates[i+1].low && rates[i].low <= rates[i+2].low;
         if (!pivot) continue;
         double candidate = NormalizeManagedPrice(rates[i].low - buffer, false);
         double bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);
         if (candidate > currentStop && candidate < bid - minimumDistance) return candidate;
      }
      else
      {
         bool pivot = rates[i].high > rates[i-1].high && rates[i].high > rates[i-2].high
                   && rates[i].high >= rates[i+1].high && rates[i].high >= rates[i+2].high;
         if (!pivot) continue;
         double candidate = NormalizeManagedPrice(rates[i].high + buffer, true);
         double ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
         if (candidate < currentStop && candidate > ask + minimumDistance) return candidate;
      }
   }
   return 0.0;
}

bool ClosePriceActionPartial(ulong ticket, double volume, string positionType)
{
   long marginMode = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   if (marginMode == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
   {
      bool sent = trade.PositionClosePartial(ticket, volume);
      uint retcode = trade.ResultRetcode();
      double filledVolume = trade.ResultVolume();
      double tolerance = MathMax(SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP) * 0.5, 1e-8);
      return sent && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_DONE_PARTIAL)
             && trade.ResultDeal() > 0 && filledVolume + tolerance >= volume;
   }

   // Netting accounts reduce the existing position with an opposite deal.
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   request.action = TRADE_ACTION_DEAL;
   request.position = ticket;
   request.symbol = g_symbol;
   request.volume = volume;
   request.magic = MagicNumber;
   request.deviation = MaxDeviationPoints;
   request.type = (positionType == "BUY") ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   request.price = (positionType == "BUY")
      ? SymbolInfoDouble(g_symbol, SYMBOL_BID)
      : SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   long filling = SymbolInfoInteger(g_symbol, SYMBOL_FILLING_MODE);
   if ((filling & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      request.type_filling = ORDER_FILLING_IOC;
   else if ((filling & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      request.type_filling = ORDER_FILLING_FOK;
   else
      request.type_filling = ORDER_FILLING_RETURN;

   if (request.price <= 0 || !OrderSend(request, result))
   {
      Print("⛔ Price Action: falha de envio da parcial netting. erro=", GetLastError());
      return false;
   }
   double tolerance = MathMax(SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP) * 0.5, 1e-8);
   return (result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_DONE_PARTIAL)
          && result.deal > 0 && result.volume + tolerance >= volume;
}

void FetchAndProcessSignal()
{
   // Send only closed OHLC candles from the five strategy timeframes.
   string structuredSignals = "{}";
   string allBuffers = "{}";
   string candlesJson = "[]";

   double ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);

   // Dedicated Price Action endpoint; the deterministic engine owns the decision.
   string url     = g_serverUrl + "/api/metatrader/signal-with-indicators";
   string headers = "Content-Type: application/json\r\n";

   long requestTradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string requestAccountType = (requestTradeMode == ACCOUNT_TRADE_MODE_REAL) ? "real" :
                               (requestTradeMode == ACCOUNT_TRADE_MODE_DEMO) ? "demo" : "contest";
   string body = "{";
   body += "\"accountType\":\"" + requestAccountType + "\",";
   body += "\"symbol\":\""          + g_symbol                     + "\",";
   body += "\"ask\":"               + DoubleToString(ask, ManagedSymbolDigits())  + ",";
   body += "\"bid\":"               + DoubleToString(bid, ManagedSymbolDigits())  + ",";
   body += "\"candles\":"           + candlesJson                   + ",";
   body += "\"timeframes\":"       + BuildMultiTimeframeJson()     + ",";
   body += "\"strategyMode\":\"PRICE_ACTION\",";
   body += "\"priceActionUseAIReview\":false,";
   body += "\"indicatorSignals\":"  + structuredSignals             + ",";
   body += "\"indicatorBuffers\":"  + allBuffers                    + ",";
   body += "\"indicatorCount\":0,";
   body += "\"eaVersion\":\"1.0\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 10000, postData, result, responseHeaders);

   // Secondary Price Action endpoint for compatible MT5 route deployments.
   if (res == 404 || res == -1)
   {
      url = g_serverUrl + "/api/mt5/signal-with-indicators";
      res = WebRequest("POST", url, headers, 10000, postData, result, responseHeaders);
   }

   // The dedicated EA requires the MTF endpoint; never fall back to legacy signal routes.
   if (res == 404)
   {
      Print("⛔ Price Action: endpoint multi-timeframe indisponível; entrada bloqueada.");
      return;
   }

   if (res == -1)
   {
      Print("⚠️ Falha na requisição de sinal: HTTP ", res);
      if (AutoReconnect && !g_isDiscovering) TryReconnect();
      return;
   }
   if (res != 200)
   {
      string errorBody = CharArrayToString(result);
      if (StringLen(ApiToken) > 0) StringReplace(errorBody, ApiToken, "[REDACTED]");
      // Never print the full URL: the EA's query string can contain its bearer token.
      Print("[MT5-DIAG] Sinal recusado/indisponível. HTTP=", res, " symbol=", g_symbol, " body=", StringSubstr(errorBody, 0, 300));
      return;
   }

   string resp   = CharArrayToString(result);
   string action = ExtractJsonString(resp, "action");
   if (action == "" || action == "HOLD") return;

   string signalId   = ExtractJsonString(resp, "id");
   if (signalId == g_pendingSignalId) return;

   double lotSize    = 0.0;
   double stopLoss   = ExtractJsonDouble(resp, "stopLoss");
   double takeProfit = ExtractJsonDouble(resp, "takeProfit");
   if (action == "BUY")
   {
      stopLoss = NormalizeManagedPrice(stopLoss, false);
      takeProfit = NormalizeManagedPrice(takeProfit, true);
   }
   else if (action == "SELL")
   {
      stopLoss = NormalizeManagedPrice(stopLoss, true);
      takeProfit = NormalizeManagedPrice(takeProfit, false);
   }
   double confidence = ExtractJsonDouble(resp, "confidence");

   string slTpSource    = ExtractJsonString(resp, "slTpSource");
   string assetFamily   = ExtractJsonString(resp, "assetFamily");
   string assetTrend    = ExtractJsonString(resp, "assetTrend");
   string assetVolClass = ExtractJsonString(resp, "assetVolClass");
   string reason        = ExtractJsonString(resp, "reason");


   if (stopLoss > 0 || takeProfit > 0)
   {
      double point      = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      long   stopsLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
      double minDist    = MathMax((double)stopsLevel * point * 1.5, (ask - bid) * 5.0);

      if (minDist <= 0) { Print("⛔ Price Action: distância mínima do broker inválida."); return; }

      if (action == "BUY")
      {
         double entry = ask;
         if (stopLoss <= 0 || (entry - stopLoss) < minDist) { Print("⛔ Price Action: stop de compra incompatível com a distância mínima do broker; sinal cancelado."); return; }
         if (takeProfit <= 0 || (takeProfit - entry) < minDist) { Print("⛔ Price Action: alvo de compra incompatível com a distância mínima do broker; sinal cancelado."); return; }
      }
      else if (action == "SELL")
      {
         double entry = bid;
         if (stopLoss <= 0 || (stopLoss - entry) < minDist) { Print("⛔ Price Action: stop de venda incompatível com a distância mínima do broker; sinal cancelado."); return; }
         if (takeProfit <= 0 || (entry - takeProfit) < minDist) { Print("⛔ Price Action: alvo de venda incompatível com a distância mínima do broker; sinal cancelado."); return; }
      }
   }

   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    {
       double entry = (action == "BUY") ? ask : bid;
       if (action != "BUY" && action != "SELL")
       {
          Print("⛔ Price Action recusado: ação inválida.");
          return;
       }
       if (stopLoss <= 0 || takeProfit <= 0 || entry <= 0 || PriceActionRiskPercent < 1.0 || PriceActionRiskPercent > 2.0)
       {
          Print("⛔ Price Action recusado: preço, SL/TP ou risco configurado inválido.");
          return;
       }
       double riskDistance = (action == "BUY") ? entry - stopLoss : stopLoss - entry;
       double rewardDistance = (action == "BUY") ? takeProfit - entry : entry - takeProfit;
       double pointSize = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
       double currentSpread = ask - bid;
       ENUM_ORDER_TYPE costOrderType = action == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
       double commissionPriceDistance = CommissionPriceDistance(costOrderType, entry);
       if (commissionPriceDistance < 0.0)
       {
          Print("⛔ Price Action recusado: não foi possível converter a comissão configurada para custo de preço.");
          return;
       }
       double estimatedRoundTripCost = currentSpread * 2.0
          + (double)MaxDeviationPoints * pointSize * 2.0 + commissionPriceDistance;
       double netReward = rewardDistance - estimatedRoundTripCost;
       double totalRiskWithCosts = riskDistance + estimatedRoundTripCost;
       double executableRiskReward = totalRiskWithCosts > 0.0 ? netReward / totalRiskWithCosts : 0.0;
       if (riskDistance <= 0 || rewardDistance <= 0 || entry <= 0 || pointSize <= 0
           || currentSpread <= 0 || MaxDeviationPoints < 0 || MaxDeviationPoints > 1000
           || riskDistance / entry > 0.015 || executableRiskReward < 2.0)
       {
          Print("⛔ Price Action recusado: stop inválido, stop acima de 1,5% ou R:R líquido inferior a 1:2 após spread.");
          return;
       }
       Print("   R:R líquido após spread: ", DoubleToString(executableRiskReward, 2));
       lotSize = CalculatePriceActionRiskLot(entry, stopLoss);
       if (lotSize <= 0)
       {
          Print("⛔ Price Action recusado: lote mínimo do broker excede o orçamento de risco ou tick value indisponível.");
          return;
       }
    }

   Print("📡 SINAL v1.0: ", action, " | ", g_symbol, " | Confiança: ", confidence, "%");
   if (assetFamily  != "") Print("   Ativo: ", assetFamily, " | ", assetTrend, " | Vol: ", assetVolClass);
   if (slTpSource   != "") Print("   SL/TP via: ", slTpSource);
   Print("   SL: ", NormalizeManagedPrice(stopLoss, action == "SELL"), " | TP: ", NormalizeManagedPrice(takeProfit, action == "BUY"));
   if (reason != "") Print("   Razão: ", StringSubstr(reason, 0, 150));
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

   bool success = false;
   bool requestOk = false;

   if (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
       || !MQLInfoInteger(MQL_TRADE_ALLOWED)
       || !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)
       || !AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
   {
      Print("⛔ Price Action: negociação bloqueada pelas permissões do terminal, EA ou conta.");
      return;
   }

   long currentSymbolTradeMode = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_MODE);
   if (currentSymbolTradeMode == SYMBOL_TRADE_MODE_DISABLED
       || currentSymbolTradeMode == SYMBOL_TRADE_MODE_CLOSEONLY
       || (action == "BUY" && currentSymbolTradeMode == SYMBOL_TRADE_MODE_SHORTONLY)
       || (action == "SELL" && currentSymbolTradeMode == SYMBOL_TRADE_MODE_LONGONLY))
   {
      Print("⛔ Price Action: direção indisponível nas regras atuais do símbolo. mode=", currentSymbolTradeMode);
      return;
   }

   if (action == "BUY")
      requestOk = trade.Buy(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);
   else if (action == "SELL")
      requestOk = trade.Sell(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);

   // CTrade bool only validates the request structure locally. Require a broker fill.
   uint tradeRetcode = trade.ResultRetcode();
   success = requestOk && (tradeRetcode == TRADE_RETCODE_DONE || tradeRetcode == TRADE_RETCODE_DONE_PARTIAL)
             && trade.ResultDeal() > 0;


   if (success)
   {
      if (signalId != "") g_pendingSignalId = signalId;
      double executedVolume = trade.ResultVolume();
      if (executedVolume > 0 && executedVolume < lotSize)
      {
         Print("⚠️ Execução parcial: solicitado=", DoubleToString(lotSize, 8),
               " executado=", DoubleToString(executedVolume, 8));
         lotSize = executedVolume;
      }
      Print("✅ Ordem executada: ", action, " | Ticket: ", trade.ResultOrder(),
            " | Volume confirmado: ", DoubleToString(lotSize, 8),
            " | SL: ", NormalizeManagedPrice(stopLoss, action == "SELL"),
            " | TP: ", NormalizeManagedPrice(takeProfit, action == "BUY"));
      PersistPriceActionPositionState();
      long positionIdentifier = GetManagedPositionIdentifier();
      if (positionIdentifier > 0)
         ConfirmTradeOpen(signalId, positionIdentifier, action, lotSize, stopLoss, takeProfit, trade.ResultPrice(), TimeCurrent());
      else
         Print("⚠️ Ordem executada, mas posição ainda não identificada; reconciliação automática fará o registro.");
   }
   else
      Print("❌ Falha definitiva: ", trade.ResultRetcode(), " / ", GetLastError());
}

//+------------------------------------------------------------------+
//| Monitor de posições abertas                                       |
//+------------------------------------------------------------------+
bool IsPastBrasiliaSessionEnd()
{
   // Brasília remains UTC-3; no seasonal DST adjustment is required.
   datetime brasiliaNow = TimeGMT() - 3 * 3600;
   MqlDateTime parts;
   TimeToStruct(brasiliaNow, parts);
   return parts.day_of_week == 0 || parts.day_of_week == 6 || parts.hour >= 17;
}

void MonitorOpenPositions()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i))      continue;
      if (posInfo.Magic() != MagicNumber) continue;
      if (posInfo.Symbol() != g_symbol)   continue;

      ulong  ticket    = posInfo.Ticket();
      if (CloseAtEndOfBrasiliaSession && IsPastBrasiliaSessionEnd())
      {
         datetime localNow = TimeLocal();
         if (localNow - g_lastSessionCloseAttempt >= 10)
         {
            g_lastSessionCloseAttempt = localNow;
            bool closeSent = trade.PositionClose(ticket);
            uint closeRetcode = trade.ResultRetcode();
            if (closeSent && closeRetcode == TRADE_RETCODE_DONE && trade.ResultDeal() > 0)
               Print("⏰ Price Action: posição encerrada no fim da sessão de Brasília. Ticket=", ticket);
            else
               Print("⚠️ Price Action: fechamento de fim de sessão não confirmado; SL/TP permanecem ativos. Ticket=", ticket, " retcode=", closeRetcode);
         }
         continue;
      }
      string posType   = posInfo.PositionType() == POSITION_TYPE_BUY ? "BUY" : "SELL";
      double openPrice = posInfo.PriceOpen();
      double curPrice  = posInfo.PriceCurrent();
      double sl        = posInfo.StopLoss();
      double tp        = posInfo.TakeProfit();
      double profit    = posInfo.Profit();
 
       // Deterministic Price Action management: breakeven at +1R and 50% partial at +1.5R.
       // These controls run locally and never depend on AI availability. During news blocks, existing positions keep their broker-side SL/TP; the server blocks only new entries.
       if (IsPriceActionEnabled() && sl > 0 && tp > 0)
       {
          string riskKey = PriceActionStateKey("InvistaPA_R", (long)ticket);
          string volumeKey = PriceActionStateKey("InvistaPA_V", (long)ticket);
          string partialKey = PriceActionStateKey("InvistaPA_TP1", (long)ticket);
          double initialRisk = GlobalVariableCheck(riskKey) ? GlobalVariableGet(riskKey)
             : RecoverInitialPositionRisk(posInfo.Identifier(), openPrice);
          if (initialRisk <= 0.0 && ((posType == "BUY" && sl < openPrice) || (posType == "SELL" && sl > openPrice)))
             initialRisk = MathAbs(openPrice - sl);
          if (initialRisk > 0.0 && !GlobalVariableCheck(riskKey)) GlobalVariableSet(riskKey, initialRisk);
          double recoveredInitialVolume = RecoverInitialPositionVolume(posInfo.Identifier());
          double initialVolume = GlobalVariableCheck(volumeKey) ? GlobalVariableGet(volumeKey)
             : (recoveredInitialVolume > 0.0 ? recoveredInitialVolume : posInfo.Volume());
          if (!GlobalVariableCheck(volumeKey)) GlobalVariableSet(volumeKey, initialVolume);
          double volumeStepForState = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
          double minVolumeForState = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
          double partialTolerance = MathMax(volumeStepForState * 0.5, 1e-8);
          double desiredPartialVolume = volumeStepForState > 0.0
             ? MathFloor((initialVolume * 0.5) / volumeStepForState) * volumeStepForState : 0.0;
          double alreadyClosedVolume = MathMax(0.0, initialVolume - posInfo.Volume());
          bool partialAlreadyDone = GlobalVariableCheck(partialKey)
             || (desiredPartialVolume >= minVolumeForState
                 && alreadyClosedVolume + partialTolerance >= desiredPartialVolume);
          if (partialAlreadyDone && !GlobalVariableCheck(partialKey)) GlobalVariableSet(partialKey, 1.0);
          if (initialRisk <= 0.0 && MathAbs(openPrice - sl) > SymbolInfoDouble(g_symbol, SYMBOL_POINT) * 2.0)
          {
             initialRisk = MathAbs(openPrice - sl);
             GlobalVariableSet(riskKey, initialRisk);
          }
          if (initialRisk > 0.0)
          {
             double favorableMove = (posType == "BUY") ? curPrice - openPrice : openPrice - curPrice;
             if (favorableMove >= initialRisk)
             {
                bool needsBreakeven = (posType == "BUY" && sl < openPrice) ||
                                      (posType == "SELL" && sl > openPrice);
                if (needsBreakeven)
                {
                   double breakevenSL = NormalizeManagedPrice(openPrice, posType == "SELL");
                   bool modifySent = trade.PositionModify(ticket, breakevenSL, tp);
                   uint modifyRetcode = trade.ResultRetcode();
                   if (modifySent && modifyRetcode == TRADE_RETCODE_DONE)
                   {
                      sl = breakevenSL;
                      Print("🛡️ Price Action: stop confirmado em breakeven +1R. Ticket=", ticket);
                   }
                   else
                      Print("⛔ Price Action: breakeven não confirmado pelo broker; ticket=", ticket, " retcode=", modifyRetcode);
                }
             }
             if (favorableMove >= initialRisk * 1.5 && !partialAlreadyDone && ((posType == "BUY" && sl >= openPrice) || (posType == "SELL" && sl <= openPrice)))
             {
                double currentVolume = posInfo.Volume();
                double volumeStep = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
                double minVolume = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
                int volumeDigits = VolumeDigitsFromStep();
                double remainingToClose = MathMax(0.0, desiredPartialVolume - alreadyClosedVolume);
                double partialVolume = (volumeStep > 0.0)
                   ? MathFloor((remainingToClose + partialTolerance) / volumeStep) * volumeStep : 0.0;
                partialVolume = NormalizeDouble(partialVolume, volumeDigits);
                if (desiredPartialVolume >= minVolume && partialVolume >= minVolume
                    && currentVolume - partialVolume >= minVolume)
                {
                   if (ClosePriceActionPartial(ticket, partialVolume, posType))
                   {
                      GlobalVariableSet(partialKey, 1.0);
                      Print("🎯 Price Action: parcial-alvo de 50% confirmada em +1,5R. Ticket=", ticket);
                      continue;
                   }
                   Print("⛔ Price Action: parcial incompleta/recusada; será reconciliada pelo volume real. Ticket=", ticket, " retcode=", trade.ResultRetcode());
                }
                else
                {
                   GlobalVariableSet(partialKey, -1.0);
                   Print("ℹ️ Price Action: lote mínimo do broker impede completar a parcial de 50%; posição segue protegida pelo SL/TP.");
                }
             }
             if (favorableMove >= initialRisk * 1.5)
             {
                double swingStop = CalculatePriceActionSwingStop(posType, sl);
                if (swingStop > 0.0)
                {
                   bool swingSent = trade.PositionModify(ticket, swingStop, tp);
                   uint swingRetcode = trade.ResultRetcode();
                   if (swingSent && swingRetcode == TRADE_RETCODE_DONE)
                   {
                      sl = swingStop;
                      Print("📈 Price Action: trailing por pivô M5 confirmado. Ticket=", ticket, " SL=", DoubleToString(sl, ManagedSymbolDigits()));
                   }
                   else
                      Print("⛔ Price Action: trailing por swing recusado; ticket=", ticket, " retcode=", swingRetcode);
                }
             }
          }
       }


   }
}

// Chart changes do not trigger legacy indicator scans in the Price Action EA.

//+------------------------------------------------------------------+
//| Heartbeat                                                         |
//+------------------------------------------------------------------+
bool SendHeartbeat()
{
   double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin    = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   long   accId     = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker    = AccountInfoString(ACCOUNT_COMPANY);
   int    openPos   = PositionsTotal();
   long   tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string accountType = (tradeMode == ACCOUNT_TRADE_MODE_REAL) ? "real" :
                        (tradeMode == ACCOUNT_TRADE_MODE_DEMO) ? "demo" : "contest";

   string url     = g_serverUrl + "/api/metatrader/heartbeat";
   string headers = "Content-Type: application/json\r\n";
   string body    = "{";
   body += "\"accountId\":\""  + IntegerToString(accId) + "\",";
   body += "\"broker\":\""     + broker                 + "\",";
   body += "\"balance\":"      + DoubleToString(balance, 2) + ",";
   body += "\"equity\":"       + DoubleToString(equity,  2) + ",";
   body += "\"freeMargin\":"   + DoubleToString(margin,  2) + ",";
   body += "\"openPositions\":" + IntegerToString(openPos)  + ",";
   body += "\"platform\":\"MT5\",";
   body += "\"accountType\":\"" + accountType + "\",";
   body += "\"eaVersion\":\"1.0\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
   if (res == 200)
   {
      g_failCount = 0;
      string resp    = CharArrayToString(result);
      string enabled = ExtractJsonString(resp, "enabled");
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Confirma abertura de trade                                        |
//+------------------------------------------------------------------+

bool ConfirmTradeOpen(string signalId, long ticket, string type, double lots, double sl, double tp, double executedPrice, datetime openedAt)
{
   if (ticket <= 0 || lots <= 0.0 || executedPrice <= 0.0) return false;
   string url     = g_serverUrl + "/api/metatrader/trade/open";
   string headers = "Content-Type: application/json\r\n";
   string body = "{";
   body += "\"ticket\":"       + IntegerToString(ticket)          + ",";
   body += "\"symbol\":\""     + g_symbol                        + "\",";
   body += "\"type\":\""       + type                            + "\",";
   body += "\"lots\":"         + DoubleToString(lots, 8)         + ",";
   body += "\"openPrice\":"    + DoubleToString(executedPrice, ManagedSymbolDigits()) + ",";
   body += "\"stopLoss\":"     + DoubleToString(sl, ManagedSymbolDigits())     + ",";
   body += "\"takeProfit\":"   + DoubleToString(tp, ManagedSymbolDigits())     + ",";
   body += "\"openTime\":"     + IntegerToString((long)BrokerTimeToUtc(openedAt) * 1000)  + ",";
   body += "\"signalId\":\""   + signalId                        + "\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";
   char postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;
   int response = WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
   if (response == 200)
   {
      GlobalVariableSet(PriceActionStateKey("InvistaPA_OPEN", ticket), 1.0);
      return true;
   }
   Print("⚠️ Registro de posição não confirmado pelo servidor; será sincronizado novamente. Ticket=", ticket, " HTTP=", response);
   return false;
}

void SyncOpenPositionReports()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Magic() != MagicNumber || posInfo.Symbol() != g_symbol) continue;
      long identifier = (long)PositionGetInteger(POSITION_IDENTIFIER);
      if (identifier <= 0 || GlobalVariableCheck(PriceActionStateKey("InvistaPA_OPEN", identifier))) continue;
      string comment = posInfo.Comment();
      string signalId = "";
      int prefix = StringFind(comment, "InvistaPRO_");
      if (prefix >= 0) signalId = StringSubstr(comment, prefix + StringLen("InvistaPRO_"));
      string type = posInfo.PositionType() == POSITION_TYPE_BUY ? "BUY" : "SELL";
      ConfirmTradeOpen(signalId, identifier, type, posInfo.Volume(), posInfo.StopLoss(),
                       posInfo.TakeProfit(), posInfo.PriceOpen(), posInfo.Time());
   }
}

bool IsPositionIdentifierOpen(ulong positionId)
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if ((ulong)PositionGetInteger(POSITION_IDENTIFIER) == positionId) return true;
   }
   return false;
}

bool ReportClosedPosition(ulong positionId)
{
   if (positionId == 0 || IsPositionIdentifierOpen(positionId)) return false;
   string closedKey = PriceActionStateKey("InvistaPA_CLOSED", (long)positionId);
   if (GlobalVariableCheck(closedKey)) return true;
   if (!HistorySelectByPosition(positionId)) return false;

   double entryVolume = 0.0, entryValue = 0.0;
   double exitVolume = 0.0, exitValue = 0.0;
   double netProfit = 0.0;
   datetime openTime = 0, closeTime = 0;
   string symbol = "", signalId = "", positionType = "";
   long closeReason = DEAL_REASON_CLIENT;

   int total = HistoryDealsTotal();
   for (int i = 0; i < total; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if (deal == 0) continue;
      if ((long)HistoryDealGetInteger(deal, DEAL_MAGIC) != MagicNumber) continue;
      string dealSymbol = HistoryDealGetString(deal, DEAL_SYMBOL);
      if (dealSymbol != g_symbol) continue;

      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      double volume = HistoryDealGetDouble(deal, DEAL_VOLUME);
      double price = HistoryDealGetDouble(deal, DEAL_PRICE);
      datetime dealTime = BrokerTimeToUtc((datetime)HistoryDealGetInteger(deal, DEAL_TIME));
      if (entry == DEAL_ENTRY_IN)
      {
         entryVolume += volume;
         entryValue += price * volume;
         if (openTime == 0 || dealTime < openTime) openTime = dealTime;
         if (symbol == "") symbol = dealSymbol;
         long dealType = HistoryDealGetInteger(deal, DEAL_TYPE);
         positionType = dealType == DEAL_TYPE_BUY ? "BUY" : dealType == DEAL_TYPE_SELL ? "SELL" : positionType;
         string comment = HistoryDealGetString(deal, DEAL_COMMENT);
         int prefix = StringFind(comment, "InvistaPRO_");
         if (prefix >= 0) signalId = StringSubstr(comment, prefix + StringLen("InvistaPRO_"));
      }
      else if (entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
      {
         exitVolume += volume;
         exitValue += price * volume;
         netProfit += HistoryDealGetDouble(deal, DEAL_PROFIT)
                    + HistoryDealGetDouble(deal, DEAL_COMMISSION)
                    + HistoryDealGetDouble(deal, DEAL_SWAP)
                    + HistoryDealGetDouble(deal, DEAL_FEE);
         if (dealTime >= closeTime)
         {
            closeTime = dealTime;
            closeReason = HistoryDealGetInteger(deal, DEAL_REASON);
         }
         if (symbol == "") symbol = dealSymbol;
      }
   }

   if (entryVolume <= 0.0 || exitVolume <= 0.0 || openTime <= 0 || closeTime <= 0
       || symbol == "" || (positionType != "BUY" && positionType != "SELL")) return false;

   double openPrice = entryValue / entryVolume;
   double closePrice = exitValue / exitVolume;
   string reason = "MANUAL";
   if (closeReason == DEAL_REASON_SL) reason = "STOP_LOSS";
   else if (closeReason == DEAL_REASON_TP) reason = "TAKE_PROFIT";
   else if (closeReason == DEAL_REASON_SO) reason = "STOP_OUT";

   string body = "{";
   body += "\"ticket\":" + IntegerToString((long)positionId) + ",";
   body += "\"signalId\":\"" + signalId + "\",";
   body += "\"symbol\":\"" + symbol + "\",";
   body += "\"type\":\"" + positionType + "\",";
   body += "\"lots\":" + DoubleToString(entryVolume, 8) + ",";
   body += "\"openPrice\":" + DoubleToString(openPrice, ManagedSymbolDigits()) + ",";
   body += "\"closePrice\":" + DoubleToString(closePrice, ManagedSymbolDigits()) + ",";
   body += "\"profit\":" + DoubleToString(netProfit, 2) + ",";
   body += "\"pips\":0,";
   body += "\"openTime\":" + IntegerToString((long)openTime * 1000) + ",";
   body += "\"closeTime\":" + IntegerToString((long)closeTime * 1000) + ",";
   body += "\"closeReason\":\"" + reason + "\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   string url = g_serverUrl + "/api/metatrader/trade/close";
   string headers = "Content-Type: application/json\r\n";
   char postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;
   int response = WebRequest("POST", url, headers, 7000, postData, result, responseHeaders);
   if (response == 200)
   {
      GlobalVariableSet(closedKey, 1.0);
      Print("📚 Fechamento sincronizado com o servidor. PositionId=", positionId,
            " P&L líquido=", DoubleToString(netProfit, 2));
      return true;
   }
   Print("⚠️ Falha ao sincronizar fechamento; será tentado novamente. PositionId=", positionId,
         " HTTP=", response);
   return false;
}

void SyncClosedTradeReports()
{
   datetime from = TimeCurrent() - 90 * 86400;
   if (!HistorySelect(from, TimeCurrent())) return;
   ulong positionIds[];
   int total = HistoryDealsTotal();
   for (int i = 0; i < total; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if (deal == 0 || (long)HistoryDealGetInteger(deal, DEAL_MAGIC) != MagicNumber) continue;
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      if (entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
      ulong positionId = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      if (positionId == 0 || IsPositionIdentifierOpen(positionId)) continue;
      string key = PriceActionStateKey("InvistaPA_CLOSED", (long)positionId);
      if (GlobalVariableCheck(key)) continue;
      bool exists = false;
      for (int j = 0; j < ArraySize(positionIds); j++) if (positionIds[j] == positionId) { exists = true; break; }
      if (!exists)
      {
         int size = ArraySize(positionIds);
         ArrayResize(positionIds, size + 1);
         positionIds[size] = positionId;
      }
   }
   for (int i = 0; i < ArraySize(positionIds); i++) ReportClosedPosition(positionIds[i]);
}

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if (trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0) return;
   if (!HistoryDealSelect(trans.deal)) return;
   if ((long)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != MagicNumber) return;
   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if (entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) return;
   ulong positionId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   if (positionId > 0 && !IsPositionIdentifierOpen(positionId)) ReportClosedPosition(positionId);
}


//+------------------------------------------------------------------+
//| Busca URL de descoberta                                           |
//+------------------------------------------------------------------+
void FetchDiscoveryUrl()
{
   string url     = g_serverUrl + "/api/url";
   string headers = "Accept: application/json\r\n";
   char  data[];
   char  result[];
   string responseHeaders;
   int res = WebRequest("GET", url, headers, 5000, data, result, responseHeaders);
   if (res == 200 && ArraySize(result) > 0)
   {
      string body    = CharArrayToString(result);
      string blobUrl = ExtractJsonString(body, "discoveryUrl");
      if (blobUrl != "")
      {
         g_discoverUrl = blobUrl;
         Print("✅ URL de descoberta: ", g_discoverUrl);
         SaveDiscoveryUrl(g_discoverUrl);
      }
   }
   else
   {
      string saved = LoadDiscoveryUrl();
      if (saved != "") g_discoverUrl = saved;
   }
}

//+------------------------------------------------------------------+
//| Reconexão automática                                              |
//+------------------------------------------------------------------+
bool TryReconnect()
{
   if (g_discoverUrl == "") { Print("⚠️ URL de descoberta não configurada"); return false; }
   g_isDiscovering = true;
   g_failCount++;
   if (g_failCount > MaxReconnectTries)
   {
      Print("❌ Máximo de reconexões atingido.");
      g_isDiscovering = false;
      return false;
   }
   Print("🔄 Reconexão ", g_failCount, "/", MaxReconnectTries, "...");
   string headers = "Accept: application/json\r\n";
   char  data[];
   char  result[];
   string responseHeaders;
   int res = WebRequest("GET", g_discoverUrl, headers, 10000, data, result, responseHeaders);
   if (res == 200 && ArraySize(result) > 0)
   {
      string body   = CharArrayToString(result);
      string newUrl = ExtractJsonString(body, "serverUrl");
      if (newUrl != "")
      {
         if (newUrl != g_serverUrl)
         {
            g_serverUrl = newUrl;
            Print("✅ URL atualizada: ", g_serverUrl);
         }
         // A discovery endpoint responding successfully means connectivity is back,
         // even when the canonical URL has not changed.
         g_failCount = 0;
         g_isDiscovering = false;
         return true;
      }
   }
   g_isDiscovering = false;
   return false;
}

//+------------------------------------------------------------------+
//| Salva URL de descoberta em arquivo                                |
//+------------------------------------------------------------------+
void SaveDiscoveryUrl(string url)
{
   string path = "InvistaPRO_discovery.txt";
   int handle = FileOpen(path, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if (handle != INVALID_HANDLE) { FileWrite(handle, url); FileClose(handle); }
}

//+------------------------------------------------------------------+
//| Carrega URL de descoberta de arquivo                              |
//+------------------------------------------------------------------+
string LoadDiscoveryUrl()
{
   string path = "InvistaPRO_discovery.txt";
   if (!FileIsExist(path, FILE_COMMON)) return "";
   int handle = FileOpen(path, FILE_READ|FILE_TXT|FILE_COMMON);
   if (handle == INVALID_HANDLE) return "";
   string url = FileReadString(handle);
   FileClose(handle);
   return url;
}

//+------------------------------------------------------------------+
//| Funções auxiliares de parsing JSON                                |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if (pos < 0)
   {
      search = "\"" + key + "\": \"";
      pos = StringFind(json, search);
   }
   if (pos < 0) return "";
   int start = pos + StringLen(search);
   int end   = StringFind(json, "\"", start);
   if (end < 0) return "";
   return StringSubstr(json, start, end - start);
}

double ExtractJsonDouble(string json, string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if (pos < 0)
   {
      search = "\"" + key + "\": ";
      pos = StringFind(json, search);
   }
   if (pos < 0) return 0.0;
   int start = pos + StringLen(search);
   string raw = StringSubstr(json, start, 30);
   return StringToDouble(raw);
}

