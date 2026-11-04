//+------------------------------------------------------------------+
//| InvistaPRO V10 Aura - MT5 Expert Advisor                         |
//| Price Action multi-timeframe implementation                     |
//| Version 1.52                                                     |
//|                                                                  |
//| IMPORTANT: Source code is provided for strategy testing.          |
//| Compile in MetaEditor and forward-test on a DEMO account first.   |
//+------------------------------------------------------------------+
#property strict
#property version   "1.52"
#property description "InvistaPRO V10 Aura - Price Action EA for MetaTrader 5"

#include <Trade/Trade.mqh>
CTrade trade;

// --- InvistaPRO connectivity (credentials are injected by the authorized download)
input string InpServerURL = "https://invista-pro-v10-kzlv.onrender.com"; // InvistaPRO production server
input string InpApiToken = ""; // Injected per authorized account download
input int    InpHeartbeatSeconds = 30;
input bool   InpEnableTrading = true;  // Execution enabled by default; account mode follows the connected MT5 terminal

// --- Core / risk
input ulong  InpMagicNumber                 = 101018;
input double InpRiskPercent                 = 1.0;   // Equity risk per trade (%)
input double InpMaxStopPercent              = 1.5;   // Reject if SL distance exceeds % of entry
input int    InpMaxTradesPerDay             = 5;     // Shared by charts using the same magic number
input int    InpStopAfterDailyLosses         = 3;     // Block new entries after this many losing trades today
input int    InpPauseAfterConsecutiveLosses  = 2;     // Pause after this many consecutive losses
input int    InpCooldownMinutes              = 60;    // Pause duration after consecutive losses
input double InpMaxDailyLossPercent           = 3.0;   // Maximum daily net loss as % of estimated start-of-day balance
input int    InpSlippagePoints               = 30;
input double InpEstimatedRoundTurnCostPerLot = 0.0;  // Configure broker commission/fees in account currency per lot
input bool   InpOnlyBTCETHSOL                 = false; // Optional restriction; false lets the EA trade only the chart where it is installed, regardless of asset class

// --- Brazil (Brasilia) trading windows
input bool   InpUseSessionFilter             = true;
input int    InpBrasiliaUtcOffsetHours        = -3;
// Windows: 04:00-07:00, 09:30-12:00, 14:00-17:00 Brasilia time.

// --- Strategy timeframes / confirmation
input int    InpSwingLookback                = 100;
input int    InpAtrPeriod                     = 14;
input double InpZoneAtrMultiplier             = 0.60;  // M15 distance from swing zone in ATRs
input double InpSignalAtrStopBuffer           = 0.10;  // ATR buffer outside the signal candle
input double InpMinVolumeVsAverage            = 1.10;  // Signal tick volume / previous 20-bar average
input double InpWickToBodyRatio               = 1.50;
input int    InpSetupExpiryBars                = 3;     // M5 bars to wait for breakout
input double InpMaxSpreadAsAtr                 = 0.15;  // Skip if spread > this fraction of M5 ATR
input bool   InpRequireLiquiditySweep           = true;  // Require a confirmed M5 sweep and reclaim
input int    InpLiquidityLookback               = 12;
input bool   InpRequireM1Confirmation            = true;  // Require M1 micro-break in trade direction
input bool   InpBlockMiddleOfRange                = true;
input double InpRangeMiddleLow                    = 0.35;
input double InpRangeMiddleHigh                   = 0.65;
input bool   InpRequireM15BreakConfirmation        = true;  // BOS/CHoCH confirmation on closed M15 candle
input bool   InpUseH4H1Zones                       = true;  // Add confirmed H4/H1 S/R zones to M15 confluence
input int    InpZoneClusterMinTouches              = 2;     // Minimum historical reactions for clustered S/R
input double InpZoneClusterAtrTolerance            = 0.25;  // Price tolerance for clustering swing levels
input bool   InpUseInsideBarTrigger                 = true;  // Mother/inside-bar breakout setup

// --- Exits
input double InpPartialTargetR                 = 1.5;   // Close 50% of initial volume at +1.5R
input double InpFinalTargetR                   = 3.0;   // Final target at +3R
input double InpMinRoomR                       = 2.0;   // Require at least 2R of room to next swing zone
input bool   InpMoveStopToBreakEvenAt1R         = true;
input double InpBreakEvenOffsetPoints           = 0.0;
input bool   InpUseAtrTrailingAfterPartial      = true;
input double InpTrailingAtrMultiplier           = 0.10;  // ATR safety buffer beyond latest confirmed M5 swing

// --- Economic calendar filter
input bool   InpUseHighImpactNewsFilter         = true;
input string InpNewsCurrency                    = "USD";
input int    InpNewsMinutesBefore               = 30;
input int    InpNewsMinutesAfter                = 30;
input bool   InpBlockIfCalendarUnavailable      = true;

// --- Runtime state
int      g_atrM5Handle = INVALID_HANDLE;
int      g_atrM15Handle = INVALID_HANDLE;
datetime g_lastM5BarTime = 0;
int      g_setupDirection = 0;  // +1 buy; -1 sell; 0 none
int      g_setupAge = 0;
datetime g_setupCreatedBar = 0;
datetime g_setupSignalTime = 0;
double   g_setupTrigger = 0.0;
double   g_setupStop = 0.0;
double   g_initialRisk = 0.0;
double   g_initialVolume = 0.0;
bool     g_partialTaken = false;
string   g_lastBlockReason = "Aguardando novo candle M5";

struct ClosedTradeStat
  {
   ulong position_id;
   double net_profit;
   datetime close_time;
  };

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
string StateKey(const string suffix)
  {
   return "AURA" + IntegerToString((long)InpMagicNumber) + "_" + _Symbol + "_" + suffix;
  }

void SavePositionState()
  {
   GlobalVariableSet(StateKey("R"), g_initialRisk);
   GlobalVariableSet(StateKey("V"), g_initialVolume);
   GlobalVariableSet(StateKey("P"), g_partialTaken ? 1.0 : 0.0);
  }

void LoadPositionState()
  {
   g_initialRisk = GlobalVariableCheck(StateKey("R")) ? GlobalVariableGet(StateKey("R")) : 0.0;
   g_initialVolume = GlobalVariableCheck(StateKey("V")) ? GlobalVariableGet(StateKey("V")) : 0.0;
   g_partialTaken = GlobalVariableCheck(StateKey("P")) && GlobalVariableGet(StateKey("P")) > 0.5;
  }

void ClearPositionState()
  {
   g_initialRisk = 0.0;
   g_initialVolume = 0.0;
   g_partialTaken = false;
   if(GlobalVariableCheck(StateKey("R"))) GlobalVariableDel(StateKey("R"));
   if(GlobalVariableCheck(StateKey("V"))) GlobalVariableDel(StateKey("V"));
   if(GlobalVariableCheck(StateKey("P"))) GlobalVariableDel(StateKey("P"));
  }

bool IsAllowedSymbol()
  {
   if(!InpOnlyBTCETHSOL) return true;
   string s = _Symbol;
   StringToUpper(s);
   return (StringFind(s, "BTC") >= 0 || StringFind(s, "ETH") >= 0 || StringFind(s, "SOL") >= 0);
  }

bool IsInBrasiliaSession()
  {
   if(!InpUseSessionFilter) return true;
   datetime brTime = TimeGMT() + InpBrasiliaUtcOffsetHours * 3600;
   MqlDateTime dt;
   TimeToStruct(brTime, dt);
   int minuteOfDay = dt.hour * 60 + dt.min;

   bool s1 = (minuteOfDay >= 4 * 60 && minuteOfDay < 7 * 60);
   bool s2 = (minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 12 * 60);
   bool s3 = (minuteOfDay >= 14 * 60 && minuteOfDay < 17 * 60);
   return (s1 || s2 || s3);
  }

bool IsNewM5Bar()
  {
   datetime t = iTime(_Symbol, PERIOD_M5, 0);
   if(t <= 0) return false;
   if(t != g_lastM5BarTime)
     {
      g_lastM5BarTime = t;
      return true;
     }
   return false;
  }

double ReadAtr(const int handle, const int shift=1)
  {
   if(handle == INVALID_HANDLE) return 0.0;
   double value[];
   ArraySetAsSeries(value, true);
   if(CopyBuffer(handle, 0, shift, 1, value) != 1) return 0.0;
   if(value[0] <= 0.0 || !MathIsValidNumber(value[0])) return 0.0;
   return value[0];
  }

// Align every submitted price to the instrument's actual trade tick size.
// direction: +1 buy, -1 sell. Stops are rounded away from entry; targets away from entry.
double NormalizeTradePrice(const double price, const int direction, const bool isStop)
  {
   double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tickSize<=0.0) tickSize=_Point;
   double units=price/tickSize;
   bool roundDown=((direction>0 && isStop) || (direction<0 && !isStop));
   double aligned=(roundDown ? MathFloor(units+1e-10) : MathCeil(units-1e-10))*tickSize;
   return NormalizeDouble(aligned,(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS));
  }

bool TradeRetcodeSucceeded(const bool methodResult, const bool allowPlaced=false)
  {
   if(!methodResult) return false;
   uint rc=trade.ResultRetcode();
   if(rc==TRADE_RETCODE_DONE || rc==TRADE_RETCODE_DONE_PARTIAL) return true;
   if(allowPlaced && rc==TRADE_RETCODE_PLACED) return true;
   return false;
  }

// Locate a confirmed swing point, beginning at shift 2 to avoid the forming candle.
bool FindSwing(const ENUM_TIMEFRAMES tf, const bool wantHigh, const int startShift,
               const int lookback, double &price, int &foundShift)
  {
   int start = MathMax(2, startShift);
   int endShift = MathMax(start + 2, lookback);
   for(int i = start; i <= endShift; i++)
     {
      double center = wantHigh ? iHigh(_Symbol, tf, i) : iLow(_Symbol, tf, i);
      double newer  = wantHigh ? iHigh(_Symbol, tf, i-1) : iLow(_Symbol, tf, i-1);
      double older  = wantHigh ? iHigh(_Symbol, tf, i+1) : iLow(_Symbol, tf, i+1);
      if(center == 0.0 || newer == 0.0 || older == 0.0) continue;
      bool pivot = wantHigh ? (center >= newer && center > older)
                            : (center <= newer && center < older);
      if(pivot)
        {
         price = center;
         foundShift = i;
         return true;
        }
     }
   return false;
  }

int StructureDirection(const ENUM_TIMEFRAMES tf)
  {
   double h1=0.0,h2=0.0,l1=0.0,l2=0.0;
   int sh1=0,sh2=0,sl1=0,sl2=0;
   if(!FindSwing(tf, true, 2, InpSwingLookback, h1, sh1)) return 0;
   if(!FindSwing(tf, true, sh1+2, InpSwingLookback, h2, sh2)) return 0;
   if(!FindSwing(tf, false, 2, InpSwingLookback, l1, sl1)) return 0;
   if(!FindSwing(tf, false, sl1+2, InpSwingLookback, l2, sl2)) return 0;

   if(h1 > h2 && l1 > l2) return 1;  // HH + HL
   if(h1 < h2 && l1 < l2) return -1; // LH + LL
   return 0;                         // sideways / conflicting structure
  }

// Cluster confirmed swing levels on H4/H1. A level is considered meaningful
// only when multiple independent pivots occur within the ATR-based tolerance.
bool IsAtClusteredHTFZone(const ENUM_TIMEFRAMES tf,const int direction,
                          const double price,const double atr)
  {
   if(atr<=0.0) return false;
   double levels[];
   ArrayResize(levels,0);
   int limit=MathMin(InpSwingLookback,120);
   for(int i=2;i<=limit;i++)
     {
      double c=direction>0?iLow(_Symbol,tf,i):iHigh(_Symbol,tf,i);
      double n=direction>0?iLow(_Symbol,tf,i-1):iHigh(_Symbol,tf,i-1);
      double o=direction>0?iLow(_Symbol,tf,i+1):iHigh(_Symbol,tf,i+1);
      if(c<=0.0 || n<=0.0 || o<=0.0) continue;
      bool pivot=direction>0?(c<=n && c<o):(c>=n && c>o);
      if(!pivot) continue;
      int k=ArraySize(levels); ArrayResize(levels,k+1); levels[k]=c;
     }
   double tolerance=atr*InpZoneClusterAtrTolerance;
   for(int a=0;a<ArraySize(levels);a++)
     {
      if(MathAbs(price-levels[a])>tolerance) continue;
      int touches=0;
      for(int b=0;b<ArraySize(levels);b++)
         if(MathAbs(levels[a]-levels[b])<=tolerance) touches++;
      if(touches>=InpZoneClusterMinTouches) return true;
     }
   return false;
  }

bool GetNearestPivotBeyondPrice(const ENUM_TIMEFRAMES tf, const bool wantHigh,
                                const double price, double &pivot)
  {
   double best = wantHigh ? DBL_MAX : -DBL_MAX;
   bool found = false;
   for(int i=2; i<=InpSwingLookback; i++)
     {
      double center = wantHigh ? iHigh(_Symbol, tf, i) : iLow(_Symbol, tf, i);
      double newer  = wantHigh ? iHigh(_Symbol, tf, i-1) : iLow(_Symbol, tf, i-1);
      double older  = wantHigh ? iHigh(_Symbol, tf, i+1) : iLow(_Symbol, tf, i+1);
      if(center <= 0.0 || newer <= 0.0 || older <= 0.0) continue;
      bool isPivot = wantHigh ? (center >= newer && center > older)
                              : (center <= newer && center < older);
      if(!isPivot) continue;
      if(wantHigh && center > price && center < best) { best=center; found=true; }
      if(!wantHigh && center < price && center > best) { best=center; found=true; }
     }
   if(found) pivot=best;
   return found;
  }

bool IsAtFairValueGap(const int direction, const double price, const double atr)
  {
   // Three-candle FVG. Ignore zones invalidated by a later close through
   // the far edge or fully filled after formation.
   int maxShift=MathMin(InpSwingLookback,48);
   for(int i=2;i<=maxShift;i++)
     {
      double newerHigh=iHigh(_Symbol,PERIOD_M15,i-1);
      double newerLow=iLow(_Symbol,PERIOD_M15,i-1);
      double olderHigh=iHigh(_Symbol,PERIOD_M15,i+1);
      double olderLow=iLow(_Symbol,PERIOD_M15,i+1);
      if(newerHigh<=0.0 || newerLow<=0.0 || olderHigh<=0.0 || olderLow<=0.0) continue;
      double zoneLow=0.0,zoneHigh=0.0;
      bool found=false,invalid=false,fullyFilled=false;
      if(direction>0 && newerLow>olderHigh)
        { zoneLow=olderHigh; zoneHigh=newerLow; found=true; }
      if(direction<0 && newerHigh<olderLow)
        { zoneLow=newerHigh; zoneHigh=olderLow; found=true; }
      if(!found) continue;
      for(int j=i-2;j>=1;j--)
        {
         double closeJ=iClose(_Symbol,PERIOD_M15,j);
         double lowJ=iLow(_Symbol,PERIOD_M15,j);
         double highJ=iHigh(_Symbol,PERIOD_M15,j);
         if(direction>0)
           { if(closeJ<zoneLow) invalid=true; if(lowJ<=zoneLow) fullyFilled=true; }
         else
           { if(closeJ>zoneHigh) invalid=true; if(highJ>=zoneHigh) fullyFilled=true; }
         if(invalid || fullyFilled) break;
        }
      if(!invalid && !fullyFilled && price>=zoneLow-0.20*atr && price<=zoneHigh+0.20*atr)
         return true;
     }
   return false;
  }

bool IsAtOrderBlock(const int direction, const double price, const double atr)
  {
   // Last opposing candle before displacement. A later close through the
   // distal edge invalidates the block; old invalidated blocks are ignored.
   int maxShift=MathMin(InpSwingLookback,48);
   for(int i=3;i<=maxShift;i++)
     {
      double obOpen=iOpen(_Symbol,PERIOD_M15,i), obClose=iClose(_Symbol,PERIOD_M15,i);
      double obHigh=iHigh(_Symbol,PERIOD_M15,i), obLow=iLow(_Symbol,PERIOD_M15,i);
      double impulseOpen=iOpen(_Symbol,PERIOD_M15,i-1), impulseClose=iClose(_Symbol,PERIOD_M15,i-1);
      double impulseHigh=iHigh(_Symbol,PERIOD_M15,i-1), impulseLow=iLow(_Symbol,PERIOD_M15,i-1);
      if(obHigh<=0.0 || obLow<=0.0 || impulseHigh<=0.0 || impulseLow<=0.0) continue;
      bool bullishBlock=(direction>0 && obClose<obOpen && impulseClose>impulseOpen &&
                         impulseClose>obHigh && (impulseClose-impulseOpen)>=1.2*atr);
      bool bearishBlock=(direction<0 && obClose>obOpen && impulseClose<impulseOpen &&
                         impulseClose<obLow && (impulseOpen-impulseClose)>=1.2*atr);
      if(!bullishBlock && !bearishBlock) continue;
      bool invalid=false,fullyMitigated=false;
      for(int j=i-2;j>=1;j--)
        {
         double laterClose=iClose(_Symbol,PERIOD_M15,j);
         double laterLow=iLow(_Symbol,PERIOD_M15,j);
         double laterHigh=iHigh(_Symbol,PERIOD_M15,j);
         if((direction>0 && laterClose<obLow) || (direction<0 && laterClose>obHigh))
           { invalid=true; break; }
         if((direction>0 && laterLow<=obLow) || (direction<0 && laterHigh>=obHigh))
           { fullyMitigated=true; break; }
        }
      if(!invalid && !fullyMitigated && price>=obLow-0.20*atr && price<=obHigh+0.20*atr) return true;
     }
   return false;
  }

bool PriceIsAtZone(const int direction)
  {
   double atr = ReadAtr(g_atrM15Handle, 1);
   if(atr <= 0.0) return false;
   double support=0.0,resistance=0.0;
   int supportShift=0,resistanceShift=0;
   double mid = (SymbolInfoDouble(_Symbol, SYMBOL_BID)+SymbolInfoDouble(_Symbol, SYMBOL_ASK))*0.5;
   bool atSwingZone=false;
   if(direction > 0)
     {
      if(FindSwing(PERIOD_M15, false, 2, InpSwingLookback, support, supportShift))
         atSwingZone=(mid >= support-0.20*atr && MathAbs(mid-support)<=InpZoneAtrMultiplier*atr);
     }
   else
     {
      if(FindSwing(PERIOD_M15, true, 2, InpSwingLookback, resistance, resistanceShift))
         atSwingZone=(mid <= resistance+0.20*atr && MathAbs(mid-resistance)<=InpZoneAtrMultiplier*atr);
     }
   double rangeLow=0.0,rangeHigh=0.0;
   bool atRangeEdge=false;
   if(GetH1RangeBounds(48,rangeLow,rangeHigh))
     {
      if(direction>0) atRangeEdge=(MathAbs(mid-rangeLow)<=InpZoneAtrMultiplier*atr);
      else atRangeEdge=(MathAbs(mid-rangeHigh)<=InpZoneAtrMultiplier*atr);
     }
   bool atClusteredSR=IsAtClusteredHTFZone(PERIOD_M15,direction,mid,atr);
   if(InpUseH4H1Zones)
      atClusteredSR=(atClusteredSR || IsAtClusteredHTFZone(PERIOD_H4,direction,mid,atr) ||
                     IsAtClusteredHTFZone(PERIOD_H1,direction,mid,atr));
   return (atSwingZone || atRangeEdge || atClusteredSR ||
           IsAtFairValueGap(direction,mid,atr) || IsAtOrderBlock(direction,mid,atr));
  }

bool VolumeConfirms()
  {
   long signalVol = iVolume(_Symbol, PERIOD_M5, 1);
   if(signalVol <= 0) return false;
   double total = 0.0;
   int count = 0;
   for(int i=2; i<=21; i++)
     {
      long v = iVolume(_Symbol, PERIOD_M5, i);
      if(v > 0) { total += (double)v; count++; }
     }
   if(count < 15) return false;
   double average = total / count;
   return ((double)signalVol >= average * InpMinVolumeVsAverage);
  }

// A liquidity sweep is valid only when the closed M5 candle takes a prior
// short-term extreme and closes back inside the previous range.
bool HasLiquiditySweep(const int direction)
  {
   int lookback=MathMax(3,InpLiquidityLookback);
   double priorLow=DBL_MAX, priorHigh=-DBL_MAX;
   for(int i=2; i<2+lookback; i++)
     {
      double lo=iLow(_Symbol,PERIOD_M5,i);
      double hi=iHigh(_Symbol,PERIOD_M5,i);
      if(lo<=0.0 || hi<=0.0) return false;
      priorLow=MathMin(priorLow,lo);
      priorHigh=MathMax(priorHigh,hi);
     }
   double low1=iLow(_Symbol,PERIOD_M5,1);
   double high1=iHigh(_Symbol,PERIOD_M5,1);
   double close1=iClose(_Symbol,PERIOD_M5,1);
   if(direction>0) return (low1<priorLow && close1>priorLow);
   if(direction<0) return (high1>priorHigh && close1<priorHigh);
   return false;
  }

// Reject entries in the center of a recent M15 dealing range. The boundaries
// are calculated from closed candles only.
bool IsInMiddleOfRange()
  {
   double rangeHigh=-DBL_MAX, rangeLow=DBL_MAX;
   for(int i=1; i<=20; i++)
     {
      double hi=iHigh(_Symbol,PERIOD_M15,i);
      double lo=iLow(_Symbol,PERIOD_M15,i);
      if(hi<=0.0 || lo<=0.0) return true; // fail closed when history is incomplete
      rangeHigh=MathMax(rangeHigh,hi);
      rangeLow=MathMin(rangeLow,lo);
     }
   double span=rangeHigh-rangeLow;
   if(span<=_Point) return true;
   double price=(SymbolInfoDouble(_Symbol,SYMBOL_BID)+SymbolInfoDouble(_Symbol,SYMBOL_ASK))*0.5;
   double location=(price-rangeLow)/span;
   return (location>=InpRangeMiddleLow && location<=InpRangeMiddleHigh);
  }

// Range boundaries use only completed H1 candles. Returns false when history is insufficient.
bool GetH1RangeBounds(const int lookback, double &rangeLow, double &rangeHigh)
  {
   rangeLow=DBL_MAX;
   rangeHigh=-DBL_MAX;
   if(Bars(_Symbol,PERIOD_H1)<lookback+2) return false;
   for(int i=1; i<=lookback; i++)
     {
      double hi=iHigh(_Symbol,PERIOD_H1,i);
      double lo=iLow(_Symbol,PERIOD_H1,i);
      if(hi<=0.0 || lo<=0.0 || hi<=lo) return false;
      rangeHigh=MathMax(rangeHigh,hi);
      rangeLow=MathMin(rangeLow,lo);
     }
   return (rangeHigh-rangeLow>_Point*10.0);
  }

int DetermineTradeDirection(bool &rangeMode)
  {
   rangeMode=false;
   int h4=StructureDirection(PERIOD_H4);
   int h1=StructureDirection(PERIOD_H1);
   if(h4!=0 && h4==h1) return h4;
   if(h4!=0 || h1!=0) return 0; // conflicting structure: stand aside

   // Both higher timeframes are non-directional: trade only at H1 range extremes.
   double low=0.0,high=0.0;
   if(!GetH1RangeBounds(48,low,high)) return 0;
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   if(bid<=0.0 || ask<=0.0 || high<=low) return 0;
   double location=(((bid+ask)*0.5)-low)/(high-low);
   if(location<=0.20) { rangeMode=true; return 1; }
   if(location>=0.80) { rangeMode=true; return -1; }
   return 0;
  }

// A closed M15 candle breaking the latest confirmed opposing swing is the
// objective BOS/CHoCH confirmation used by the strategy filter.
bool FindSwingBeforeBreak(const ENUM_TIMEFRAMES tf, const bool wantHigh,
                          const int breakShift, const int lookback,
                          double &price, int &foundShift)
  {
   // The pivot and its two confirming neighbours must all pre-date the break candle.
   int first=MathMax(3,breakShift+3);
   int last=MathMax(first,lookback);
   for(int i=first; i<=last; i++)
     {
      double center=wantHigh ? iHigh(_Symbol,tf,i) : iLow(_Symbol,tf,i);
      double newer=wantHigh ? iHigh(_Symbol,tf,i-1) : iLow(_Symbol,tf,i-1);
      double older=wantHigh ? iHigh(_Symbol,tf,i+1) : iLow(_Symbol,tf,i+1);
      if(center<=0.0 || newer<=0.0 || older<=0.0) continue;
      bool pivot=wantHigh ? (center>=newer && center>older)
                          : (center<=newer && center<older);
      if(pivot) { price=center; foundShift=i; return true; }
     }
   return false;
  }

bool HasM15DirectionalBreak(const int direction)
  {
   // Search a recent closed M15 candle against a swing that was fully confirmed
   // before that candle. This avoids using the breakout candle to define its own pivot.
   for(int bar=1; bar<=12; bar++)
     {
      double level=0.0;
      int shift=0;
      if(!FindSwingBeforeBreak(PERIOD_M15,direction>0,bar,InpSwingLookback,level,shift))
         continue;
      double closePrice=iClose(_Symbol,PERIOD_M15,bar);
      if(direction>0 && closePrice>level) return true;
      if(direction<0 && closePrice<level) return true;
     }
   return false;
  }

// M1 confirmation: a completed candle must close beyond the previous M1
// candle's extreme in the intended direction (no use of the forming candle).
bool HasM1MicroBreak(const int direction, const datetime signalBarTime)
  {
   datetime m1Time=iTime(_Symbol,PERIOD_M1,1);
   double o=iOpen(_Symbol,PERIOD_M1,1);
   double c=iClose(_Symbol,PERIOD_M1,1);
   double h2=iHigh(_Symbol,PERIOD_M1,2);
   double l2=iLow(_Symbol,PERIOD_M1,2);
   if(m1Time<=0 || o<=0.0 || c<=0.0 || h2<=0.0 || l2<=0.0) return false;
   // Require the micro-break candle to belong to the end of the M5 signal bar,
   // not an unrelated earlier M1 candle.
   if(m1Time<signalBarTime+240) return false;
   if(direction>0) return (c>o && c>h2);
   if(direction<0) return (c<o && c<l2);
   return false;
  }

bool IsBullishInsideBar()
  {
   double h1=iHigh(_Symbol,PERIOD_M5,1),l1=iLow(_Symbol,PERIOD_M5,1);
   double h2=iHigh(_Symbol,PERIOD_M5,2),l2=iLow(_Symbol,PERIOD_M5,2);
   double o1=iOpen(_Symbol,PERIOD_M5,1),c1=iClose(_Symbol,PERIOD_M5,1);
   return (h1>l1 && h1<h2 && l1>l2 && c1>o1);
  }

bool IsBearishInsideBar()
  {
   double h1=iHigh(_Symbol,PERIOD_M5,1),l1=iLow(_Symbol,PERIOD_M5,1);
   double h2=iHigh(_Symbol,PERIOD_M5,2),l2=iLow(_Symbol,PERIOD_M5,2);
   double o1=iOpen(_Symbol,PERIOD_M5,1),c1=iClose(_Symbol,PERIOD_M5,1);
   return (h1>l1 && h1<h2 && l1>l2 && c1<o1);
  }

bool IsBullishSignalCandle()
  {
   double o1=iOpen(_Symbol,PERIOD_M5,1), c1=iClose(_Symbol,PERIOD_M5,1);
   double h1=iHigh(_Symbol,PERIOD_M5,1), l1=iLow(_Symbol,PERIOD_M5,1);
   double o2=iOpen(_Symbol,PERIOD_M5,2), c2=iClose(_Symbol,PERIOD_M5,2);
   if(h1<=l1) return false;
   double body=MathAbs(c1-o1);
   double lowerWick=MathMin(o1,c1)-l1;
   bool rejection=(c1>o1 && lowerWick >= MathMax(body*InpWickToBodyRatio, _Point*2.0)
                   && c1 >= l1+(h1-l1)*0.60);
   bool engulf=(c1>o1 && c2<o2 && o1<=c2 && c1>=o2);
   return (rejection || engulf || (InpUseInsideBarTrigger && IsBullishInsideBar()));
  }

bool IsBearishSignalCandle()
  {
   double o1=iOpen(_Symbol,PERIOD_M5,1), c1=iClose(_Symbol,PERIOD_M5,1);
   double h1=iHigh(_Symbol,PERIOD_M5,1), l1=iLow(_Symbol,PERIOD_M5,1);
   double o2=iOpen(_Symbol,PERIOD_M5,2), c2=iClose(_Symbol,PERIOD_M5,2);
   if(h1<=l1) return false;
   double body=MathAbs(c1-o1);
   double upperWick=h1-MathMax(o1,c1);
   bool rejection=(c1<o1 && upperWick >= MathMax(body*InpWickToBodyRatio, _Point*2.0)
                   && c1 <= h1-(h1-l1)*0.60);
   bool engulf=(c1<o1 && c2>o2 && o1>=c2 && c1<=o2);
   return (rejection || engulf || (InpUseInsideBarTrigger && IsBearishInsideBar()));
  }

bool NewsWindowBlocked()
  {
   if(!InpUseHighImpactNewsFilter) return false;
   // MT5 Strategy Tester does not provide the live economic calendar reliably.
   // News filtering must be modelled separately in historical tests.
   if((bool)MQLInfoInteger(MQL_TESTER)) return false;
   datetime now = TimeTradeServer();
   if(now <= 0) now = TimeCurrent();
   datetime from = now - InpNewsMinutesBefore*60;
   datetime to   = now + InpNewsMinutesAfter*60;
   MqlCalendarValue values[];
   int n = CalendarValueHistory(values, from, to, NULL, InpNewsCurrency);
   if(n < 0)
     {
      Print("Aura EA: economic calendar unavailable. Error=", GetLastError());
      return InpBlockIfCalendarUnavailable;
     }
   for(int i=0; i<n; i++)
     {
      MqlCalendarEvent ev;
      if(!CalendarEventById(values[i].event_id, ev))
        {
         if(InpBlockIfCalendarUnavailable) return true;
         continue;
        }
      if(ev.importance == CALENDAR_IMPORTANCE_HIGH && values[i].time >= from && values[i].time <= to)
         return true;
     }
   return false;
  }

bool SpreadIsAcceptable()
  {
   double atr=ReadAtr(g_atrM5Handle,1);
   if(atr<=0.0) return false;
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   if(ask<=0.0 || bid<=0.0 || ask<bid) return false;
   return ((ask-bid) <= atr*InpMaxSpreadAsAtr);
  }

bool IsPositionIdentifierOpen(const ulong positionId)
  {
   for(int i=PositionsTotal()-1; i>=0; i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if((ulong)PositionGetInteger(POSITION_IDENTIFIER)==positionId) return true;
     }
   return false;
  }

void SortStatsNewestFirst(ClosedTradeStat &stats[])
  {
   int n=ArraySize(stats);
   for(int i=0; i<n-1; i++)
     for(int j=i+1; j<n; j++)
       if(stats[j].close_time > stats[i].close_time)
         {
          ClosedTradeStat tmp=stats[i];
          stats[i]=stats[j];
          stats[j]=tmp;
         }
  }

// The counters are account-wide for all charts that use the same magic number.
void GetDailyPerformance(int &trades, int &losses, int &consecutiveLosses, datetime &latestClose)
  {
   trades=0; losses=0; consecutiveLosses=0; latestClose=0;
   datetime now=TimeTradeServer();
   if(now<=0) now=TimeCurrent();
   datetime dayStart=StringToTime(TimeToString(now,TIME_DATE));
   // Read a rolling history window so entry-side commissions are included when
   // a position is closed today, even if it was opened before midnight.
   datetime historyStart=now-90*86400;
   if(!HistorySelect(historyStart,now)) return;

   ClosedTradeStat stats[];
   int total=HistoryDealsTotal();
   // First pass: identify positions with a closing deal today.
   for(int i=0;i<total;i++)
     {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0 || (ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagicNumber) continue;
      ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY && entry!=DEAL_ENTRY_INOUT) continue;
      datetime dt=(datetime)HistoryDealGetInteger(deal,DEAL_TIME);
      if(dt<dayStart) continue;
      ulong pid=(ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID);
      if(pid==0 || IsPositionIdentifierOpen(pid)) continue;
      int idx=ArraySize(stats);
      bool exists=false;
      for(int k=0;k<idx;k++) if(stats[k].position_id==pid) { exists=true; break; }
      if(exists) continue;
      ArrayResize(stats,idx+1);
      stats[idx].position_id=pid;
      stats[idx].net_profit=0.0;
      stats[idx].close_time=dt;
     }
   // Second pass: sum every deal belonging to each position, including entry
   // commissions/fees and all partial exits.
   for(int i=0;i<total;i++)
     {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0 || (ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagicNumber) continue;
      ulong pid=(ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID);
      for(int k=0;k<ArraySize(stats);k++)
        if(stats[k].position_id==pid)
          {
           stats[k].net_profit+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_SWAP)
                               +HistoryDealGetDouble(deal,DEAL_COMMISSION)+HistoryDealGetDouble(deal,DEAL_FEE);
           ENUM_DEAL_ENTRY entry=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal,DEAL_ENTRY);
           if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY || entry==DEAL_ENTRY_INOUT)
             {
              datetime dt=(datetime)HistoryDealGetInteger(deal,DEAL_TIME);
              if(dt>stats[k].close_time) stats[k].close_time=dt;
             }
          }
     }

   SortStatsNewestFirst(stats);
   trades=ArraySize(stats);
   // Count positions opened today even if they are still running, so parallel charts
   // using the same magic number cannot exceed the daily entry cap unnoticed.
   for(int p=PositionsTotal()-1;p>=0;p--)
     {
      ulong ticket=PositionGetTicket(p);
      if(ticket==0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagicNumber) continue;
      datetime openTime=(datetime)PositionGetInteger(POSITION_TIME);
      if(openTime>=dayStart) trades++;
     }
   bool stillInLossStreak=true;
   for(int j=0;j<ArraySize(stats);j++)
     {
      if(stats[j].close_time>latestClose) latestClose=stats[j].close_time;
      if(stats[j].net_profit<0.0)
        {
         losses++;
         if(stillInLossStreak) consecutiveLosses++;
        }
      else if(stats[j].net_profit>0.0) stillInLossStreak=false;
     }
  }

void GetDailyNetPnl(double &netPnl, double &estimatedStartBalance)
  {
   netPnl=0.0;
   datetime now=TimeTradeServer();
   if(now<=0) now=TimeCurrent();
   datetime dayStart=StringToTime(TimeToString(now,TIME_DATE));
   if(HistorySelect(dayStart,now))
     {
      int total=HistoryDealsTotal();
      for(int i=0; i<total; i++)
        {
         ulong deal=HistoryDealGetTicket(i);
         if(deal==0 || (ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagicNumber) continue;
         netPnl+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_SWAP)
                 +HistoryDealGetDouble(deal,DEAL_COMMISSION)+HistoryDealGetDouble(deal,DEAL_FEE);
        }
     }
   // Include current floating P/L for this EA's positions.
   for(int p=PositionsTotal()-1; p>=0; p--)
     {
      ulong ticket=PositionGetTicket(p);
      if(ticket==0 || (ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagicNumber) continue;
      netPnl+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
     }
   double balance=AccountInfoDouble(ACCOUNT_BALANCE);
   // Reconstruct account balance at day start using all account deals, not only
   // this EA's deals; the daily loss numerator above remains scoped to this Magic.
   double accountRealized=0.0;
   if(HistorySelect(dayStart,now))
     {
      int total=HistoryDealsTotal();
      for(int i=0; i<total; i++)
        {
         ulong deal=HistoryDealGetTicket(i);
         if(deal==0) continue;
         accountRealized+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_SWAP)
                          +HistoryDealGetDouble(deal,DEAL_COMMISSION)+HistoryDealGetDouble(deal,DEAL_FEE);
        }
     }
   estimatedStartBalance=balance-accountRealized;
   if(estimatedStartBalance<=0.0) estimatedStartBalance=AccountInfoDouble(ACCOUNT_EQUITY);
  }

bool DailyLimitsAllowEntry()
  {
   int trades=0, losses=0, streak=0;
   datetime lastClose=0;
   GetDailyPerformance(trades,losses,streak,lastClose);
   if(trades>=InpMaxTradesPerDay)
     {
      Comment("InvistaPRO Aura MT5 | Limite diário de operações atingido: ",trades);
      return false;
     }
   if(losses>=InpStopAfterDailyLosses)
     {
      Comment("InvistaPRO Aura MT5 | Bloqueado: limite de perdas no dia atingido: ",losses);
      return false;
     }
   double dailyNet=0.0, startBalance=0.0;
   GetDailyNetPnl(dailyNet,startBalance);
   double maxDailyLoss=startBalance*InpMaxDailyLossPercent/100.0;
   if(InpMaxDailyLossPercent>0.0 && maxDailyLoss>0.0 && dailyNet<=-maxDailyLoss)
     {
      Comment("InvistaPRO Aura MT5 | Bloqueado: limite monetário diário atingido. P/L=",
              DoubleToString(dailyNet,2)," limite=-",DoubleToString(maxDailyLoss,2));
      return false;
     }
   if(streak>=InpPauseAfterConsecutiveLosses && lastClose>0)
     {
      datetime now=TimeTradeServer();
      if(now<=0) now=TimeCurrent();
      if(now < lastClose + InpCooldownMinutes*60)
        {
         Comment("InvistaPRO Aura MT5 | Pausa após perdas consecutivas até ",TimeToString(lastClose+InpCooldownMinutes*60,TIME_MINUTES));
         return false;
        }
     }
   return true;
  }

bool AnyPositionOnThisSymbol()
  {
   for(int i=PositionsTotal()-1; i>=0; i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol) return true;
     }
   return false;
  }

bool OurPositionSelected()
  {
   for(int i=PositionsTotal()-1; i>=0; i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagicNumber)
         return true;
     }
   return false;
  }

double NormalizeVolumeDown(double volume)
  {
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double minVol=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxVol=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   if(step<=0.0 || minVol<=0.0) return 0.0;
   volume=MathMin(volume,maxVol);
   volume=MathFloor((volume+1e-10)/step)*step;
   int digits=2;
   if(step<0.01) digits=3;
   if(step<0.001) digits=4;
   volume=NormalizeDouble(volume,digits);
   if(volume<minVol) return 0.0;
   return volume;
  }

double CalculateRiskVolume(const ENUM_ORDER_TYPE orderType, const double entry, const double stop)
  {
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double riskCash=equity*InpRiskPercent/100.0;
   if(equity<=0.0 || riskCash<=0.0) return 0.0;
   double oneLotPnl=0.0;
   if(!OrderCalcProfit(orderType,_Symbol,1.0,entry,stop,oneLotPnl))
     {
      Print("Aura EA: OrderCalcProfit failed. Error=",GetLastError());
      return 0.0;
     }
   double lossPerLot=MathAbs(oneLotPnl)+InpEstimatedRoundTurnCostPerLot;
   if(lossPerLot<=0.0) return 0.0;
   double volume=NormalizeVolumeDown(riskCash/lossPerLot);
   if(volume<=0.0) return 0.0;

   // Never raise the lot size to the broker minimum if that would exceed configured risk.
   double actualLoss=0.0;
   if(!OrderCalcProfit(orderType,_Symbol,volume,entry,stop,actualLoss)) return 0.0;
   if(MathAbs(actualLoss)+InpEstimatedRoundTurnCostPerLot*volume>riskCash*1.02) return 0.0;
   return volume;
  }

bool IsPlanNetRiskRewardValid(const int direction, const double entry, const double stop,
                              const double target, const double volume)
  {
   if(volume<=0.0 || target<=0.0) return false;
   ENUM_ORDER_TYPE orderType=(direction>0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double stopPnl=0.0, targetPnl=0.0, partialPnl=0.0;
   if(!OrderCalcProfit(orderType,_Symbol,volume,entry,stop,stopPnl) ||
      !OrderCalcProfit(orderType,_Symbol,volume,entry,target,targetPnl)) return false;
   double cost=InpEstimatedRoundTurnCostPerLot*volume;
   double riskCash=MathAbs(stopPnl)+cost;
   if(riskCash<=0.0) return false;

   // Model the strategy's 50% partial at 1.5R and the remainder at the final target.
   double half=NormalizeVolumeDown(volume*0.50);
   double minVol=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double remaining=NormalizeVolumeDown(volume-half);
   double grossReward=0.0;
   if(half>0.0 && remaining>=minVol)
     {
      double partialTarget=(direction>0 ? entry+InpPartialTargetR*MathAbs(entry-stop)
                                        : entry-InpPartialTargetR*MathAbs(entry-stop));
      if(!OrderCalcProfit(orderType,_Symbol,half,entry,partialTarget,partialPnl)) return false;
      double finalPnl=0.0;
      if(!OrderCalcProfit(orderType,_Symbol,remaining,entry,target,finalPnl)) return false;
      grossReward=partialPnl+finalPnl;
     }
   else
      grossReward=targetPnl;

   double netReward=grossReward-cost;
   return (netReward>=2.0*riskCash);
  }

bool EnoughRoomForTarget(const int direction, const double entry, const double risk)
  {
   double pivot=0.0;
   if(direction>0)
     {
      if(!GetNearestPivotBeyondPrice(PERIOD_M15,true,entry,pivot)) return true;
      return ((pivot-entry) >= InpMinRoomR*risk);
     }
   if(!GetNearestPivotBeyondPrice(PERIOD_M15,false,entry,pivot)) return true;
   return ((entry-pivot) >= InpMinRoomR*risk);
  }

double CalculateFinalTarget(const int direction, const double entry, const double risk)
  {
   if(risk<=0.0 || InpFinalTargetR<InpMinRoomR) return 0.0;
   double targetR=InpFinalTargetR;
   double pivot=0.0;
   bool hasPivot=GetNearestPivotBeyondPrice(PERIOD_M15,direction>0,entry,pivot);
   if(hasPivot)
     {
      double room=(direction>0 ? pivot-entry : entry-pivot)-2.0*_Point;
      double roomR=room/risk;
      if(roomR<InpMinRoomR) return 0.0;
      targetR=MathMin(targetR,roomR);
     }
   if(targetR<InpMinRoomR) return 0.0;
   return (direction>0 ? entry+targetR*risk : entry-targetR*risk);
  }

void ResetSetup()
  {
   g_setupDirection=0;
   g_setupAge=0;
   g_setupCreatedBar=0;
   g_setupSignalTime=0;
   g_setupTrigger=0.0;
   g_setupStop=0.0;
  }

void SetBlockReason(const string reason)
  {
   g_lastBlockReason=reason;
  }

void EvaluateNewSignal()
  {
   if(!InpEnableTrading) { SetBlockReason("Conectado; execução pausada (InpEnableTrading=false)"); return; }
   SetBlockReason("Analisando confluências MTF");
   if(!IsAllowedSymbol()) { SetBlockReason("Símbolo bloqueado pela restrição opcional BTC/ETH/SOL"); return; }
   if(!IsInBrasiliaSession()) { SetBlockReason("Fora da janela operacional Brasília"); return; }
   if(NewsWindowBlocked()) { SetBlockReason("Bloqueio por notícia de alto impacto / calendário indisponível"); return; }
   if(!DailyLimitsAllowEntry()) { SetBlockReason("Limite diário ou cooldown de risco ativo"); return; }
   if(AnyPositionOnThisSymbol()) { SetBlockReason("Já existe posição aberta neste símbolo"); return; }
   if(!SpreadIsAcceptable()) { SetBlockReason("Spread excessivo ou ATR indisponível"); return; }

   bool rangeMode=false;
   int direction=DetermineTradeDirection(rangeMode);
   if(direction==0) { SetBlockReason("Sem alinhamento H4/H1 ou sem extremo de range"); return; }
   if(InpBlockMiddleOfRange && IsInMiddleOfRange()) { SetBlockReason("Preço no meio do range M15"); return; }
   if(InpRequireM15BreakConfirmation && !HasM15DirectionalBreak(direction)) { SetBlockReason("BOS/CHoCH M15 não confirmado"); return; }
   if(!PriceIsAtZone(direction)) { SetBlockReason("Preço fora das zonas S/R, FVG e OB ativas"); return; }
   if(!VolumeConfirms()) { SetBlockReason("Volume M5 abaixo da média mínima"); return; }
   bool pattern=(direction>0 ? IsBullishSignalCandle() : IsBearishSignalCandle());
   if(!pattern) { SetBlockReason("Sem padrão M5 válido (rejeição, engolfo ou inside bar)"); return; }
   if(InpRequireLiquiditySweep && !HasLiquiditySweep(direction)) { SetBlockReason("Sweep de liquidez M5 não confirmado"); return; }
   if(InpRequireM1Confirmation && !HasM1MicroBreak(direction,iTime(_Symbol,PERIOD_M5,1)))
     { SetBlockReason("Microestrutura M1 não confirmou o sinal M5"); return; }

   double atr=ReadAtr(g_atrM5Handle,1);
   if(atr<=0.0) { SetBlockReason("ATR M5 indisponível"); return; }
   double signalHigh=iHigh(_Symbol,PERIOD_M5,1);
   double signalLow=iLow(_Symbol,PERIOD_M5,1);
   double stop=0.0,pivot=0.0;
   if(direction>0)
     {
      stop=signalLow-atr*InpSignalAtrStopBuffer;
      if(GetNearestPivotBeyondPrice(PERIOD_M5,false,signalLow,pivot) && pivot<signalLow)
         stop=MathMin(stop,pivot-atr*InpSignalAtrStopBuffer);
      g_setupTrigger=signalHigh+_Point;
     }
   else
     {
      stop=signalHigh+atr*InpSignalAtrStopBuffer;
      if(GetNearestPivotBeyondPrice(PERIOD_M5,true,signalHigh,pivot) && pivot>signalHigh)
         stop=MathMax(stop,pivot+atr*InpSignalAtrStopBuffer);
      g_setupTrigger=signalLow-_Point;
     }
   double refPrice=(SymbolInfoDouble(_Symbol,SYMBOL_ASK)+SymbolInfoDouble(_Symbol,SYMBOL_BID))*0.5;
   double stopPct=100.0*MathAbs(refPrice-stop)/refPrice;
   if(stopPct<=0.0 || stopPct>InpMaxStopPercent) { SetBlockReason("Stop estrutural excede o risco máximo permitido"); return; }
   if(!EnoughRoomForTarget(direction,refPrice,MathAbs(refPrice-stop)))
     { SetBlockReason("Espaço até a próxima estrutura inferior a 2R"); return; }

   g_setupDirection=direction;
   g_setupAge=0;
   g_setupCreatedBar=iTime(_Symbol,PERIOD_M5,0);
   g_setupSignalTime=iTime(_Symbol,PERIOD_M5,1);
   g_setupStop=stop;
   SetBlockReason("Setup armado; aguardando rompimento do gatilho");
   Print("Aura EA: setup armed: ",(direction>0?"BUY":"SELL")," ",_Symbol,
         " trigger=",DoubleToString(g_setupTrigger,_Digits),
         " structuralSL=",DoubleToString(g_setupStop,_Digits));
  }
void OnNewM5Bar()
  {
   if(g_setupDirection!=0 && g_setupCreatedBar!=iTime(_Symbol,PERIOD_M5,0))
     {
      g_setupAge++;
      if(g_setupAge>=InpSetupExpiryBars)
        { ResetSetup(); SetBlockReason("Setup expirou sem rompimento do gatilho"); }
      else
         return; // Keep waiting for the active breakout setup.
     }
   if(g_setupDirection==0) EvaluateNewSignal();
  }



string CoreJsonString(const string json,const string key)
  {
   int keyPos=StringFind(json,"\""+key+"\"");
   if(keyPos<0) return "";
   int colon=StringFind(json,":",keyPos);
   if(colon<0) return "";
   int start=StringFind(json,"\"",colon+1);
   if(start<0) return "";
   int end=StringFind(json,"\"",start+1);
   if(end<0) return "";
   return StringSubstr(json,start+1,end-start-1);
  }

double CoreJsonNumber(const string json,const string key)
  {
   int keyPos=StringFind(json,"\""+key+"\"");
   if(keyPos<0) return 0.0;
   int colon=StringFind(json,":",keyPos);
   if(colon<0) return 0.0;
   string tail=StringSubstr(json,colon+1);
   StringTrimLeft(tail);
   int comma=StringFind(tail,",");
   int brace=StringFind(tail,"}");
   int end=StringLen(tail);
   if(comma>=0 && comma<end) end=comma;
   if(brace>=0 && brace<end) end=brace;
   return StringToDouble(StringSubstr(tail,0,end));
  }

datetime g_lastCoreReviewAttempt = 0;

string BuildCoreCandleArray(const ENUM_TIMEFRAMES timeframe,const int requested)
  {
   MqlRates rates[];
   ArraySetAsSeries(rates,false);
   int copied=CopyRates(_Symbol,timeframe,1,requested,rates);
   if(copied<30) return "[]";
   string json="[";
   for(int i=0;i<copied;i++)
     {
      if(i>0) json+=",";
      json+="{";
      json+="\"time\":"+StringFormat("%I64d",(long)rates[i].time)+",";
      json+="\"open\":"+DoubleToString(rates[i].open,_Digits)+",";
      json+="\"high\":"+DoubleToString(rates[i].high,_Digits)+",";
      json+="\"low\":"+DoubleToString(rates[i].low,_Digits)+",";
      json+="\"close\":"+DoubleToString(rates[i].close,_Digits)+",";
      json+="\"volume\":"+StringFormat("%I64d",(long)rates[i].tick_volume);
      json+="}";
     }
   json+="]";
   return json;
  }

bool RequestCentralAIApproval(const int localDirection)
  {
   datetime now=TimeCurrent();
   if(g_lastCoreReviewAttempt>0 && now-g_lastCoreReviewAttempt<10) return false;
   g_lastCoreReviewAttempt=now;
   string base=InpServerURL;
   StringTrimLeft(base); StringTrimRight(base);
   while(StringLen(base)>0 && StringSubstr(base,StringLen(base)-1,1)=="/")
      base=StringSubstr(base,0,StringLen(base)-1);
   if(StringLen(InpApiToken)<16 || StringLen(base)<8)
     { SetBlockReason("Consenso central indisponível: URL/token não configurado"); return false; }

   string h4=BuildCoreCandleArray(PERIOD_H4,60);
   string h1=BuildCoreCandleArray(PERIOD_H1,60);
   string m15=BuildCoreCandleArray(PERIOD_M15,60);
   string m5=BuildCoreCandleArray(PERIOD_M5,80);
   string m1=BuildCoreCandleArray(PERIOD_M1,80);
   if(h4=="[]" || h1=="[]" || m15=="[]" || m5=="[]" || m1=="[]")
     { SetBlockReason("Consenso central aguardando pelo menos 30 candles por timeframe"); return false; }
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick)) { SetBlockReason("Cotação indisponível para análise central"); return false; }
   string accountType=CurrentAccountType();
   if(accountType!="demo" && accountType!="real")
     { SetBlockReason("Conta MT5 não é DEMO/REAL válida"); return false; }

   string body="{";
   body+="\"symbol\":\""+JsonEscape(_Symbol)+"\",";
   body+="\"accountId\":\""+StringFormat("%I64d",AccountInfoInteger(ACCOUNT_LOGIN))+"\",";
   body+="\"accountType\":\""+accountType+"\",";
   body+="\"token\":\""+JsonEscape(InpApiToken)+"\",";
   body+="\"ask\":"+DoubleToString(tick.ask,_Digits)+",";
   body+="\"bid\":"+DoubleToString(tick.bid,_Digits)+",";
   body+="\"priceActionUseAIReview\":true,";
   body+="\"candles\":"+m5+",";
   body+="\"timeframes\":{\"H4\":"+h4+",\"H1\":"+h1+",\"M15\":"+m15+",\"M5\":"+m5+",\"M1\":"+m1+"},";
   body+="\"indicatorSignals\":{},\"indicatorBuffers\":[]";
   body+="}";
   char data[],result[];
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   string responseHeaders;
   string headers="Content-Type: application/json\r\n";
   ResetLastError();
   int http=WebRequest("POST",base+"/api/metatrader/signal-with-indicators",headers,12000,data,result,responseHeaders);
   if(http!=200)
     {
      SetBlockReason("Consenso central sem resposta válida (HTTP "+IntegerToString(http)+")");
      Print("Aura EA: core AI review failed HTTP=",http," err=",GetLastError()," response=",CharArrayToString(result,0,-1,CP_UTF8));
      return false;
     }
   string response=CharArrayToString(result,0,-1,CP_UTF8);
   string action=CoreJsonString(response,"action");
   string reason=CoreJsonString(response,"reason");
   double confidence=CoreJsonNumber(response,"confidence");
   string expected=(localDirection>0 ? "BUY" : "SELL");
   if(action!=expected)
     { SetBlockReason("Consenso central não aprovou "+expected+": "+(reason!=""?reason:"ação "+action)); return false; }
   if(confidence<0.70)
     { SetBlockReason("Consenso central abaixo de 70% ("+DoubleToString(confidence*100.0,1)+"%)"); return false; }
   if(StringFind(response,"\"executionEnabled\":true")<0)
     { SetBlockReason("Backend não autorizou execução: "+(reason!=""?reason:"executionEnabled ausente")); return false; }
   Print("Aura EA: consenso central aprovado ",action," | confiança=",DoubleToString(confidence*100.0,1),"% | ",reason);
   SetBlockReason("Consenso central aprovado; preparando execução");
   return true;
  }

bool OpenPositionFromSetup()
  {
   if(!InpEnableTrading) { SetBlockReason("Entrada bloqueada: habilite InpEnableTrading após validar DEMO"); return false; }
   if(g_setupDirection==0) return false;
   if(!RequestCentralAIApproval(g_setupDirection)) return false;
   if(!IsAllowedSymbol()) { SetBlockReason("Entrada cancelada: símbolo não permitido"); return false; }
   if(!IsInBrasiliaSession()) { SetBlockReason("Entrada cancelada: fora da sessão"); return false; }
   if(NewsWindowBlocked()) { SetBlockReason("Entrada cancelada: bloqueio de notícia"); return false; }
   if(!DailyLimitsAllowEntry()) { SetBlockReason("Entrada cancelada: limite diário/cooldown"); return false; }
   if(AnyPositionOnThisSymbol()) { SetBlockReason("Entrada cancelada: já existe posição no símbolo"); return false; }
   if(!SpreadIsAcceptable()) { SetBlockReason("Entrada cancelada: spread/ATR fora do limite"); return false; }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick)) { SetBlockReason("Entrada cancelada: cotação indisponível"); return false; }
   int direction=g_setupDirection;
   double entry=(direction>0 ? tick.ask : tick.bid);
   double stop=g_setupStop;
   double risk=MathAbs(entry-stop);
   if(risk<=_Point*2.0 || entry<=0.0) { ResetSetup(); SetBlockReason("Entrada cancelada: risco/preço inválido"); return false; }
   double stopPct=100.0*risk/entry;
   if(stopPct>InpMaxStopPercent) { ResetSetup(); SetBlockReason("Entrada cancelada: stop acima do percentual máximo"); return false; }
   if(!EnoughRoomForTarget(direction,entry,risk)) { ResetSetup(); SetBlockReason("Entrada cancelada: espaço estrutural insuficiente"); return false; }

   double stopLevel=(double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*_Point;
   if(direction>0 && entry-stop<stopLevel) stop=entry-stopLevel;
   if(direction<0 && stop-entry<stopLevel) stop=entry+stopLevel;
   stop=NormalizeTradePrice(stop,direction,true);
   risk=MathAbs(entry-stop);
   if(risk<=0.0 || 100.0*risk/entry>InpMaxStopPercent) { ResetSetup(); return false; }

   double target=CalculateFinalTarget(direction,entry,risk);
   if(target>0.0) target=NormalizeTradePrice(target,direction,false);
   if(target<=0.0 || (direction>0 && (stop>=entry || target<=entry)) ||
      (direction<0 && (stop<=entry || target>=entry)))
     {
      Print("Aura EA: no valid target with minimum room of ",DoubleToString(InpMinRoomR,2),"R.");
      ResetSetup();
      SetBlockReason("Entrada cancelada: stop/target inválido ou broker distance");
      return false;
     }
   double volume=CalculateRiskVolume(direction>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL,entry,stop);
   if(volume<=0.0)
     {
      Print("Aura EA: volume was rejected because minimum lot / tick-value would exceed risk.");
      ResetSetup(); SetBlockReason("Entrada cancelada: volume mínimo excede o risco permitido");
      return false;
     }
   if(!IsPlanNetRiskRewardValid(direction,entry,stop,target,volume))
     {
      Print("Aura EA: trade rejected because projected net risk/reward is below 1:2. Configure estimated round-turn costs.");
      ResetSetup(); SetBlockReason("Entrada cancelada: R:R líquido abaixo de 1:2");
      return false;
     }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   string comment="InvistaPRO Aura V10";
   bool ok=(direction>0 ? trade.Buy(volume,_Symbol,0.0,stop,target,comment)
                        : trade.Sell(volume,_Symbol,0.0,stop,target,comment));
   if(!TradeRetcodeSucceeded(ok,true))
     {
      Print("Aura EA: order failed. retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
      ResetSetup(); SetBlockReason("Ordem rejeitada pelo servidor: "+trade.ResultRetcodeDescription());
      return false;
     }

   // Save actual fill-based risk after the broker confirms the position.
   if(PositionSelect(_Symbol) && (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagicNumber)
     {
      double actualEntry=PositionGetDouble(POSITION_PRICE_OPEN);
      double actualSL=PositionGetDouble(POSITION_SL);
      g_initialRisk=MathAbs(actualEntry-actualSL);
      g_initialVolume=PositionGetDouble(POSITION_VOLUME);
      g_partialTaken=false;
      if(g_initialRisk>0.0) SavePositionState();
     }
   Print("Aura EA: ",(direction>0?"BUY":"SELL")," sent. volume=",DoubleToString(volume,4),
         " risk%=",DoubleToString(InpRiskPercent,2)," SL=",DoubleToString(stop,_Digits),
         " TP=",DoubleToString(target,_Digits));
   ResetSetup();
   SetBlockReason("Posição aberta e gestão ativa");
   return true;
  }

bool ClosePartial(const ulong ticket, const double volume, const ENUM_POSITION_TYPE posType)
  {
   double v=NormalizeVolumeDown(volume);
   if(v<=0.0) return false;
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   long marginMode=AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   bool ok=false;
   if(marginMode==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      ok=trade.PositionClosePartial(ticket,v);
   else
     {
      // On a netting account, an opposite market deal reduces the existing net position.
      if(posType==POSITION_TYPE_BUY) ok=trade.Sell(v,_Symbol,0.0,0.0,0.0,"Aura partial close");
      else ok=trade.Buy(v,_Symbol,0.0,0.0,0.0,"Aura partial close");
     }
   if(!TradeRetcodeSucceeded(ok))
     {
      Print("Aura EA: partial close failed: ",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
      return false;
     }
   return true;
  }

bool StopModificationHasBrokerClearance(const ENUM_POSITION_TYPE type,const double newStop,const MqlTick &tick)
  {
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   long stops=(long)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   long freeze=(long)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL);
   double minDistance=(double)MathMax(stops,freeze)*point;
   if(point<=0.0 || newStop<=0.0) return false;
   if(type==POSITION_TYPE_BUY) return (newStop<tick.bid && tick.bid-newStop>=minDistance);
   return (newStop>tick.ask && newStop-tick.ask>=minDistance);
  }

void ManageOpenPosition()
  {
   ulong positionTicket=0;
   for(int i=PositionsTotal()-1; i>=0; i--)
     {
      ulong candidate=PositionGetTicket(i);
      if(candidate==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagicNumber)
        { positionTicket=candidate; break; }
     }
   if(positionTicket==0 || !PositionSelectByTicket(positionTicket)) return;

   LoadPositionState();
   ENUM_POSITION_TYPE type=(ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   double entry=PositionGetDouble(POSITION_PRICE_OPEN);
   double sl=PositionGetDouble(POSITION_SL);
   double tp=PositionGetDouble(POSITION_TP);
   double volume=PositionGetDouble(POSITION_VOLUME);
   if(g_initialRisk<=0.0 && sl>0.0)
     {
      g_initialRisk=MathAbs(entry-sl);
      g_initialVolume=volume;
      SavePositionState();
     }
   if(g_initialRisk<=0.0) return;

   // Recover partial-close state after a terminal/VPS restart. If the live volume
   // is already materially below the recorded initial volume, never close twice.
   double volumeStep=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(!g_partialTaken && g_initialVolume>0.0 && volumeStep>0.0 &&
      volume<g_initialVolume-volumeStep*0.5)
     {
      g_partialTaken=true;
      SavePositionState();
      Print("Aura EA: partial-close state recovered from live position volume.");
     }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick)) return;
   double favorable=(type==POSITION_TYPE_BUY ? tick.bid-entry : entry-tick.ask);
   double t1=(type==POSITION_TYPE_BUY ? entry+InpPartialTargetR*g_initialRisk
                                      : entry-InpPartialTargetR*g_initialRisk);
   bool target1Reached=(type==POSITION_TYPE_BUY ? tick.bid>=t1 : tick.ask<=t1);

   // Move SL to break-even after +1R.
   if(InpMoveStopToBreakEvenAt1R && favorable>=g_initialRisk)
     {
      double be=(type==POSITION_TYPE_BUY ? entry+InpBreakEvenOffsetPoints*_Point
                                         : entry-InpBreakEvenOffsetPoints*_Point);
      be=NormalizeTradePrice(be,(type==POSITION_TYPE_BUY?1:-1),true);
      bool improves=(type==POSITION_TYPE_BUY ? (sl==0.0 || be>sl+_Point)
                                             : (sl==0.0 || be<sl-_Point));
      if(improves && StopModificationHasBrokerClearance(type,be,tick))
        {
         bool modified=trade.PositionModify(positionTicket,be,tp);
         if(TradeRetcodeSucceeded(modified)) Print("Aura EA: stop moved to break-even.");
         else Print("Aura EA: break-even modification failed: ",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
        }
     }

   // Partial close 50% of the initial position at +1.5R.
   if(target1Reached && !g_partialTaken)
     {
      double minVol=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
      double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
      double desired=NormalizeVolumeDown(MathMin(g_initialVolume*0.50,volume));
      if(desired>0.0 && volume-desired>=minVol-step*0.1)
        {
         if(ClosePartial(positionTicket,desired,type))
           {
            g_partialTaken=true;
            SavePositionState();
            Print("Aura EA: partial profit taken at +",DoubleToString(InpPartialTargetR,2),"R.");
           }
        }
      else
        {
         // Too small to split legally. Avoid repeated failed partial close attempts.
         g_partialTaken=true;
         SavePositionState();
        }
     }

   // Structural trailing starts only after the partial target has been reached.
   if(InpUseAtrTrailingAfterPartial && g_partialTaken)
     {
      double atr=ReadAtr(g_atrM5Handle,1);
      if(atr>0.0)
        {
         double swingPrice=0.0;
         int swingShift=0;
         bool hasSwing=FindSwing(PERIOD_M5,(type==POSITION_TYPE_SELL),2,InpSwingLookback,swingPrice,swingShift);
         if(!hasSwing) return;
         double candidate=(type==POSITION_TYPE_BUY ? swingPrice-atr*InpTrailingAtrMultiplier
                                                   : swingPrice+atr*InpTrailingAtrMultiplier);
         candidate=NormalizeTradePrice(candidate,(type==POSITION_TYPE_BUY?1:-1),true);
         bool improves=(type==POSITION_TYPE_BUY ? candidate>sl+_Point : (sl==0.0 || candidate<sl-_Point));
         if(improves && StopModificationHasBrokerClearance(type,candidate,tick))
           {
            bool modified=trade.PositionModify(positionTicket,candidate,tp);
            if(!TradeRetcodeSucceeded(modified))
               Print("Aura EA: trailing stop modification failed: ",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
           }
        }
     }
  }

void UpdatePanel()
  {
   int trades=0, losses=0, streak=0;
   datetime lastClose=0;
   GetDailyPerformance(trades,losses,streak,lastClose);
   string trend="NEUTRO / SEM CONTEXTO";
   bool rangeMode=false;
   int direction=DetermineTradeDirection(rangeMode);
   if(rangeMode) trend=(direction>0 ? "RANGE: EXTREMO INFERIOR" : "RANGE: EXTREMO SUPERIOR");
   else if(direction==1) trend="ALTA";
   else if(direction==-1) trend="BAIXA";
   double dailyNet=0.0,startBalance=0.0;
   GetDailyNetPnl(dailyNet,startBalance);
   string setup=(g_setupDirection>0 ? "COMPRA ARMADA" : (g_setupDirection<0 ? "VENDA ARMADA" : "SEM GATILHO"));
   Comment("INVISTAPRO V10 AURA 1.50 | MT5\n",
           "Símbolo: ",_Symbol," | Tendência H4/H1: ",trend,"\n",
           "Setup M5: ",setup," | Trades hoje: ",trades,"/",InpMaxTradesPerDay,"\n",
           "Perdas hoje: ",losses,"/",InpStopAfterDailyLosses," | Sequência atual: ",streak,"\n",
           "P/L diário EA: ",DoubleToString(dailyNet,2)," | Limite: ",DoubleToString(InpMaxDailyLossPercent,2),"%\n",
           "Sessão Brasília: ",(IsInBrasiliaSession()?"ATIVA":"INATIVA"),
           " | Filtro notícias: ",(InpUseHighImpactNewsFilter?"LIGADO":"DESLIGADO"),"\n",
           "Status: ",g_lastBlockReason);
  }

//+------------------------------------------------------------------+
//| InvistaPRO authenticated heartbeat                                |
//+------------------------------------------------------------------+
string JsonEscape(const string value)
  {
   string out=value;
   StringReplace(out,"\\","\\\\");
   StringReplace(out,"\"","\\\"");
   StringReplace(out,"\r","");
   StringReplace(out,"\n","");
   return out;
  }

string CurrentAccountType()
  {
   long mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode==ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode==ACCOUNT_TRADE_MODE_REAL) return "real";
   if(mode==ACCOUNT_TRADE_MODE_CONTEST) return "contest";
   return "unknown";
  }

int CountAuraPositions()
  {
   int count=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC)==InpMagicNumber) count++;
     }
   return count;
  }

void SendInvistaHeartbeat()
  {
   if(MQLInfoInteger(MQL_TESTER)) return;
   string base=InpServerURL;
   StringTrimLeft(base);
   StringTrimRight(base);
   while(StringLen(base)>0 && StringSubstr(base,StringLen(base)-1,1)=="/")
      base=StringSubstr(base,0,StringLen(base)-1);
   if(StringLen(base)<8 || StringLen(InpApiToken)<16)
     {
      static bool warned=false;
      if(!warned)
        {
         Print("Aura EA: integração InvistaPRO sem URL/token válido. Baixe o EA pelo painel MetaTrader autenticado.");
         warned=true;
        }
      return;
     }

   string accountType=CurrentAccountType();
   if(accountType=="unknown")
     {
      Print("Aura EA: tipo de conta MT5 desconhecido; heartbeat bloqueado por segurança.");
      return;
     }
   string accountId=StringFormat("%I64d",AccountInfoInteger(ACCOUNT_LOGIN));
   string broker=AccountInfoString(ACCOUNT_COMPANY);
   string payload=StringFormat(
      "{\"accountId\":\"%s\",\"broker\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"openPositions\":%d,\"symbol\":\"%s\",\"platform\":\"MT5\",\"accountType\":\"%s\",\"token\":\"%s\"}",
      JsonEscape(accountId),JsonEscape(broker),AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      CountAuraPositions(),JsonEscape(_Symbol),accountType,JsonEscape(InpApiToken));

   char data[],result[];
   StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   string responseHeaders;
   string headers="Content-Type: application/json\r\n";
   ResetLastError();
   int status=WebRequest("POST",base+"/api/mt5/heartbeat",headers,5000,data,result,responseHeaders);
   if(status==200)
      Print("Aura EA: heartbeat InvistaPRO confirmado. Conta ",accountId," | ",accountType);
   else
      Print("Aura EA: heartbeat InvistaPRO falhou. HTTP=",status," erro=",GetLastError(),
            " resposta=",CharArrayToString(result,0,-1,CP_UTF8));
  }

//+------------------------------------------------------------------+
//| Expert lifecycle                                                  |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpRiskPercent<=0.0 || InpRiskPercent>2.0)
     {
      Print("Aura EA: InpRiskPercent must be > 0 and <= 2.0 for this configuration.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpMaxStopPercent<=0.0 || InpMaxTradesPerDay<1 || InpSetupExpiryBars<1 ||
      InpSwingLookback<10 || InpAtrPeriod<2 || InpLiquidityLookback<3 ||
      InpZoneAtrMultiplier<=0.0 || InpMinVolumeVsAverage<=0.0 ||
      InpWickToBodyRatio<=0.0 || InpMaxSpreadAsAtr<=0.0 ||
      InpRangeMiddleLow<0.0 || InpRangeMiddleHigh>1.0 ||
      InpRangeMiddleLow>=InpRangeMiddleHigh || InpZoneClusterMinTouches<2 ||
      InpZoneClusterAtrTolerance<=0.0 ||
      InpMinRoomR<2.0 || InpFinalTargetR<InpMinRoomR ||
      InpPartialTargetR<=0.0 || InpPartialTargetR>=InpMinRoomR ||
      InpTrailingAtrMultiplier<=0.0 || InpNewsMinutesBefore<0 || InpNewsMinutesAfter<0 ||
      InpPauseAfterConsecutiveLosses<1 || InpStopAfterDailyLosses<1 ||
      InpMaxDailyLossPercent<0.0 || InpMaxDailyLossPercent>20.0 ||
      InpCooldownMinutes<0 || InpSlippagePoints<0 || InpEstimatedRoundTurnCostPerLot<0.0 ||
      InpBrasiliaUtcOffsetHours<-12 ||
      InpBrasiliaUtcOffsetHours>14 || InpBreakEvenOffsetPoints<0.0)
      return INIT_PARAMETERS_INCORRECT;

   g_atrM5Handle=iATR(_Symbol,PERIOD_M5,InpAtrPeriod);
   g_atrM15Handle=iATR(_Symbol,PERIOD_M15,InpAtrPeriod);
   if(g_atrM5Handle==INVALID_HANDLE || g_atrM15Handle==INVALID_HANDLE)
     {
      Print("Aura EA: failed to create ATR handles. Error=",GetLastError());
      return INIT_FAILED;
     }
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   g_lastM5BarTime=iTime(_Symbol,PERIOD_M5,0);
   LoadPositionState();
   EventSetTimer(MathMax(10,InpHeartbeatSeconds));
   SendInvistaHeartbeat();
   Print("InvistaPRO V10 Aura MT5 initialized on ",_Symbol,
         ". Use Strategy Tester and DEMO account before any live trading.");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_atrM5Handle!=INVALID_HANDLE) IndicatorRelease(g_atrM5Handle);
   if(g_atrM15Handle!=INVALID_HANDLE) IndicatorRelease(g_atrM15Handle);
   Comment("");
  }

void OnTimer()
  {
   SendInvistaHeartbeat();
  }

void OnTick()
  {
   ManageOpenPosition();

   // Clear persisted management state only when this EA no longer has a position on this symbol.
   if(!OurPositionSelected() && g_initialRisk>0.0) ClearPositionState();

   if(IsNewM5Bar()) OnNewM5Bar();

   if(g_setupDirection!=0)
     {
      if(g_setupDirection>0 && SymbolInfoDouble(_Symbol,SYMBOL_ASK)>=g_setupTrigger)
         OpenPositionFromSetup();
      else if(g_setupDirection<0 && SymbolInfoDouble(_Symbol,SYMBOL_BID)<=g_setupTrigger)
         OpenPositionFromSetup();
     }
   UpdatePanel();
  }
//+------------------------------------------------------------------+