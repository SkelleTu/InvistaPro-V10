//+------------------------------------------------------------------+
//| InvistaPRO Price Action EA                                       |
//| Corretora-neutro: opera exclusivamente o simbolo do grafico MT5  |
//| Independente do EA Girassol.                                     |
//+------------------------------------------------------------------+
#property strict
#property version   "1.0"
#property description "InvistaPRO Price Action multi-timeframe EA - broker neutral"

#include <Trade/Trade.mqh>

input string InpServerURL = "https://invista-pro-v10-kzlv.onrender.com";
input string InpApiToken = "";
input bool   InpRequireAIApproval = true;
input double InpRiskPercent = 1.0;
input double InpMaxStopPercent = 1.5;
input double InpMinimumRR = 2.0;
input int    InpMagic = 26110201;
input int    InpMaxSpreadPoints = 0; // 0 = automatic ATR-based spread cap
input int    InpMaxTradesPerDay = 3;
input int    InpMaxConsecutiveLosses = 2;
input int    InpPauseMinutesAfterLosses = 60;
input double InpDailyLossLimitPercent = 3.0;
input int    InpDeviationPoints = 30;
input int    InpHeartbeatSeconds = 30;
input bool   InpUseSessionFilter = false; // Crypto trades 24/7; enable only if desired

CTrade trade;
datetime g_lastM5Bar = 0;
datetime g_lastM1Bar = 0;
datetime g_lastHeartbeat = 0;
datetime g_lastPositionAIReview = 0;
double g_lastPositionAIReference = 0;
ulong g_lastPositionTicket = 0;
datetime g_pauseUntil = 0;
datetime g_dayStart = 0;
double g_dayStartEquity = 0;
int g_tradesToday = 0;
int g_consecutiveLosses = 0;
datetime g_approvedPatternTime = 0;
int g_approvedSide = 0; // 1 buy, -1 sell
double g_approvedTrigger = 0;
double g_approvedInvalidation = 0;
bool g_aiUnavailable = false;

struct Setup {
   int side;
   double entry;
   double stop;
   double target;
   double rr;
   datetime patternTime;
};

bool IsDemoAccount() {
   return (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO;
}

bool IsNewBar(ENUM_TIMEFRAMES tf, datetime &last) {
   datetime t[1];
   if(CopyTime(_Symbol, tf, 0, 1, t) != 1) return false;
   if(t[0] == last) return false;
   last = t[0];
   return true;
}

bool GetRates(ENUM_TIMEFRAMES tf, int count, MqlRates &rates[]) {
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, tf, 1, count, rates); // closed candles only
   if(copied < count) return false;
   for(int i=0;i<count;i++) {
      if(rates[i].time <= 0 || rates[i].high < rates[i].low ||
         rates[i].open <= 0 || rates[i].close <= 0 || rates[i].tick_volume < 0)
         return false;
   }
   return true;
}

double EMA(ENUM_TIMEFRAMES tf, int period, int shift) {
   int h=iMA(_Symbol,tf,period,0,MODE_EMA,PRICE_CLOSE);
   if(h==INVALID_HANDLE) return 0;
   double b[];
   ArraySetAsSeries(b,true);
   int n=CopyBuffer(h,0,shift,1,b);
   IndicatorRelease(h);
   return n==1 ? b[0] : 0;
}

int Trend(ENUM_TIMEFRAMES tf) {
   double fast=EMA(tf,20,1), slow=EMA(tf,50,1), fastOld=EMA(tf,20,5);
   if(fast<=0 || slow<=0 || fastOld<=0) return 0;
   if(fast>slow && fast>fastOld) return 1;
   if(fast<slow && fast<fastOld) return -1;
   return 0;
}

double ATR(ENUM_TIMEFRAMES tf, int period=14) {
   int h=iATR(_Symbol,tf,period);
   if(h==INVALID_HANDLE) return 0;
   double b[];
   ArraySetAsSeries(b,true);
   int n=CopyBuffer(h,0,1,1,b);
   IndicatorRelease(h);
   return n==1 ? b[0] : 0;
}

bool Pattern(ENUM_TIMEFRAMES tf, int &side, double &trigger, double &invalidation, datetime &patternTime) {
   MqlRates r[];
   if(!GetRates(tf,4,r)) return false;
   // r[0] latest closed, r[1] pattern, r[2] prior
   MqlRates p=r[1], prior=r[2], last=r[0];
   double range=p.high-p.low;
   if(range<=0) return false;
   double body=MathAbs(p.close-p.open);
   double lower=MathMin(p.open,p.close)-p.low;
   double upper=p.high-MathMax(p.open,p.close);
   bool bullEngulf=p.close>p.open && prior.close<prior.open && p.open<=prior.close && p.close>=prior.open;
   bool bearEngulf=p.close<p.open && prior.close>prior.open && p.open>=prior.close && p.close<=prior.open;
   bool bullPin=p.close>p.open && lower/range>=0.55 && body/range>=0.12;
   bool bearPin=p.close<p.open && upper/range>=0.55 && body/range>=0.12;
   bool inside=p.high<prior.high && p.low>prior.low;
   int t=Trend(PERIOD_H1);
   if((bullEngulf || bullPin || inside) && last.close<=p.high && (t==1 || t==0)) {
      side=1; trigger=p.high; invalidation=p.low; patternTime=p.time; return true;
   }
   if((bearEngulf || bearPin || inside) && last.close>=p.low && (t==-1 || t==0)) {
      side=-1; trigger=p.low; invalidation=p.high; patternTime=p.time; return true;
   }
   return false;
}

bool NearM15Zone(int side, double price) {
   MqlRates r[];
   if(!GetRates(PERIOD_M15,30,r)) return false;
   double lo=r[1].low, hi=r[1].high;
   for(int i=2;i<21;i++) { lo=MathMin(lo,r[i].low); hi=MathMax(hi,r[i].high); }
   double atr=ATR(PERIOD_M15);
   if(atr<=0) return false;
   double boundary=side==1 ? lo : hi;
   return MathAbs(price-boundary)<=atr*0.35;
}

bool RelativeVolume(ENUM_TIMEFRAMES tf) {
   MqlRates r[];
   if(!GetRates(tf,25,r)) return false;
   double avg=0;
   for(int i=1;i<=20;i++) avg+=(double)r[i].tick_volume;
   avg/=20.0;
   return avg>0 && (double)r[0].tick_volume>=avg;
}

string FrameJSON(ENUM_TIMEFRAMES tf) {
   MqlRates r[];
   if(!GetRates(tf,60,r)) return "";
   string s="[";
   for(int i=59;i>=0;i--) {
      if(i<59) s+=",";
      s+=StringFormat("{\"time\":%I64d,\"open\":%.10f,\"high\":%.10f,\"low\":%.10f,\"close\":%.10f,\"volume\":%I64d}",
         (long)r[i].time,r[i].open,r[i].high,r[i].low,r[i].close,(long)r[i].tick_volume);
   }
   return s+"]";
}

string JsonString(string body,string key) {
   string k="\""+key+"\"";
   int p=StringFind(body,k);
   if(p<0) return "";
   p=StringFind(body,":",p+StringLen(k));
   if(p<0) return "";
   p++;
   while(p<StringLen(body) && (StringGetCharacter(body,p)==' ' || StringGetCharacter(body,p)=='\"')) p++;
   int e=StringFind(body,"\"",p);
   if(e<0) return "";
   return StringSubstr(body,p,e-p);
}

bool RequestAIReview(int side,double trigger,double invalidation,datetime patternTime) {
   if(!InpRequireAIApproval) return true;
   string h4=FrameJSON(PERIOD_H4),h1=FrameJSON(PERIOD_H1),m15=FrameJSON(PERIOD_M15),
          m5=FrameJSON(PERIOD_M5),m1=FrameJSON(PERIOD_M1);
   if(h4=="" || h1=="" || m15=="" || m5=="" || m1=="") { g_aiUnavailable=true; return false; }
   string direction=side==1 ? "BUY" : "SELL";
   string body="{\"token\":\""+InpApiToken+"\",\"symbol\":\""+_Symbol+"\",\"phase\":\"ENTRY\",";
   body+="\"direction\":\""+direction+"\",\"triggerPrice\":"+DoubleToString(trigger,_Digits)+",";
   body+="\"invalidationPrice\":"+DoubleToString(invalidation,_Digits)+",\"patternTime\":"+(string)(long)patternTime+",";
   body+="\"frames\":{\"H4\":"+h4+",\"H1\":"+h1+",\"M15\":"+m15+",\"M5\":"+m5+",\"M1\":"+m1+"}}";
   char data[],result[];
   string headers="Content-Type: application/json\r\n";
   StringToCharArray(body,data,0,StringLen(body),CP_UTF8);
   string responseHeaders;
   int code=WebRequest("POST",InpServerURL+"/api/mt5/price-action/review",headers,25000,data,result,responseHeaders);
   if(code!=200) { g_aiUnavailable=true; Print("Price Action AI indisponivel: HTTP ",code); return false; }
   string response=CharArrayToString(result,0,-1,CP_UTF8);
   bool approved=JsonString(response,"decision")=="APPROVE" && JsonString(response,"direction")==direction;
   g_aiUnavailable=!approved;
   return approved;
}

double JsonNumber(string body,string key) {
   string k="\""+key+"\"";
   int p=StringFind(body,k);
   if(p<0) return 0;
   p=StringFind(body,":",p+StringLen(k));
   if(p<0) return 0;
   p++;
   while(p<StringLen(body) && StringGetCharacter(body,p)==' ') p++;
   int e=p;
   while(e<StringLen(body)) {
      ushort ch=StringGetCharacter(body,e);
      if((ch>='0' && ch<='9') || ch=='-' || ch=='.' || ch=='e' || ch=='E' || ch=='+') e++;
      else break;
   }
   if(e<=p) return 0;
   return StringToDouble(StringSubstr(body,p,e-p));
}

void ReviewOpenPositionAI() {
   if(!InpRequireAIApproval || !PositionSelect(_Symbol)) return;
   if((long)PositionGetInteger(POSITION_MAGIC)!=InpMagic) return;
   ulong ticket=(ulong)PositionGetInteger(POSITION_TICKET);
   long type=PositionGetInteger(POSITION_TYPE);
   int side=type==POSITION_TYPE_BUY ? 1 : -1;
   double currentStop=PositionGetDouble(POSITION_SL);
   double takeProfit=PositionGetDouble(POSITION_TP);
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   double currentPrice=side==1 ? tick.bid : tick.ask;
   double atr=ATR(PERIOD_M15);
   bool newPosition=ticket!=g_lastPositionTicket;
   bool material=newPosition || g_lastPositionAIReference<=0 ||
      (atr>0 && MathAbs(currentPrice-g_lastPositionAIReference)>=atr*0.5);
   bool heartbeat=(TimeCurrent()-g_lastPositionAIReview)>=900;
   if(!material && !heartbeat) return;

   // Rate-limit before the network call; a failed model request must not create a retry storm.
   g_lastPositionTicket=ticket;
   g_lastPositionAIReview=TimeCurrent();
   g_lastPositionAIReference=currentPrice;

   string h4=FrameJSON(PERIOD_H4),h1=FrameJSON(PERIOD_H1),m15=FrameJSON(PERIOD_M15),
          m5=FrameJSON(PERIOD_M5),m1=FrameJSON(PERIOD_M1);
   if(h4=="" || h1=="" || m15=="" || m5=="" || m1=="") return;
   string direction=side==1 ? "BUY" : "SELL";
   string body="{\"token\":\""+InpApiToken+"\",\"symbol\":\""+_Symbol+"\",\"phase\":\"POSITION\",";
   body+="\"direction\":\""+direction+"\",\"currentPrice\":"+DoubleToString(currentPrice,_Digits)+",";
   body+="\"currentStop\":"+DoubleToString(currentStop,_Digits)+",\"takeProfit\":"+DoubleToString(takeProfit,_Digits)+",";
   body+="\"lastMaterialEventAt\":"+(string)(long)TimeCurrent()+",";
   body+="\"frames\":{\"H4\":"+h4+",\"H1\":"+h1+",\"M15\":"+m15+",\"M5\":"+m5+",\"M1\":"+m1+"}}";
   char data[],result[]; StringToCharArray(body,data,0,StringLen(body),CP_UTF8);
   string headers="Content-Type: application/json\r\n",responseHeaders;
   int code=WebRequest("POST",InpServerURL+"/api/mt5/price-action/review",headers,25000,data,result,responseHeaders);
   if(code!=200) { Print("AI position review indisponivel; protecao local mantida. HTTP ",code); return; }
   string response=CharArrayToString(result,0,-1,CP_UTF8);
   double confidence=JsonNumber(response,"confidence");
   if(confidence<0.80 || confidence>1.0) return;
   string action=JsonString(response,"action");
   if(action=="MOVE_STOP") {
      double proposed=JsonNumber(response,"proposedStop");
      bool tighter=side==1 ? proposed>=currentStop && proposed<currentPrice
                           : proposed<=currentStop && proposed>currentPrice;
      if(tighter && proposed>0) {
         proposed=NormalizeDouble(proposed,_Digits);
         if(trade.PositionModify(_Symbol,proposed,takeProfit))
            Print("IA apertou stop protetivo. Stop nunca e ampliado.");
      }
   } else if(action=="TAKE_PARTIAL") {
      string key="PA_PARTIAL_"+(string)ticket;
      if(!GlobalVariableCheck(key) && PositionSelect(_Symbol)) {
         double volume=PositionGetDouble(POSITION_VOLUME);
         double partial=NormalizeVolume(volume*0.5);
         if(partial>0 && partial<volume && trade.PositionClosePartial(_Symbol,partial))
            GlobalVariableSet(key,1.0);
      }
   } else if(action=="CLOSE") {
      string reason=JsonString(response,"closeReason");
      if(StringLen(reason)>0 && PositionSelect(_Symbol))
         if(trade.PositionClose(_Symbol)) Print("IA recomendou encerramento: ",reason);
   }
}

bool DailyRiskAllowed() {
   datetime now=TimeCurrent();
   MqlDateTime d; TimeToStruct(now,d); d.hour=0; d.min=0; d.sec=0;
   datetime start=StructToTime(d);
   if(start!=g_dayStart) {
      g_dayStart=start; g_dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);
      g_tradesToday=0; g_consecutiveLosses=0; g_pauseUntil=0;
   }
   if(TimeCurrent()<g_pauseUntil || g_tradesToday>=InpMaxTradesPerDay) return false;
   if(g_dayStartEquity<=0) return false;
   double dd=(g_dayStartEquity-AccountInfoDouble(ACCOUNT_EQUITY))/g_dayStartEquity*100.0;
   return dd<InpDailyLossLimitPercent && g_consecutiveLosses<InpMaxConsecutiveLosses;
}

bool SpreadAllowed() {
   MqlTick t;
   if(!SymbolInfoTick(_Symbol,t) || t.ask<=t.bid || t.bid<=0) return false;
   double cap=InpMaxSpreadPoints>0 ? InpMaxSpreadPoints*_Point : ATR(PERIOD_M15)*0.08;
   return cap>0 && (t.ask-t.bid)<=cap;
}

double NormalizeVolume(double volume) {
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double minv=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxv=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   if(step<=0 || minv<=0 || maxv<minv) return 0;
   volume=MathFloor(volume/step)*step;
   if(volume<minv) return 0;
   volume=MathMin(volume,maxv);
   return NormalizeDouble(volume,8);
}

double RiskVolume(int side,double entry,double stop) {
   double riskMoney=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double pnl=0;
   ENUM_ORDER_TYPE type=side==1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcProfit(type,_Symbol,1.0,entry,stop,pnl)) return 0;
   double lossPerLot=MathAbs(pnl);
   if(lossPerLot<=0) return 0;
   return NormalizeVolume(riskMoney/lossPerLot);
}

bool BuildSetup(int side,double trigger,Setup &s) {
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick)) return false;
   double entry=side==1 ? tick.ask : tick.bid;
   MqlRates r[];
   if(!GetRates(PERIOD_M15,30,r)) return false;
   double swing=side==1 ? r[1].low : r[1].high;
   for(int i=2;i<15;i++) swing=side==1 ? MathMin(swing,r[i].low) : MathMax(swing,r[i].high);
   double atr=ATR(PERIOD_M15);
   if(atr<=0) return false;
   double stop=side==1 ? swing-atr*0.15 : swing+atr*0.15;
   double risk=MathAbs(entry-stop);
   if(risk<=0 || risk/entry*100.0>InpMaxStopPercent) return false;
   double target=side==1 ? entry+risk*InpMinimumRR : entry-risk*InpMinimumRR;
   double cost=2.0*(tick.ask-tick.bid);
   double reward=MathAbs(target-entry)-cost;
   double netRisk=risk+cost;
   if(reward<=0 || reward/netRisk<InpMinimumRR) return false;
   int stops=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   if(MathAbs(entry-stop)<stops*_Point || MathAbs(target-entry)<stops*_Point) return false;
   s.side=side; s.entry=entry; s.stop=NormalizeDouble(stop,_Digits);
   s.target=NormalizeDouble(target,_Digits); s.rr=reward/netRisk;
   return true;
}

bool ExecuteSetup(Setup &s) {
   if(!SpreadAllowed() || !DailyRiskAllowed()) return false;
   double volume=RiskVolume(s.side,s.entry,s.stop);
   if(volume<=0) { Print("Lote abaixo do minimo ou risco nao calculavel. Entrada bloqueada."); return false; }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   bool ok=s.side==1 ? trade.Buy(volume,_Symbol,0,s.stop,s.target,"InvistaPRO PA")
                     : trade.Sell(volume,_Symbol,0,s.stop,s.target,"InvistaPRO PA");
   if(!ok || (trade.ResultRetcode()!=TRADE_RETCODE_DONE && trade.ResultRetcode()!=TRADE_RETCODE_PLACED)) {
      Print("Ordem rejeitada: ",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
      return false;
   }
   g_tradesToday++;
   Print("Price Action executado: ",s.side==1?"BUY":"SELL"," ",_Symbol," volume=",volume,
         " SL=",s.stop," TP=",s.target," RR=",DoubleToString(s.rr,2));
   return true;
}

void ManageOpenPosition() {
   if(!PositionSelect(_Symbol)) return;
   if((long)PositionGetInteger(POSITION_MAGIC)!=InpMagic) return;
   long type=PositionGetInteger(POSITION_TYPE);
   int side=type==POSITION_TYPE_BUY ? 1 : -1;
   double open=PositionGetDouble(POSITION_PRICE_OPEN);
   double stop=PositionGetDouble(POSITION_SL);
   double target=PositionGetDouble(POSITION_TP);
   double volume=PositionGetDouble(POSITION_VOLUME);
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   double price=side==1 ? tick.bid : tick.ask;
   double risk=MathAbs(open-stop);
   if(risk<=0) return;
   double rNow=(side==1 ? price-open : open-price)/risk;
   if(rNow>=1.0) {
      double be=NormalizeDouble(open,_Digits);
      bool tighter=side==1 ? be>stop : stop==0 || be<stop;
      if(tighter) trade.PositionModify(_Symbol,be,target);
   }
   if(rNow>=1.5 && volume>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)*1.5) {
      double closeVol=NormalizeVolume(volume*0.5);
      if(closeVol>0 && closeVol<volume) trade.PositionClosePartial(_Symbol,closeVol);
   }
   // Trailing only tightens behind confirmed closed M15 swing points.
   if(rNow>=2.0) {
      MqlRates r[];
      if(GetRates(PERIOD_M15,8,r)) {
         double candidate=side==1 ? r[1].low : r[1].high;
         for(int i=2;i<6;i++) candidate=side==1 ? MathMin(candidate,r[i].low) : MathMax(candidate,r[i].high);
         candidate=NormalizeDouble(candidate,_Digits);
         bool tighter=side==1 ? candidate>stop && candidate<price : candidate<stop && candidate>price;
         if(tighter) trade.PositionModify(_Symbol,candidate,target);
      }
   }
}

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result) {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if((long)HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=InpMagic) return;
   if((long)HistoryDealGetInteger(trans.deal,DEAL_ENTRY)!=DEAL_ENTRY_OUT) return;
   double pnl=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)+HistoryDealGetDouble(trans.deal,DEAL_SWAP)+HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
   if(pnl<0) { g_consecutiveLosses++; if(g_consecutiveLosses>=InpMaxConsecutiveLosses) g_pauseUntil=TimeCurrent()+InpPauseMinutesAfterLosses*60; }
   else if(pnl>0) g_consecutiveLosses=0;
}

void OnInitHeartbeat() {
   if(InpHeartbeatSeconds<=0 || TimeCurrent()-g_lastHeartbeat<InpHeartbeatSeconds) return;
   g_lastHeartbeat=TimeCurrent();
   // Heartbeat endpoint is informational; no market or execution decision depends on it.
   string body="{\"token\":\""+InpApiToken+"\",\"symbol\":\""+_Symbol+"\",\"broker\":\""+AccountInfoString(ACCOUNT_COMPANY)+"\",\"accountType\":\""+(IsDemoAccount()?"demo":"real")+"\"}";
   char data[],result[]; StringToCharArray(body,data,0,StringLen(body),CP_UTF8);
   string headers="Content-Type: application/json\r\n",rh;
   WebRequest("POST",InpServerURL+"/api/mt5/price-action/heartbeat",headers,5000,data,result,rh);
}

int OnInit() {
   if(InpRiskPercent<=0 || InpRiskPercent>2.0 || InpMaxStopPercent<=0 || InpMaxStopPercent>1.5 || InpMinimumRR<2.0) {
      Print("Configuracao de risco invalida. EA bloqueado."); return INIT_PARAMETERS_INCORRECT;
   }
   if(!IsDemoAccount()) {
      Print("Conta nao-DEMO bloqueada nesta versao de validacao. Use uma conta DEMO MT5."); return INIT_FAILED;
   }
   if(!SymbolSelect(_Symbol,true)) return INIT_FAILED;
   trade.SetExpertMagicNumber(InpMagic);
   g_lastM5Bar=iTime(_Symbol,PERIOD_M5,0);
   g_lastM1Bar=iTime(_Symbol,PERIOD_M1,0);
   EventSetTimer(1);
   Print("InvistaPRO Price Action EA v1.0 iniciado. Broker-neutral | Simbolo do grafico: ",_Symbol);
   Print("Sem dependencia de Binance/Deriv. Timeframes: H4/H1/M15/M5/M1.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() {
   OnInitHeartbeat();
   ManageOpenPosition();
   ReviewOpenPositionAI();
}

void OnTick() {
   ManageOpenPosition();
   if(!IsNewBar(PERIOD_M5,g_lastM5Bar)) return;
   if(!DailyRiskAllowed() || !SpreadAllowed() || PositionSelect(_Symbol)) return;
   int t4=Trend(PERIOD_H4),t1=Trend(PERIOD_H1);
   if(t4==0 || t4!=t1) { g_approvedPatternTime=0; return; }

   // Approved setup is checked first on the next closed candle.
   if(g_approvedPatternTime>0) {
      if(t4!=g_approvedSide) { g_approvedPatternTime=0; return; }
      MqlRates confirm[];
      if(!GetRates(PERIOD_M5,2,confirm)) { g_approvedPatternTime=0; return; }
      bool invalidated=g_approvedSide==1 ? confirm[0].low<g_approvedInvalidation
                                         : confirm[0].high>g_approvedInvalidation;
      if(invalidated) { g_approvedPatternTime=0; return; }
      bool broken=g_approvedSide==1 ? confirm[0].close>g_approvedTrigger
                                    : confirm[0].close<g_approvedTrigger;
      if(!broken) return;
      MqlTick current;
      if(!SymbolInfoTick(_Symbol,current)) return;
      double reference=g_approvedSide==1 ? current.ask : current.bid;
      if(!NearM15Zone(g_approvedSide,reference) || !RelativeVolume(PERIOD_M5)) {
         g_approvedPatternTime=0; return;
      }
      Setup approvedSetup;
      if(!BuildSetup(g_approvedSide,g_approvedTrigger,approvedSetup)) {
         g_approvedPatternTime=0; return;
      }
      approvedSetup.patternTime=g_approvedPatternTime;
      g_approvedPatternTime=0;
      ExecuteSetup(approvedSetup);
      return;
   }

   int side=0; double trigger=0,invalidation=0; datetime pt=0;
   if(!Pattern(PERIOD_M5,side,trigger,invalidation,pt) || side!=t4) return;
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   double ref=side==1 ? tick.ask : tick.bid;
   if(!NearM15Zone(side,ref) || !RelativeVolume(PERIOD_M5)) return;
   if(!RequestAIReview(side,trigger,invalidation,pt)) {
      Print("Pre-gatilho sem aprovacao IA. Nenhuma entrada.");
      return;
   }
   g_approvedPatternTime=pt; g_approvedSide=side;
   g_approvedTrigger=trigger; g_approvedInvalidation=invalidation;
   Print("Pre-gatilho aprovado. Aguardando rompimento fechado.");
}
