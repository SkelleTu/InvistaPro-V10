//+------------------------------------------------------------------+
//|                                              InvistaPRO_EA.mq5    |
//|                                 InvistaPRO - Auto-Discovery URL   |
//|   Versão com auto-descoberta de URL — reconecta automaticamente   |
//+------------------------------------------------------------------+
#property copyright "InvistaPRO"
#property version   "3.0"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- Parâmetros de entrada
input string   ServerURL        = "https://9247e7c5-b152-4bc0-9d12-ac9c72dba06a-00-1nke37pzbqles.kirk.replit.dev"; // URL do servidor (atualiza automático)
input string   DiscoveryBlobURL = "https://jsonblob.com/api/jsonBlob/019cf494-e13b-7182-961b-7b8714b6d184"; // URL de descoberta automática (não altere)
input string   ApiToken         = "";          // Token de autenticação (opcional)
input string   Symbol_Override  = "";          // Símbolo (deixe vazio para usar o gráfico atual)
input int      HeartbeatSeconds = 30;          // Intervalo do heartbeat (segundos)
input int      SignalSeconds    = 5;           // Intervalo de busca de sinal (segundos)
input double   LotSize          = 0.01;        // Tamanho do lote
input int      MagicNumber      = 20250315;    // Número mágico
input bool     AutoReconnect    = true;        // Reconexão automática de URL
input int      MaxReconnectTries= 5;           // Tentativas máximas de reconexão

//--- Variáveis globais
string   g_serverUrl    = "";
string   g_discoverUrl  = "";
string   g_symbol       = "";
string   g_apiToken     = "";
datetime g_lastHeartbeat = 0;
datetime g_lastSignal    = 0;
int      g_failCount     = 0;
bool     g_isDiscovering = false;
string   g_pendingSignalId = "";

CTrade trade;

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

   Print("🚀 InvistaPRO EA iniciado | Servidor: ", g_serverUrl);
   Print("📊 Símbolo: ", g_symbol, " | Conta: ", AccountInfoInteger(ACCOUNT_LOGIN));

   // Tenta descobrir URL de descoberta se não configurada
   if (g_discoverUrl == "")
   {
      Print("🔍 Buscando URL de descoberta no servidor...");
      FetchDiscoveryUrl();
   }

   // Primeiro heartbeat imediato
   SendHeartbeat();

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Tick principal                                                    |
//+------------------------------------------------------------------+
void OnTick()
{
   datetime now = TimeCurrent();

   // Heartbeat periódico
   if (now - g_lastHeartbeat >= HeartbeatSeconds)
   {
      g_lastHeartbeat = now;
      if (!SendHeartbeat() && AutoReconnect && !g_isDiscovering)
      {
         TryReconnect();
      }
   }

   // Busca de sinal periódica
   if (now - g_lastSignal >= SignalSeconds)
   {
      g_lastSignal = now;
      FetchAndProcessSignal();
   }
}

//+------------------------------------------------------------------+
//| Busca URL de descoberta no próprio servidor                       |
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
      string body = CharArrayToString(result);
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
      // Tenta ler URL salva localmente
      string saved = LoadDiscoveryUrl();
      if (saved != "") g_discoverUrl = saved;
   }
}

//+------------------------------------------------------------------+
//| Tentativa de reconexão automática via serviço de descoberta       |
//+------------------------------------------------------------------+
bool TryReconnect()
{
   if (g_discoverUrl == "")
   {
      Print("⚠️ URL de descoberta não configurada — impossível reconectar automaticamente");
      return false;
   }

   g_isDiscovering = true;
   g_failCount++;

   if (g_failCount > MaxReconnectTries)
   {
      Print("❌ Máximo de tentativas de reconexão atingido (", MaxReconnectTries, "). Parando.");
      g_isDiscovering = false;
      return false;
   }

   Print("🔄 Tentativa de reconexão ", g_failCount, "/", MaxReconnectTries, " via serviço de descoberta...");

   string headers       = "Content-Type: application/json\r\nAccept: application/json\r\n";
   char   result[];
   string responseHeaders;

   int res = WebRequest("GET", g_discoverUrl, headers, 10000, NULL, result, responseHeaders);

   if (res == 200 && ArraySize(result) > 0)
   {
      string body      = CharArrayToString(result);
      string newUrl    = ExtractJsonString(body, "serverUrl");

      if (newUrl != "" && newUrl != g_serverUrl)
      {
         Print("✅ Nova URL do servidor encontrada: ", newUrl);
         g_serverUrl  = newUrl;
         g_failCount  = 0;
         g_isDiscovering = false;

         // Testa a nova URL
         if (SendHeartbeat())
         {
            Print("🎉 Reconexão bem-sucedida com nova URL!");
            // Atualiza URL de descoberta também
            FetchDiscoveryUrl();
            return true;
         }
         else
         {
            Print("⚠️ Nova URL encontrada mas heartbeat ainda falhou");
         }
      }
      else if (newUrl != "" && newUrl == g_serverUrl)
      {
         Print("ℹ️ URL de descoberta retornou a mesma URL — servidor pode estar temporariamente fora");
         g_failCount = 0;
      }
   }
   else
   {
      Print("⚠️ Falha ao consultar serviço de descoberta: HTTP ", res);
   }

   g_isDiscovering = false;
   return false;
}

//+------------------------------------------------------------------+
//| Envia heartbeat para o servidor                                   |
//+------------------------------------------------------------------+
bool SendHeartbeat()
{
   string url = g_serverUrl + "/api/metatrader/heartbeat";

   string body = "{";
   body += "\"accountId\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   body += "\"broker\":\"" + AccountInfoString(ACCOUNT_COMPANY) + "\",";
   body += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   body += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   body += "\"freeMargin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   body += "\"platform\":\"MT5\"";
   if (g_apiToken != "") body += ",\"token\":\"" + g_apiToken + "\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 5000, postData, result, responseHeaders);

   if (res == 200)
   {
      g_failCount = 0;
      return true;
   }
   else
   {
      Print("⚠️ Heartbeat falhou: ", res);
      return false;
   }
}

//+------------------------------------------------------------------+
//| Busca e processa sinal de trading                                 |
//+------------------------------------------------------------------+
void FetchAndProcessSignal()
{
   string url = g_serverUrl + "/api/metatrader/signal?symbol=" + g_symbol;
   if (g_apiToken != "") url += "&token=" + g_apiToken;

   string headers = "Content-Type: application/json\r\n";
   char   result[];
   string responseHeaders;

   int res = WebRequest("GET", url, headers, 5000, NULL, result, responseHeaders);

   if (res == -1)
   {
      Print("⚠️ Falha ao buscar sinal: HTTP ", res);
      if (AutoReconnect && !g_isDiscovering) TryReconnect();
      return;
   }

   if (res != 200) return;

   string body   = CharArrayToString(result);
   string action = ExtractJsonString(body, "action");

   if (action == "" || action == "HOLD") return;

   string signalId    = ExtractJsonString(body, "id");
   double lotSize     = ExtractJsonDouble(body, "lotSize");
   double stopLoss    = ExtractJsonDouble(body, "stopLoss");
   double takeProfit  = ExtractJsonDouble(body, "takeProfit");
   double confidence  = ExtractJsonDouble(body, "confidence");

   if (lotSize <= 0) lotSize = LotSize;
   if (signalId == g_pendingSignalId) return;

   //--- Crash/Boom: operar sem SL e TP (spikes pulam stops — proteção não funciona)
   string symUpper = g_symbol;
   StringToUpper(symUpper);
   bool isSpikeIndex = (StringFind(symUpper, "CRASH") >= 0 || StringFind(symUpper, "BOOM") >= 0);

   if(isSpikeIndex)
   {
      stopLoss   = 0;
      takeProfit = 0;
      Print("ℹ️ Crash/Boom detectado — operando sem SL/TP (spikes ignoram stops)");
   }
   else
   {
      //--- Outros símbolos: respeitar distância mínima exigida pelo broker
      double ask        = SymbolInfoDouble(g_symbol, SYMBOL_ASK);
      double bid        = SymbolInfoDouble(g_symbol, SYMBOL_BID);
      double point      = SymbolInfoDouble(g_symbol, SYMBOL_POINT);
      long   stopsLevel = SymbolInfoInteger(g_symbol, SYMBOL_TRADE_STOPS_LEVEL);
      double minDist    = MathMax((double)stopsLevel * point, (ask - bid) * 3.0);
      if(minDist <= 0) minDist = ask * 0.005;

      if(action == "BUY")
      {
         double entry = ask;
         if(stopLoss > 0 && (entry - stopLoss) < minDist)
            stopLoss = NormalizeDouble(entry - minDist, _Digits);
         if(takeProfit > 0 && (takeProfit - entry) < minDist)
            takeProfit = NormalizeDouble(entry + minDist, _Digits);
      }
      else if(action == "SELL")
      {
         double entry = bid;
         if(stopLoss > 0 && (stopLoss - entry) < minDist)
            stopLoss = NormalizeDouble(entry + minDist, _Digits);
         if(takeProfit > 0 && (entry - takeProfit) < minDist)
            takeProfit = NormalizeDouble(entry - minDist, _Digits);
      }
   }

   Print("📡 Sinal recebido: ", action, " | Confiança: ", confidence, "% | Lot: ", lotSize,
         " | SL: ", stopLoss, " | TP: ", takeProfit);
   g_pendingSignalId = signalId;

   bool success = false;

   if (action == "BUY")
   {
      success = trade.Buy(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);
   }
   else if (action == "SELL")
   {
      success = trade.Sell(lotSize, g_symbol, 0, stopLoss, takeProfit, "InvistaPRO_" + signalId);
   }

   if (success)
   {
      Print("✅ Ordem executada: ", action, " | Ticket: ", trade.ResultOrder());
      ConfirmTradeOpen(signalId, (int)trade.ResultOrder(), action, lotSize, stopLoss, takeProfit);
   }
   else
   {
      Print("❌ Falha ao executar ordem: ", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Envia candles de mercado para o servidor                          |
//+------------------------------------------------------------------+
void SendMarketData()
{
   string url = g_serverUrl + "/api/metatrader/market-data";

   MqlRates rates[];
   int copied = CopyRates(g_symbol, PERIOD_M1, 0, 200, rates);
   if (copied <= 0) return;

   string body = "{\"symbol\":\"" + g_symbol + "\",\"candles\":[";
   for (int i = 0; i < copied; i++)
   {
      if (i > 0) body += ",";
      body += "{";
      body += "\"time\":" + IntegerToString(rates[i].time) + ",";
      body += "\"open\":" + DoubleToString(rates[i].open, _Digits) + ",";
      body += "\"high\":" + DoubleToString(rates[i].high, _Digits) + ",";
      body += "\"low\":" + DoubleToString(rates[i].low, _Digits) + ",";
      body += "\"close\":" + DoubleToString(rates[i].close, _Digits) + ",";
      body += "\"volume\":" + IntegerToString(rates[i].tick_volume);
      body += "}";
   }
   body += "]}";

   string headers = "Content-Type: application/json\r\n";
   char   postData[], result[];
   StringToCharArray(body, postData, 0, StringLen(body));
   string responseHeaders;

   int res = WebRequest("POST", url, headers, 10000, postData, result, responseHeaders);

   if (res == 200)
      Print("📊 Dados enviados: ", copied, " candles de ", g_symbol);
   else
      Print("⚠️ Falha ao enviar dados: HTTP ", res);
}

//+------------------------------------------------------------------+
//| Confirma abertura de trade no servidor                            |
//+------------------------------------------------------------------+
void ConfirmTradeOpen(string signalId, int ticket, string type, double lots, double sl, double tp)
{
   string url = g_serverUrl + "/api/metatrader/trade/open";

   string body = "{";
   body += "\"ticket\":" + IntegerToString(ticket) + ",";
   body += "\"symbol\":\"" + g_symbol + "\",";
   body += "\"type\":\"" + type + "\",";
   body += "\"lots\":" + DoubleToString(lots, 2) + ",";
   body += "\"openPrice\":" + DoubleToString(SymbolInfoDouble(g_symbol, SYMBOL_BID), _Digits) + ",";
   body += "\"stopLoss\":" + DoubleToString(sl, _Digits) + ",";
   body += "\"takeProfit\":" + DoubleToString(tp, _Digits) + ",";
   body += "\"openTime\":" + IntegerToString(TimeCurrent()) + ",";
   body += "\"signalId\":\"" + signalId + "\"";
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
   if (handle != INVALID_HANDLE)
   {
      FileWriteString(handle, url);
      FileClose(handle);
   }
}

//+------------------------------------------------------------------+
//| Carrega URL de descoberta salva localmente                        |
//+------------------------------------------------------------------+
string LoadDiscoveryUrl()
{
   string url    = "";
   int    handle = FileOpen("InvistaPRO_DiscoveryURL.txt", FILE_READ | FILE_TXT | FILE_COMMON);
   if (handle != INVALID_HANDLE)
   {
      url = FileReadString(handle);
      FileClose(handle);
      if (url != "") Print("📂 URL de descoberta carregada do arquivo: ", url);
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
//| Desinicialização                                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("🛑 InvistaPRO EA encerrado. Razão: ", reason);
}
//+------------------------------------------------------------------+
