//+------------------------------------------------------------------+
//|                                              InvistaPRO_EA.mq5    |
//|                                 InvistaPRO - Auto-Discovery URL   |
//|   Versão 6.0 — Perfil de Ativo + SL/TP por Indicadores Reais     |
//|   Detecta: Girassol, Fibonacci automático e qualquer indicador    |
//|   Calcula SL/TP usando os níveis REAIS dos indicadores instalados |
//+------------------------------------------------------------------+
#property copyright "InvistaPRO"
#property version   "6.0"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- Parâmetros de entrada
input string   ServerURL        = "https://7352d23d-7673-4705-a8d7-9e8839cf09fa-00-1jh0r3h4kuy8w.worf.replit.dev"; // URL do servidor
input string   DiscoveryBlobURL = "https://jsonblob.com/api/jsonBlob/019d0dd7-564d-7c0c-a833-9a25b3b70c81"; // URL de descoberta automática
input string   ApiToken         = "";          // Token de autenticação (opcional)
input string   Symbol_Override  = "";          // Símbolo (vazio = gráfico atual)
input int      HeartbeatSeconds = 30;          // Intervalo do heartbeat (segundos)
input int      SignalSeconds    = 5;           // Intervalo de busca de sinal (segundos)
input double   LotSize          = 0.01;        // Tamanho do lote
input int      MagicNumber      = 20250315;    // Número mágico
input bool     AutoReconnect    = true;        // Reconexão automática de URL
input int      MaxReconnectTries= 5;           // Tentativas máximas de reconexão
input int      IndicatorBars    = 5;           // Quantas barras recentes dos indicadores ler
input int      CandleCount      = 200;         // Candles para enviar à IA (histórico)

//--- Variáveis globais
string   g_serverUrl      = "";
string   g_discoverUrl    = "";
string   g_symbol         = "";
string   g_apiToken       = "";
datetime g_lastHeartbeat  = 0;
datetime g_lastSignal     = 0;
int      g_failCount      = 0;
bool     g_isDiscovering  = false;
string   g_pendingSignalId= "";
datetime g_lastMonitor    = 0;
int      g_monitorSeconds = 2;

// Perfil do ativo recebido do servidor
string   g_assetFamily    = "";
string   g_assetTrend     = "";
string   g_assetVolClass  = "";
double   g_assetRsiOversold  = 30.0;
double   g_assetRsiOverbought= 70.0;
bool     g_assetProfileLoaded = false;

CTrade         trade;
CPositionInfo  posInfo;

//--- Estrutura para armazenar info de cada indicador detectado no gráfico
struct IndicatorInfo
{
   string name;
   int    handle;
   int    subwindow;
   int    totalBuffers;
};

IndicatorInfo g_indicators[];
int           g_indicatorCount = 0;

//+------------------------------------------------------------------+
//| Inicialização do EA                                               |
//+------------------------------------------------------------------+
int OnInit()
{
   g_serverUrl   = ServerURL;
   g_discoverUrl = DiscoveryBlobURL;
   g_symbol      = (Symbol_Override != "") ? Symbol_Override : _Symbol;
   g_apiToken    = ApiToken;
   g_failCount   = 0;

   trade.SetExpertMagicNumber(MagicNumber);

   Print("🚀 InvistaPRO EA v6.0 iniciado | Símbolo: ", g_symbol);
   Print("   → Perfil de ativo Deriv | SL/TP por indicadores reais | ", CandleCount, " candles históricos");

   ScanChartIndicators();

   if (g_discoverUrl == "") FetchDiscoveryUrl();

   // Busca o perfil do ativo Deriv logo no início
   FetchAssetProfile();

   SendHeartbeat();
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Busca e armazena o perfil do ativo sintético no servidor         |
//| Permite que o EA saiba de antemão como aquele ativo se comporta  |
//+------------------------------------------------------------------+
void FetchAssetProfile()
{
   string url     = g_serverUrl + "/api/metatrader/asset-profile/" + g_symbol;
   string headers = "Accept: application/json\r\n";
   char   result[];
   string responseHeaders;

   int res = WebRequest("GET", url, headers, 5000, NULL, result, responseHeaders);
   if (res != 200) return;

   string resp = CharArrayToString(result);
   string found = ExtractJsonString(resp, "found");
   if (found != "true") return;

   g_assetFamily    = ExtractJsonString(resp, "family");
   g_assetTrend     = ExtractJsonString(resp, "trendType");
   g_assetVolClass  = ExtractJsonString(resp, "volClass");
   g_assetProfileLoaded = true;

   // Extrai thresholds de RSI do objeto indicatorGuidance
   double ov  = ExtractJsonDoubleInObject(resp, "indicatorGuidance", "rsiOversold");
   double ovb = ExtractJsonDoubleInObject(resp, "indicatorGuidance", "rsiOverbought");
   if (ov  > 0) g_assetRsiOversold  = ov;
   if (ovb > 0) g_assetRsiOverbought= ovb;

   Print("📊 Perfil do ativo carregado: ", g_symbol);
   Print("   Família:     ", g_assetFamily);
   Print("   Volatilidade: ", g_assetVolClass);
   Print("   Tipo:        ", g_assetTrend);
   Print("   RSI thr:     <", g_assetRsiOversold, " / >", g_assetRsiOverbought);
}

//+------------------------------------------------------------------+
//| Detecta TODOS os indicadores instalados no gráfico atual          |
//+------------------------------------------------------------------+
void ScanChartIndicators()
{
   ArrayResize(g_indicators, 0);
   g_indicatorCount = 0;

   long chartId     = ChartID();
   int  totalWindows= (int)ChartGetInteger(chartId, CHART_WINDOWS_TOTAL);

   Print("🔍 Escaneando indicadores em ", totalWindows, " janela(s) do gráfico...");

   for (int win = 0; win < totalWindows; win++)
   {
      int indicatorsInWindow = ChartIndicatorsTotal(chartId, win);
      for (int idx = 0; idx < indicatorsInWindow; idx++)
      {
         string shortName = ChartIndicatorName(chartId, win, idx);
         if (shortName == "") continue;

         int handle = ChartIndicatorGet(chartId, win, shortName);
         if (handle == INVALID_HANDLE)
         {
            Print("⚠️ Handle inválido: ", shortName);
            continue;
         }

         int numBuffers = 0;
         double testBuf[];
         for (int b = 0; b < 64; b++)
         {
            if (CopyBuffer(handle, b, 0, 1, testBuf) < 0) break;
            numBuffers = b + 1;
         }

         int i = g_indicatorCount;
         ArrayResize(g_indicators, i + 1);
         g_indicators[i].name        = shortName;
         g_indicators[i].handle      = handle;
         g_indicators[i].subwindow   = win;
         g_indicators[i].totalBuffers= numBuffers;
         g_indicatorCount++;

         Print("✅ Indicador detectado: [", shortName, "] | Janela: ", win,
               " | Buffers: ", numBuffers);
      }
   }
   Print("📊 Total de indicadores detectados: ", g_indicatorCount);
}

//+------------------------------------------------------------------+
//| Lê os buffers de todos os indicadores detectados                  |
//| Retorna JSON array com valores de cada buffer de cada indicador   |
//+------------------------------------------------------------------+
string ReadAllIndicatorBuffers()
{
   string json = "[";
   int bars = IndicatorBars;

   for (int i = 0; i < g_indicatorCount; i++)
   {
      if (i > 0) json += ",";
      json += "{";
      json += "\"name\":\"" + g_indicators[i].name + "\",";
      json += "\"subwindow\":" + IntegerToString(g_indicators[i].subwindow) + ",";
      json += "\"buffers\":[";

      for (int b = 0; b < g_indicators[i].totalBuffers; b++)
      {
         double buf[];
         int copied = CopyBuffer(g_indicators[i].handle, b, 0, bars, buf);

         if (b > 0) json += ",";
         json += "{\"index\":" + IntegerToString(b) + ",\"values\":[";

         if (copied > 0)
         {
            for (int v = 0; v < copied; v++)
            {
               if (v > 0) json += ",";
               if (buf[v] >= 1e20 || buf[v] <= -1e20)
                  json += "null";
               else
                  json += DoubleToString(buf[v], _Digits);
            }
         }
         json += "]}";
      }
      json += "]}";
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Identifica sinais estruturados do Girassol, Fibonacci e outros   |
//| v6.0: inclui support_resistance_levels para SL/TP baseado em    |
//|        indicadores reais instalados no gráfico                   |
//+------------------------------------------------------------------+
string ReadStructuredIndicatorSignals()
{
   string json = "{";

   bool girassolFound = false;
   bool fibFound      = false;

   for (int i = 0; i < g_indicatorCount; i++)
   {
      string nameLower = g_indicators[i].name;
      StringToLower(nameLower);

      bool isGirassol = (StringFind(nameLower, "girassol") >= 0 ||
                         StringFind(nameLower, "sunflower") >= 0 ||
                         StringFind(nameLower, "gira")     >= 0);

      bool isFibonacci = (StringFind(nameLower, "fib")      >= 0 ||
                          StringFind(nameLower, "fibonacci") >= 0 ||
                          StringFind(nameLower, "retr")      >= 0);

      // === LEITURA DO GIRASSOL ===
      if (isGirassol && !girassolFound)
      {
         girassolFound = true;
         int    totalBufs = g_indicators[i].totalBuffers;
         int    lookback  = IndicatorBars;
         double ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);

         json += "\"girassol\":{";
         json += "\"detected\":true,";
         json += "\"name\":\"" + g_indicators[i].name + "\",";
         json += "\"signals\":{";

         string buySignals  = "\"buy_signals\":[";
         string sellSignals = "\"sell_signals\":[";
         string exitSignals = "\"exit_signals\":[";

         // Para SL/TP baseado em indicador real:
         // Buffers abaixo do preço são suporte (potencial SL para SELL / TP para BUY)
         // Buffers acima do preço são resistência (potencial TP para BUY / SL para SELL)
         string srLevels = "\"support_resistance_levels\":[";
         bool firstSR    = true;

         for (int b = 0; b < MathMin(totalBufs, 8); b++)
         {
            double buf[];
            if (CopyBuffer(g_indicators[i].handle, b, 0, lookback, buf) < 1) continue;

            for (int v = 0; v < lookback; v++)
            {
               if (buf[v] >= 1e20 || buf[v] <= -1e20) continue;

               string entry = "{\"bar\":" + IntegerToString(v) +
                              ",\"buffer\":" + IntegerToString(b) +
                              ",\"value\":" + DoubleToString(buf[v], _Digits) + "}";

               if (b == 0)      { if (StringLen(buySignals)  > 14) buySignals  += ","; buySignals  += entry; }
               else if (b == 1) { if (StringLen(sellSignals) > 15) sellSignals += ","; sellSignals += entry; }
               else             { if (StringLen(exitSignals) > 15) exitSignals += ","; exitSignals += entry; }

               // Classificar como suporte ou resistência com base na posição relativa ao preço
               // Apenas barra 0 (atual) é relevante para SL/TP
               if (v == 0 && buf[v] > 0 && ask > 0)
               {
                  string srType = (buf[v] < ask) ? "support" : "resistance";
                  if (!firstSR) srLevels += ",";
                  firstSR = false;
                  srLevels += "{\"type\":\"" + srType + "\",";
                  srLevels += "\"price\":" + DoubleToString(buf[v], _Digits) + ",";
                  srLevels += "\"buffer\":" + IntegerToString(b) + "}";
               }
            }
         }

         buySignals += "]";
         sellSignals += "]";
         exitSignals += "]";
         srLevels    += "]";

         json += buySignals  + ",";
         json += sellSignals + ",";
         json += exitSignals;
         json += "},"; // fecha signals

         json += srLevels + ","; // níveis de suporte/resistência para SL/TP

         json += "\"raw_buffers\":" + BuildRawBuffersJson(i, lookback);
         json += "},"; // fecha girassol
      }

      // === LEITURA DO FIBONACCI AUTOMÁTICO ===
      if (isFibonacci && !fibFound)
      {
         fibFound  = true;
         int totalBufs = g_indicators[i].totalBuffers;

         json += "\"fibonacci\":{";
         json += "\"detected\":true,";
         json += "\"name\":\"" + g_indicators[i].name + "\",";
         json += "\"levels\":[";

         string fibNames[];
         ArrayResize(fibNames, 11);
         fibNames[0]  = "0%";
         fibNames[1]  = "23.6%";
         fibNames[2]  = "38.2%";
         fibNames[3]  = "50%";
         fibNames[4]  = "61.8%";
         fibNames[5]  = "78.6%";
         fibNames[6]  = "100%";
         fibNames[7]  = "127.2%";
         fibNames[8]  = "161.8%";
         fibNames[9]  = "200%";
         fibNames[10] = "261.8%";

         bool firstLevel = true;
         for (int b = 0; b < totalBufs; b++)
         {
            double buf[];
            if (CopyBuffer(g_indicators[i].handle, b, 0, 1, buf) < 1) continue;
            if (buf[0] >= 1e20 || buf[0] <= -1e20) continue;

            if (!firstLevel) json += ",";
            firstLevel = false;

            string levelName = (b < ArraySize(fibNames)) ? fibNames[b] : ("L" + IntegerToString(b));
            json += "{\"level\":\"" + levelName + "\",";
            json += "\"price\":" + DoubleToString(buf[0], _Digits) + ",";
            json += "\"buffer\":" + IntegerToString(b) + "}";
         }
         json += "]},"; // fecha levels e fibonacci
      }
   }

   if (!girassolFound)  json += "\"girassol\":{\"detected\":false},";
   if (!fibFound)       json += "\"fibonacci\":{\"detected\":false},";

   // Remove vírgula extra antes de fechar
   if (StringGetCharacter(json, StringLen(json)-1) == ',')
      json = StringSubstr(json, 0, StringLen(json)-1);

   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Constrói JSON com buffers brutos de um indicador pelo índice      |
//+------------------------------------------------------------------+
string BuildRawBuffersJson(int indicatorIdx, int bars)
{
   string json = "[";
   for (int b = 0; b < g_indicators[indicatorIdx].totalBuffers; b++)
   {
      double buf[];
      if (b > 0) json += ",";
      json += "[";
      if (CopyBuffer(g_indicators[indicatorIdx].handle, b, 0, bars, buf) > 0)
      {
         for (int v = 0; v < bars; v++)
         {
            if (v > 0) json += ",";
            if (buf[v] >= 1e20 || buf[v] <= -1e20) json += "null";
            else json += DoubleToString(buf[v], _Digits);
         }
      }
      json += "]";
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Tick principal                                                    |
//+------------------------------------------------------------------+
void OnTick()
{
   datetime now = TimeCurrent();

   if (now - g_lastHeartbeat >= HeartbeatSeconds)
   {
      g_lastHeartbeat = now;
      if (!SendHeartbeat() && AutoReconnect && !g_isDiscovering)
         TryReconnect();
   }

   if (PositionsTotal() > 0 && (now - g_lastMonitor >= g_monitorSeconds))
   {
      g_lastMonitor = now;
      MonitorOpenPositions();
   }

   if (PositionsTotal() == 0 && (now - g_lastSignal >= SignalSeconds))
   {
      g_lastSignal = now;
      FetchAndProcessSignal();
   }
}

//+------------------------------------------------------------------+
//| Monitor de posições — inclui leituras dos indicadores do gráfico  |
//+------------------------------------------------------------------+
void MonitorOpenPositions()
{
   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M1, 0, 100, rates);
   if (copied < 5) return;

   string candlesJson = BuildCandlesJson(rates, copied);
   string structuredSignals = ReadStructuredIndicatorSignals();
   string allBuffers        = ReadAllIndicatorBuffers();

   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i))      continue;
      if (posInfo.Magic() != MagicNumber) continue;
      if (posInfo.Symbol() != g_symbol)   continue;

      long   ticket    = posInfo.Ticket();
      string posType   = posInfo.PositionType() == POSITION_TYPE_BUY ? "BUY" : "SELL";
      double openPrice = posInfo.PriceOpen();
      double curPrice  = posInfo.PriceCurrent();
      double sl        = posInfo.StopLoss();
      double tp        = posInfo.TakeProfit();
      double profit    = posInfo.Profit();

      string posJson = "{";
      posJson += "\"ticket\":"       + IntegerToString(ticket)               + ",";
      posJson += "\"symbol\":\""     + g_symbol                              + "\",";
      posJson += "\"type\":\""       + posType                               + "\",";
      posJson += "\"lots\":"         + DoubleToString(posInfo.Volume(), 2)   + ",";
      posJson += "\"openPrice\":"    + DoubleToString(openPrice, _Digits)    + ",";
      posJson += "\"currentPrice\":" + DoubleToString(curPrice, _Digits)     + ",";
      posJson += "\"stopLoss\":"     + DoubleToString(sl, _Digits)           + ",";
      posJson += "\"takeProfit\":"   + DoubleToString(tp, _Digits)           + ",";
      posJson += "\"profit\":"       + DoubleToString(profit, 2)             + ",";
      posJson += "\"openTime\":"     + IntegerToString((long)posInfo.Time()) + ",";
      posJson += "\"signalId\":\""   + posType + "_" + IntegerToString(ticket) + "\"";
      posJson += "}";

      string body = "{";
      body += "\"position\":"         + posJson           + ",";
      body += "\"marketData\":"       + candlesJson        + ",";
      body += "\"symbol\":\""         + g_symbol          + "\",";
      body += "\"indicatorSignals\":" + structuredSignals  + ",";
      body += "\"indicatorBuffers\":" + allBuffers;
      body += "}";

      string url     = g_serverUrl + "/api/mt5/position/monitor";
      string headers = "Content-Type: application/json\r\n";
      char   postData[], result[];
      StringToCharArray(body, postData, 0, StringLen(body));
      string responseHeaders;

      int res = WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
      if (res != 200) continue;

      string resp    = CharArrayToString(result);
      string action  = ExtractJsonString(resp, "action");
      string reason  = ExtractJsonString(resp, "reason");
      string urgency = ExtractJsonString(resp, "urgency");

      bool shouldClose = (action == "CLOSE_PROFIT"        ||
                          action == "CLOSE_SPIKE_EXIT"    ||
                          action == "CLOSE_LOSS_PREVENTION");

      if (shouldClose)
      {
         Print("🤖 Monitor IA → ", action, " | #", ticket,
               " | Urgência: ", urgency, " | Razão: ", reason);
         bool closed = trade.PositionClose(ticket);
         if (closed)
            Print("✅ Posição #", ticket, " fechada pelo monitor IA (", action, ")");
         else
            Print("❌ Falha ao fechar #", ticket, ": ", GetLastError());
      }
      else
      {
         string narrative = ExtractJsonString(resp, "narrative");
         if (narrative != "")
            Print("📐 Monitor #", ticket, " [HOLD]: ", StringSubstr(narrative, 0, 150));
      }
   }
}

//+------------------------------------------------------------------+
//| Busca e processa sinal — com indicadores reais e perfil do ativo  |
//| v6.0: envia 200 candles, support_resistance_levels do Girassol,  |
//|        usa SL/TP refinado pelo servidor (calcIndicatorDrivenSLTP) |
//+------------------------------------------------------------------+
void FetchAndProcessSignal()
{
   string structuredSignals = ReadStructuredIndicatorSignals();
   string allBuffers        = ReadAllIndicatorBuffers();

   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M1, 0, CandleCount, rates);
   string candlesJson = BuildCandlesJson(rates, copied);

   double ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);

   string url     = g_serverUrl + "/api/metatrader/signal-with-indicators";
   string headers = "Content-Type: application/json\r\n";

   string body = "{";
   body += "\"symbol\":\""          + g_symbol                       + "\",";
   body += "\"ask\":"               + DoubleToString(ask, _Digits)   + ",";
   body += "\"bid\":"               + DoubleToString(bid, _Digits)   + ",";
   body += "\"candles\":"           + candlesJson                     + ",";
   body += "\"indicatorSignals\":"  + structuredSignals               + ",";
   body += "\"indicatorBuffers\":"  + allBuffers                      + ",";
   body += "\"indicatorCount\":"    + IntegerToString(g_indicatorCount);
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 10000, postData, result, responseHeaders);

   // Fallback para endpoint legado
   if (res == 404 || res == -1)
   {
      url = g_serverUrl + "/api/metatrader/signal?symbol=" + g_symbol;
      if (g_apiToken != "") url += "&token=" + g_apiToken;
      char emptyData[];
      res = WebRequest("GET", url, headers, 5000, emptyData, result, responseHeaders);
   }

   if (res == -1)
   {
      Print("⚠️ Falha ao buscar sinal: HTTP ", res);
      if (AutoReconnect && !g_isDiscovering) TryReconnect();
      return;
   }
   if (res != 200) return;

   string resp   = CharArrayToString(result);
   string action = ExtractJsonString(resp, "action");
   if (action == "" || action == "HOLD") return;

   string signalId   = ExtractJsonString(resp, "id");
   if (signalId == g_pendingSignalId) return;

   double lotSize    = ExtractJsonDouble(resp, "lotSize");
   double stopLoss   = ExtractJsonDouble(resp, "stopLoss");
   double takeProfit = ExtractJsonDouble(resp, "takeProfit");
   double confidence = ExtractJsonDouble(resp, "confidence");

   // Metadados da resposta v6.0
   string slTpSource   = ExtractJsonString(resp, "slTpSource");
   string assetFamily  = ExtractJsonString(resp, "assetFamily");
   string assetTrend   = ExtractJsonString(resp, "assetTrend");
   string assetVolClass= ExtractJsonString(resp, "assetVolClass");
   string reason       = ExtractJsonString(resp, "reason");
   string girassolBias = ExtractJsonString(resp, "girassolBias");

   if (lotSize <= 0) lotSize = LotSize;

   string symUpper = g_symbol;
   StringToUpper(symUpper);
   bool isSpikeIndex = (StringFind(symUpper, "CRASH") >= 0 || StringFind(symUpper, "BOOM") >= 0);

   if (isSpikeIndex)
   {
      stopLoss   = 0;
      takeProfit = 0;
      Print("ℹ️ Crash/Boom — sem SL/TP fixo (spike index)");
   }
   else if (stopLoss > 0 || takeProfit > 0)
   {
      // Valida distância mínima de SL/TP
      double point      = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      long   stopsLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
      double minDist    = MathMax((double)stopsLevel * point, (ask - bid) * 3.0);
      if (minDist <= 0) minDist = ask * 0.002;

      if (action == "BUY")
      {
         double entry = ask;
         if (stopLoss   > 0 && (entry - stopLoss)   < minDist) stopLoss   = NormalizeDouble(entry - minDist, _Digits);
         if (takeProfit > 0 && (takeProfit - entry)  < minDist) takeProfit = NormalizeDouble(entry + minDist, _Digits);
      }
      else if (action == "SELL")
      {
         double entry = bid;
         if (stopLoss   > 0 && (stopLoss - entry)   < minDist) stopLoss   = NormalizeDouble(entry + minDist, _Digits);
         if (takeProfit > 0 && (entry - takeProfit)  < minDist) takeProfit = NormalizeDouble(entry - minDist, _Digits);
      }
   }

   // Log completo do sinal v6.0
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
   Print("📡 SINAL: ", action, " | ", g_symbol, " | Confiança: ", confidence, "%");
   if (assetFamily  != "") Print("   Ativo:    ", assetFamily, " | ", assetTrend, " | Vol: ", assetVolClass);
   if (girassolBias != "") Print("   Girassol: ", girassolBias);
   if (slTpSource   != "") Print("   SL/TP via: ", slTpSource);
   Print("   SL: ", NormalizeDouble(stopLoss, _Digits), " | TP: ", NormalizeDouble(takeProfit, _Digits));
   Print("   Indicadores no gráfico: ", g_indicatorCount);
   if (reason != "")       Print("   Razão: ", StringSubstr(reason, 0, 150));
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

   g_pendingSignalId = signalId;
   bool success = false;

   if (action == "BUY")
      success = trade.Buy(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);
   else if (action == "SELL")
      success = trade.Sell(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);

   if (success)
   {
      Print("✅ Ordem executada: ", action, " | Ticket: ", trade.ResultOrder(),
            " | SL/TP source: ", slTpSource != "" ? slTpSource : "server_default");
      ConfirmTradeOpen(signalId, (int)trade.ResultOrder(), action, lotSize, stopLoss, takeProfit);
   }
   else
      Print("❌ Falha ao executar ordem: ", GetLastError());
}

//+------------------------------------------------------------------+
//| Constrói JSON de candles a partir de MqlRates[]                  |
//+------------------------------------------------------------------+
string BuildCandlesJson(MqlRates &rates[], int count)
{
   string json = "[";
   for (int i = 0; i < count; i++)
   {
      if (i > 0) json += ",";
      json += "{";
      json += "\"time\":"   + IntegerToString(rates[i].time)                 + ",";
      json += "\"open\":"   + DoubleToString(rates[i].open,  _Digits)        + ",";
      json += "\"high\":"   + DoubleToString(rates[i].high,  _Digits)        + ",";
      json += "\"low\":"    + DoubleToString(rates[i].low,   _Digits)        + ",";
      json += "\"close\":"  + DoubleToString(rates[i].close, _Digits)        + ",";
      json += "\"volume\":" + IntegerToString(rates[i].tick_volume);
      json += "}";
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Evento: mudança no gráfico (add/remove de indicadores)           |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if (id == CHARTEVENT_CHART_CHANGE)
   {
      Print("🔄 Mudança no gráfico — re-escaneando indicadores e perfil do ativo...");
      ScanChartIndicators();
      FetchAssetProfile();
   }
}

//+------------------------------------------------------------------+
//| Busca URL de descoberta no servidor                               |
//+------------------------------------------------------------------+
void FetchDiscoveryUrl()
{
   string url     = g_serverUrl + "/api/url";
   string headers = "Content-Type: application/json\r\n";
   char   result[];
   string responseHeaders;

   int res = WebRequest("GET", url, headers, 5000, NULL, result, responseHeaders);
   if (res == 200 && ArraySize(result) > 0)
   {
      string body    = CharArrayToString(result);
      string blobUrl = ExtractJsonString(body, "discoveryUrl");
      if (blobUrl != "")
      {
         g_discoverUrl = blobUrl;
         Print("✅ URL de descoberta obtida: ", g_discoverUrl);
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
//| Reconexão automática via serviço de descoberta                    |
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

   string headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
   char   result[];
   string responseHeaders;

   int res = WebRequest("GET", g_discoverUrl, headers, 10000, NULL, result, responseHeaders);

   if (res == 200 && ArraySize(result) > 0)
   {
      string body   = CharArrayToString(result);
      string newUrl = ExtractJsonString(body, "serverUrl");

      if (newUrl != "" && newUrl != g_serverUrl)
      {
         Print("✅ Nova URL: ", newUrl);
         g_serverUrl     = newUrl;
         g_failCount     = 0;
         g_isDiscovering = false;

         if (SendHeartbeat())
         {
            Print("🎉 Reconexão bem-sucedida!");
            FetchDiscoveryUrl();
            FetchAssetProfile();
            return true;
         }
      }
      else if (newUrl != "")
      {
         Print("ℹ️ Mesma URL — servidor pode estar temporariamente fora");
         g_failCount = 0;
      }
   }

   g_isDiscovering = false;
   return false;
}

//+------------------------------------------------------------------+
//| Heartbeat                                                         |
//+------------------------------------------------------------------+
bool SendHeartbeat()
{
   string url  = g_serverUrl + "/api/metatrader/heartbeat";
   string body = "{";
   body += "\"accountId\":\""  + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))        + "\",";
   body += "\"broker\":\""     + AccountInfoString(ACCOUNT_COMPANY)                         + "\",";
   body += "\"balance\":"      + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),  2)     + ",";
   body += "\"equity\":"       + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),   2)     + ",";
   body += "\"freeMargin\":"   + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2)  + ",";
   body += "\"platform\":\"MT5\",";
   body += "\"eaVersion\":\"6.0\",";
   body += "\"indicatorCount\":" + IntegerToString(g_indicatorCount)                        + ",";
   body += "\"assetProfile\":{";
   body += "\"loaded\":" + (g_assetProfileLoaded ? "true" : "false") + ",";
   body += "\"family\":\"" + g_assetFamily + "\",";
   body += "\"trend\":\"" + g_assetTrend + "\",";
   body += "\"volClass\":\"" + g_assetVolClass + "\"";
   body += "}";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
   if (res == 200) { g_failCount = 0; return true; }
   Print("⚠️ Heartbeat falhou: ", res);
   return false;
}

//+------------------------------------------------------------------+
//| Confirma abertura de trade                                        |
//+------------------------------------------------------------------+
void ConfirmTradeOpen(string signalId, int ticket, string type, double lots, double sl, double tp)
{
   string url  = g_serverUrl + "/api/metatrader/trade/open";
   string body = "{";
   body += "\"ticket\":"     + IntegerToString(ticket)                                                   + ",";
   body += "\"symbol\":\""   + g_symbol                                                                  + "\",";
   body += "\"type\":\""     + type                                                                      + "\",";
   body += "\"lots\":"       + DoubleToString(lots, 2)                                                   + ",";
   body += "\"openPrice\":"  + DoubleToString(SymbolInfoDouble(g_symbol, SYMBOL_BID), _Digits)           + ",";
   body += "\"stopLoss\":"   + DoubleToString(sl, _Digits)                                               + ",";
   body += "\"takeProfit\":" + DoubleToString(tp, _Digits)                                               + ",";
   body += "\"openTime\":"   + IntegerToString(TimeCurrent())                                            + ",";
   body += "\"signalId\":\"" + signalId                                                                  + "\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;
   WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
}

//+------------------------------------------------------------------+
//| Salva URL de descoberta localmente                                |
//+------------------------------------------------------------------+
void SaveDiscoveryUrl(string url)
{
   int handle = FileOpen("InvistaPRO_DiscoveryURL.txt", FILE_WRITE | FILE_TXT | FILE_COMMON);
   if (handle != INVALID_HANDLE) { FileWriteString(handle, url); FileClose(handle); }
}

//+------------------------------------------------------------------+
//| Carrega URL de descoberta salva                                   |
//+------------------------------------------------------------------+
string LoadDiscoveryUrl()
{
   string url    = "";
   int    handle = FileOpen("InvistaPRO_DiscoveryURL.txt", FILE_READ | FILE_TXT | FILE_COMMON);
   if (handle != INVALID_HANDLE)
   {
      url = FileReadString(handle);
      FileClose(handle);
      if (url != "") Print("📂 URL carregada: ", url);
   }
   return url;
}

//+------------------------------------------------------------------+
//| Extrai string de JSON simples                                     |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int    start  = StringFind(json, search);
   if (start < 0) return "";
   start += StringLen(search);
   int end = StringFind(json, "\"", start);
   if (end < 0) return "";
   return StringSubstr(json, start, end - start);
}

//+------------------------------------------------------------------+
//| Extrai double de JSON simples                                     |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key)
{
   string search = "\"" + key + "\":";
   int    start  = StringFind(json, search);
   if (start < 0) return 0;
   start += StringLen(search);
   int end = start;
   while (end < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, end);
      if (ch == ',' || ch == '}') break;
      end++;
   }
   return StringToDouble(StringSubstr(json, start, end - start));
}

//+------------------------------------------------------------------+
//| Extrai double de um objeto aninhado no JSON                       |
//| Procura: "parentKey":{..."key":value...}                         |
//+------------------------------------------------------------------+
double ExtractJsonDoubleInObject(string json, string parentKey, string key)
{
   // Encontra o objeto pai
   string parentSearch = "\"" + parentKey + "\":{";
   int    parentStart  = StringFind(json, parentSearch);
   if (parentStart < 0) return 0;

   // Encontra o fim do objeto pai (próximo '}')
   int objStart = parentStart + StringLen(parentSearch);
   int depth    = 1;
   int objEnd   = objStart;
   while (objEnd < StringLen(json) && depth > 0)
   {
      ushort ch = StringGetCharacter(json, objEnd);
      if (ch == '{') depth++;
      else if (ch == '}') depth--;
      objEnd++;
   }

   // Extrai o sub-JSON e procura a chave
   string subJson = StringSubstr(json, objStart, objEnd - objStart);
   return ExtractJsonDouble(subJson, key);
}

//+------------------------------------------------------------------+
//| Desinicialização                                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   for (int i = 0; i < g_indicatorCount; i++)
   {
      if (g_indicators[i].handle != INVALID_HANDLE)
         IndicatorRelease(g_indicators[i].handle);
   }
   Print("🛑 InvistaPRO EA v6.0 encerrado. Razão: ", reason);
}
//+------------------------------------------------------------------+
