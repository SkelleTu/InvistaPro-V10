//+------------------------------------------------------------------+
//|                                              InvistaPRO_EA.mq5    |
//|                                 InvistaPRO - Auto-Discovery URL   |
//|   Versão 8.0 — Girassol 3 Níveis + AutoFibonacci + Diagnóstico   |
//|   CORREÇÕES v8.0:                                                 |
//|   • Detecção ampliada de nomes do Girassol/Fibonacci              |
//|   • Endpoint /signal-with-indicators com fallback robusto         |
//|   • Envio paralelo de candles (market-data) para Girassol Sinté.  |
//|   • Diagnóstico detalhado de indicadores no log do MT5            |
//|   • URL de descoberta automática atualizada                       |
//|   Nível 1: Girassol extremo (buf 0=compra, 1=venda)              |
//|   Nível 2: Bolinha média pivot (buf 2=compra, 3=venda)           |
//|   Nível 3: Bolinha pequena micro (buf 4=compra, 5=venda)         |
//+------------------------------------------------------------------+
#property copyright "InvistaPRO"
#property version   "8.0"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\DealInfo.mqh>

//--- Modo de Controle da IA
enum ENUM_AI_CONTROL_MODE
{
   AI_MANUAL  = 0,  // Manual — Defino tudo, IA não decide nada
   AI_PARTIAL = 1,  // Parcial — Escolho exatamente o que a IA controla
   AI_FULL    = 2   // Total — IA controla 100% de forma autônoma
};

//--- Parâmetros de entrada
input string   ServerURL        = "https://invista-pro-v10-kzlv.onrender.com"; // URL do servidor InvistaPRO
input string   DiscoveryBlobURL = "https://invista-pro-v10-kzlv.onrender.com/api/url"; // URL de descoberta automática
input string   ApiToken         = "";          // Token de autenticação (opcional)
input string   Symbol_Override  = "";          // Símbolo (vazio = gráfico atual)
input int      HeartbeatSeconds = 30;          // Intervalo do heartbeat (segundos)
input int      SignalSeconds    = 5;           // Intervalo de busca de sinal (segundos)
input int      MagicNumber      = 20250315;    // Número mágico
input bool     AutoReconnect    = true;        // Reconexão automática de URL
input int      MaxReconnectTries= 5;           // Tentativas máximas de reconexão
input int      IndicatorBars    = 5;           // Quantas barras recentes dos indicadores ler
input int      CandleCount      = 200;         // Candles para enviar à IA (histórico)
input double   PriceActionRiskPercent = 1.0; // Risco por trade para Price Action (padrão 1%, máximo 2%)
input double   PriceActionExtraRoundTripCostPerLot = 0.0; // Comissão + slippage estimados por lote em moeda da conta; 0 bloqueia Price Action
input bool     PriceActionUseAIReview = true; // true = revisão IA diagnóstica; REAL continua bloqueado sem serviço essencial

//--- Controle de Autonomia da IA
input ENUM_AI_CONTROL_MODE AIControlMode = AI_FULL; // Modo de Controle da IA

//--- Parâmetros Manuais
input double   ManualLotSize    = 0.01;  // Lote (manual)
input int      ManualStopLoss   = 0;     // Stop Loss em pontos — 0 = desativado (manual)
input int      ManualTakeProfit = 0;     // Take Profit em pontos — 0 = desativado (manual)
input int      MaxPositions     = 1;     // Máximo de posições abertas simultâneas
input int      WarmupSeconds   = 120;   // Período de aquecimento (segundos)

//--- Controle Parcial
input bool     AI_Lote          = true;  // IA define o tamanho do lote
input bool     AI_StopLoss      = true;  // IA define o Stop Loss
input bool     AI_TakeProfit    = true;  // IA define o Take Profit
input bool     AI_Entrada       = true;  // IA decide quando e se entrar
input bool     AI_Saida         = true;  // IA decide quando sair

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
datetime g_lastMonitor    = 0;
int      g_monitorSeconds = 2;
datetime g_warmupUntil    = 0;
datetime g_lastWarmupPrint= 0;
datetime g_lastMarketData = 0;  // controle do envio de candles para Girassol Sintético
int      g_marketDataSeconds = 10; // envia candles a cada 10s para o Girassol Sintético

// Perfil do ativo
string   g_assetFamily    = "";
string   g_assetTrend     = "";
string   g_assetVolClass  = "";
double   g_assetRsiOversold  = 30.0;
double   g_assetRsiOverbought= 70.0;
bool     g_assetProfileLoaded = false;

CTrade         trade;
CPositionInfo  posInfo;

//--- Estrutura para indicadores detectados
struct IndicatorInfo
{
   string name;
   string nameLower;
   int    handle;
   int    subwindow;
   int    totalBuffers;
   bool   isGirassol;
   bool   isFibonacci;
};

IndicatorInfo g_indicators[];
int           g_indicatorCount = 0;

//+------------------------------------------------------------------+
//| Inicialização                                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   g_serverUrl   = ServerURL;
   g_discoverUrl = DiscoveryBlobURL;
   g_symbol      = (Symbol_Override != "") ? Symbol_Override : _Symbol;
   g_apiToken    = ApiToken;
   g_failCount   = 0;

   trade.SetExpertMagicNumber(MagicNumber);
   // Timer keeps connectivity checks alive even when the chart receives no ticks.
   EventSetTimer(1);

   datetime now = TimeCurrent();
   g_lastSignal      = now;
   g_lastHeartbeat   = now;
   g_lastMonitor     = now;
   g_lastWarmupPrint = now;
   g_lastMarketData  = now;

   if (WarmupSeconds > 0)
      g_warmupUntil = now + WarmupSeconds;
   else
      g_warmupUntil = now;

   Print("🚀 InvistaPRO EA v8.0 iniciado | Símbolo: ", g_symbol);
   Print("   → URL: ", g_serverUrl);
   Print("   → CandleCount: ", CandleCount, " | IndicatorBars: ", IndicatorBars);
   if (WarmupSeconds > 0)
      Print("   ⏳ AQUECIMENTO ATIVO: operações bloqueadas por ", WarmupSeconds, "s");

   string modeLabel = "";
   if (AIControlMode == AI_MANUAL)
      modeLabel = "MANUAL";
   else if (AIControlMode == AI_PARTIAL)
      modeLabel = "PARCIAL";
   else
      modeLabel = "TOTAL (IA controla 100%)";
   Print("🤖 Modo de Controle da IA: ", modeLabel);

   ScanChartIndicators();

   if (g_discoverUrl == "") FetchDiscoveryUrl();

   FetchAssetProfile();
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
   datetime localNow = TimeLocal();
   if (HeartbeatSeconds > 0 && (g_lastTimerHeartbeat == 0 || localNow - g_lastTimerHeartbeat >= HeartbeatSeconds))
   {
      g_lastTimerHeartbeat = localNow;
      g_lastHeartbeat = TimeCurrent();
      bool ok = SendHeartbeat();
      if (!ok && AutoReconnect && !g_isDiscovering)
         TryReconnect();
   }
}

//+------------------------------------------------------------------+
//| Busca perfil do ativo Deriv                                       |
//+------------------------------------------------------------------+
void FetchAssetProfile()
{
   string url     = g_serverUrl + "/api/metatrader/asset-profile/" + g_symbol;
   string headers = "Accept: application/json\r\n";
   uchar  data[];
   uchar  result[];
   string responseHeaders;

   int res = WebRequest("GET", url, headers, 5000, data, result, responseHeaders);
   if (res != 200) return;

   string resp  = CharArrayToString(result);
   string found = ExtractJsonString(resp, "found");
   if (found != "true") return;

   g_assetFamily    = ExtractJsonString(resp, "family");
   g_assetTrend     = ExtractJsonString(resp, "trendType");
   g_assetVolClass  = ExtractJsonString(resp, "volClass");
   g_assetProfileLoaded = true;

   double ov  = ExtractJsonDoubleInObject(resp, "indicatorGuidance", "rsiOversold");
   double ovb = ExtractJsonDoubleInObject(resp, "indicatorGuidance", "rsiOverbought");
   if (ov  > 0) g_assetRsiOversold  = ov;
   if (ovb > 0) g_assetRsiOverbought= ovb;

   Print("📊 Perfil carregado: ", g_symbol, " | ", g_assetFamily, " | ", g_assetVolClass, " | ", g_assetTrend);
}

//+------------------------------------------------------------------+
//| Escaneia TODOS os indicadores no gráfico com diagnóstico amplo   |
//+------------------------------------------------------------------+
void ScanChartIndicators()
{
   ArrayResize(g_indicators, 0);
   g_indicatorCount = 0;

   long chartId     = ChartID();
   int  totalWindows= (int)ChartGetInteger(chartId, CHART_WINDOWS_TOTAL);

   Print("🔍 v8.0 — Escaneando ", totalWindows, " janela(s) do gráfico...");

   for (int win = 0; win < totalWindows; win++)
   {
      int indicatorsInWindow = ChartIndicatorsTotal(chartId, win);
      Print("   Janela ", win, ": ", indicatorsInWindow, " indicador(es)");

      for (int idx = 0; idx < indicatorsInWindow; idx++)
      {
         string shortName = ChartIndicatorName(chartId, win, idx);
         if (shortName == "") continue;

         int handle = ChartIndicatorGet(chartId, win, shortName);
         if (handle == INVALID_HANDLE)
         {
            Print("   ⚠️ Handle inválido para: [", shortName, "]");
            continue;
         }

         int numBuffers = 0;
         double testBuf[];
         for (int b = 0; b < 64; b++)
         {
            if (CopyBuffer(handle, b, 0, 1, testBuf) < 0) break;
            numBuffers = b + 1;
         }

         string nameLower = shortName;
         StringToLower(nameLower);

         // ── DETECÇÃO AMPLIADA DO GIRASSOL v8.0 ──────────────────────────────
         // Cobre todos os nomes conhecidos do Girassol Sunflower em BR/EN
         bool isGirassol = (
            StringFind(nameLower, "girassol")    >= 0 ||
            StringFind(nameLower, "sunflower")   >= 0 ||
            StringFind(nameLower, "gira")        >= 0 ||
            StringFind(nameLower, "girasol")     >= 0 ||  // grafia alternativa
            StringFind(nameLower, "zigzag")      >= 0 ||  // base do Girassol
            StringFind(nameLower, "zig zag")     >= 0 ||
            StringFind(nameLower, "zz_")         >= 0 ||
            StringFind(nameLower, "semaforo")    >= 0 ||  // nomes alternativos
            StringFind(nameLower, "semáforo")    >= 0 ||
            StringFind(nameLower, "bolinha")     >= 0 ||
            StringFind(nameLower, "pivot_zz")   >= 0 ||
            StringFind(nameLower, "pivots")      >= 0 ||
            StringFind(nameLower, "fractal")     >= 0 ||  // fractais = base do pivot
            StringFind(nameLower, "swing")       >= 0 ||
            StringFind(nameLower, "flor")        >= 0
         );

         // ── DETECÇÃO AMPLIADA DO AUTOFIBONACCI v8.0 ─────────────────────────
         bool isFibonacci = (
            StringFind(nameLower, "fib")         >= 0 ||
            StringFind(nameLower, "fibonacci")   >= 0 ||
            StringFind(nameLower, "retr")        >= 0 ||
            StringFind(nameLower, "retracement") >= 0 ||
            StringFind(nameLower, "extension")   >= 0 ||
            StringFind(nameLower, "auto_fib")    >= 0 ||
            StringFind(nameLower, "autofib")     >= 0 ||
            StringFind(nameLower, "auto fib")    >= 0 ||
            StringFind(nameLower, "fibo")        >= 0 ||
            StringFind(nameLower, "level")       >= 0 ||
            StringFind(nameLower, "golden")      >= 0 ||  // golden ratio
            StringFind(nameLower, "161")         >= 0 ||  // 161.8%
            StringFind(nameLower, "618")         >= 0     // 61.8%
         );

         int i = g_indicatorCount;
         ArrayResize(g_indicators, i + 1);
         g_indicators[i].name        = shortName;
         g_indicators[i].nameLower   = nameLower;
         g_indicators[i].handle      = handle;
         g_indicators[i].subwindow   = win;
         g_indicators[i].totalBuffers= numBuffers;
         g_indicators[i].isGirassol  = isGirassol;
         g_indicators[i].isFibonacci = isFibonacci;
         g_indicatorCount++;

         string typeTag = isGirassol ? " 🌻GIRASSOL" : isFibonacci ? " 📐FIBONACCI" : "";
         Print("   ✅ [", shortName, "] Janela=", win, " Buffers=", numBuffers, typeTag);
      }
   }

   int girassolCount  = 0;
   int fibonacciCount = 0;
   for (int i = 0; i < g_indicatorCount; i++)
   {
      if (g_indicators[i].isGirassol)  girassolCount++;
      if (g_indicators[i].isFibonacci) fibonacciCount++;
   }

   Print("📊 Total: ", g_indicatorCount, " indicador(es) | Girassol=", girassolCount, " | Fibonacci=", fibonacciCount);

   if (girassolCount == 0)
      Print("⚠️ ATENÇÃO: Girassol/Sunflower NÃO detectado. Instale o indicador no gráfico do ativo '", g_symbol, "' para ativar o filtro primário.");
   if (fibonacciCount == 0)
      Print("ℹ️ AutoFibonacci não detectado — análise de Fibonacci será feita pelo servidor.");
}

//+------------------------------------------------------------------+
//| Lê buffers brutos de todos os indicadores                         |
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
      json += "\"isGirassol\":" + (g_indicators[i].isGirassol ? "true" : "false") + ",";
      json += "\"isFibonacci\":" + (g_indicators[i].isFibonacci ? "true" : "false") + ",";
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
//| Lê sinais estruturados do Girassol (3 níveis) e AutoFibonacci    |
//+------------------------------------------------------------------+
string ReadStructuredIndicatorSignals()
{
   string json = "{";

   bool girassolFound  = false;
   bool fibFound       = false;

   for (int i = 0; i < g_indicatorCount; i++)
   {
      // ================================================================
      // === GIRASSOL — 3 NÍVEIS ===
      // ================================================================
      if (g_indicators[i].isGirassol && !girassolFound)
      {
         girassolFound = true;
         int    totalBufs = g_indicators[i].totalBuffers;
         int    lookback  = IndicatorBars;
         double ask       = SymbolInfoDouble(g_symbol, SYMBOL_ASK);

         json += "\"girassol\":{";
         json += "\"detected\":true,";
         json += "\"name\":\"" + g_indicators[i].name + "\",";
         json += "\"total_buffers\":" + IntegerToString(totalBufs) + ",";

         string levelNames[];
         ArrayResize(levelNames, 3);
         levelNames[0] = "girassol_extremo";
         levelNames[1] = "bolinha_media_pivot";
         levelNames[2] = "bolinha_pequena_micro";

         string levelsJson = "\"levels\":[";
         bool   firstLevel = true;
         string srLevels   = "\"support_resistance_levels\":[";
         bool   firstSR    = true;
         string allBuyJson  = "\"all_buy_signals\":[";
         string allSellJson = "\"all_sell_signals\":[";
         bool   firstBuy   = true;
         bool   firstSell  = true;

         for (int lvl = 0; lvl < 3; lvl++)
         {
            int bufBuy  = lvl * 2;
            int bufSell = lvl * 2 + 1;

            if (bufBuy >= totalBufs && bufSell >= totalBufs) continue;

            if (!firstLevel) levelsJson += ",";
            firstLevel = false;

            levelsJson += "{";
            levelsJson += "\"level_id\":" + IntegerToString(lvl) + ",";
            levelsJson += "\"level_name\":\"" + levelNames[lvl] + "\",";
            levelsJson += "\"buy_symbol\":\"LowSymbol\",";
            levelsJson += "\"buy_color\":\"blue\",";
            levelsJson += "\"buy_buffer\":" + IntegerToString(bufBuy) + ",";
            levelsJson += "\"buy_signals\":[";
            bool firstEntry = true;

            if (bufBuy < totalBufs)
            {
               double bufB[];
               if (CopyBuffer(g_indicators[i].handle, bufBuy, 0, lookback, bufB) >= 1)
               {
                  for (int v = 0; v < lookback; v++)
                  {
                     if (bufB[v] >= 1e20 || bufB[v] <= -1e20) continue;
                     if (bufB[v] == 0.0) continue;
                     if (!firstEntry) levelsJson += ",";
                     firstEntry = false;
                     levelsJson += "{\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufB[v], _Digits) + ",\"direction\":\"buy\",\"color\":\"blue\"}";
                     if (!firstBuy) allBuyJson += ",";
                     firstBuy = false;
                     allBuyJson += "{\"level\":\"" + levelNames[lvl] + "\",\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufB[v], _Digits) + "}";
                     if (v == 0 && ask > 0)
                     {
                        string srType = (bufB[v] < ask) ? "support" : "resistance";
                        if (!firstSR) srLevels += ",";
                        firstSR = false;
                        srLevels += "{\"type\":\"" + srType + "\",\"price\":" + DoubleToString(bufB[v], _Digits) + ",\"level\":\"" + levelNames[lvl] + "\",\"direction\":\"buy\",\"buffer\":" + IntegerToString(bufBuy) + "}";
                     }
                  }
               }
            }
            levelsJson += "],";
            levelsJson += "\"sell_symbol\":\"HighSymbol\",";
            levelsJson += "\"sell_color\":\"red\",";
            levelsJson += "\"sell_buffer\":" + IntegerToString(bufSell) + ",";
            levelsJson += "\"sell_signals\":[";
            firstEntry = true;

            if (bufSell < totalBufs)
            {
               double bufS[];
               if (CopyBuffer(g_indicators[i].handle, bufSell, 0, lookback, bufS) >= 1)
               {
                  for (int v = 0; v < lookback; v++)
                  {
                     if (bufS[v] >= 1e20 || bufS[v] <= -1e20) continue;
                     if (bufS[v] == 0.0) continue;
                     if (!firstEntry) levelsJson += ",";
                     firstEntry = false;
                     levelsJson += "{\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufS[v], _Digits) + ",\"direction\":\"sell\",\"color\":\"red\"}";
                     if (!firstSell) allSellJson += ",";
                     firstSell = false;
                     allSellJson += "{\"level\":\"" + levelNames[lvl] + "\",\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufS[v], _Digits) + "}";
                     if (v == 0 && ask > 0)
                     {
                        string srType = (bufS[v] < ask) ? "support" : "resistance";
                        if (!firstSR) srLevels += ",";
                        firstSR = false;
                        srLevels += "{\"type\":\"" + srType + "\",\"price\":" + DoubleToString(bufS[v], _Digits) + ",\"level\":\"" + levelNames[lvl] + "\",\"direction\":\"sell\",\"buffer\":" + IntegerToString(bufSell) + "}";
                     }
                  }
               }
            }
            levelsJson += "]";
            levelsJson += "}";
         }
         levelsJson   += "]";
         allBuyJson   += "]";
         allSellJson  += "]";
         srLevels     += "]";

         json += levelsJson  + ",";
         json += allBuyJson  + ",";
         json += allSellJson + ",";
         json += srLevels    + ",";
         json += "\"raw_buffers\":" + BuildRawBuffersJson(i, lookback);
         json += "},";
      }

      // ================================================================
      // === AUTOFIBONACCI ===
      // ================================================================
      if (g_indicators[i].isFibonacci && !fibFound)
      {
         fibFound = true;
         int totalBufs = g_indicators[i].totalBuffers;

         json += "\"fibonacci\":{";
         json += "\"detected\":true,";
         json += "\"name\":\"" + g_indicators[i].name + "\",";
         json += "\"total_buffers\":" + IntegerToString(totalBufs) + ",";
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
         json += "]},";
      }
   }

   if (!girassolFound)  json += "\"girassol\":{\"detected\":false},";
   if (!fibFound)       json += "\"fibonacci\":{\"detected\":false},";

   if (StringGetCharacter(json, StringLen(json)-1) == ',')
      json = StringSubstr(json, 0, StringLen(json)-1);

   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Constrói JSON de buffers brutos de um indicador                   |
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
//| Constrói JSON de candles                                          |
//+------------------------------------------------------------------+
string BuildCandlesJson(MqlRates &rates[], int count)
{
   string json = "[";
   for (int i = 0; i < count; i++)
   {
      if (i > 0) json += ",";
      json += "{";
      json += "\"time\":"   + IntegerToString(rates[i].time)          + ",";
      json += "\"open\":"   + DoubleToString(rates[i].open,  _Digits) + ",";
      json += "\"high\":"   + DoubleToString(rates[i].high,  _Digits) + ",";
      json += "\"low\":"    + DoubleToString(rates[i].low,   _Digits) + ",";
      json += "\"close\":"  + DoubleToString(rates[i].close, _Digits) + ",";
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
   // Only closed candles may participate in the deterministic setup or AI review.
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

   // ── Envio de candles para Girassol Sintético (a cada 10s) ────────────
   // Mesmo sem Girassol instalado no gráfico, o servidor calcula um
   // equivalente usando os candles OHLC. Isso mantém o consenso da IA ativo.
   if (now - g_lastMarketData >= g_marketDataSeconds)
   {
      g_lastMarketData = now;
      SendMarketDataForSyntheticGirassol();
   }

   // ── Monitor de posições abertas ────────────────────────────────────────
   if (PositionsTotal() > 0 && (now - g_lastMonitor >= g_monitorSeconds))
   {
      g_lastMonitor = now;
      MonitorOpenPositions();
   }

   // ── Busca de sinal ────────────────────────────────────────────────────
   if (PositionsTotal() < MaxPositions && (now - g_lastSignal >= SignalSeconds))
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
//| Envia candles para o servidor calcular Girassol Sintético         |
//+------------------------------------------------------------------+
void SendMarketDataForSyntheticGirassol()
{
   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M1, 0, CandleCount, rates);
   if (copied < 20) return;

   string candlesJson = BuildCandlesJson(rates, copied);

   string url     = g_serverUrl + "/api/metatrader/market-data";
   string headers = "Content-Type: application/json\r\n";
   string body    = "{\"symbol\":\"" + g_symbol + "\",\"candles\":" + candlesJson;
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
}

//+------------------------------------------------------------------+
//| Busca e processa sinal com indicadores reais                      |
//+------------------------------------------------------------------+
bool IsPriceActionCryptoSymbol()
{
   string normalized = g_symbol;
   StringToUpper(normalized);
   StringReplace(normalized, "/", "");
   StringReplace(normalized, ".", "");
   StringReplace(normalized, "_", "");
   StringReplace(normalized, "-", "");
   return (StringFind(normalized, "BTCUSD") == 0 ||
           StringFind(normalized, "ETHUSD") == 0 ||
           StringFind(normalized, "SOLUSD") == 0);
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
   if (entryPrice <= 0 || stopLoss <= 0 ||
       PriceActionRiskPercent < 1.0 || PriceActionRiskPercent > 2.0 ||
       !MathIsValidNumber(PriceActionExtraRoundTripCostPerLot) || PriceActionExtraRoundTripCostPerLot <= 0.0)
      return 0.0;
   double tickSize = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if (tickValue <= 0) tickValue = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_VALUE);
   double volumeStep = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
   double minVolume = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
   double maxVolume = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MAX);
   double distance = MathAbs(entryPrice - stopLoss);
   if (tickSize <= 0 || tickValue <= 0 || volumeStep <= 0 || minVolume <= 0 || maxVolume <= 0 || distance <= 0)
      return 0.0;
   // Size against stop loss plus configured round-trip commission/slippage estimate.
   double lossPerLot = (distance / tickSize) * tickValue + PriceActionExtraRoundTripCostPerLot;
   double riskCash = AccountInfoDouble(ACCOUNT_EQUITY) * PriceActionRiskPercent / 100.0;
   if (lossPerLot <= 0 || riskCash <= 0) return 0.0;
   double rawVolume = riskCash / lossPerLot;
   double volume = MathFloor(rawVolume / volumeStep) * volumeStep;
   if (volume < minVolume) return 0.0;
   if (volume > maxVolume) volume = maxVolume;
   int volumeDigits = VolumeDigitsFromStep();
   return NormalizeDouble(volume, volumeDigits);
}

bool ClosePriceActionPartial(ulong ticket, double volume, string positionType)
{
   long marginMode = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   if (marginMode == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      return trade.PositionClosePartial(ticket, volume);

   // Netting accounts reduce the existing position with an opposite deal.
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   request.action = TRADE_ACTION_DEAL;
   request.position = ticket;
   request.symbol = g_symbol;
   request.volume = volume;
   request.magic = MagicNumber;
   request.deviation = 20;
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
   return result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_DONE_PARTIAL;
}

void FetchAndProcessSignal()
{
   string structuredSignals = ReadStructuredIndicatorSignals();
   string allBuffers        = ReadAllIndicatorBuffers();

   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M1, 0, CandleCount, rates);
   string candlesJson = BuildCandlesJson(rates, copied);

   double ask = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);

   // ── Endpoint principal: signal-with-indicators (v8.0) ────────────────
   string url     = g_serverUrl + "/api/metatrader/signal-with-indicators";
   string headers = "Content-Type: application/json\r\n";

   long requestTradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string requestAccountType = (requestTradeMode == ACCOUNT_TRADE_MODE_REAL) ? "real" :
                               (requestTradeMode == ACCOUNT_TRADE_MODE_DEMO) ? "demo" : "contest";
   string body = "{";
   body += "\"accountType\":\"" + requestAccountType + "\",";
   body += "\"symbol\":\""          + g_symbol                     + "\",";
   body += "\"ask\":"               + DoubleToString(ask, _Digits)  + ",";
   body += "\"bid\":"               + DoubleToString(bid, _Digits)  + ",";
   body += "\"candles\":"           + candlesJson                   + ",";
   body += "\"timeframes\":"       + BuildMultiTimeframeJson()     + ",";
   body += "\"priceActionUseAIReview\":" + (PriceActionUseAIReview ? "true" : "false") + ",";
   body += "\"indicatorSignals\":"  + structuredSignals             + ",";
   body += "\"indicatorBuffers\":"  + allBuffers                    + ",";
   body += "\"indicatorCount\":"    + IntegerToString(g_indicatorCount) + ",";
   body += "\"eaVersion\":\"8.0\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 10000, postData, result, responseHeaders);

   // ── Fallback 1: endpoint alternativo /api/mt5/signal-with-indicators ──
   if (res == 404 || res == -1)
   {
      url = g_serverUrl + "/api/mt5/signal-with-indicators";
      res = WebRequest("POST", url, headers, 10000, postData, result, responseHeaders);
   }

   // ── Fallback 2: GET simples de sinal ─────────────────────────────────
   if (res == 404 || res == -1)
   {
      url = g_serverUrl + "/api/metatrader/signal?symbol=" + g_symbol;
      if (g_apiToken != "") url += "&token=" + g_apiToken;
      char emptyData[];
      res = WebRequest("GET", url, headers, 5000, emptyData, result, responseHeaders);
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

   double lotSize    = ExtractJsonDouble(resp, "lotSize");
   double stopLoss   = ExtractJsonDouble(resp, "stopLoss");
   double takeProfit = ExtractJsonDouble(resp, "takeProfit");
   double confidence = ExtractJsonDouble(resp, "confidence");

   string slTpSource    = ExtractJsonString(resp, "slTpSource");
   string assetFamily   = ExtractJsonString(resp, "assetFamily");
   string assetTrend    = ExtractJsonString(resp, "assetTrend");
   string assetVolClass = ExtractJsonString(resp, "assetVolClass");
   string reason        = ExtractJsonString(resp, "reason");
   string girassolBias  = ExtractJsonString(resp, "girassolBias");

   // ── Aplicação do Modo de Controle da IA ──────────────────────────────
   if (AIControlMode == AI_MANUAL)
   {
      Print("ℹ️ Modo MANUAL: usando parâmetros do usuário");
      lotSize    = ManualLotSize;
      double point = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      stopLoss   = (ManualStopLoss   > 0) ? ManualStopLoss   * point : 0;
      takeProfit = (ManualTakeProfit > 0) ? ManualTakeProfit * point : 0;
      if (action == "BUY")
      {
         double entry = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
         if (stopLoss   > 0) stopLoss   = NormalizeDouble(entry - stopLoss,   _Digits);
         if (takeProfit > 0) takeProfit = NormalizeDouble(entry + takeProfit, _Digits);
      }
      else if (action == "SELL")
      {
         double entry = SymbolInfoDouble(g_symbol, SYMBOL_BID);
         if (stopLoss   > 0) stopLoss   = NormalizeDouble(entry + stopLoss,   _Digits);
         if (takeProfit > 0) takeProfit = NormalizeDouble(entry - takeProfit, _Digits);
      }
   }
   else if (AIControlMode == AI_PARTIAL)
   {
      if (!AI_Entrada)
      {
         Print("ℹ️ Modo PARCIAL: AI_Entrada=false — entrada bloqueada pelo usuário");
         return;
      }
      double point = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      if (!AI_Lote || lotSize <= 0) lotSize = ManualLotSize;
      if (!AI_StopLoss)
      {
         double rawSL = (ManualStopLoss > 0) ? ManualStopLoss * point : 0;
         if (rawSL > 0)
         {
            if (action == "BUY")  stopLoss = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_ASK) - rawSL, _Digits);
            else                   stopLoss = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_BID) + rawSL, _Digits);
         }
         else stopLoss = 0;
      }
      if (!AI_TakeProfit)
      {
         double rawTP = (ManualTakeProfit > 0) ? ManualTakeProfit * point : 0;
         if (rawTP > 0)
         {
            if (action == "BUY")  takeProfit = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_ASK) + rawTP, _Digits);
            else                   takeProfit = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_BID) - rawTP, _Digits);
         }
         else takeProfit = 0;
      }
      slTpSource = "parcial_usuario_ia";
      Print("ℹ️ PARCIAL: Lote=", AI_Lote ? "IA" : "Manual", " | SL=", AI_StopLoss ? "IA" : "Manual", " | TP=", AI_TakeProfit ? "IA" : "Manual");
   }
   else
   {
      if (lotSize <= 0) lotSize = ManualLotSize;
   }

   if (lotSize <= 0) lotSize = ManualLotSize;

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
      double point      = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      long   stopsLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
      double minDist    = MathMax((double)stopsLevel * point * 1.5, (ask - bid) * 5.0);

      string symUpper2 = g_symbol;
      StringToUpper(symUpper2);
      if (StringFind(symUpper2, "JUMP") >= 0 && ask > 1000)
      {
         double jumpMinPct = 0.06;
         if (StringFind(symUpper2, "100") >= 0) jumpMinPct = 0.12;
         else if (StringFind(symUpper2, "75")  >= 0) jumpMinPct = 0.10;
         else if (StringFind(symUpper2, "50")  >= 0) jumpMinPct = 0.08;
         else if (StringFind(symUpper2, "25")  >= 0) jumpMinPct = 0.07;
         minDist = MathMax(minDist, ask * jumpMinPct);
         Print("⚡ Jump — distância mínima: ", NormalizeDouble(minDist, 2), " pts");
      }

      if (minDist <= 0) minDist = ask * 0.01;

      if (action == "BUY")
      {
         double entry = ask;
         if (stopLoss > 0 && (entry - stopLoss) < minDist) { if (IsPriceActionCryptoSymbol()) { Print("⛔ Price Action: distância mínima do broker exigiria alargar o stop; sinal cancelado."); return; } stopLoss = NormalizeDouble(entry - minDist, _Digits); }
         if (takeProfit > 0 && (takeProfit - entry) < minDist) { if (IsPriceActionCryptoSymbol()) { Print("⛔ Price Action: TP abaixo da distância mínima do broker; sinal cancelado."); return; } takeProfit = NormalizeDouble(entry + minDist, _Digits); }
      }
      else if (action == "SELL")
      {
         double entry = bid;
         if (stopLoss > 0 && (stopLoss - entry) < minDist) { if (IsPriceActionCryptoSymbol()) { Print("⛔ Price Action: distância mínima do broker exigiria alargar o stop; sinal cancelado."); return; } stopLoss = NormalizeDouble(entry + minDist, _Digits); }
         if (takeProfit > 0 && (entry - takeProfit) < minDist) { if (IsPriceActionCryptoSymbol()) { Print("⛔ Price Action: TP abaixo da distância mínima do broker; sinal cancelado."); return; } takeProfit = NormalizeDouble(entry - minDist, _Digits); }
      }
   }

   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    bool isPriceActionCrypto = IsPriceActionCryptoSymbol();
    if (isPriceActionCrypto)
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
       double tickSizeCost = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_SIZE);
       double tickValueCost = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
       if (tickValueCost <= 0) tickValueCost = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_VALUE);
       double spreadCostPrice = MathMax(0.0, ask - bid) * 2.0;
       double commissionCostPrice = (tickSizeCost > 0 && tickValueCost > 0)
          ? PriceActionExtraRoundTripCostPerLot / (tickValueCost / tickSizeCost)
          : 1e100;
       double totalRoundTripCostPrice = spreadCostPrice + commissionCostPrice;
       double planRewardAfterCosts = riskDistance * 0.75 + rewardDistance * 0.5 - totalRoundTripCostPrice;
       double planRiskAfterCosts = riskDistance + totalRoundTripCostPrice;
       double planRiskReward = planRiskAfterCosts > 0 ? planRewardAfterCosts / planRiskAfterCosts : 0.0;
       if (riskDistance <= 0 || rewardDistance <= 0 || riskDistance / entry > 0.015 ||
           PriceActionExtraRoundTripCostPerLot <= 0.0 || planRiskReward < 2.0)
       {
          Print("⛔ Price Action recusado: custo total não configurado, stop >1,5% ou plano parcial + alvo final abaixo de 1:2 após custos.");
          return;
       }
       lotSize = CalculatePriceActionRiskLot(entry, stopLoss);
       if (lotSize <= 0)
       {
          Print("⛔ Price Action recusado: lote mínimo do broker excede o orçamento de risco ou tick value indisponível.");
          return;
       }
    }

   Print("📡 SINAL v8.0: ", action, " | ", g_symbol, " | Confiança: ", confidence, "%");
   if (assetFamily  != "") Print("   Ativo: ", assetFamily, " | ", assetTrend, " | Vol: ", assetVolClass);
   if (girassolBias != "") Print("   Girassol: ", girassolBias);
   if (slTpSource   != "") Print("   SL/TP via: ", slTpSource);
   Print("   SL: ", NormalizeDouble(stopLoss, _Digits), " | TP: ", NormalizeDouble(takeProfit, _Digits));
   Print("   Indicadores no gráfico: ", g_indicatorCount);
   if (reason != "") Print("   Razão: ", StringSubstr(reason, 0, 150));
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

   g_pendingSignalId = signalId;
   datetime tradeRequestTime = TimeCurrent();
   bool success = false;

   if (action == "BUY")
      success = trade.Buy(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);
   else if (action == "SELL")
      success = trade.Sell(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);

   // ── Retry automático se stops inválidos (10016) ───────────────────────
   if (!success && trade.ResultRetcode() == 10016 && !isPriceActionCrypto)
   {
      Print("⚠️ Stops inválidos (10016) — recalculando...");
      double askNow   = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
      double bidNow   = SymbolInfoDouble(g_symbol, SYMBOL_BID);
      double pointNow = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      long   stopsLvl = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
      double safeDist = MathMax((double)stopsLvl * pointNow * 3.0, (askNow - bidNow) * 10.0);

      string symUp = g_symbol;
      StringToUpper(symUp);
      if (StringFind(symUp, "JUMP") >= 0 && askNow > 1000)
      {
         double pct = 0.10;
         if (StringFind(symUp, "100") >= 0) pct = 0.15;
         else if (StringFind(symUp, "75") >= 0) pct = 0.13;
         else if (StringFind(symUp, "50") >= 0) pct = 0.10;
         safeDist = MathMax(safeDist, askNow * pct);
      }

      double slRetry = 0, tpRetry = 0;
      if (action == "BUY")
      {
         slRetry = NormalizeDouble(askNow - safeDist, _Digits);
         tpRetry = NormalizeDouble(askNow + safeDist, _Digits);
         success = trade.Buy(lotSize, g_symbol, 0, slRetry, tpRetry, "InvistaPRO_" + signalId);
      }
      else
      {
         slRetry = NormalizeDouble(bidNow + safeDist, _Digits);
         tpRetry = NormalizeDouble(bidNow - safeDist, _Digits);
         success = trade.Sell(lotSize, g_symbol, 0, slRetry, tpRetry, "InvistaPRO_" + signalId);
      }

      if (!success)
      {
         Print("⛔ Retry falhou. Ordem cancelada; nunca abrir sem SL/TP de proteção.");
         // A ordem permanece recusada se o broker não aceitar os stops protetivos.
         
         
      }
   }

   ulong confirmedPositionTicket = 0;
   long confirmedPositionIdentifier = 0;
   // CTrade's boolean result is not proof of execution. Every market entry must
   // be matched to the exact broker deal and a real, protected position.
   if (success)
   {
      uint fillCode = trade.ResultRetcode();
      double fillPrice = trade.ResultPrice();
      double fillVolume = trade.ResultVolume();
      bool filled = (fillCode == TRADE_RETCODE_DONE || fillCode == TRADE_RETCODE_DONE_PARTIAL) &&
                    fillPrice > 0.0 && fillVolume > 0.0;
      if (!filled)
      {
         Print("⛔ Ordem recusada como execução não confirmada. Retcode=", fillCode,
               " preço=", DoubleToString(fillPrice, _Digits),
               " volume=", DoubleToString(fillVolume, 8));
         success = false;
      }
      else
      {
         bool positionFound = false;
         bool protectionValid = false;
         long executedPositionIdentifier = 0;
         ulong executedDealTicket = trade.ResultDeal();
         if (executedDealTicket > 0 && HistoryDealSelect(executedDealTicket))
            executedPositionIdentifier = HistoryDealGetInteger(executedDealTicket, DEAL_POSITION_ID);

         for (int positionIndex = PositionsTotal() - 1; positionIndex >= 0; positionIndex--)
         {
            ulong candidateTicket = PositionGetTicket(positionIndex);
            if (candidateTicket == 0 || !PositionSelectByTicket(candidateTicket)) continue;
            if (PositionGetString(POSITION_SYMBOL) != g_symbol) continue;
            if ((long)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
            if (executedPositionIdentifier <= 0 ||
                PositionGetInteger(POSITION_IDENTIFIER) != executedPositionIdentifier) continue;
            if ((datetime)PositionGetInteger(POSITION_TIME) < tradeRequestTime) continue;

            long brokerType = PositionGetInteger(POSITION_TYPE);
            if ((action == "BUY" && brokerType != POSITION_TYPE_BUY) ||
                (action == "SELL" && brokerType != POSITION_TYPE_SELL)) continue;

            positionFound = true;
            confirmedPositionTicket = candidateTicket;
            confirmedPositionIdentifier = PositionGetInteger(POSITION_IDENTIFIER);
            if (confirmedPositionIdentifier > 0)
               GlobalVariableSet("InvistaPA_IDMAP_" + StringFormat("%I64d", confirmedPositionIdentifier), (double)confirmedPositionTicket);
            string signalFile = "InvistaPA_SIGNAL_" + StringFormat("%I64u", confirmedPositionTicket) + ".txt";
            int signalHandle = FileOpen(signalFile, FILE_WRITE | FILE_TXT | FILE_COMMON);
            if (signalHandle != INVALID_HANDLE)
            {
               FileWriteString(signalHandle, signalId);
               FileClose(signalHandle);
            }
            double brokerSL = PositionGetDouble(POSITION_SL);
            double brokerTP = PositionGetDouble(POSITION_TP);
            double brokerEntry = PositionGetDouble(POSITION_PRICE_OPEN);
            protectionValid = brokerSL > 0.0 && brokerTP > 0.0 && brokerEntry > 0.0 &&
               (action == "BUY" ? (brokerSL < brokerEntry && brokerTP > brokerEntry)
                                : (brokerSL > brokerEntry && brokerTP < brokerEntry));
            if (!protectionValid)
            {
               Print("🚨 CRÍTICO: posição executada sem SL/TP protetivos válidos. Ticket=", candidateTicket,
                     ". Tentando fechamento de emergência.");
               bool emergencyClose = trade.PositionClose(candidateTicket);
               if (!emergencyClose || trade.ResultRetcode() != TRADE_RETCODE_DONE)
                  Print("🚨 FALHA NO FECHAMENTO DE EMERGÊNCIA. Verifique imediatamente o ticket ", candidateTicket,
                        " | retcode=", trade.ResultRetcode());
            }
            break;
         }

         if (!positionFound)
         {
            Print("🚨 CRÍTICO: broker confirmou execução, mas a posição não pôde ser reconciliada ao deal. Entradas seguintes devem ser bloqueadas até revisão.");
            success = false;
         }
         else if (!protectionValid)
         {
            success = false;
         }
         else
         {
            if (isPriceActionCrypto)
               GlobalVariableSet("InvistaPA_SL0_" + IntegerToString((long)confirmedPositionTicket), stopLoss);
         }
      }
   }

   if (success)
   {
      double executedVolume = trade.ResultVolume();
      if (executedVolume > 0 && executedVolume < lotSize)
      {
         Print("⚠️ Execução parcial: solicitado=", DoubleToString(lotSize, 8),
               " executado=", DoubleToString(executedVolume, 8));
         lotSize = executedVolume;
      }
      Print("✅ Ordem confirmada: ", action, " | Ticket/posição: ",
            (confirmedPositionTicket > 0 ? confirmedPositionTicket : trade.ResultOrder()),
            " | Volume confirmado: ", DoubleToString(lotSize, 8),
            " | Preço de execução: ", DoubleToString(trade.ResultPrice(), _Digits),
            " | SL: ", NormalizeDouble(stopLoss, _Digits),
            " | TP: ", NormalizeDouble(takeProfit, _Digits));
      ConfirmTradeOpen(signalId,
         (int)(confirmedPositionTicket > 0 ? confirmedPositionTicket : trade.ResultOrder()),
         action, lotSize, trade.ResultPrice(), stopLoss, takeProfit);
   }
   else
      Print("❌ Falha definitiva ou execução não reconciliada: ", trade.ResultRetcode(), " / ", GetLastError());
}

//+------------------------------------------------------------------+
//| Monitor de posições abertas                                       |
//+------------------------------------------------------------------+
void MonitorOpenPositions()
{
   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M1, 0, 100, rates);
   if (copied < 5) return;

   string candlesJson       = BuildCandlesJson(rates, copied);
   string structuredSignals = ReadStructuredIndicatorSignals();
   string allBuffers        = ReadAllIndicatorBuffers();

   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i))      continue;
      if (posInfo.Magic() != MagicNumber) continue;
      if (posInfo.Symbol() != g_symbol)   continue;

      ulong  ticket    = posInfo.Ticket();
      string posType   = posInfo.PositionType() == POSITION_TYPE_BUY ? "BUY" : "SELL";
      double openPrice = posInfo.PriceOpen();
      double curPrice  = posInfo.PriceCurrent();
      double sl        = posInfo.StopLoss();
      double tp        = posInfo.TakeProfit();
      double profit    = posInfo.Profit();
 
       // Deterministic Price Action management: breakeven at +1R and 50% partial at +1.5R.
       // These controls run locally and never depend on AI availability.
       if (IsPriceActionCryptoSymbol() && sl > 0 && tp > 0)
       {
          string riskKey = "InvistaPA_R_" + IntegerToString((long)ticket);
          string partialKey = "InvistaPA_TP1_" + IntegerToString((long)ticket);
          double initialRisk = GlobalVariableCheck(riskKey) ? GlobalVariableGet(riskKey) : 0.0;
          if (initialRisk <= 0.0 && MathAbs(openPrice - sl) > _Point * 2.0)
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
                   double breakevenSL = NormalizeDouble(openPrice, _Digits);
                   if (trade.PositionModify(ticket, breakevenSL, tp))
                   {
                      sl = breakevenSL;
                      Print("🛡️ Price Action: stop movido para breakeven em +1R. Ticket=", ticket);
                   }
                   else
                      Print("⛔ Price Action: falha ao mover stop para breakeven; ticket=", ticket, " retcode=", trade.ResultRetcode());
                }
             }
             if (favorableMove >= initialRisk * 1.5 && !GlobalVariableCheck(partialKey) && ((posType == "BUY" && sl >= openPrice) || (posType == "SELL" && sl <= openPrice)))
             {
                double volume = posInfo.Volume();
                double volumeStep = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
                double minVolume = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
                int volumeDigits = VolumeDigitsFromStep();
                double partialVolume = (volumeStep > 0) ? MathFloor((volume * 0.5) / volumeStep) * volumeStep : 0.0;
                partialVolume = NormalizeDouble(partialVolume, volumeDigits);
                if (partialVolume >= minVolume && volume - partialVolume >= minVolume)
                {
                   if (ClosePriceActionPartial(ticket, partialVolume, posType))
                   {
                      GlobalVariableSet(partialKey, 1.0);
                      Print("🎯 Price Action: parcial de 50% realizada em +1,5R. Ticket=", ticket);
                      continue;
                   }
                   Print("⛔ Price Action: parcial falhou; ticket=", ticket, " retcode=", trade.ResultRetcode());
                }
                else
                {
                   GlobalVariableSet(partialKey, -1.0);
                   Print("ℹ️ Price Action: lote mínimo do broker impede parcial de 50%; posição segue protegida pelo SL/TP.");
                }
             }
          }
       }

// Strategy position management is deterministic. Do not let the legacy AI monitor
// close this position using rules that are not part of the Price Action document.
      if (IsPriceActionCryptoSymbol())
      {
         string initialStopKey = "InvistaPA_SL0_" + IntegerToString((long)ticket);
         double originalStructuralStop = GlobalVariableCheck(initialStopKey)
            ? GlobalVariableGet(initialStopKey) : 0.0;
         if (originalStructuralStop <= 0.0 && sl > 0.0)
         {
            originalStructuralStop = sl;
            GlobalVariableSet(initialStopKey, originalStructuralStop);
         }

         MqlRates trailRates[];
         int trailCopied = CopyRates(g_symbol, PERIOD_M5, 1, 60, trailRates);
         if (trailCopied >= 7)
         {
            double lastClosedM5 = trailRates[trailCopied - 1].close;
            bool structureInvalidated = originalStructuralStop > 0.0 &&
               (posType == "BUY" ? lastClosedM5 < originalStructuralStop
                                 : lastClosedM5 > originalStructuralStop);
            if (structureInvalidated)
            {
               Print("⚠️ Price Action: fechamento M5 confirmou invalidação da estrutura original. Encerrando posição ", ticket);
               if (!trade.PositionClose(ticket) || trade.ResultRetcode() != TRADE_RETCODE_DONE)
                  Print("🚨 Falha ao encerrar após invalidação estrutural. Ticket=", ticket,
                        " retcode=", trade.ResultRetcode());
               continue;
            }

            string partialKeyForTrail = "InvistaPA_TP1_" + IntegerToString((long)ticket);
            bool partialWasExecuted = GlobalVariableCheck(partialKeyForTrail) &&
                                      GlobalVariableGet(partialKeyForTrail) > 0.0;
            if (partialWasExecuted && sl > 0.0)
            {
               double rangeSum = 0.0;
               int rangeCount = 0;
               int rangeStart = MathMax(0, trailCopied - 21);
               for (int ri = rangeStart; ri < trailCopied - 1; ri++)
               {
                  double candleRange = trailRates[ri].high - trailRates[ri].low;
                  if (candleRange > 0.0)
                  {
                     rangeSum += candleRange;
                     rangeCount++;
                  }
               }
               double avgM5Range = rangeCount > 0 ? rangeSum / rangeCount : 0.0;
               double tickSize = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_SIZE);
               double point = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
               double trailBuffer = MathMax(avgM5Range * 0.1, tickSize);
               long stopsLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
               long freezeLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_FREEZE_LEVEL);
               double minStopDistance = MathMax((double)MathMax(stopsLevel, freezeLevel) * point, tickSize);
               double currentBid = SymbolInfoDouble(g_symbol, SYMBOL_BID);
               double currentAsk = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
               double proposedStop = 0.0;

               // Find the most recent confirmed M5 higher-low (BUY) / lower-high (SELL).
               for (int pivotIndex = trailCopied - 3; pivotIndex >= 2; pivotIndex--)
               {
                  bool isSwing = true;
                  double pivotPrice = (posType == "BUY") ? trailRates[pivotIndex].low : trailRates[pivotIndex].high;
                  for (int wingIndex = pivotIndex - 2; wingIndex <= pivotIndex + 2; wingIndex++)
                  {
                     if (wingIndex == pivotIndex) continue;
                     if (posType == "BUY" && trailRates[wingIndex].low <= pivotPrice) isSwing = false;
                     if (posType == "SELL" && trailRates[wingIndex].high >= pivotPrice) isSwing = false;
                  }
                  if (!isSwing) continue;

                  double candidateStop = (posType == "BUY")
                     ? NormalizeDouble(pivotPrice - trailBuffer, _Digits)
                     : NormalizeDouble(pivotPrice + trailBuffer, _Digits);
                  bool tightens = (posType == "BUY")
                     ? candidateStop > sl + point * 0.5
                     : candidateStop < sl - point * 0.5;
                  bool brokerDistanceOk = (posType == "BUY")
                     ? candidateStop < currentBid - minStopDistance
                     : candidateStop > currentAsk + minStopDistance;
                  if (tightens && brokerDistanceOk)
                  {
                     proposedStop = candidateStop;
                     break;
                  }
               }

               if (proposedStop > 0.0)
               {
                  if (trade.PositionModify(ticket, proposedStop, tp))
                  {
                     sl = proposedStop;
                     Print("🛡️ Price Action: trailing estrutural M5 apertou o stop para ",
                           DoubleToString(proposedStop, _Digits), " | Ticket=", ticket);
                  }
                  else
                     Print("⛔ Price Action: trailing estrutural recusado pelo broker; ticket=", ticket,
                           " retcode=", trade.ResultRetcode());
               }
            }
         }
         // Every Price Action position stays on deterministic SL/TP, breakeven,
         // structural invalidation and trailing. No undocumented legacy AI exit filter.
         continue;
      }

            string posJson = "{";
      posJson += "\"ticket\":"        + IntegerToString(ticket)             + ",";
      posJson += "\"symbol\":\""      + g_symbol                           + "\",";
      posJson += "\"type\":\""        + posType                             + "\",";
      posJson += "\"lots\":"          + DoubleToString(posInfo.Volume(), 2) + ",";
      posJson += "\"openPrice\":"     + DoubleToString(openPrice, _Digits)  + ",";
      posJson += "\"currentPrice\":"  + DoubleToString(curPrice, _Digits)   + ",";
      posJson += "\"stopLoss\":"      + DoubleToString(sl, _Digits)         + ",";
      posJson += "\"takeProfit\":"    + DoubleToString(tp, _Digits)         + ",";
      posJson += "\"profit\":"        + DoubleToString(profit, 2)           + ",";
      posJson += "\"openTime\":"      + IntegerToString((long)posInfo.Time()) + ",";
      posJson += "\"signalId\":\""    + posType + "_" + IntegerToString(ticket) + "\"";
      posJson += "}";

      string body = "{";
      body += "\"position\":"         + posJson          + ",";
      body += "\"marketData\":"       + candlesJson       + ",";
      body += "\"symbol\":\""         + g_symbol         + "\",";
      body += "\"indicatorSignals\":" + structuredSignals + ",";
      body += "\"indicatorBuffers\":" + allBuffers;
      if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
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

      bool shouldClose = (action == "CLOSE_PROFIT"     ||
                          action == "CLOSE_SPIKE_EXIT" ||
                          action == "CLOSE_LOSS_PREVENTION");

      bool aiCanClose = (AIControlMode == AI_FULL) ||
                        (AIControlMode == AI_PARTIAL && AI_Saida);
      if (!aiCanClose && shouldClose)
      {
         Print("ℹ️ Monitor sugeriu ", action, " mas saída por IA desativada");
         shouldClose = false;
      }

      if (shouldClose)
      {
         Print("🤖 Monitor IA → ", action, " | #", ticket, " | Urgência: ", urgency, " | ", reason);
         bool closed = trade.PositionClose(ticket);
         if (closed) Print("✅ Posição #", ticket, " fechada pelo monitor IA");
         else        Print("❌ Falha ao fechar #", ticket, ": ", GetLastError());
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
//| Evento: mudança no gráfico (add/remove de indicadores)           |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if (id == CHARTEVENT_CHART_CHANGE)
   {
      Print("🔄 Mudança no gráfico — re-escaneando indicadores...");
      ScanChartIndicators();
      FetchAssetProfile();
   }
}

//+------------------------------------------------------------------+
//| Heartbeat                                                         |
//+------------------------------------------------------------------+
void RetryPendingClosedPositions();

bool SendHeartbeat()
{
   // Retry any final close that failed to reach the server during a previous disconnect.
   RetryPendingClosedPositions();

   double balance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin    = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   long   accId     = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker    = AccountInfoString(ACCOUNT_COMPANY);
   long   tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string accountType = (tradeMode == ACCOUNT_TRADE_MODE_REAL) ? "real" :
                        (tradeMode == ACCOUNT_TRADE_MODE_DEMO) ? "demo" : "contest";

   // Send exact broker position tickets, not only a count. The server must not
   // erase its own state merely because the terminal reports zero open positions.
   string openPositionTicketsJson = "[";
   int openPos = 0;
   for (int positionIndex = 0; positionIndex < PositionsTotal(); positionIndex++)
   {
      ulong positionTicket = PositionGetTicket(positionIndex);
      if (positionTicket == 0 || !PositionSelectByTicket(positionTicket)) continue;
      long positionIdentifier = PositionGetInteger(POSITION_IDENTIFIER);
      // Only map positions owned by this EA for close-event accounting. All account
      // tickets are still reported below, so unmanaged positions keep the entry gate closed.
      if (positionIdentifier > 0 && PositionGetInteger(POSITION_MAGIC) == MagicNumber)
         GlobalVariableSet("InvistaPA_IDMAP_" + StringFormat("%I64d", positionIdentifier), (double)positionTicket);
      if (openPos > 0) openPositionTicketsJson += ",";
      openPositionTicketsJson += "\"" + StringFormat("%I64u", positionTicket) + "\"";
      openPos++;
   }
   openPositionTicketsJson += "]";

   string url     = g_serverUrl + "/api/metatrader/heartbeat";
   string headers = "Content-Type: application/json\r\n";
   string body    = "{";
   body += "\"accountId\":\""  + IntegerToString(accId) + "\",";
   body += "\"broker\":\""     + broker                 + "\",";
   body += "\"balance\":"      + DoubleToString(balance, 2) + ",";
   body += "\"equity\":"       + DoubleToString(equity,  2) + ",";
   body += "\"freeMargin\":"   + DoubleToString(margin,  2) + ",";
   body += "\"openPositions\":" + IntegerToString(openPos)  + ",";
   body += "\"openPositionTickets\":" + openPositionTicketsJson + ",";
   body += "\"platform\":\"MT5\",";
   body += "\"accountType\":\"" + accountType + "\",";
   body += "\"eaVersion\":\"8.0\"";
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
void ConfirmTradeOpen(string signalId, int ticket, string type, double lots, double fillPrice, double sl, double tp)
{
   string url     = g_serverUrl + "/api/metatrader/trade/open";
   string headers = "Content-Type: application/json\r\n";
   double openPrice = fillPrice;
   string body = "{";
   body += "\"ticket\":"       + IntegerToString(ticket)          + ",";
   body += "\"symbol\":\""     + g_symbol                        + "\",";
   body += "\"type\":\""       + type                            + "\",";
   body += "\"lots\":"         + DoubleToString(lots, 2)         + ",";
   body += "\"openPrice\":"    + DoubleToString(openPrice, _Digits) + ",";
   body += "\"stopLoss\":"     + DoubleToString(sl, _Digits)     + ",";
   body += "\"takeProfit\":"   + DoubleToString(tp, _Digits)     + ",";
   body += "\"openTime\":"     + IntegerToString(TimeCurrent())  + ",";
   body += "\"signalId\":\""   + signalId                        + "\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";
   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;
   WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);
}


void ReportClosedPositionFromDeal(ulong transactionDeal)
{
   if (transactionDeal == 0 || !HistoryDealSelect(transactionDeal)) return;

   long entryKind = HistoryDealGetInteger(transactionDeal, DEAL_ENTRY);
   if (entryKind != DEAL_ENTRY_OUT && entryKind != DEAL_ENTRY_OUT_BY && entryKind != DEAL_ENTRY_INOUT)
      return;

   long positionIdentifier = HistoryDealGetInteger(transactionDeal, DEAL_POSITION_ID);
   if (positionIdentifier <= 0) return;
   // The tracked position mapping, not the closing deal's magic number, is the
   // authority: SL/TP/manual closing deals may report a different deal magic.
   string identifierKey = "InvistaPA_IDMAP_" + StringFormat("%I64d", positionIdentifier);
   if (!GlobalVariableCheck(identifierKey)) return;

   // A partial close must not remove the still-open position from the server.
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong currentTicket = PositionGetTicket(i);
      if (currentTicket == 0 || !PositionSelectByTicket(currentTicket)) continue;
      if (PositionGetInteger(POSITION_IDENTIFIER) == positionIdentifier) return;
   }

   ulong serverTicket = (ulong)GlobalVariableGet(identifierKey);
   if (serverTicket == 0) return;

   string closeReportedKey = "InvistaPA_CLOSE_SENT_" + StringFormat("%I64d", positionIdentifier);
   if (GlobalVariableCheck(closeReportedKey)) return;

   if (!HistorySelectByPosition(positionIdentifier)) return;
   int totalDeals = HistoryDealsTotal();
   if (totalDeals <= 0) return;

   double netProfit = 0.0;
   double entryVolume = 0.0;
   double weightedOpenPrice = 0.0;
   double exitVolume = 0.0;
   double weightedClosePrice = 0.0;
   long openTime = 0;
   long closeTime = 0;
   long positionType = -1;
   long latestCloseReason = DEAL_REASON_CLIENT;
   string recordedSignalId = "";
   string symbol = "";

   for (int i = 0; i < totalDeals; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if (deal == 0) continue;
      if (HistoryDealGetInteger(deal, DEAL_POSITION_ID) != positionIdentifier) continue;

      long dealEntry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      long dealTime = HistoryDealGetInteger(deal, DEAL_TIME);
      double dealVolume = HistoryDealGetDouble(deal, DEAL_VOLUME);
      double dealPrice = HistoryDealGetDouble(deal, DEAL_PRICE);
      long dealType = HistoryDealGetInteger(deal, DEAL_TYPE);

      netProfit += HistoryDealGetDouble(deal, DEAL_PROFIT);
      netProfit += HistoryDealGetDouble(deal, DEAL_COMMISSION);
      netProfit += HistoryDealGetDouble(deal, DEAL_SWAP);
      netProfit += HistoryDealGetDouble(deal, DEAL_FEE);

      if (symbol == "") symbol = HistoryDealGetString(deal, DEAL_SYMBOL);

      if (dealEntry == DEAL_ENTRY_IN || dealEntry == DEAL_ENTRY_INOUT)
      {
         if (dealVolume > 0.0 && dealPrice > 0.0)
         {
            entryVolume += dealVolume;
            weightedOpenPrice += dealPrice * dealVolume;
         }
         if (openTime == 0 || dealTime < openTime) openTime = dealTime;
         if (positionType < 0 && (dealType == DEAL_TYPE_BUY || dealType == DEAL_TYPE_SELL))
            positionType = dealType;
         if (recordedSignalId == "")
         {
            string comment = HistoryDealGetString(deal, DEAL_COMMENT);
            int prefix = StringFind(comment, "InvistaPRO_");
            if (prefix >= 0) recordedSignalId = StringSubstr(comment, prefix + StringLen("InvistaPRO_"));
         }
      }

      if (dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_OUT_BY || dealEntry == DEAL_ENTRY_INOUT)
      {
         if (dealVolume > 0.0 && dealPrice > 0.0)
         {
            exitVolume += dealVolume;
            weightedClosePrice += dealPrice * dealVolume;
         }
         if (dealTime >= closeTime)
         {
            closeTime = dealTime;
            latestCloseReason = HistoryDealGetInteger(deal, DEAL_REASON);
         }
      }
   }

   if (entryVolume <= 0.0 || exitVolume <= 0.0 || weightedOpenPrice <= 0.0 || weightedClosePrice <= 0.0 ||
       openTime <= 0 || closeTime <= 0 || symbol == "" ||
       (positionType != DEAL_TYPE_BUY && positionType != DEAL_TYPE_SELL))
      return;

   double averageOpen = weightedOpenPrice / entryVolume;
   double averageClose = weightedClosePrice / exitVolume;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   double signedPips = point > 0.0
      ? ((positionType == DEAL_TYPE_BUY) ? averageClose - averageOpen : averageOpen - averageClose) / point
      : 0.0;

   string signalFile = "InvistaPA_SIGNAL_" + StringFormat("%I64u", serverTicket) + ".txt";
   if (FileIsExist(signalFile, FILE_COMMON))
   {
      int signalHandle = FileOpen(signalFile, FILE_READ | FILE_TXT | FILE_COMMON);
      if (signalHandle != INVALID_HANDLE)
      {
         string storedSignalId = FileReadString(signalHandle);
         FileClose(signalHandle);
         if (storedSignalId != "") recordedSignalId = storedSignalId;
      }
   }

   string closeReason = "MANUAL";
   if (latestCloseReason == DEAL_REASON_TP) closeReason = "TP";
   else if (latestCloseReason == DEAL_REASON_SL) closeReason = "SL";

   string body = "{";
   body += "\"ticket\":" + StringFormat("%I64u", serverTicket) + ",";
   body += "\"signalId\":\"" + recordedSignalId + "\",";
   body += "\"symbol\":\"" + symbol + "\",";
   body += "\"type\":\"" + string(positionType == DEAL_TYPE_BUY ? "BUY" : "SELL") + "\",";
   body += "\"lots\":" + DoubleToString(entryVolume, 8) + ",";
   body += "\"openPrice\":" + DoubleToString(averageOpen, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + ",";
   body += "\"closePrice\":" + DoubleToString(averageClose, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + ",";
   body += "\"profit\":" + DoubleToString(netProfit, 8) + ",";
   body += "\"pips\":" + DoubleToString(signedPips, 2) + ",";
   body += "\"openTime\":" + IntegerToString((int)openTime) + ",";
   body += "\"closeTime\":" + IntegerToString((int)closeTime) + ",";
   body += "\"closeReason\":\"" + closeReason + "\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   char postData[], responseData[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;
   int responseCode = WebRequest(
      "POST", g_serverUrl + "/api/metatrader/trade/close",
      "Content-Type: application/json\r\n", 5000, postData, responseData, responseHeaders
   );
   if (responseCode == 200)
   {
      GlobalVariableSet(closeReportedKey, (double)TimeCurrent());
      GlobalVariableDel(identifierKey);
      FileDelete(signalFile, FILE_COMMON);
      Print("📊 Fechamento de posição reconciliado. Ticket=", serverTicket,
            " | P&L líquido com comissão/swap/taxas=", DoubleToString(netProfit, 2),
            " | motivo=", closeReason);
   }
   else
   {
      Print("🚨 Falha ao reportar fechamento ao servidor. Ticket=", serverTicket,
            " | HTTP=", responseCode, ". A reconciliação seguirá bloqueando novas entradas.");
   }
}

void RetryPendingClosedPositions()
{
   string prefix = "InvistaPA_IDMAP_";
   for (int globalIndex = GlobalVariablesTotal() - 1; globalIndex >= 0; globalIndex--)
   {
      string key = GlobalVariableName(globalIndex);
      if (StringFind(key, prefix) != 0) continue;
      string identifierText = StringSubstr(key, StringLen(prefix));
      long positionIdentifier = (long)StringToInteger(identifierText);
      if (positionIdentifier <= 0) continue;

      string closeReportedKey = "InvistaPA_CLOSE_SENT_" + StringFormat("%I64d", positionIdentifier);
      if (GlobalVariableCheck(closeReportedKey)) continue;

      bool stillOpen = false;
      for (int positionIndex = PositionsTotal() - 1; positionIndex >= 0; positionIndex--)
      {
         ulong ticket = PositionGetTicket(positionIndex);
         if (ticket == 0 || !PositionSelectByTicket(ticket)) continue;
         if (PositionGetInteger(POSITION_IDENTIFIER) == positionIdentifier)
         {
            stillOpen = true;
            break;
         }
      }
      if (stillOpen) continue;
      if (!HistorySelectByPosition(positionIdentifier)) continue;

      ulong latestCloseDeal = 0;
      long latestCloseTime = 0;
      for (int dealIndex = 0; dealIndex < HistoryDealsTotal(); dealIndex++)
      {
         ulong deal = HistoryDealGetTicket(dealIndex);
         if (deal == 0 || HistoryDealGetInteger(deal, DEAL_POSITION_ID) != positionIdentifier) continue;
         long entryKind = HistoryDealGetInteger(deal, DEAL_ENTRY);
         if (entryKind != DEAL_ENTRY_OUT && entryKind != DEAL_ENTRY_OUT_BY && entryKind != DEAL_ENTRY_INOUT) continue;
         long dealTime = HistoryDealGetInteger(deal, DEAL_TIME);
         if (dealTime >= latestCloseTime)
         {
            latestCloseTime = dealTime;
            latestCloseDeal = deal;
         }
      }
      if (latestCloseDeal > 0)
      {
         Print("🔁 Tentando reconciliar fechamento pendente da posição ", positionIdentifier);
         ReportClosedPositionFromDeal(latestCloseDeal);
      }
   }
}

void OnTradeTransaction(
   const MqlTradeTransaction& trans,
   const MqlTradeRequest& request,
   const MqlTradeResult& result
)
{
   if (trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0) return;
   if (!HistoryDealSelect(trans.deal)) return;
   long entryKind = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if (entryKind != DEAL_ENTRY_OUT && entryKind != DEAL_ENTRY_OUT_BY && entryKind != DEAL_ENTRY_INOUT)
      return;
   ReportClosedPositionFromDeal(trans.deal);
}

//+------------------------------------------------------------------+
//| Busca URL de descoberta                                           |
//+------------------------------------------------------------------+
void FetchDiscoveryUrl()
{
   string url     = g_serverUrl + "/api/url";
   string headers = "Accept: application/json\r\n";
   uchar  data[];
   uchar  result[];
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
   uchar  data[];
   uchar  result[];
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

double ExtractJsonDoubleInObject(string json, string objKey, string fieldKey)
{
   string search = "\"" + objKey + "\":{";
   int objPos = StringFind(json, search);
   if (objPos < 0) return 0.0;
   string sub = StringSubstr(json, objPos, 300);
   return ExtractJsonDouble(sub, fieldKey);
}
