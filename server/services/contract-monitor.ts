/**
 * MONITOR UNIVERSAL DE CONTRATOS — InvestaPRO
 * 
 * Acompanha cada operação aberta tick a tick como um trader humano expert,
 * com inteligência específica para cada modalidade da Deriv.
 * 
 * Modalidades suportadas:
 *   ACCU        — Accumulator: fecha no alvo de lucro ou reversão
 *   MULT        — Multiplier: gerencia stop/take_profit dinâmico  
 *   CALL/PUT    — Rise/Fall: venda antecipada no momento ideal
 *   TURBOSLONG/TURBOSSHORT — Turbo: evita breach de barreira
 *   VANILLACALL/VANILLAPUT — Vanilla: monitora moneyness e delta
 *   DIGITDIFF/OVER/UNDER/MATCH/EVEN/ODD — Digit: auto-fecha (monitora)
 *   LBFLOATPUT/LBFLOATCALL/LBHIGHLOW — Lookback: auto-expira (monitora)
 *   ONETOUCH/NOTOUCH/RANGE/EXPIRYRANGE — Barrier: vende se lucrativo
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { marketDataCollector } from './market-data-collector';

// ─────────────────────────── Tipos ───────────────────────────

export interface MonitoredContractInput {
  contractId: number;
  contractType: string;       // e.g., ACCU, CALL, PUT, TURBOSLONG, etc.
  symbol: string;
  buyPrice: number;
  amount: number;
  direction?: 'up' | 'down' | 'neutral';
  userId: string;
  openedAt: number;           // timestamp ms
  growthRate?: number;        // para ACCU
  multiplier?: number;        // para MULT
  barrier?: string;           // barreira do contrato
  highBarrier?: string;
  lowBarrier?: string;
  dateExpiry?: number;        // timestamp unix para contratos com prazo
}

interface ContractState {
  input: MonitoredContractInput;
  bidPrice: number;
  currentSpot: number;
  entrySpot: number;
  profit: number;
  profitPct: number;
  isValidToSell: boolean;
  isSold: boolean;
  isExpired: boolean;
  barrierValue?: number;
  barrierDistance?: number;   // % distância do barrier ao spot
  tickCount: number;
  lastUpdate: number;
  subscriptionId?: string;
  aiSignalBuffer: Array<{ ts: number; direction: 'up' | 'down' | 'neutral'; strength: number }>;
  peakProfit: number;         // maior lucro já visto
  peakBidPrice: number;
  status: 'monitoring' | 'closing' | 'closed';
}

interface SellDecision {
  shouldSell: boolean;
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'emergency';
}

// ─────────────────── Constantes por modalidade ───────────────────

const CONTRACT_CATEGORIES = {
  // Precisa fechamento manual — principal alvo do monitor
  MANUAL_CLOSE: ['ACCU', 'MULTUP', 'MULTDOWN'],

  // Pode vender antecipado mas também expira automaticamente
  EARLY_SELL: [
    'CALL', 'PUT', 'RISE', 'FALL',
    'TURBOSLONG', 'TURBOSSHORT',
    'VANILLACALL', 'VANILLAPUT',
    'ONETOUCH', 'NOTOUCH',
    'RANGE', 'EXPIRYRANGE', 'UPORDOWN',
    'CALLE', 'PUTE',
  ],

  // Auto-fecham: apenas monitora resultado
  AUTO_CLOSE: [
    'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
    'DIGITMATCH', 'DIGITEVEN', 'DIGITODD',
    'LBFLOATPUT', 'LBFLOATCALL', 'LBHIGHLOW',
  ],
};

function getCategory(contractType: string): 'MANUAL_CLOSE' | 'EARLY_SELL' | 'AUTO_CLOSE' {
  const t = contractType.toUpperCase();
  if (CONTRACT_CATEGORIES.MANUAL_CLOSE.includes(t)) return 'MANUAL_CLOSE';
  if (CONTRACT_CATEGORIES.AUTO_CLOSE.includes(t)) return 'AUTO_CLOSE';
  return 'EARLY_SELL';
}

// ─────────────────── Limiares por modalidade ───────────────────

interface ExitThresholds {
  profitTargetPct: number;      // fechar quando lucro atingir X%
  trailingStopPct: number;      // fechar se cair X% do pico
  barrierDangerPct: number;     // fechar se barreira < X% do spot
  maxDurationMin: number;       // fechar após N minutos independente
  earlyLossExitPct: number;     // fechar se perda > X% (corte de perda)
  aiReversalStrength: number;   // força mínima do sinal de reversão p/ fechar
  minTicksBeforeSell: number;   // ticks mínimos antes de poder fechar
}

function getThresholds(contractType: string): ExitThresholds {
  const t = contractType.toUpperCase();
  switch (t) {
    case 'ACCU':
      return {
        profitTargetPct: 40,      // 40% de lucro → fecha
        trailingStopPct: 15,      // cair 15% do pico → fecha (trailing)
        barrierDangerPct: 0.4,    // barreira a <0.4% → urgente
        maxDurationMin: 15,       // máx 15 min
        earlyLossExitPct: 999,    // ACCU não tem perda negativa (perde o stake se cruzar)
        aiReversalStrength: 70,
        minTicksBeforeSell: 5,
      };
    case 'MULTUP':
    case 'MULTDOWN':
      return {
        profitTargetPct: 60,
        trailingStopPct: 20,
        barrierDangerPct: 1.0,
        maxDurationMin: 20,
        earlyLossExitPct: 40,     // sai se perder 40% do stake
        aiReversalStrength: 65,
        minTicksBeforeSell: 3,
      };
    case 'TURBOSLONG':
    case 'TURBOSSHORT':
      return {
        profitTargetPct: 50,
        trailingStopPct: 25,
        barrierDangerPct: 1.5,    // turbos têm barreira próxima
        maxDurationMin: 10,
        earlyLossExitPct: 50,
        aiReversalStrength: 75,
        minTicksBeforeSell: 3,
      };
    case 'VANILLACALL':
    case 'VANILLAPUT':
      return {
        profitTargetPct: 80,
        trailingStopPct: 30,
        barrierDangerPct: 2.0,
        maxDurationMin: 60,
        earlyLossExitPct: 60,
        aiReversalStrength: 70,
        minTicksBeforeSell: 5,
      };
    case 'CALL':
    case 'PUT':
    case 'RISE':
    case 'FALL':
    case 'CALLE':
    case 'PUTE':
      return {
        profitTargetPct: 70,      // 70% de lucro sobre o payout
        trailingStopPct: 20,
        barrierDangerPct: 0,      // sem barreira física
        maxDurationMin: 30,
        earlyLossExitPct: 75,     // corta perda se bid cair 75%
        aiReversalStrength: 72,
        minTicksBeforeSell: 5,
      };
    case 'ONETOUCH':
    case 'NOTOUCH':
    case 'RANGE':
    case 'EXPIRYRANGE':
    case 'UPORDOWN':
      return {
        profitTargetPct: 65,
        trailingStopPct: 25,
        barrierDangerPct: 0.5,
        maxDurationMin: 30,
        earlyLossExitPct: 70,
        aiReversalStrength: 70,
        minTicksBeforeSell: 4,
      };
    default:
      return {
        profitTargetPct: 60,
        trailingStopPct: 20,
        barrierDangerPct: 1.0,
        maxDurationMin: 20,
        earlyLossExitPct: 50,
        aiReversalStrength: 70,
        minTicksBeforeSell: 5,
      };
  }
}

// ─────────────────── Análise técnica rápida (sem IA externa) ───────────────

function computeQuickSignal(
  recentPrices: number[],
  direction: 'up' | 'down' | 'neutral'
): { reversalDetected: boolean; strength: number; trend: 'up' | 'down' | 'neutral' } {
  if (recentPrices.length < 8) return { reversalDetected: false, strength: 0, trend: 'neutral' };

  const prices = recentPrices.slice(-20);
  const n = prices.length;

  // EMA rápida (5) vs lenta (15)
  function ema(data: number[], period: number): number {
    const k = 2 / (period + 1);
    let e = data[0];
    for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  }

  const emaFast = ema(prices, Math.min(5, n));
  const emaSlow = ema(prices, Math.min(15, n));

  // RSI rápido
  let gains = 0, losses = 0;
  const rsiWindow = Math.min(7, n - 1);
  for (let i = n - rsiWindow; i < n; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);

  // Momentum curto (últimos 3 ticks)
  const momentum3 = prices[n - 1] - prices[n - 4 < 0 ? 0 : n - 4];
  const momentum3Pct = momentum3 / prices[n - 4 < 0 ? 0 : n - 4];

  // Determinar tendência atual
  let trend: 'up' | 'down' | 'neutral';
  if (emaFast > emaSlow * 1.0001) trend = 'up';
  else if (emaFast < emaSlow * 0.9999) trend = 'down';
  else trend = 'neutral';

  // Reversão detectada se tendência oposta ao direction
  let reversalDetected = false;
  let strength = 0;

  if (direction === 'up') {
    // Procurando sinais de queda (reversão adversa)
    const bearRSI = rsi > 65 ? (rsi - 65) / 35 : 0;
    const bearMomentum = momentum3Pct < -0.001 ? Math.min(1, Math.abs(momentum3Pct) / 0.01) : 0;
    const bearEMA = trend === 'down' ? 0.8 : 0;
    strength = (bearRSI * 30 + bearMomentum * 40 + bearEMA * 30);
    reversalDetected = strength > 50 && trend === 'down';
  } else if (direction === 'down') {
    // Procurando sinais de alta (reversão adversa)
    const bullRSI = rsi < 35 ? (35 - rsi) / 35 : 0;
    const bullMomentum = momentum3Pct > 0.001 ? Math.min(1, momentum3Pct / 0.01) : 0;
    const bullEMA = trend === 'up' ? 0.8 : 0;
    strength = (bullRSI * 30 + bullMomentum * 40 + bullEMA * 30);
    reversalDetected = strength > 50 && trend === 'up';
  }

  return { reversalDetected, strength, trend };
}

// ─────────────────── Classe principal ───────────────────

class UniversalContractMonitor extends EventEmitter {
  private monitored = new Map<number, ContractState>();
  private ws: WebSocket | null = null;
  private apiToken: string | null = null;
  private connected = false;
  private reconnecting = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reqIdCounter = 1000000;
  private pendingSubAcks = new Map<number, number>(); // reqId → contractId
  private isShuttingDown = false;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ── API Pública ──────────────────────────────────────────

  setToken(token: string): void {
    this.apiToken = token;
  }

  async startMonitoring(input: MonitoredContractInput): Promise<void> {
    if (this.monitored.has(input.contractId)) {
      console.log(`📡 [MONITOR] Contrato ${input.contractId} já monitorado`);
      return;
    }

    const category = getCategory(input.contractType);
    console.log(`🔭 [MONITOR] Iniciando monitoramento: ${input.contractId} | ${input.contractType} | ${input.symbol} | Categoria: ${category}`);

    const state: ContractState = {
      input,
      bidPrice: input.buyPrice,
      currentSpot: 0,
      entrySpot: 0,
      profit: 0,
      profitPct: 0,
      isValidToSell: false,
      isSold: false,
      isExpired: false,
      tickCount: 0,
      lastUpdate: Date.now(),
      aiSignalBuffer: [],
      peakProfit: 0,
      peakBidPrice: input.buyPrice,
      status: 'monitoring',
    };

    this.monitored.set(input.contractId, state);

    // Conectar se necessário e subscrever
    await this.ensureConnected();
    this.subscribeToContract(input.contractId);

    // Para contratos auto-close, agendar cleanup
    if (category === 'AUTO_CLOSE') {
      const thresholds = getThresholds(input.contractType);
      setTimeout(() => this.stopMonitoring(input.contractId), thresholds.maxDurationMin * 60 * 1000 + 30000);
    }
  }

  stopMonitoring(contractId: number): void {
    const state = this.monitored.get(contractId);
    if (!state) return;

    // Dessubscrever
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ forget: state.subscriptionId }));
    }

    this.monitored.delete(contractId);
    console.log(`🔭 [MONITOR] Monitoramento encerrado: ${contractId} | Status: ${state.status}`);
  }

  getMonitoredContracts(): Array<{ contractId: number; state: ContractState }> {
    return Array.from(this.monitored.entries()).map(([id, s]) => ({ contractId: id, state: s }));
  }

  getContractState(contractId: number): ContractState | undefined {
    return this.monitored.get(contractId);
  }

  // ── WebSocket interno ────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.reconnecting) {
      // Esperar conexão atual
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (this.connected) { clearInterval(check); resolve(); }
        }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 8000);
      });
      return;
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.apiToken) {
      console.warn('⚠️ [MONITOR] Sem API token — monitor em modo standby');
      return;
    }

    this.reconnecting = true;
    console.log('🔌 [MONITOR] Conectando WebSocket dedicado...');

    return new Promise((resolve) => {
      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!this.connected) {
          ws.terminate();
          this.reconnecting = false;
          resolve();
        }
      }, 12000);

      ws.on('open', () => {
        // Autenticar
        ws.send(JSON.stringify({ authorize: this.apiToken, req_id: ++this.reqIdCounter }));
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg, resolve, timeout);
        } catch (_) {}
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        this.connected = false;
        this.stopKeepAlive();
        console.log('🔌 [MONITOR] WebSocket fechado — reconectando em 3s...');
        if (!this.isShuttingDown) {
          setTimeout(() => this.reconnectAndResubscribe(), 3000);
        }
      });

      ws.on('error', (err: Error) => {
        console.warn(`⚠️ [MONITOR] WebSocket erro: ${err.message}`);
      });
    });
  }

  private handleMessage(msg: any, authResolve?: () => void, authTimeout?: NodeJS.Timeout): void {
    if (msg.msg_type === 'authorize' && msg.authorize) {
      clearTimeout(authTimeout!);
      this.connected = true;
      this.reconnecting = false;
      this.startKeepAlive();
      console.log(`✅ [MONITOR] Autenticado como ${msg.authorize.loginid}`);
      authResolve?.();
      // Resubscrever contratos pendentes
      this.resubscribeAll();
      return;
    }

    if (msg.msg_type === 'proposal_open_contract') {
      this.processContractUpdate(msg.proposal_open_contract);
      return;
    }

    if (msg.msg_type === 'sell') {
      if (msg.sell) {
        console.log(`💰 [MONITOR] Venda executada: contrato ${msg.sell.contract_id} | Vendido por: $${msg.sell.sold_for}`);
        this.emit('contract_sold', {
          contractId: msg.sell.contract_id,
          soldFor: msg.sell.sold_for,
          referenceId: msg.sell.reference,
        });
      } else if (msg.error) {
        console.warn(`⚠️ [MONITOR] Erro na venda: ${msg.error.message} (code: ${msg.error.code})`);
        this.emit('sell_error', msg.error);
      }
      return;
    }

    if (msg.msg_type === 'error') {
      console.warn(`⚠️ [MONITOR] Erro Deriv: ${msg.error?.message}`);
    }
  }

  private subscribeToContract(contractId: number): void {
    if (!this.connected || !this.ws) return;
    const reqId = ++this.reqIdCounter;
    this.pendingSubAcks.set(reqId, contractId);
    this.ws.send(JSON.stringify({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
      req_id: reqId,
    }));
    console.log(`📡 [MONITOR] Subscrito para contrato ${contractId} (req ${reqId})`);
  }

  private resubscribeAll(): void {
    for (const [contractId, state] of this.monitored.entries()) {
      if (state.status === 'monitoring') {
        this.subscribeToContract(contractId);
      }
    }
  }

  private async reconnectAndResubscribe(): Promise<void> {
    if (this.isShuttingDown || this.reconnecting) return;
    await this.connect();
  }

  // ── Processamento de updates do contrato ─────────────────

  private async processContractUpdate(contract: any): Promise<void> {
    if (!contract || !contract.contract_id) return;
    const contractId = contract.contract_id;
    const state = this.monitored.get(contractId);
    if (!state) return;

    // Salvar subscription_id para poder fazer forget depois
    if (contract.id && !state.subscriptionId) {
      state.subscriptionId = contract.id;
    }

    // Atualizar estado
    state.bidPrice = parseFloat(contract.bid_price) || state.bidPrice;
    state.currentSpot = parseFloat(contract.current_spot) || state.currentSpot;
    state.entrySpot = parseFloat(contract.entry_spot || contract.entry_tick) || state.entrySpot;
    state.profit = parseFloat(contract.profit) || 0;
    state.profitPct = state.input.buyPrice > 0 ? (state.profit / state.input.buyPrice) * 100 : 0;
    state.isValidToSell = !!contract.is_valid_to_sell;
    state.isSold = !!contract.is_sold;
    state.isExpired = !!contract.is_expired;
    state.tickCount++;
    state.lastUpdate = Date.now();

    // Atualizar pico
    if (state.profit > state.peakProfit) state.peakProfit = state.profit;
    if (state.bidPrice > state.peakBidPrice) state.peakBidPrice = state.bidPrice;

    // Calcular distância da barreira (se houver)
    if (state.currentSpot > 0) {
      const barrierStr = contract.barrier || state.input.barrier;
      if (barrierStr) {
        const barrierNum = parseFloat(barrierStr);
        if (!isNaN(barrierNum) && barrierNum > 0) {
          state.barrierValue = barrierNum;
          state.barrierDistance = Math.abs(state.currentSpot - barrierNum) / state.currentSpot * 100;
        }
      }
    }

    // Log de acompanhamento a cada 5 ticks para não poluir
    if (state.tickCount % 5 === 0) {
      this.logContractStatus(state, contract);
    }

    // Emitir evento de update para UI/WebSocket
    this.emit('contract_update', {
      contractId,
      contractType: state.input.contractType,
      symbol: state.input.symbol,
      bidPrice: state.bidPrice,
      buyPrice: state.input.buyPrice,
      profit: state.profit,
      profitPct: state.profitPct,
      peakProfit: state.peakProfit,
      currentSpot: state.currentSpot,
      barrierDistance: state.barrierDistance,
      isValidToSell: state.isValidToSell,
      tickCount: state.tickCount,
    });

    // Se já fechou, limpar
    if (state.isSold || state.isExpired) {
      this.handleContractClosed(state, contract);
      return;
    }

    // Se status=closed não monitorar mais
    if (contract.status === 'sold' || contract.status === 'won' || contract.status === 'lost') {
      this.handleContractClosed(state, contract);
      return;
    }

    // Contratos auto-close: apenas monitorar, não fechar
    const category = getCategory(state.input.contractType);
    if (category === 'AUTO_CLOSE') return;

    // Verificar se está pronto para decisão
    if (state.status !== 'monitoring') return;
    if (!state.isValidToSell) return;

    // Executar análise de saída
    const thresholds = getThresholds(state.input.contractType);
    if (state.tickCount < thresholds.minTicksBeforeSell) return;

    const decision = this.shouldSell(state, thresholds, contract);

    if (decision.shouldSell) {
      console.log(`🎯 [MONITOR] DECISÃO DE VENDA — ${contractId} (${state.input.contractType}) | ${decision.reason} | Urgência: ${decision.urgency}`);
      await this.executeSell(state, decision.reason);
    }
  }

  // ── Motor de Decisão de Saída ─────────────────────────────

  private shouldSell(state: ContractState, thresholds: ExitThresholds, raw: any): SellDecision {
    const ct = state.input.contractType.toUpperCase();
    const dir = state.input.direction || 'neutral';
    const ageMin = (Date.now() - state.input.openedAt) / 60000;

    // ── 1. TEMPO MÁXIMO ──────────────────────────────────
    if (ageMin >= thresholds.maxDurationMin) {
      return {
        shouldSell: true,
        reason: `Tempo máximo atingido (${ageMin.toFixed(1)}min / ${thresholds.maxDurationMin}min)`,
        urgency: 'high',
      };
    }

    // ── 2. ANÁLISE TÉCNICA RÁPIDA ────────────────────────
    const recentPrices = this.getRecentPrices(state.input.symbol);
    const signal = computeQuickSignal(recentPrices, dir);
    if (signal.reversalDetected) {
      state.aiSignalBuffer.push({ ts: Date.now(), direction: signal.trend, strength: signal.strength });
      // Manter apenas últimos 10 sinais
      if (state.aiSignalBuffer.length > 10) state.aiSignalBuffer.shift();
    }

    // Sinal de reversão confirmado (2 sinais consecutivos)
    const recentReversals = state.aiSignalBuffer.filter(s => Date.now() - s.ts < 15000 && s.strength > thresholds.aiReversalStrength);
    const confirmedReversal = recentReversals.length >= 2;

    // ── 3. ESTRATÉGIAS POR MODALIDADE ────────────────────

    // ── ACCUMULATOR ──────────────────────────────────────
    if (ct === 'ACCU') {
      // Alvo de lucro
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `ACCU: alvo de lucro ${state.profitPct.toFixed(1)}% ≥ ${thresholds.profitTargetPct}%`, urgency: 'high' };
      }
      // Trailing stop: cai X% do pico
      if (state.peakProfit > 0 && state.profit < state.peakProfit * (1 - thresholds.trailingStopPct / 100)) {
        const drawdown = ((state.peakProfit - state.profit) / state.peakProfit * 100).toFixed(1);
        return { shouldSell: true, reason: `ACCU: trailing stop ativado (queda de ${drawdown}% do pico $${state.peakProfit.toFixed(2)})`, urgency: 'high' };
      }
      // Barreira PRÓXIMA — emergência
      if (state.barrierDistance !== undefined && state.barrierDistance < thresholds.barrierDangerPct) {
        return { shouldSell: true, reason: `ACCU: BARREIRA CRÍTICA a ${state.barrierDistance.toFixed(3)}% do spot!`, urgency: 'emergency' };
      }
      // Barreira moderadamente próxima + reversão
      if (state.barrierDistance !== undefined && state.barrierDistance < thresholds.barrierDangerPct * 2.5 && confirmedReversal) {
        return { shouldSell: true, reason: `ACCU: barreira próxima (${state.barrierDistance.toFixed(3)}%) + reversão confirmada`, urgency: 'high' };
      }
      // Reversão forte com qualquer lucro
      if (confirmedReversal && state.profitPct > 5) {
        return { shouldSell: true, reason: `ACCU: reversão forte confirmada com lucro de ${state.profitPct.toFixed(1)}%`, urgency: 'medium' };
      }
    }

    // ── MULTIPLIER ───────────────────────────────────────
    if (ct === 'MULTUP' || ct === 'MULTDOWN') {
      // Alvo de lucro
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `MULT: alvo ${state.profitPct.toFixed(1)}% atingido`, urgency: 'high' };
      }
      // Stop de perda (multiplier pode ir negativo)
      if (state.profitPct <= -thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `MULT: corte de perda ${state.profitPct.toFixed(1)}% < -${thresholds.earlyLossExitPct}%`, urgency: 'emergency' };
      }
      // Trailing
      if (state.peakProfit > state.input.buyPrice * 0.2 && state.profit < state.peakProfit * (1 - thresholds.trailingStopPct / 100)) {
        return { shouldSell: true, reason: `MULT: trailing stop (pico $${state.peakProfit.toFixed(2)} → atual $${state.profit.toFixed(2)})`, urgency: 'high' };
      }
      if (confirmedReversal && state.profitPct > 10) {
        return { shouldSell: true, reason: `MULT: reversão confirmada com lucro ${state.profitPct.toFixed(1)}%`, urgency: 'medium' };
      }
    }

    // ── TURBOS ──────────────────────────────────────────
    if (ct === 'TURBOSLONG' || ct === 'TURBOSSHORT') {
      if (state.barrierDistance !== undefined && state.barrierDistance < thresholds.barrierDangerPct) {
        return { shouldSell: true, reason: `TURBO: barreira PERIGOSA a ${state.barrierDistance.toFixed(3)}%`, urgency: 'emergency' };
      }
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `TURBO: alvo ${state.profitPct.toFixed(1)}% atingido`, urgency: 'high' };
      }
      if (state.profitPct <= -thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `TURBO: corte de perda ${state.profitPct.toFixed(1)}%`, urgency: 'high' };
      }
      if (state.barrierDistance !== undefined && state.barrierDistance < thresholds.barrierDangerPct * 2 && confirmedReversal) {
        return { shouldSell: true, reason: `TURBO: barreira próxima + reversão`, urgency: 'high' };
      }
    }

    // ── VANILLA ──────────────────────────────────────────
    if (ct === 'VANILLACALL' || ct === 'VANILLAPUT') {
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `VANILLA: alvo ${state.profitPct.toFixed(1)}% atingido`, urgency: 'high' };
      }
      if (state.profitPct <= -thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `VANILLA: corte de perda ${state.profitPct.toFixed(1)}%`, urgency: 'high' };
      }
      if (confirmedReversal && state.profitPct > 15) {
        return { shouldSell: true, reason: `VANILLA: reversão com lucro ${state.profitPct.toFixed(1)}%`, urgency: 'medium' };
      }
    }

    // ── CALL/PUT/RISE/FALL ───────────────────────────────
    if (['CALL', 'PUT', 'RISE', 'FALL', 'CALLE', 'PUTE'].includes(ct)) {
      // Bid price como % do payout estimado
      const payout = parseFloat(raw.payout) || state.input.buyPrice * 1.8;
      const bidPct = (state.bidPrice / payout) * 100;

      if (bidPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `CALL/PUT: bid ${bidPct.toFixed(1)}% do payout — objetivo atingido`, urgency: 'high' };
      }
      // Corte de perda quando bid cai muito
      const bidDecline = (1 - state.bidPrice / state.input.buyPrice) * 100;
      if (bidDecline >= thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `CALL/PUT: bid caiu ${bidDecline.toFixed(1)}% — saída preventiva`, urgency: 'medium' };
      }
      // Trailing quando lucrativo + reversão
      if (state.profitPct > 15 && confirmedReversal) {
        return { shouldSell: true, reason: `CALL/PUT: reversão com bid lucrativo ${state.profitPct.toFixed(1)}%`, urgency: 'medium' };
      }
      // Trailing stop do pico
      if (state.peakBidPrice > state.input.buyPrice * 1.3 && state.bidPrice < state.peakBidPrice * (1 - thresholds.trailingStopPct / 100)) {
        return { shouldSell: true, reason: `CALL/PUT: trailing stop bid (pico $${state.peakBidPrice.toFixed(2)} → $${state.bidPrice.toFixed(2)})`, urgency: 'high' };
      }
    }

    // ── ONETOUCH/NOTOUCH/RANGE ───────────────────────────
    if (['ONETOUCH', 'NOTOUCH', 'RANGE', 'EXPIRYRANGE', 'UPORDOWN'].includes(ct)) {
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `BARRIER: lucro ${state.profitPct.toFixed(1)}% — realizando`, urgency: 'high' };
      }
      if (confirmedReversal && state.profitPct > 20) {
        return { shouldSell: true, reason: `BARRIER: reversão com lucro ${state.profitPct.toFixed(1)}%`, urgency: 'medium' };
      }
    }

    return { shouldSell: false, reason: '', urgency: 'low' };
  }

  // ── Execução de Venda ─────────────────────────────────

  private async executeSell(state: ContractState, reason: string): Promise<void> {
    if (state.status !== 'monitoring') return;
    state.status = 'closing';

    const contractId = state.input.contractId;
    console.log(`\n🔴 [MONITOR] ═══ EXECUTANDO VENDA ═══`);
    console.log(`   Contrato : ${contractId} (${state.input.contractType})`);
    console.log(`   Ativo    : ${state.input.symbol}`);
    console.log(`   Motivo   : ${reason}`);
    console.log(`   Bid      : $${state.bidPrice.toFixed(4)}`);
    console.log(`   Buy      : $${state.input.buyPrice.toFixed(4)}`);
    console.log(`   Lucro    : $${state.profit.toFixed(4)} (${state.profitPct.toFixed(2)}%)`);
    console.log(`   Pico     : $${state.peakProfit.toFixed(4)}`);
    console.log(`   Ticks    : ${state.tickCount}`);
    console.log(`   Duração  : ${((Date.now() - state.input.openedAt) / 60000).toFixed(1)}min`);

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ [MONITOR] WebSocket não conectado — tentando reconectar para vender...');
      await this.ensureConnected();
    }

    if (this.connected && this.ws) {
      const reqId = ++this.reqIdCounter;
      this.ws.send(JSON.stringify({ sell: contractId, price: 0, req_id: reqId }));
      state.status = 'closed';

      this.emit('sell_initiated', {
        contractId,
        contractType: state.input.contractType,
        symbol: state.input.symbol,
        reason,
        bidPrice: state.bidPrice,
        buyPrice: state.input.buyPrice,
        profit: state.profit,
        profitPct: state.profitPct,
        peakProfit: state.peakProfit,
        duration: Date.now() - state.input.openedAt,
        tickCount: state.tickCount,
      });
    } else {
      state.status = 'monitoring'; // Reverter para tentar novamente
      console.error('❌ [MONITOR] Falha ao conectar para executar venda');
    }
  }

  // ── Contrato fechado (por expiry ou venda) ────────────────

  private handleContractClosed(state: ContractState, raw: any): void {
    const contractId = state.input.contractId;
    const result = raw.status === 'won' ? '✅ WON' : raw.status === 'sold' ? '💰 SOLD' : '❌ LOST';
    const finalProfit = parseFloat(raw.profit) || state.profit;

    console.log(`\n📊 [MONITOR] Contrato FECHADO: ${contractId} (${state.input.contractType})`);
    console.log(`   Resultado: ${result} | Lucro final: $${finalProfit.toFixed(4)}`);
    console.log(`   Ticks monitorados: ${state.tickCount} | Duração: ${((Date.now() - state.input.openedAt) / 60000).toFixed(1)}min`);

    this.emit('contract_closed', {
      contractId,
      contractType: state.input.contractType,
      symbol: state.input.symbol,
      status: raw.status,
      finalProfit,
      buyPrice: state.input.buyPrice,
      tickCount: state.tickCount,
      duration: Date.now() - state.input.openedAt,
      peakProfit: state.peakProfit,
    });

    this.monitored.delete(contractId);
  }

  // ── Log status ────────────────────────────────────────────

  private logContractStatus(state: ContractState, raw: any): void {
    const ct = state.input.contractType;
    const ageMin = ((Date.now() - state.input.openedAt) / 60000).toFixed(1);
    const barrierInfo = state.barrierDistance !== undefined
      ? ` | Barreira: ${state.barrierDistance.toFixed(3)}%`
      : '';
    const emoji = state.profitPct > 0 ? '📈' : state.profitPct < -5 ? '📉' : '➡️';

    console.log(
      `${emoji} [MONITOR] ${ct} ${state.input.contractId} | ${state.input.symbol}` +
      ` | Bid: $${state.bidPrice.toFixed(4)}` +
      ` | Lucro: ${state.profitPct >= 0 ? '+' : ''}${state.profitPct.toFixed(2)}%` +
      ` | Pico: $${state.peakProfit.toFixed(4)}` +
      `${barrierInfo}` +
      ` | ${ageMin}min | Tick#${state.tickCount}`
    );
  }

  // ── Preços recentes do market collector ──────────────────

  private getRecentPrices(symbol: string): number[] {
    try {
      const ticks = marketDataCollector.getRecentTicks(symbol, 30);
      return ticks.map((t: any) => t.quote || t.price || 0).filter((p: number) => p > 0);
    } catch (_) {
      return [];
    }
  }

  // ── Keep-Alive ────────────────────────────────────────────

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 25000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  shutdown(): void {
    this.isShuttingDown = true;
    this.stopKeepAlive();
    this.ws?.terminate();
    this.monitored.clear();
    console.log('🔭 [MONITOR] Monitor universal encerrado');
  }
}

// Singleton global
export const contractMonitor = new UniversalContractMonitor();
