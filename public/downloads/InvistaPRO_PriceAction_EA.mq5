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
input double InpRiskPercent = 1.0;
input double InpMaxStopPercent = 1.5;
input double InpMinimumRR = 2.0;
input double InpEstimatedRoundTripCostPercent = 0.15; // broker-specific fee + slippage estimate
input int    InpMagic = 26110201;
input int    InpMaxSpreadPoints = 0; // 0 = automatic ATR-based spread cap
input int    InpMaxTradesPerDay = 3;
input int    InpMaxConsecutiveLosses = 2;
input int    InpMaxLosingTradesPerDay = 3;
input int    InpPauseMinutesAfterLosses = 60;
input double InpDailyLossLimitPercent = 3.0;
input int    InpDeviationPoints = 30;
input int    InpMaxSlippagePoints = 0; // 0 = automatic ATR-based limit
input double InpMarginReserveMultiplier = 1.5;
input int    InpHeartbeatSeconds = 30;

CTrade trade;
datetime g_lastM5Bar = 0;
datetime g_lastHeartbeat = 0;
datetime g_lastPositionAIReview = 0;
double g_lastPositionAIReference = 0;
ulong g_lastPositionTicket = 0;
datetime g_pauseUntil = 0;
datetime g_dayStart = 0;
double g_dailyLockToken = 0.0;
double g_dayStartEquity = 0;
int g_tradesToday = 0;
int g_consecutiveLosses = 0;
int g_losingTradesToday = 0;
datetime g_approvedPatternTime = 0;
int g_approvedSide = 0; // 1 buy, -1 sell
double g_approvedTrigger = 0;
double g_approvedInvalidation = 0;

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

bool TrendDataReady(ENUM_TIMEFRAMES tf) {
   return EMA(tf,20,1)>0 && EMA(tf,50,1)>0 && EMA(tf,20,5)>0;
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
   bool insideBull=inside && p.close>(prior.high+prior.low)*0.5;
   bool insideBear=inside && p.close<(prior.high+prior.low)*0.5;
   int t=Trend(PERIOD_H1);
   if((bullEngulf || bullPin || insideBull) && last.close<=p.high && (t==1 || t==0)) {
      side=1; trigger=p.high; invalidation=p.low; patternTime=p.time; return true;
   }
   if((bearEngulf || bearPin || insideBear) && last.close>=p.low && (t==-1 || t==0)) {
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

bool HasLiquiditySweep(int side) {
   MqlRates r[];
   if(!GetRates(PERIOD_M15,22,r)) return false;
   double priorLow=r[1].low, priorHigh=r[1].high;
   for(int i=2;i<=20;i++) { priorLow=MathMin(priorLow,r[i].low); priorHigh=MathMax(priorHigh,r[i].high); }
   return side==1 ? r[0].low<priorLow && r[0].close>priorLow
                  : r[0].high>priorHigh && r[0].close<priorHigh;
}

bool HasFVGConfluence(int side,double price) {
   MqlRates r[];
   if(!GetRates(PERIOD_M15,25,r)) return false;
   double atr=ATR(PERIOD_M15);
   if(atr<=0) return false;
   for(int i=0;i<10;i++) {
      double zoneLow=0,zoneHigh=0;
      bool valid=side==1 ? r[i].low>r[i+2].high : r[i].high<r[i+2].low;
      if(!valid) continue;
      if(side==1) { zoneLow=r[i+2].high; zoneHigh=r[i].low; }
      else { zoneLow=r[i].high; zoneHigh=r[i+2].low; }
      if(price>=zoneLow-atr*0.25 && price<=zoneHigh+atr*0.25) return true;
   }
   return false;
}

bool HasOrderBlockConfluence(int side,double price) {
   MqlRates r[];
   if(!GetRates(PERIOD_M15,25,r)) return false;
   double avgRange=0;
   for(int j=2;j<22;j++) avgRange+=r[j].high-r[j].low;
   avgRange/=20.0;
   if(avgRange<=0) return false;
   double tolerance=ATR(PERIOD_M15)*0.25;
   if(tolerance<=0) return false;
   for(int i=0;i<10;i++) {
      MqlRates candidate=r[i+1], impulse=r[i];
      bool opposite=side==1 ? candidate.close<candidate.open : candidate.close>candidate.open;
      bool displacement=side==1 ? impulse.close>impulse.open : impulse.close<impulse.open;
      if(!opposite || !displacement || MathAbs(impulse.close-impulse.open)<avgRange*1.5) continue;
      double zoneLow=MathMin(candidate.open,candidate.close);
      double zoneHigh=MathMax(candidate.open,candidate.close);
      if(price>=zoneLow-tolerance && price<=zoneHigh+tolerance) return true;
   }
   return false;
}

bool HasChangeOfCharacter(int side) {
   MqlRates r[];
   if(!GetRates(PERIOD_M15,40,r)) return false;
   double highs[2],lows[2];
   int highCount=0,lowCount=0;
   for(int i=2;i<32 && (highCount<2 || lowCount<2);i++) {
      bool pivotHigh=r[i].high>r[i-1].high && r[i].high>r[i-2].high &&
                     r[i].high>=r[i+1].high && r[i].high>=r[i+2].high;
      bool pivotLow=r[i].low<r[i-1].low && r[i].low<r[i-2].low &&
                    r[i].low<=r[i+1].low && r[i].low<=r[i+2].low;
      if(pivotHigh && highCount<2) highs[highCount++]=r[i].high;
      if(pivotLow && lowCount<2) lows[lowCount++]=r[i].low;
   }
   if(highCount<2 || lowCount<2) return false;
   bool priorBearish=highs[1]>highs[0] && lows[1]>lows[0];
   bool priorBullish=highs[1]<highs[0] && lows[1]<lows[0];
   return side==1 ? priorBearish && r[0].close>highs[0]
                  : priorBullish && r[0].close<lows[0];
}

bool HasBreakOfStructure(int side) {
   MqlRates r[];
   if(!GetRates(PERIOD_M15,12,r)) return false;
   double priorHigh=r[1].high, priorLow=r[1].low;
   for(int i=2;i<=10;i++) { priorHigh=MathMax(priorHigh,r[i].high); priorLow=MathMin(priorLow,r[i].low); }
   return side==1 ? r[0].close>priorHigh : r[0].close<priorLow;
}

bool LatestClosedCandleFresh(ENUM_TIMEFRAMES tf) {
   MqlRates latest[];
   if(!GetRates(tf,1,latest)) return false;
   int seconds=PeriodSeconds(tf);
   if(seconds<=0) return false;
   long age=(long)TimeCurrent()-(long)latest[0].time;
   return age>=0 && age<=seconds*3;
}
bool AllFramesFresh() {
   return LatestClosedCandleFresh(PERIOD_H4) && LatestClosedCandleFresh(PERIOD_H1) &&
          LatestClosedCandleFresh(PERIOD_M15) && LatestClosedCandleFresh(PERIOD_M5) &&
          LatestClosedCandleFresh(PERIOD_M1);
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
   if(!AllFramesFresh()) return false;
   string h4=FrameJSON(PERIOD_H4),h1=FrameJSON(PERIOD_H1),m15=FrameJSON(PERIOD_M15),
          m5=FrameJSON(PERIOD_M5),m1=FrameJSON(PERIOD_M1);
   if(h4=="" || h1=="" || m15=="" || m5=="" || m1=="") { return false; }
   string direction=side==1 ? "BUY" : "SELL";
   string body="{\"token\":\""+InpApiToken+"\",\"symbol\":\""+_Symbol+"\",\"phase\":\"ENTRY\",";
   body+="\"direction\":\""+direction+"\",\"triggerPrice\":"+DoubleToString(trigger,_Digits)+",";
   body+="\"invalidationPrice\":"+DoubleToString(invalidation,_Digits)+",\"patternTime\":"+(string)(long)patternTime+",";
   MqlTick marketTick; if(!SymbolInfoTick(_Symbol,marketTick)) return false;
   body+="\"context\":{\"spread\":"+DoubleToString(marketTick.ask-marketTick.bid,_Digits)+",";
   body+="\"brokerUtcOffsetSeconds\":"+(string)(long)(TimeCurrent()-TimeGMT())+",";
   body+="\"riskPercent\":"+DoubleToString(InpRiskPercent,2)+",\"maxStopPercent\":"+DoubleToString(InpMaxStopPercent,2)+",\"marketRegime\":\""+(Trend(PERIOD_H4)==0?"RANGE":"TREND")+"\",";
   body+="\"estimatedRoundTripCostPercent\":"+DoubleToString(InpEstimatedRoundTripCostPercent,3)+",";
   body+="\"accountEquity\":"+DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2)+",";
   body+="\"freeMargin\":"+DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE),2)+",";
   double confluencePrice=side==1 ? marketTick.ask : marketTick.bid;
   body+="\"liquiditySweep\":"+(HasLiquiditySweep(side)?"true":"false")+",";
   body+="\"fvgConfluence\":"+(HasFVGConfluence(side,confluencePrice)?"true":"false")+",";
   body+="\"orderBlockConfluence\":"+(HasOrderBlockConfluence(side,confluencePrice)?"true":"false")+",";
   body+="\"breakOfStructure\":"+(HasBreakOfStructure(side)?"true":"false")+",";
   body+="\"changeOfCharacter\":"+(HasChangeOfCharacter(side)?"true":"false")+",";
   body+="\"tradesToday\":"+(string)g_tradesToday+",\"consecutiveLosses\":"+(string)g_consecutiveLosses+"},";
   body+="\"frames\":{\"H4\":"+h4+",\"H1\":"+h1+",\"M15\":"+m15+",\"M5\":"+m5+",\"M1\":"+m1+"}}";
   char data[],result[];
   string headers="Content-Type: application/json\r\n";
   StringToCharArray(body,data,0,StringLen(body),CP_UTF8);
   string responseHeaders;
   int code=WebRequest("POST",InpServerURL+"/api/mt5/price-action/review",headers,25000,data,result,responseHeaders);
   if(code!=200) { Print("Price Action AI indisponivel: HTTP ",code); return false; }
   string response=CharArrayToString(result,0,-1,CP_UTF8);
   bool approved=JsonString(response,"decision")=="APPROVE" && JsonString(response,"direction")==direction;
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
   if(!PositionSelect(_Symbol)) return;
   if((long)PositionGetInteger(POSITION_MAGIC)!=InpMagic) return;
   ulong ticket=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
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

   if(!AllFramesFresh()) return;
   string h4=FrameJSON(PERIOD_H4),h1=FrameJSON(PERIOD_H1),m15=FrameJSON(PERIOD_M15),
          m5=FrameJSON(PERIOD_M5),m1=FrameJSON(PERIOD_M1);
   if(h4=="" || h1=="" || m15=="" || m5=="" || m1=="") return;
   string direction=side==1 ? "BUY" : "SELL";
   string body="{\"token\":\""+InpApiToken+"\",\"symbol\":\""+_Symbol+"\",\"phase\":\"POSITION\",";
   body+="\"direction\":\""+direction+"\",\"currentPrice\":"+DoubleToString(currentPrice,_Digits)+",";
   body+="\"currentStop\":"+DoubleToString(currentStop,_Digits)+",\"takeProfit\":"+DoubleToString(takeProfit,_Digits)+",";
   body+="\"lastMaterialEventAt\":"+(string)(long)TimeCurrent()+",";
   body+="\"context\":{\"brokerUtcOffsetSeconds\":"+(string)(long)(TimeCurrent()-TimeGMT())+",";
   body+="\"spread\":"+DoubleToString(tick.ask-tick.bid,_Digits)+",";
   body+="\"estimatedRoundTripCostPercent\":"+DoubleToString(InpEstimatedRoundTripCostPercent,3)+",";
   body+="\"accountEquity\":"+DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2)+",";
   body+="\"freeMargin\":"+DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE),2)+"},";
   body+="\"frames\":{\"H4\":"+h4+",\"H1\":"+h1+",\"M15\":"+m15+",\"M5\":"+m5+",\"M1\":"+m1+"}}";
   char data[],result[]; StringToCharArray(body,data,0,StringLen(body),CP_UTF8);
   string headers="Content-Type: application/json\r\n",responseHeaders;
   int code=WebRequest("POST",InpServerURL+"/api/mt5/price-action/review",headers,25000,data,result,responseHeaders);
   if(code!=200) { Print("AI position review indisponivel; protecao local mantida. HTTP ",code); return; }
   string response=CharArrayToString(result,0,-1,CP_UTF8);
   double confidence=JsonNumber(response,"confidence");
   if(confidence<0.80 || confidence>1.0) return;
   // The position may have changed or closed while the AI request was in flight.
   if(!PositionSelect(_Symbol) || (ulong)PositionGetInteger(POSITION_IDENTIFIER)!=ticket ||
      (long)PositionGetInteger(POSITION_MAGIC)!=InpMagic) return;
   MqlTick latestTick; if(!SymbolInfoTick(_Symbol,latestTick)) return;
   currentStop=PositionGetDouble(POSITION_SL);
   takeProfit=PositionGetDouble(POSITION_TP);
   currentPrice=side==1 ? latestTick.bid : latestTick.ask;
   string action=JsonString(response,"action");
   if(action=="MOVE_STOP") {
      double proposed=JsonNumber(response,"proposedStop");
      proposed=NormalizeTradePrice(proposed,side,true);
      bool tighter=side==1 ? proposed>=currentStop && proposed<currentPrice
                           : proposed<=currentStop && proposed>currentPrice;
      int minStop=(int)MathMax(SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL),
                               SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL));
      bool brokerDistance=side==1 ? currentPrice-proposed>=minStop*_Point
                                  : proposed-currentPrice>=minStop*_Point;
      if(tighter && brokerDistance && proposed>0) {
         if(trade.PositionModify(_Symbol,proposed,takeProfit) && TradeRequestSucceeded())
            Print("IA apertou stop protetivo. Stop nunca e ampliado.");
      }
   } else if(action=="TAKE_PARTIAL") {
      string key=PartialKey(ticket);
      if(!GlobalVariableCheck(key) && PositionSelect(_Symbol)) {
         double volume=PositionGetDouble(POSITION_VOLUME);
         double partial=NormalizeVolume(volume*0.5);
         if(partial>0 && partial<volume && ClosePartialPosition(side,partial,volume))
            GlobalVariableSet(key,1.0);
      }
   } else if(action=="CLOSE") {
      string reason=JsonString(response,"closeReason");
      if(StringLen(reason)>0 && PositionSelect(_Symbol))
         if(trade.PositionClose(_Symbol) && TradeRequestSucceeded()) Print("IA recomendou encerramento: ",reason);
   }
}

string DailyStatePrefix() {
   return "PA_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+TimeToString(g_dayStart,TIME_DATE);
}
void PersistDailyState() {
   string key=DailyStatePrefix();
   GlobalVariableSet(key+"_T",(double)g_tradesToday);
   GlobalVariableSet(key+"_L",(double)g_consecutiveLosses);
   GlobalVariableSet(key+"_D",(double)g_losingTradesToday);
   GlobalVariableSet(key+"_P",(double)g_pauseUntil);
   GlobalVariableSet(key+"_E",g_dayStartEquity);
}
bool PositionIdentifierOpen(ulong identifier) {
   for(int i=PositionsTotal()-1;i>=0;i--) {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if((ulong)PositionGetInteger(POSITION_IDENTIFIER)==identifier) return true;
   }
   return false;
}

double ReconstructDayStartEquity(datetime dayStart) {
   // If a position was carried across midnight, its midnight floating PnL
   // cannot be reconstructed safely from current MT5 history. Fail closed.
   for(int i=PositionsTotal()-1;i>=0;i--) {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) return 0;
      ulong identifier=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
      if(!HistorySelectByPosition(identifier)) return 0;
      int count=HistoryDealsTotal();
      if(count<=0) return 0;
      datetime firstDeal=0;
      for(int j=0;j<count;j++) {
         ulong deal=HistoryDealGetTicket(j);
         if(deal==0) continue;
         datetime dealTime=(datetime)HistoryDealGetInteger(deal,DEAL_TIME);
         if(firstDeal==0 || dealTime<firstDeal) firstDeal=dealTime;
      }
      if(firstDeal==0 || firstDeal<dayStart) return 0;
   }
   if(!HistorySelect(dayStart,TimeCurrent())) return 0;
   double realized=0;
   for(int i=0;i<HistoryDealsTotal();i++) {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0) continue;
      realized+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_SWAP)+
                HistoryDealGetDouble(deal,DEAL_COMMISSION)+HistoryDealGetDouble(deal,DEAL_FEE);
   }
   double baseline=AccountInfoDouble(ACCOUNT_BALANCE)-realized;
   return baseline>0 ? baseline : 0;
}

bool DailyRiskAllowed() {
   // Daily limits use Brasília calendar day, independent of broker server timezone.
   datetime nowBrt=TimeGMT()-3*60*60;
   MqlDateTime d; TimeToStruct(nowBrt,d); d.hour=0; d.min=0; d.sec=0;
   datetime start=StructToTime(d);
   datetime serverDayStart=start+(TimeTradeServer()-TimeGMT());
   if(start!=g_dayStart) {
      g_dayStart=start;
      string key=DailyStatePrefix();
      g_tradesToday=GlobalVariableCheck(key+"_T") ? (int)GlobalVariableGet(key+"_T") : 0;
      g_consecutiveLosses=GlobalVariableCheck(key+"_L") ? (int)GlobalVariableGet(key+"_L") : 0;
      g_losingTradesToday=GlobalVariableCheck(key+"_D") ? (int)GlobalVariableGet(key+"_D") : 0;
      g_pauseUntil=GlobalVariableCheck(key+"_P") ? (datetime)GlobalVariableGet(key+"_P") : 0;
      g_dayStartEquity=GlobalVariableCheck(key+"_E") ? GlobalVariableGet(key+"_E") : ReconstructDayStartEquity(serverDayStart);
      if(g_dayStartEquity<=0) {
         Print("Baseline de equity diário não pode ser reconstruído com segurança. Novas entradas bloqueadas.");
         return false;
      }
      PersistDailyState();
   }
   else {
      string key=DailyStatePrefix();
      if(GlobalVariableCheck(key+"_T")) g_tradesToday=(int)GlobalVariableGet(key+"_T");
      if(GlobalVariableCheck(key+"_L")) g_consecutiveLosses=(int)GlobalVariableGet(key+"_L");
      if(GlobalVariableCheck(key+"_D")) g_losingTradesToday=(int)GlobalVariableGet(key+"_D");
      if(GlobalVariableCheck(key+"_P")) g_pauseUntil=(datetime)GlobalVariableGet(key+"_P");
      if(GlobalVariableCheck(key+"_E")) g_dayStartEquity=GlobalVariableGet(key+"_E");
   }
   if(TimeCurrent()<g_pauseUntil || g_tradesToday>=InpMaxTradesPerDay || g_losingTradesToday>=InpMaxLosingTradesPerDay) return false;
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

double NormalizeTradePrice(double price,int side,bool isStop) {
   double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tickSize<=0) tickSize=_Point;
   double units=price/tickSize;
   // Round protective stop away from market and target in the favorable direction.
   if(isStop) units=(side==1 ? MathFloor(units) : MathCeil(units));
   else units=(side==1 ? MathCeil(units) : MathFloor(units));
   return NormalizeDouble(units*tickSize,_Digits);
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
   MqlTick quote;
   if(!SymbolInfoTick(_Symbol,quote)) return 0;
   double feePrice=entry*InpEstimatedRoundTripCostPercent/100.0+2.0*(quote.ask-quote.bid);
   double feeExit=side==1 ? entry-feePrice : entry+feePrice;
   double feePnl=0;
   if(!OrderCalcProfit(type,_Symbol,1.0,entry,feeExit,feePnl)) return 0;
   lossPerLot+=MathAbs(feePnl);
   if(lossPerLot<=0) return 0;
   return NormalizeVolume(riskMoney/lossPerLot);
}

bool BuildSetup(int side,double trigger,Setup &s) {
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick)) return false;
   double entry=side==1 ? tick.ask : tick.bid;
   MqlRates r[];
   if(!GetRates(PERIOD_M15,30,r)) return false;
   // Confirmed 2-left/2-right pivots only. The newest two candles cannot be pivots yet.
   double swing=0;
   bool foundSwing=false;
   for(int i=2;i<15;i++) {
      bool pivot=side==1
         ? r[i].low<r[i-1].low && r[i].low<r[i-2].low && r[i].low<=r[i+1].low && r[i].low<=r[i+2].low
         : r[i].high>r[i-1].high && r[i].high>r[i-2].high && r[i].high>=r[i+1].high && r[i].high>=r[i+2].high;
      if(pivot) { swing=side==1 ? r[i].low : r[i].high; foundSwing=true; break; }
   }
   if(!foundSwing) return false;
   double atr=ATR(PERIOD_M15);
   if(atr<=0) return false;
   double stop=side==1 ? swing-atr*0.15 : swing+atr*0.15;
   if((side==1 && stop>=entry) || (side==-1 && stop<=entry)) return false;
   double risk=MathAbs(entry-stop);
   if(risk<=0 || risk/entry*100.0>InpMaxStopPercent) return false;
   double target=side==1 ? entry+risk*InpMinimumRR : entry-risk*InpMinimumRR;
   double cost=2.0*(tick.ask-tick.bid)+entry*InpEstimatedRoundTripCostPercent/100.0;
   double reward=MathAbs(target-entry)-cost;
   double netRisk=risk+cost;
   if(reward<=0 || reward/netRisk<InpMinimumRR) return false;
   // Do not aim a 2R target straight into the nearest confirmed opposing M15 pivot.
   double barrier=0;
   for(int i=2;i<15;i++) {
      bool pivotHigh=r[i].high>r[i-1].high && r[i].high>r[i-2].high &&
                     r[i].high>=r[i+1].high && r[i].high>=r[i+2].high;
      bool pivotLow=r[i].low<r[i-1].low && r[i].low<r[i-2].low &&
                    r[i].low<=r[i+1].low && r[i].low<=r[i+2].low;
      if(side==1 && pivotHigh && r[i].high>entry && (barrier==0 || r[i].high<barrier)) barrier=r[i].high;
      if(side==-1 && pivotLow && r[i].low<entry && (barrier==0 || r[i].low>barrier)) barrier=r[i].low;
   }
   if(barrier>0 && (side==1 ? barrier<=target+cost : barrier>=target-cost)) return false;
   int stops=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   int freeze=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minDistance=MathMax(stops,freeze)*_Point;
   if(MathAbs(entry-stop)<minDistance || MathAbs(target-entry)<minDistance) return false;
   s.side=side; s.entry=entry; s.stop=NormalizeTradePrice(stop,side,true);
   s.target=NormalizeTradePrice(target,side,false);
   double finalRisk=MathAbs(entry-s.stop);
   double finalReward=MathAbs(s.target-entry)-cost;
   if(finalRisk<=0 || finalRisk/entry*100.0>InpMaxStopPercent ||
      finalReward/(finalRisk+cost)<InpMinimumRR) return false;
   s.rr=finalReward/(finalRisk+cost);
   return true;
}

string DailyLockKey() { return DailyStatePrefix()+"_LOCK"; }

bool AcquireDailyLock() {
   string key=DailyLockKey();
   // Create-if-absent without overwriting another chart's active lock.
   if(!GlobalVariableTemp(key) && !GlobalVariableCheck(key)) return false;
   double observed=GlobalVariableGet(key);
   datetime now=TimeLocal();
   if(observed!=0 && now-(datetime)observed<30) return false;
   // Include millisecond and chart identity fragments so lock ownership is
   // distinguishable between charts even when they execute in the same second.
   double token=(double)now+(double)(GetTickCount()%1000)/1000.0+
                (double)(MathAbs((double)ChartID())%100)/100000.0;
   if(!GlobalVariableSetOnCondition(key,token,observed)) return false;
   g_dailyLockToken=token;
   return true;
}
void ReleaseDailyLock() {
   if(g_dailyLockToken==0) return;
   string key=DailyLockKey();
   // Never release a lock that expired and was acquired by another chart.
   GlobalVariableSetOnCondition(key,0.0,g_dailyLockToken);
   g_dailyLockToken=0.0;
}

bool ExecuteSetup(Setup &s) {
   if(!DailyRiskAllowed() || !AcquireDailyLock()) return false;
   bool executed=ExecuteSetupLocked(s);
   ReleaseDailyLock();
   return executed;
}

bool ExecuteSetupLocked(Setup &s) {
   if(!SpreadAllowed() || !DailyRiskAllowed()) return false;
   long tradeMode=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE);
   if(tradeMode==SYMBOL_TRADE_MODE_DISABLED || tradeMode==SYMBOL_TRADE_MODE_CLOSEONLY) return false;
   if(s.side==1 && tradeMode==SYMBOL_TRADE_MODE_SHORTONLY) return false;
   if(s.side==-1 && tradeMode==SYMBOL_TRADE_MODE_LONGONLY) return false;
   double volume=RiskVolume(s.side,s.entry,s.stop);
   if(volume<=0) { Print("Lote abaixo do minimo ou risco nao calculavel. Entrada bloqueada."); return false; }
   ENUM_ORDER_TYPE orderType=s.side==1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double requiredMargin=0;
   if(!OrderCalcMargin(orderType,_Symbol,volume,s.entry,requiredMargin) ||
      requiredMargin<=0 || requiredMargin*InpMarginReserveMultiplier>AccountInfoDouble(ACCOUNT_MARGIN_FREE)) {
      Print("Margem insuficiente ou nao calculavel. Entrada bloqueada.");
      return false;
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   bool ok=s.side==1 ? trade.Buy(volume,_Symbol,0,s.stop,s.target,"InvistaPRO PA")
                     : trade.Sell(volume,_Symbol,0,s.stop,s.target,"InvistaPRO PA");
   if(!ok || (trade.ResultRetcode()!=TRADE_RETCODE_DONE && trade.ResultRetcode()!=TRADE_RETCODE_PLACED && trade.ResultRetcode()!=TRADE_RETCODE_DONE_PARTIAL)) {
      Print("Ordem rejeitada: ",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
      return false;
   }
   // Count every accepted order response before slippage checks; ambiguous fills stay fail-closed.
   g_tradesToday++;
   PersistDailyState();
   double fillPrice=trade.ResultPrice();
   double maxSlippage=InpMaxSlippagePoints>0 ? InpMaxSlippagePoints*_Point : ATR(PERIOD_M15)*0.10;
   if(fillPrice<=0 || maxSlippage<=0 || MathAbs(fillPrice-s.entry)>maxSlippage) {
      Print("Slippage acima do limite ou preço de execução inválido. Tentando zerar a posição imediatamente.");
      if(PositionSelect(_Symbol) && (long)PositionGetInteger(POSITION_MAGIC)==InpMagic)
         trade.PositionClose(_Symbol);
      return false;
   }
   Print("Price Action executado: ",s.side==1?"BUY":"SELL"," ",_Symbol," volume=",volume,
         " SL=",s.stop," TP=",s.target," RR=",DoubleToString(s.rr,2));
   return true;
}

bool TradeRequestSucceeded() {
   uint code=trade.ResultRetcode();
   return code==TRADE_RETCODE_DONE || code==TRADE_RETCODE_PLACED || code==TRADE_RETCODE_DONE_PARTIAL;
}

string PartialKey(ulong ticket) { return "PA_PARTIAL_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+(string)ticket; }

bool ClosePartialPosition(int side,double closeVolume,double currentVolume) {
   if(closeVolume<=0 || closeVolume>=currentVolume) return false;
   ENUM_ACCOUNT_MARGIN_MODE mode=(ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   bool requested=false;
   if(mode==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING) {
      requested=trade.PositionClosePartial(_Symbol,closeVolume);
   } else {
      // Netting/exchange accounts reduce the existing net position with an opposite deal.
      requested=side==1
         ? trade.Sell(closeVolume,_Symbol,0,0,0,"PA partial reduction")
         : trade.Buy(closeVolume,_Symbol,0,0,0,"PA partial reduction");
   }
   return requested && TradeRequestSucceeded();
}

void ManageOpenPosition() {
   if(!PositionSelect(_Symbol)) return;
   if((long)PositionGetInteger(POSITION_MAGIC)!=InpMagic) return;
   ulong ticket=(ulong)PositionGetInteger(POSITION_IDENTIFIER);
   long type=PositionGetInteger(POSITION_TYPE);
   int side=type==POSITION_TYPE_BUY ? 1 : -1;
   double open=PositionGetDouble(POSITION_PRICE_OPEN);
   double stop=PositionGetDouble(POSITION_SL);
   double target=PositionGetDouble(POSITION_TP);
   double volume=PositionGetDouble(POSITION_VOLUME);
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   double price=side==1 ? tick.bid : tick.ask;
   string riskKey="PA_RISK_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+(string)ticket;
   double risk=GlobalVariableCheck(riskKey) ? GlobalVariableGet(riskKey) : MathAbs(open-stop);
   if(risk<=0) return;
   if(!GlobalVariableCheck(riskKey)) GlobalVariableSet(riskKey,risk);
   double rNow=(side==1 ? price-open : open-price)/risk;
   if(rNow>=1.0) {
      double be=NormalizeDouble(open,_Digits);
      bool tighter=side==1 ? be>stop : stop==0 || be<stop;
      if(tighter && trade.PositionModify(_Symbol,be,target) && TradeRequestSucceeded())
         Print("Stop movido para break-even em +1R.");
   }
   string partialKey=PartialKey(ticket);
   if(rNow>=1.5 && !GlobalVariableCheck(partialKey) &&
      volume>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)*1.5) {
      double closeVol=NormalizeVolume(volume*0.5);
      if(closeVol>0 && closeVol<volume && ClosePartialPosition(side,closeVol,volume))
         GlobalVariableSet(partialKey,1.0);
   }
   // Trailing only tightens behind confirmed closed M15 swing points.
   if(rNow>=2.0) {
      MqlRates r[];
      if(GetRates(PERIOD_M15,8,r)) {
         double candidate=side==1 ? r[1].low : r[1].high;
         for(int i=2;i<6;i++) candidate=side==1 ? MathMin(candidate,r[i].low) : MathMax(candidate,r[i].high);
         candidate=NormalizeDouble(candidate,_Digits);
         bool tighter=side==1 ? candidate>stop && candidate<price : candidate<stop && candidate>price;
         if(tighter && trade.PositionModify(_Symbol,candidate,target) && TradeRequestSucceeded())
            Print("Trailing stop estrutural apertado.");
      }
   }
}

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result) {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   long entry=(long)HistoryDealGetInteger(trans.deal,DEAL_ENTRY);
   ulong positionId=(ulong)HistoryDealGetInteger(trans.deal,DEAL_POSITION_ID);
   if(positionId==0) return;
   string account=(string)AccountInfoInteger(ACCOUNT_LOGIN);
   string trackKey="PA_TRACK_"+account+"_"+(string)positionId;
   string dealComment=HistoryDealGetString(trans.deal,DEAL_COMMENT);
   bool isPriceActionEntry=entry==DEAL_ENTRY_IN && StringFind(dealComment,"InvistaPRO PA")>=0;
   bool isTrackedExit=(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY) && GlobalVariableCheck(trackKey);
   if(!isPriceActionEntry && !isTrackedExit) return;

   // One terminal-global guard makes every chart instance account-wide and idempotent,
   // even when users assign different magic numbers to different Price Action charts.
   string dealGuard="PA_DEAL_"+account+"_"+(string)trans.deal;
   if(!GlobalVariableCheck(dealGuard)) GlobalVariableSet(dealGuard,0.0);
   if(!GlobalVariableSetOnCondition(dealGuard,(double)TimeCurrent(),0.0)) return;

   // Include opening commission/fees as well as every partial/final closing deal.
   // A position is counted only after it is completely closed.
   string pnlKey="PA_PNL_"+account+"_"+(string)positionId;
   double cumulative=GlobalVariableCheck(pnlKey) ? GlobalVariableGet(pnlKey) : 0.0;
   cumulative+=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)+HistoryDealGetDouble(trans.deal,DEAL_SWAP)+
               HistoryDealGetDouble(trans.deal,DEAL_COMMISSION)+HistoryDealGetDouble(trans.deal,DEAL_FEE);
   GlobalVariableSet(pnlKey,cumulative);

   if(isPriceActionEntry) {
      GlobalVariableSet(trackKey,1.0);
      return;
   }

   if(!PositionIdentifierOpen(positionId)) {
      if(cumulative<0) {
         g_losingTradesToday++;
         g_consecutiveLosses++;
         if(g_consecutiveLosses>=InpMaxConsecutiveLosses)
            g_pauseUntil=TimeCurrent()+InpPauseMinutesAfterLosses*60;
      } else if(cumulative>0) g_consecutiveLosses=0;
      GlobalVariableDel(pnlKey);
      GlobalVariableDel(trackKey);
      GlobalVariableDel(PartialKey(positionId));
      GlobalVariableDel("PA_RISK_"+account+"_"+(string)positionId);
      PersistDailyState();
   }
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

void CleanupOldDealGuards() {
   string prefix="PA_DEAL_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_";
   for(int i=GlobalVariablesTotal()-1;i>=0;i--) {
      string name=GlobalVariableName(i);
      if(StringFind(name,prefix)!=0) continue;
      if(TimeCurrent()-(datetime)GlobalVariableGet(name)>30*24*60*60)
         GlobalVariableDel(name);
   }
}

int OnInit() {
   if(InpRiskPercent<1.0 || InpRiskPercent>2.0 || InpMaxStopPercent<=0 || InpMaxStopPercent>1.5 || InpMinimumRR<2.0 || InpEstimatedRoundTripCostPercent<0 || InpEstimatedRoundTripCostPercent>2.0 || InpDailyLossLimitPercent<=0 || InpDailyLossLimitPercent>10.0 || InpMaxTradesPerDay<1 || InpMaxTradesPerDay>5 || InpMaxConsecutiveLosses<1 || InpMaxLosingTradesPerDay<1 || InpPauseMinutesAfterLosses<1 || InpMarginReserveMultiplier<1.0 || InpMarginReserveMultiplier>5.0) {
      Print("Configuracao de risco invalida. EA bloqueado."); return INIT_PARAMETERS_INCORRECT;
   }
   if(!IsDemoAccount()) {
      Print("Conta nao-DEMO bloqueada nesta versao de validacao. Use uma conta DEMO MT5."); return INIT_FAILED;
   }
   if(!SymbolSelect(_Symbol,true)) return INIT_FAILED;
   CleanupOldDealGuards();
   trade.SetExpertMagicNumber(InpMagic);
   g_lastM5Bar=iTime(_Symbol,PERIOD_M5,0);
   EventSetTimer(1);
   Print("InvistaPRO Price Action EA v1.0 iniciado. Broker-neutral | Simbolo do grafico: ",_Symbol);
   Print("Estratégia independente do provedor de cotações. Timeframes: H4/H1/M15/M5/M1.");
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
   if(!TrendDataReady(PERIOD_H4) || !TrendDataReady(PERIOD_H1) || !TrendDataReady(PERIOD_M15)) { g_approvedPatternTime=0; return; }
   int t4=Trend(PERIOD_H4),t1=Trend(PERIOD_H1),t15=Trend(PERIOD_M15);
   bool rangeMode=(t4==0 && t1==0 && t15==0);
   if(t4!=t1 || (t4==0 && !rangeMode) || (t4!=0 && t15!=0 && t15!=t4)) { g_approvedPatternTime=0; return; }

   // Approved setup is checked first on the next closed candle.
   if(g_approvedPatternTime>0) {
      if(TimeCurrent()-g_approvedPatternTime>PeriodSeconds(PERIOD_M5)*3) { g_approvedPatternTime=0; return; }
      if(t4!=0 && t4!=g_approvedSide) { g_approvedPatternTime=0; return; }
      if(t4==0 && !rangeMode) { g_approvedPatternTime=0; return; }
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
   if(!Pattern(PERIOD_M5,side,trigger,invalidation,pt) || (t4!=0 && side!=t4)) return;
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
