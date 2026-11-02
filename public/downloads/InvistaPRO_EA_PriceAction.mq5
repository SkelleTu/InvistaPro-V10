//+------------------------------------------------------------------+
//|                                              InvistaPRO_EA.mq5    |
//|                                 InvistaPRO - Auto-Discovery URL   |
//|   Versão 1.0 — Price Action operacional com gates de segurança   |
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
#property version   "1.0"
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
input int      MagicNumber      = 20261102;    // Número mágico
input bool     AutoReconnect    = true;        // Reconexão automática de URL
input int      MaxReconnectTries= 5;           // Tentativas máximas de reconexão
const int      IndicatorBars = 5; // Compatibilidade interna; sem leitura de indicadores no EA novo
const int      CandleCount = 200; // Compatibilidade interna; candles enviados por timeframe
input double   PriceActionRiskPercent = 1.0; // Risco por trade: 1% padrão, máximo 2%
input int      MaxPositions = 1; // Uma posição por símbolo
input int      WarmupSeconds = 120; // Aquecimento sem operar
input bool     CloseAtEndOfBrasiliaSession = true; // Não carregar day trades para o dia seguinte

// Compatibilidade com funções legadas mantidas sem execução no EA Price Action.
const ENUM_AI_CONTROL_MODE AIControlMode = AI_FULL;
const double ManualLotSize = 0.01;
const int ManualStopLoss = 0;
const int ManualTakeProfit = 0;
const bool AI_Lote = true;
const bool AI_StopLoss = true;
const bool AI_TakeProfit = true;
const bool AI_Entrada = true;
const bool AI_Saida = true;

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
   trade.SetDeviationInPoints(20);
   // Timer keeps connectivity checks alive even when the chart receives no ticks.
   EventSetTimer(1);

   datetime now = TimeCurrent();
   g_lastSignal      = now;
   g_lastHeartbeat   = now;
   g_lastMonitor     = TimeLocal();
   g_lastWarmupPrint = now;
   g_lastMarketData  = now;

   if (WarmupSeconds > 0)
      g_warmupUntil = now + WarmupSeconds;
   else
      g_warmupUntil = now;

   Print("🚀 InvistaPRO EA Price Action v1.0 iniciado | Símbolo: ", g_symbol);
   Print("   → URL: ", g_serverUrl);
   Print("   → Estratégia: Price Action H4/H1/M15/M5/M1 | Risco: ", DoubleToString(PriceActionRiskPercent, 1), "% | Magic: ", MagicNumber);
   if (WarmupSeconds > 0)
      Print("   ⏳ AQUECIMENTO ATIVO: operações bloqueadas por ", WarmupSeconds, "s");

   string modeLabel = "";
   if (AIControlMode == AI_MANUAL)
      modeLabel = "MANUAL";
   else if (!IsPriceActionEnabled() && AIControlMode == AI_PARTIAL)
      modeLabel = "PARCIAL";
   else
      modeLabel = "TOTAL (IA controla 100%)";
   Print("🤖 Modo de Controle da IA: ", modeLabel);



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
//| Busca perfil do ativo Deriv                                       |
//+------------------------------------------------------------------+
void FetchAssetProfile()
{
   string url     = g_serverUrl + "/api/metatrader/asset-profile/" + g_symbol;
   string headers = "Accept: application/json\r\n";
   char  data[];
   char  result[];
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
                  json += DoubleToString(buf[v], ManagedSymbolDigits());
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
                     levelsJson += "{\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufB[v], ManagedSymbolDigits()) + ",\"direction\":\"buy\",\"color\":\"blue\"}";
                     if (!firstBuy) allBuyJson += ",";
                     firstBuy = false;
                     allBuyJson += "{\"level\":\"" + levelNames[lvl] + "\",\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufB[v], ManagedSymbolDigits()) + "}";
                     if (v == 0 && ask > 0)
                     {
                        string srType = (bufB[v] < ask) ? "support" : "resistance";
                        if (!firstSR) srLevels += ",";
                        firstSR = false;
                        srLevels += "{\"type\":\"" + srType + "\",\"price\":" + DoubleToString(bufB[v], ManagedSymbolDigits()) + ",\"level\":\"" + levelNames[lvl] + "\",\"direction\":\"buy\",\"buffer\":" + IntegerToString(bufBuy) + "}";
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
                     levelsJson += "{\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufS[v], ManagedSymbolDigits()) + ",\"direction\":\"sell\",\"color\":\"red\"}";
                     if (!firstSell) allSellJson += ",";
                     firstSell = false;
                     allSellJson += "{\"level\":\"" + levelNames[lvl] + "\",\"bar\":" + IntegerToString(v) + ",\"value\":" + DoubleToString(bufS[v], ManagedSymbolDigits()) + "}";
                     if (v == 0 && ask > 0)
                     {
                        string srType = (bufS[v] < ask) ? "support" : "resistance";
                        if (!firstSR) srLevels += ",";
                        firstSR = false;
                        srLevels += "{\"type\":\"" + srType + "\",\"price\":" + DoubleToString(bufS[v], ManagedSymbolDigits()) + ",\"level\":\"" + levelNames[lvl] + "\",\"direction\":\"sell\",\"buffer\":" + IntegerToString(bufSell) + "}";
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
         fibNames[2]  = "31.0%";
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
            json += "\"price\":" + DoubleToString(buf[0], ManagedSymbolDigits()) + ",";
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
            else json += DoubleToString(buf[v], ManagedSymbolDigits());
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

   // EA Price Action é independente do canal de candles/Girassol legado.

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
   double lossPerLot = MathAbs(oneLotProfit);
   if (lossPerLot <= 0.0) return 0.0;

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

void PersistPriceActionPositionState()
{
   for (int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if (!posInfo.SelectByIndex(i)) continue;
      if (posInfo.Magic() != MagicNumber || posInfo.Symbol() != g_symbol) continue;
      ulong ticket = posInfo.Ticket();
      double initialRisk = MathAbs(posInfo.PriceOpen() - posInfo.StopLoss());
      if (initialRisk <= 0.0) continue;
      string riskKey = PriceActionStateKey("InvistaPA_R", (long)ticket);
      if (!GlobalVariableCheck(riskKey)) GlobalVariableSet(riskKey, initialRisk);
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
         double candidate = NormalizeDouble(rates[i].low - buffer, ManagedSymbolDigits());
         double bid = SymbolInfoDouble(g_symbol, SYMBOL_BID);
         if (candidate > currentStop && candidate < bid - minimumDistance) return candidate;
      }
      else
      {
         bool pivot = rates[i].high > rates[i-1].high && rates[i].high > rates[i-2].high
                   && rates[i].high >= rates[i+1].high && rates[i].high >= rates[i+2].high;
         if (!pivot) continue;
         double candidate = NormalizeDouble(rates[i].high + buffer, ManagedSymbolDigits());
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
      return sent && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_DONE_PARTIAL)
             && trade.ResultDeal() > 0;
   }

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
   return (result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_DONE_PARTIAL) && result.deal > 0 && result.volume > 0;
}

void FetchAndProcessSignal()
{
   // O EA novo envia somente candles OHLC multi-timeframe; não lê Girassol nem buffers legados.
   string structuredSignals = "{}";
   string allBuffers = "{}";
   string candlesJson = "[]";

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
   body += "\"ask\":"               + DoubleToString(ask, ManagedSymbolDigits())  + ",";
   body += "\"bid\":"               + DoubleToString(bid, ManagedSymbolDigits())  + ",";
   body += "\"candles\":"           + candlesJson                   + ",";
   body += "\"timeframes\":"       + BuildMultiTimeframeJson()     + ",";
   body += "\"strategyMode\":\"PRICE_ACTION\",";
   body += "\"priceActionUseAIReview\":false,";
   body += "\"indicatorSignals\":"  + structuredSignals             + ",";
   body += "\"indicatorBuffers\":"  + allBuffers                    + ",";
   body += "\"indicatorCount\":"    + IntegerToString(g_indicatorCount) + ",";
   body += "\"eaVersion\":\"1.0\"";
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

   // Legacy GET is forbidden for crypto strategy symbols: it lacks full MTF context
   // and could bypass the deterministic Price Action gate.
   if ((res == 404 || res == -1) && !IsPriceActionEnabled())
   {
      url = g_serverUrl + "/api/metatrader/signal?symbol=" + g_symbol;
      if (g_apiToken != "") url += "&token=" + g_apiToken;
      char emptyData[];
      res = WebRequest("GET", url, headers, 5000, emptyData, result, responseHeaders);
   }
   else if ((res == 404 || res == -1) && IsPriceActionEnabled())
   {
      Print("⛔ Price Action: endpoint multi-timeframe indisponível; fallback legado bloqueado.");
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
   if (!IsPriceActionEnabled() && AIControlMode == AI_MANUAL)
   {
      Print("ℹ️ Modo MANUAL: usando parâmetros do usuário");
      lotSize    = ManualLotSize;
      double point = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      stopLoss   = (ManualStopLoss   > 0) ? ManualStopLoss   * point : 0;
      takeProfit = (ManualTakeProfit > 0) ? ManualTakeProfit * point : 0;
      if (action == "BUY")
      {
         double entry = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
         if (stopLoss   > 0) stopLoss   = NormalizeDouble(entry - stopLoss,   ManagedSymbolDigits());
         if (takeProfit > 0) takeProfit = NormalizeDouble(entry + takeProfit, ManagedSymbolDigits());
      }
      else if (action == "SELL")
      {
         double entry = SymbolInfoDouble(g_symbol, SYMBOL_BID);
         if (stopLoss   > 0) stopLoss   = NormalizeDouble(entry + stopLoss,   ManagedSymbolDigits());
         if (takeProfit > 0) takeProfit = NormalizeDouble(entry - takeProfit, ManagedSymbolDigits());
      }
   }
   else if (!IsPriceActionEnabled() && AIControlMode == AI_PARTIAL)
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
            if (action == "BUY")  stopLoss = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_ASK) - rawSL, ManagedSymbolDigits());
            else                   stopLoss = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_BID) + rawSL, ManagedSymbolDigits());
         }
         else stopLoss = 0;
      }
      if (!AI_TakeProfit)
      {
         double rawTP = (ManualTakeProfit > 0) ? ManualTakeProfit * point : 0;
         if (rawTP > 0)
         {
            if (action == "BUY")  takeProfit = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_ASK) + rawTP, ManagedSymbolDigits());
            else                   takeProfit = NormalizeDouble(SymbolInfoDouble(g_symbol, SYMBOL_BID) - rawTP, ManagedSymbolDigits());
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

   if (stopLoss > 0 || takeProfit > 0)
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
         if (stopLoss > 0 && (entry - stopLoss) < minDist) { if (IsPriceActionEnabled()) { Print("⛔ Price Action: distância mínima do broker exigiria alargar o stop; sinal cancelado."); return; } stopLoss = NormalizeDouble(entry - minDist, ManagedSymbolDigits()); }
         if (takeProfit > 0 && (takeProfit - entry) < minDist) { if (IsPriceActionEnabled()) { Print("⛔ Price Action: TP abaixo da distância mínima do broker; sinal cancelado."); return; } takeProfit = NormalizeDouble(entry + minDist, ManagedSymbolDigits()); }
      }
      else if (action == "SELL")
      {
         double entry = bid;
         if (stopLoss > 0 && (stopLoss - entry) < minDist) { if (IsPriceActionEnabled()) { Print("⛔ Price Action: distância mínima do broker exigiria alargar o stop; sinal cancelado."); return; } stopLoss = NormalizeDouble(entry + minDist, ManagedSymbolDigits()); }
         if (takeProfit > 0 && (entry - takeProfit) < minDist) { if (IsPriceActionEnabled()) { Print("⛔ Price Action: TP abaixo da distância mínima do broker; sinal cancelado."); return; } takeProfit = NormalizeDouble(entry - minDist, ManagedSymbolDigits()); }
      }
   }

   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    bool isPriceActionInstrument = IsPriceActionEnabled();
    if (isPriceActionInstrument)
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
       if (riskDistance <= 0 || rewardDistance <= 0 || riskDistance / entry > 0.015 || rewardDistance / riskDistance < 2.0)
       {
          Print("⛔ Price Action recusado: stop inválido, stop acima de 1,5% ou R:R abaixo de 1:2 no preço executável.");
          return;
       }
       lotSize = CalculatePriceActionRiskLot(entry, stopLoss);
       if (lotSize <= 0)
       {
          Print("⛔ Price Action recusado: lote mínimo do broker excede o orçamento de risco ou tick value indisponível.");
          return;
       }
    }

   Print("📡 SINAL v1.0: ", action, " | ", g_symbol, " | Confiança: ", confidence, "%");
   if (assetFamily  != "") Print("   Ativo: ", assetFamily, " | ", assetTrend, " | Vol: ", assetVolClass);
   if (girassolBias != "") Print("   Girassol: ", girassolBias);
   if (slTpSource   != "") Print("   SL/TP via: ", slTpSource);
   Print("   SL: ", NormalizeDouble(stopLoss, ManagedSymbolDigits()), " | TP: ", NormalizeDouble(takeProfit, ManagedSymbolDigits()));
   Print("   Indicadores no gráfico: ", g_indicatorCount);
   if (reason != "") Print("   Razão: ", StringSubstr(reason, 0, 150));
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

   bool success = false;
   bool requestOk = false;

   if (action == "BUY")
      requestOk = trade.Buy(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);
   else if (action == "SELL")
      requestOk = trade.Sell(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);

   // CTrade bool only validates the request structure locally. Require a broker fill.
   uint tradeRetcode = trade.ResultRetcode();
   success = requestOk && (tradeRetcode == TRADE_RETCODE_DONE || tradeRetcode == TRADE_RETCODE_DONE_PARTIAL)
             && trade.ResultDeal() > 0;

   // Retry invalid stops only for non-Price-Action legacy instruments.
   if (!success && tradeRetcode == 10016 && !isPriceActionInstrument)
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
         slRetry = NormalizeDouble(askNow - safeDist, ManagedSymbolDigits());
         tpRetry = NormalizeDouble(askNow + safeDist, ManagedSymbolDigits());
         requestOk = trade.Buy(lotSize, g_symbol, 0, slRetry, tpRetry, "InvistaPRO_" + signalId);
         tradeRetcode = trade.ResultRetcode();
         success = requestOk && (tradeRetcode == TRADE_RETCODE_DONE || tradeRetcode == TRADE_RETCODE_DONE_PARTIAL)
                   && trade.ResultDeal() > 0;
      }
      else
      {
         slRetry = NormalizeDouble(bidNow + safeDist, ManagedSymbolDigits());
         tpRetry = NormalizeDouble(bidNow - safeDist, ManagedSymbolDigits());
         requestOk = trade.Sell(lotSize, g_symbol, 0, slRetry, tpRetry, "InvistaPRO_" + signalId);
         tradeRetcode = trade.ResultRetcode();
         success = requestOk && (tradeRetcode == TRADE_RETCODE_DONE || tradeRetcode == TRADE_RETCODE_DONE_PARTIAL)
                   && trade.ResultDeal() > 0;
      }

      if (!success)
      {
         Print("⛔ Retry falhou. Ordem cancelada; nunca abrir sem SL/TP de proteção.");
         // A ordem permanece recusada se o broker não aceitar os stops protetivos.
         
         
      }
   }

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
            " | SL: ", NormalizeDouble(stopLoss, ManagedSymbolDigits()),
            " | TP: ", NormalizeDouble(takeProfit, ManagedSymbolDigits()));
      PersistPriceActionPositionState();
      long positionIdentifier = GetManagedPositionIdentifier();
      if (positionIdentifier > 0)
         ConfirmTradeOpen(signalId, positionIdentifier, action, lotSize, stopLoss, takeProfit, trade.ResultPrice());
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
   string candlesJson = "[]";
   string structuredSignals = "{}";
   string allBuffers = "{}";

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
       // These controls run locally and never depend on AI availability.
       if (IsPriceActionEnabled() && sl > 0 && tp > 0)
       {
          string riskKey = PriceActionStateKey("InvistaPA_R", (long)ticket);
          string partialKey = PriceActionStateKey("InvistaPA_TP1", (long)ticket);
          double initialRisk = GlobalVariableCheck(riskKey) ? GlobalVariableGet(riskKey) : 0.0;
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
                   double breakevenSL = NormalizeDouble(openPrice, ManagedSymbolDigits());
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

// Autonomous Price Action mode uses only deterministic local protection and fixed SL/TP.
      if (IsPriceActionEnabled())
         continue;

            string posJson = "{";
      posJson += "\"ticket\":"        + IntegerToString(ticket)             + ",";
      posJson += "\"symbol\":\""      + g_symbol                           + "\",";
      posJson += "\"type\":\""        + posType                             + "\",";
      posJson += "\"lots\":"          + DoubleToString(posInfo.Volume(), 2) + ",";
      posJson += "\"openPrice\":"     + DoubleToString(openPrice, ManagedSymbolDigits())  + ",";
      posJson += "\"currentPrice\":"  + DoubleToString(curPrice, ManagedSymbolDigits())   + ",";
      posJson += "\"stopLoss\":"      + DoubleToString(sl, ManagedSymbolDigits())         + ",";
      posJson += "\"takeProfit\":"    + DoubleToString(tp, ManagedSymbolDigits())         + ",";
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

bool ConfirmTradeOpen(string signalId, long ticket, string type, double lots, double sl, double tp, double executedPrice)
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
   body += "\"openTime\":"     + IntegerToString((long)TimeCurrent() * 1000)  + ",";
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
                       posInfo.TakeProfit(), posInfo.PriceOpen());
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
      datetime dealTime = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
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

double ExtractJsonDoubleInObject(string json, string objKey, string fieldKey)
{
   string search = "\"" + objKey + "\":{";
   int objPos = StringFind(json, search);
   if (objPos < 0) return 0.0;
   string sub = StringSubstr(json, objPos, 300);
   return ExtractJsonDouble(sub, fieldKey);
}
