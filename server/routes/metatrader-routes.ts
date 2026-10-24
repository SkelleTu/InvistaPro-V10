/**
 * METATRADER API ROUTES - INVESTAPRO
 * Endpoints REST para comunicação com o Expert Advisor MT4/MT5
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { isAuthenticated, isApproved, isAuthorizedForTradingSystem } from '../auth';
import path from 'path';
import fs from 'fs';
import { metaTraderBridge, MT5Position, MT5TradeResult } from '../services/metatrader-bridge';
import {
  analyzeCrashBoomSpike,
  analyzeContinuitySafety,
  storeExternalGirassolPivots,
  getExternalGirassolPivots,
  ExternalGirassolPivot,
} from '../services/crash-boom-spike-engine';
import { brazilNewsService } from '../services/brazil-news-service';
import { computeSyntheticGirassol } from '../services/synthetic-girassol';
import { isAllowedProductionSymbol } from '../services/production-symbol-policy';
import { getMt5ProductionBlock } from '../services/mt5-production-policy';
import { consensusCache } from '../services/consensus-cache';
import { evaluatePriceActionSetup, isValidPriceActionCandles, validateAIEntryReview, type Candle } from '../services/price-action-engine';
import { huggingFaceAI } from '../services/huggingface-ai';
import { assessMt5RiskLimit, buildTrustedPriceActionContext, getHighImpactNewsStatus, isAllowedBrasiliaTradingSession } from '../services/price-action-context';


const router = Router();

// Último ambiente confirmado pelo próprio terminal MT5. Desconhecido após restart até novo heartbeat.
let lastMt5ObservedAccountType: 'demo' | 'real' | 'contest' | null = null;
let lastMt5EnvironmentHeartbeatAt = 0;

function mt5EnvironmentMismatch() {
  const config = metaTraderBridge.getConfig();
  return !lastMt5ObservedAccountType || lastMt5ObservedAccountType === 'contest' ||
    lastMt5ObservedAccountType !== config.accountType || Date.now() - lastMt5EnvironmentHeartbeatAt > 90_000;
}


function mt5DashboardAccess(req: any, res: any, next: any) {
  return isAuthenticated(req, res, () =>
    isApproved(req, res, () => isAuthorizedForTradingSystem(req, res, next))
  );
}

/** EA calls must carry the per-deployment MT5 token in production. */
function mt5EaTokenAccess(req: any, res: any, next: any) {
  const config = metaTraderBridge.getConfig();
  const configuredToken = String(config.apiToken ?? '').trim();
  if (process.env.NODE_ENV === 'production' && !configuredToken) {
    return res.status(503).json({
      ok: false,
      code: 'MT5_API_TOKEN_NOT_CONFIGURED',
      error: 'O token do Expert Advisor ainda não foi configurado no painel MetaTrader.',
    });
  }
  const suppliedToken = String(req.body?.token ?? '').trim();
  if (configuredToken && suppliedToken !== configuredToken) {
    return res.status(401).json({ ok: false, code: 'MT5_INVALID_TOKEN', error: 'Token inválido.' });
  }
  return next();
}

/** The polling endpoint is shared by the signed-in dashboard and the EA. */
function mt5SignalAccess(req: any, res: any, next: any) {
  const config = metaTraderBridge.getConfig();
  const configuredToken = String(config.apiToken ?? '').trim();
  const suppliedToken = String(req.query?.token ?? '').trim();

  if (process.env.NODE_ENV === 'production' && !configuredToken) {
    return res.status(503).json({
      action: 'HOLD',
      executionEnabled: false,
      code: 'MT5_API_TOKEN_NOT_CONFIGURED',
      reason: 'Configure o token do Expert Advisor no painel MetaTrader e baixe novamente o EA.',
      timestamp: Date.now(),
    });
  }
  if (suppliedToken) {
    if (!configuredToken || suppliedToken !== configuredToken) {
      return res.status(401).json({ action: 'HOLD', code: 'MT5_INVALID_TOKEN', reason: 'Token inválido.' });
    }
    return next();
  }
  return mt5DashboardAccess(req, res, next);
}

router.post('/heartbeat', mt5EaTokenAccess, (req: Request, res: Response) => {
  try {
    const { accountId, broker, balance, equity, freeMargin, openPositions, openPositionTickets, platform, token, accountType } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId obrigatório' });
    if (!['demo', 'real', 'contest'].includes(accountType)) {
      lastMt5ObservedAccountType = null;
      lastMt5EnvironmentHeartbeatAt = 0;
      return res.status(400).json({ ok: false, code: 'MT5_ACCOUNT_MODE_UNKNOWN', error: 'EA desatualizado: baixe e instale a versão que reporta o tipo real da conta MT5.' });
    }
    lastMt5ObservedAccountType = accountType;
    lastMt5EnvironmentHeartbeatAt = Date.now();
    const config = metaTraderBridge.getConfig();
    if (accountType !== config.accountType) {
      return res.status(409).json({ ok: false, code: 'MT5_ACCOUNT_MODE_MISMATCH', expectedAccountType: config.accountType, actualAccountType: accountType, error: 'A conta conectada não corresponde ao ambiente selecionado no painel. Sinais bloqueados.' });
    }
    const validatedPositionTickets = Array.isArray(openPositionTickets) &&
      openPositionTickets.every((ticket: unknown) =>
        (typeof ticket === 'string' && /^\d+$/.test(ticket)) ||
        (typeof ticket === 'number' && Number.isSafeInteger(ticket) && ticket >= 0)
      )
      ? openPositionTickets.map((ticket: string | number) => String(ticket))
      : undefined;
    metaTraderBridge.recordHeartbeat({
      accountId, broker: broker || 'Unknown', balance, equity, freeMargin,
      openPositionsCount: typeof openPositions === 'number' ? openPositions : undefined,
      openPositionTickets: validatedPositionTickets,
    });
    const updatedConfig = metaTraderBridge.getConfig();
    console.log(`[MT5Bridge] 💚 Heartbeat: ${broker || 'Unknown'} | Conta: ${accountId} | Saldo: $${balance} | Posições abertas EA: ${openPositions ?? '?'} | Habilitado: ${updatedConfig.enabled}`);
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

router.get('/signal', mt5SignalAccess, (req: Request, res: Response) => {
  try {
    const { symbol, accountId } = req.query;
    const config = metaTraderBridge.getConfig();
    if (symbol && mt5EnvironmentMismatch()) {
      return res.status(409).json({ action: 'HOLD', executionEnabled: false, code: 'MT5_ACCOUNT_MODE_MISMATCH', expectedAccountType: config.accountType, actualAccountType: lastMt5ObservedAccountType, reason: 'Ambiente MT5 não confirmado ou divergente. Verifique a conta conectada e mantenha as operações bloqueadas.', timestamp: Date.now() });
    }
    // Registrar heartbeat apenas quando o EA faz polling (tem parâmetro symbol)
    // Isso evita que o dashboard (sem symbol) mantenha o heartbeat vivo falsamente
    const symbolStr = (symbol as string) || '';
    if (symbolStr) {
      const accId = (accountId as string) || 'EA_AUTO';
      metaTraderBridge.recordHeartbeat({
        accountId: accId,
        broker: 'MT5',
        balance: 0,
        equity: 0,
        freeMargin: 0
      });
    }
    const resolvedSymbol = symbolStr || config.symbols[0] || 'EURUSD';

    // MT5 orders are placed by the user's logged-in MT5 terminal, not as Deriv contracts.
    if (process.env.NODE_ENV === 'production' && symbolStr && !isAllowedProductionSymbol(symbolStr)) {
      return res.status(403).json({
        action: 'HOLD',
        executionEnabled: false,
        code: 'PRODUCTION_SYMBOL_BLOCKED',
        reason: 'Símbolo inválido ou não permitido para este canal MT5.',
        timestamp: Date.now(),
      });
    }
    const productionBlock = getMt5ProductionBlock(config.apiToken, process.env, config.accountType, config.realTradingAuthorized);
    if (productionBlock) {
      return res.status(productionBlock.status).json({ action: 'HOLD', ...productionBlock, timestamp: Date.now() });
    }
    if (!config.enabled) {
      return res.json({
        action: 'HOLD',
        executionEnabled: false,
        code: 'MT5_TRADING_DISABLED',
        reason: 'O sistema MetaTrader está desativado nas configurações. Ative-o no painel antes de permitir sinais.',
        timestamp: Date.now(),
      });
    }

    const signal = metaTraderBridge.getPendingSignal(resolvedSymbol);

    // Se não há sinal pendente, gerar sob demanda (modo IA pura ou com candles)
    if ((!signal || signal.action === 'HOLD') && symbolStr && config.enabled) {
      // Dispara geração em segundo plano; próximo poll do EA receberá o sinal
      setImmediate(() => {
        metaTraderBridge.generateSignal(resolvedSymbol).catch(() => {});
      });
    }

    if (!signal || signal.action === 'HOLD') {
      return res.json({
        action: 'HOLD',
        reason: signal?.reason || 'Aguardando próximo sinal da IA',
        confidence: signal?.confidence || 0,
        timestamp: Date.now()
      });
    }

    // ── Validação Girassol no polling simples ──────────────────────────────
    // O Girassol é o GATILHO PRIMÁRIO. Mesmo no endpoint /signal, o sinal
    // da IA deve ser bloqueado se o Girassol contradiz ou está NEUTRO.
    const girassolStored = metaTraderBridge.getGirassolBias(resolvedSymbol);
    if (girassolStored) {
      const signalDir = signal.action === 'BUY' ? 'BUY' : 'SELL';
      if (girassolStored.bias === 'NEUTRAL') {
        console.log(`[MT5-Signal] ⏸️ ${resolvedSymbol}: Girassol NEUTRO — sinal ${signalDir} bloqueado no polling`);
        return res.json({
          action: 'HOLD',
          reason: 'Girassol NEUTRO — aguardando gatilho direcional do indicador',
          confidence: 0,
          timestamp: Date.now()
        });
      }
      if (girassolStored.bias !== signalDir) {
        console.log(`[MT5-Signal] 🚫 ${resolvedSymbol}: Girassol ${girassolStored.bias} contradiz sinal ${signalDir} — bloqueado no polling`);
        return res.json({
          action: 'HOLD',
          reason: `Bloqueado: Girassol ${girassolStored.bias} contradiz sinal IA ${signalDir}`,
          confidence: 0,
          timestamp: Date.now()
        });
      }
    } else {
      // Sem dados do Girassol E ele é obrigatório → bloquear
      const requireGirassol = metaTraderBridge.getConfig().requireGirassolConfirmation;
      if (requireGirassol) {
        console.log(`[MT5-Signal] 🚫 ${resolvedSymbol}: Girassol obrigatório mas sem dados — sinal bloqueado no polling`);
        return res.json({
          action: 'HOLD',
          reason: 'Girassol obrigatório mas sem dados do indicador — instale o Girassol no gráfico MT5',
          confidence: 0,
          timestamp: Date.now()
        });
      }
    }

    // ── Gate: Duplo Padrão da bolinha_media ──────────────────────────────────
    // Mesmo no polling simples, verificar se o duplo topo/fundo está confirmado
    // antes de entregar o sinal em cache. Isso evita que generateSignal() em background
    // armazene sinais que depois saem por esta rota sem a validação completa.
    {
      const signalDir = signal.action as 'BUY' | 'SELL';
      const dp = metaTraderBridge.checkBolinhaMediaDoublePattern(resolvedSymbol, signalDir);
      const bolinhaHistLen = metaTraderBridge.getBolinhaMediaHistoryLength(resolvedSymbol);
      // Só aplica o gate quando há histórico da bolinha_media (EA enviando buffers reais)
      if (bolinhaHistLen > 0 && !dp.detected) {
        console.log(`[MT5-Signal] ⏳ ${resolvedSymbol}: duplo padrão pendente — sinal ${signalDir} retido no polling`);
        return res.json({
          action: 'HOLD',
          reason: `Aguardando duplo padrão: bolinha_media ${signalDir} registrou 1º pivô — entrada somente com 2º pivô confirmado`,
          confidence: 0,
          timestamp: Date.now()
        });
      }
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
router.post('/signal-with-indicators', mt5EaTokenAccess, async (req: Request, res: Response) => {
  try {
    const {
      symbol,
      ask,
      bid,
      candles,
      timeframes,
      accountType: requestAccountType,
      priceActionUseAIReview,
      indicatorSignals,   // { girassol: {...}, fibonacci: {...} }
      indicatorBuffers,   // array bruto de todos os buffers
      indicatorCount,
      accountId: bodyAccountId,
      token
    } = req.body;

    const config = metaTraderBridge.getConfig();
    if (config.apiToken && token !== config.apiToken) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (!symbol) {
      return res.status(400).json({ error: 'symbol é obrigatório' });
    }

    const requestedAccountMode = String(requestAccountType ?? '').trim().toLowerCase();
    if (!['demo', 'real', 'contest'].includes(requestedAccountMode)
      || requestedAccountMode !== config.accountType
      || requestedAccountMode !== lastMt5ObservedAccountType) {
      return res.status(409).json({
        action: 'HOLD',
        executionEnabled: false,
        code: 'MT5_ACCOUNT_MODE_MISMATCH',
        expectedAccountType: config.accountType,
        requestedAccountType: requestedAccountMode || null,
        actualAccountType: lastMt5ObservedAccountType,
        reason: 'O modo informado pelo terminal diverge do modo configurado/observado; sinais bloqueados.',
        timestamp: Date.now(),
      });
    }

    if (mt5EnvironmentMismatch()) {
      return res.status(409).json({
        action: 'HOLD',
        executionEnabled: false,
        code: 'MT5_ACCOUNT_MODE_MISMATCH',
        expectedAccountType: config.accountType,
        actualAccountType: lastMt5ObservedAccountType,
        reason: 'Conta MT5 não confirmada ou heartbeat desatualizado; sinais bloqueados.',
        timestamp: Date.now(),
      });
    }

    const productionBlock = getMt5ProductionBlock(config.apiToken, process.env, config.accountType, config.realTradingAuthorized);
    if (productionBlock) {
      return res.status(productionBlock.status).json({
        action: 'HOLD',
        ...productionBlock,
        confidence: 0,
        timestamp: Date.now(),
      });
    }

    // Registrar heartbeat — EA v5.0 usa este endpoint como canal principal
    metaTraderBridge.recordHeartbeat({
      accountId: bodyAccountId || 'EA_AUTO',
      broker: 'MT5',
      balance: 0,
      equity: 0,
      freeMargin: 0
    });

    if (!config.enabled) {
      return res.json({ action: 'HOLD', reason: 'Sistema desabilitado', confidence: 0 });
    }

    const sym = symbol as string;
    // Crypto strategy symbols must pass the deterministic multi-timeframe gate first.
    // Legacy indicator/AI logic is not allowed to create a bypass around this gate.
    const normalizedStrategySymbol = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isStrategyCrypto = ['BTCUSDT','ETHUSDT','SOLUSDT','BTCUSD','ETHUSD','SOLUSD'].includes(normalizedStrategySymbol);
    let priceActionSetup: ReturnType<typeof evaluatePriceActionSetup> | null = null;
    if (isStrategyCrypto) {
      const frames = timeframes && typeof timeframes === 'object' ? timeframes as Partial<Record<'H4'|'H1'|'M15'|'M5'|'M1', Candle[]>> : {};
      // All execution gates are derived on the server. The EA cannot self-assert news clearance,
      // account risk clearance, or a permitted trading session.
      const riskLimit = assessMt5RiskLimit({
        config,
        status: metaTraderBridge.getStatus(),
        observedAccountType: lastMt5ObservedAccountType,
        accountHeartbeatAt: lastMt5EnvironmentHeartbeatAt,
        realTradingExplicitlyEnabled: String(process.env.MT5_PRODUCTION_TRADING_ENABLED ?? '').trim().toLowerCase() === 'true',
      });
      const newsStatus = await getHighImpactNewsStatus();
      const sessionOpen = isAllowedBrasiliaTradingSession();
      const entryFrameForContext = isValidPriceActionCandles(frames.M5)
        ? frames.M5
        : isValidPriceActionCandles(frames.M1) ? frames.M1 : [];
      const entryPriceForContext = entryFrameForContext.length
        ? entryFrameForContext[entryFrameForContext.length - 1].close
        : undefined;
      const trustedContext = buildTrustedPriceActionContext({
        bid,
        ask,
        entryPrice: entryPriceForContext,
        riskLimitOk: riskLimit.ok,
        newsBlocked: newsStatus.blocked || !newsStatus.valid,
        sessionOpen,
      });
      priceActionSetup = evaluatePriceActionSetup(frames, trustedContext);
      if (!priceActionSetup.approved) {
        return res.json({
          action: 'HOLD',
          confidence: 0,
          executionEnabled: false,
          code: 'PRICE_ACTION_GATE_REJECTED',
          reason: 'A estratégia determinística não aprovou a entrada. A IA não pode criar sinal sem setup válido.',
          strategyAction: priceActionSetup.action,
          rejectionReasons: priceActionSetup.reasons,
          checks: priceActionSetup.checks,
          features: priceActionSetup.features,
          safetyContext: {
            riskLimit: riskLimit.reasons,
            news: newsStatus.reason,
            tradingSessionOpen: sessionOpen,
          },
          timestamp: Date.now()
        });
      }

      // Do not feed the same crypto request into the legacy generator; it could create a competing signal.
      const reviewTimeframe: 'M5' | 'M1' = priceActionSetup.features.entryTimeframe === 'M1' ? 'M1' : 'M5';
      const reviewFrameCandidate = reviewTimeframe === 'M5' ? frames.M5 : frames.M1;
      if (!isValidPriceActionCandles(reviewFrameCandidate)) {
        return res.json({
          action: 'HOLD', confidence: 0, executionEnabled: false,
          code: 'PRICE_ACTION_INTERNAL_TIMEFRAME_MISMATCH',
          reason: 'O timeframe aprovado pelo motor determinístico não está disponível para a rota de execução.',
          strategyAction: priceActionSetup.action,
          timestamp: Date.now(),
        });
      }
      const reviewFrame = reviewFrameCandidate;
      let aiReview: Awaited<ReturnType<typeof huggingFaceAI.reviewPriceActionCandidate>> = {
        approved: false, direction: 'HOLD', confidence: 0, sources: [],
        reason: 'Revisão IA não executada; a decisão operacional continuará restrita aos critérios explícitos da estratégia.',
      };

      if (priceActionUseAIReview === true && isValidPriceActionCandles(reviewFrame)) {
        const reviewTicks = reviewFrame.map(candle => ({
          symbol: sym,
          quote: candle.close,
          epoch: Math.floor(candle.time > 100_000_000_000 ? candle.time / 1000 : candle.time),
        }));
        aiReview = await huggingFaceAI.reviewPriceActionCandidate(
          reviewTicks, sym, priceActionSetup.action, reviewTimeframe
        );
      } else {
        aiReview = {
          approved: false, direction: 'HOLD', confidence: 0, sources: [],
          reason: priceActionUseAIReview === true
            ? 'Revisão IA indisponível: candles de entrada ausentes ou inválidos.'
            : 'Revisão IA desativada. Nenhum limiar de consenso ou indicador legado substituirá os critérios da estratégia.',
        };
      }

      // The deterministic checklist is the entry authority. AI consensus/confidence and
      // legacy indicators are diagnostic only: they must not add undocumented vetoes.
      // For REAL, an unavailable AI service is an essential-component failure and fails closed;
      // a numerical consensus threshold or AI disagreement is never used as a new entry rule.
      if (config.accountType === 'real' && aiReview.sources.length === 0) {
        return res.json({
          action: 'HOLD', confidence: 0, executionEnabled: false,
          code: 'PRICE_ACTION_AI_UNAVAILABLE',
          reason: 'Conta REAL bloqueada: o serviço de revisão IA essencial não respondeu com evidência válida.',
          strategyAction: priceActionSetup.action,
          aiAction: aiReview.direction,
          aiSources: [],
          timestamp: Date.now(),
        });
      }

      const reviewValidation = validateAIEntryReview(priceActionSetup, {
        decision: aiReview.approved ? 'approve' : 'reject',
        direction: aiReview.direction,
        confidence: aiReview.confidence,
      });
      // The closed trigger candle creates a stable id. Repeated polls within the
      // same opportunity must not mint new IDs and reopen the same trade.
      const signalBar = reviewFrame[reviewFrame.length - 1];
      const stableSignalId = 'pa-' + normalizedStrategySymbol + '-' + priceActionSetup.action + '-' + Math.floor(signalBar.time);
      const alreadyExecuted = metaTraderBridge.getOpenPositions().some(position => position.signalId === stableSignalId)
        || metaTraderBridge.getRecentTrades().some(trade => trade.signalId === stableSignalId);
      if (alreadyExecuted) {
        return res.json({
          action: 'HOLD', confidence: 0, executionEnabled: false,
          code: 'PRICE_ACTION_SIGNAL_ALREADY_EXECUTED',
          reason: 'Esta oportunidade, identificada pela vela de gatilho fechada, já foi executada ou permanece aberta.',
          strategyAction: priceActionSetup.action, signalId: stableSignalId, timestamp: Date.now(),
        });
      }
      const timestamp = Date.now();
      return res.json({
        id: stableSignalId,
        symbol: sym,
        action: priceActionSetup.action,
        lotSize: config.defaultLotSize,
        stopLoss: priceActionSetup.stopLoss,
        takeProfit: priceActionSetup.takeProfit,
        stopLossPips: 0,
        takeProfitPips: 0,
        entryPrice: priceActionSetup.entry,
        confidence: aiReview.sources.length > 0 ? aiReview.confidence : 0,
        aiSources: aiReview.sources,
        aiReview: {
          performed: aiReview.sources.length > 0,
          consensusApproved: aiReview.approved,
          direction: aiReview.direction,
          confidence: aiReview.sources.length > 0 ? aiReview.confidence : null,
          validation: reviewValidation.approved ? 'aligned' : 'diagnostic_only',
          reason: aiReview.reason,
        },
        indicators: {},
        timestamp,
        expiresAt: timestamp + Math.max(10, config.signalTimeoutSeconds) * 1000,
        reason: 'Setup aprovado pelos critérios objetivos da estratégia. Revisão IA (diagnóstica): ' + aiReview.reason,
        strategyMode: 'AUTHORITATIVE_PRICE_ACTION',
        executionEnabled: true,
      });
    }

    // Monta resposta final
    if (!baseSignal || finalAction === 'HOLD') {
      return res.json({
        action: 'HOLD',
        reason: finalReason,
        confidence: finalConfidence,
        indicatorNotes,
        girassolBias,
        girassolConfluence,
        girassolDescription:   girassolDesc,
        girassolLevels:        girassolLevelSummary,
        girassolSupportLevel:  girassolSupportLevel ?? null,
        girassolResistLevel:   girassolResistanceLevel ?? null,
        girassolRawBuffers:    girassolRawBufferDiag,
        fibonacciDescription:  fibDesc,
        fibonacciNearestLevel: fibNearestLevel,
        indicatorsDetected:    indicatorCount || 0,
        assetFamily:  derivProfile?.family      ?? null,
        assetTrend:   derivProfile?.trendType   ?? null,
        assetVolClass: derivProfile?.volClass   ?? null,
        timestamp: Date.now()
      });
    }

    res.json({
      id:                    baseSignal.id,
      symbol:                baseSignal.symbol,
      action:                finalAction,
      lotSize:               baseSignal.lotSize,
      stopLoss:              refinedSL,
      takeProfit:            refinedTP,
      stopLossPips:          refinedSLPips,
      takeProfitPips:        refinedTPPips,
      slTpSource,
      entryPrice:            baseSignal.entryPrice,
      confidence:            Math.round(finalConfidence * 10) / 10,
      reason:                finalReason,
      indicatorNotes,
      girassolBias,
      girassolConfluence,
      girassolDescription:   girassolDesc,
      girassolLevels:        girassolLevelSummary,
      girassolSupportLevel:  girassolSupportLevel ?? null,
      girassolResistLevel:   girassolResistanceLevel ?? null,
      girassolRawBuffers:    girassolRawBufferDiag,
      fibonacciDescription:  fibDesc,
      fibonacciNearestLevel: fibNearestLevel,
      indicatorsDetected:    indicatorCount || 0,
      assetFamily:           derivProfile?.family      ?? null,
      assetTrend:            derivProfile?.trendType   ?? null,
      assetVolClass:         derivProfile?.volClass    ?? null,
      assetRsiThresholds:    derivProfile ? { oversold: derivProfile.rsiOversold, overbought: derivProfile.rsiOverbought } : null,
      assetContext,
      aiSources:             baseSignal.aiSources,
      timestamp:             baseSignal.timestamp,
      expiresAt:             baseSignal.expiresAt
    });
  } catch (err: any) {
    console.error('[MT5-Indicators] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metatrader/asset-profile/:symbol
 * Retorna o perfil completo do ativo sintético Deriv, incluindo
 * comportamento, limiares de indicadores, parâmetros de SL/TP e contexto IA.
 */
router.get('/asset-profile/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol;
    if (process.env.NODE_ENV === 'production' && !isAllowedProductionSymbol(symbol)) {
      return res.status(403).json({ error: 'Ativo bloqueado pela allowlist de produção.' });
    }
    const profile = metaTraderBridge.getDerivSyntheticProfile(symbol);
    const aiContext = metaTraderBridge.getAssetAIContext(symbol);
    const atr = metaTraderBridge.getSymbolATR(symbol);

    if (!profile) {
      return res.json({
        symbol,
        found: false,
        message: `Nenhum perfil encontrado para ${symbol}. O ativo pode ser um par Forex ou símbolo não reconhecido.`,
        aiContext,
        atr: atr || null
      });
    }

    res.json({
      symbol,
      found: true,
      profile,
      aiContext,
      atr: atr || null,
      indicatorGuidance: {
        rsiOversold:   profile.rsiOversold,
        rsiOverbought: profile.rsiOverbought,
        slAtrMultiplier: profile.slAtrMultiplier,
        tpAtrMultiplier: profile.tpAtrMultiplier,
        suggestedSLPips: atr > 0 ? Math.round(atr * profile.slAtrMultiplier / 0.0001) : null,
        suggestedTPPips: atr > 0 ? Math.round(atr * profile.tpAtrMultiplier / 0.0001) : null,
        useFibonacci: profile.useFibonacci,
        optimalTimeframe: profile.optimalTimeframe,
        spikeAlert: profile.spikeIndex ? { direction: profile.spikeDirection, frequency: profile.spikeFrequency } : null,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/market-data', mt5EaTokenAccess, (req: Request, res: Response) => {
  try {
    const { symbol, candles } = req.body;
    if (!symbol || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'symbol e candles são obrigatórios' });
    }
    if (process.env.NODE_ENV === 'production' && !isAllowedProductionSymbol(symbol)) {
      return res.status(403).json({ error: 'Ativo bloqueado pela allowlist de produção.' });
    }
    metaTraderBridge.addMarketData(symbol, candles);

    // ── Girassol Sintético: processa candles recebidos do EA antigo ──────────
    // Quando o EA não envia buffers do Girassol (versão antiga), calculamos
    // um sinal equivalente via ZigZag server-side e injetamos no cache.
    const existingGirassol = metaTraderBridge.getGirassolBias(symbol);
    const existingIsStale = !existingGirassol; // sem dados = calcular sintético

    if (existingIsStale && candles.length >= 20) {
      setImmediate(() => {
        try {
          const result = computeSyntheticGirassol(candles);
          if (result.bias !== 'NEUTRAL' || result.adx >= 20) {
            metaTraderBridge.setGirassolBias(symbol, result.bias, result.levelCount);
            console.log(`[MT5Bridge] 🌻 Girassol Sintético ${symbol}: ${result.bias} (${result.levelCount}/3 níveis) | ADX=${result.adx.toFixed(1)} | ${result.description}`);
          }
        } catch (_e) {}
      });
    }

    res.json({ ok: true, received: candles.length, symbol });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trade/open', mt5EaTokenAccess, (req: Request, res: Response) => {
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

router.post('/trade/update', mt5EaTokenAccess, (req: Request, res: Response) => {
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

router.post('/trade/close', mt5EaTokenAccess, (req: Request, res: Response) => {
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

router.get('/positions', mt5DashboardAccess, (_req: Request, res: Response) => {
  try {
    const bridgePositions = metaTraderBridge.getOpenPositions();
    res.json(bridgePositions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades', mt5DashboardAccess, (_req: Request, res: Response) => {
  try {
    const bridgeTrades = metaTraderBridge.getRecentTrades();
    res.json(bridgeTrades);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', mt5DashboardAccess, (_req: Request, res: Response) => {
  try {
    const bridgeStatus = metaTraderBridge.getStatus();
    res.json(bridgeStatus);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/config', mt5DashboardAccess, (_req: Request, res: Response) => {
  try {
    const config = metaTraderBridge.getConfig();
    const { apiToken: _, ...safeConfig } = config;
    res.json({ ...safeConfig, apiTokenConfigured: Boolean(String(config.apiToken ?? '').trim()) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/download-ea
 * Serve o EA v8.0 com ServerURL pré-preenchida (lê arquivo do disco).
 */
router.get('/download-ea', mt5DashboardAccess, async (req: Request, res: Response) => {
  try {
    let config = metaTraderBridge.getConfig();
    let token = String(config.apiToken ?? '').trim();
    if (process.env.NODE_ENV === 'production' && !token) {
      // The authorized EA download creates the first strong token automatically,
      // so a blank default can never make the live EA heartbeat unauthenticated.
      token = randomBytes(32).toString('hex');
      metaTraderBridge.updateConfig({ apiToken: token });
      config = metaTraderBridge.getConfig();
    }

    // Never hand out an EA with a token that has not been confirmed in durable storage.
    await metaTraderBridge.flushDurableConfig();

    // In Render production, never inject a legacy REPLIT_DEV_DOMAIN into the EA.
    const requestHost = String(req.get('host') ?? '').trim();
    const serverUrl = (process.env.NODE_ENV === 'production'
      ? (String(process.env.MT5_PUBLIC_BASE_URL ?? '').trim() || String(process.env.RENDER_EXTERNAL_URL ?? '').trim() || (requestHost ? `https://${requestHost}` : ''))
      : (String(process.env.REPLIT_DEV_DOMAIN ?? '').trim()
          ? `https://${String(process.env.REPLIT_DEV_DOMAIN).trim()}`
          : `${req.protocol}://${requestHost}`)).replace(/\/+$/, '');
    if (!serverUrl) {
      return res.status(500).json({ ok: false, error: 'Não foi possível determinar a URL pública do servidor MT5.' });
    }

    // Authorized download: inject both the live Render URL and the saved token.
    const eaPath = path.join(process.cwd(), 'public', 'downloads', 'InvistaPRO_EA.mq5');
    let content: string;
    try {
      content = fs.readFileSync(eaPath, 'utf-8');
      const escapeMqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
      const serverPattern = /input\s+string\s+ServerURL\s*=\s*"[^"]*";/;
      const discoveryPattern = /input\s+string\s+DiscoveryBlobURL\s*=\s*"[^"]*";/;
      const tokenPattern = /input\s+string\s+ApiToken\s*=\s*"[^"]*";/;
      if (!serverPattern.test(content) || !discoveryPattern.test(content) || !tokenPattern.test(content)) {
        throw new Error('O EA estático não contém os parâmetros ServerURL, DiscoveryBlobURL e ApiToken esperados.');
      }
      const discoveryUrl = `${serverUrl}/api/url`;
      content = content.replace(serverPattern, `input string   ServerURL        = "${escapeMqlString(serverUrl)}"; // URL do servidor InvistaPRO`);
      content = content.replace(discoveryPattern, `input string   DiscoveryBlobURL = "${escapeMqlString(discoveryUrl)}"; // URL de descoberta automática`);
      content = content.replace(tokenPattern, `input string   ApiToken         = "${escapeMqlString(token)}"; // Token de autenticação`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      content = generateEAContent(serverUrl, token, config);
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="InvistaPRO_EA.mq5"');
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
function generateEAContent(serverUrl: string, token: string, config: any): string {
  const lotSize           = config.defaultLotSize       ?? 0.01;
  const stopLoss          = config.stopLossPips          ?? 30;
  const takeProfit        = config.takeProfitPips        ?? 60;
  const maxPositions      = config.maxOpenPositions      ?? 5;
  const maxDailyLoss      = config.maxDailyLoss          ?? 100;
  const maxDailyProfit    = config.maxDailyProfit        ?? 500;
  const useAISL           = config.useAIStopLoss         ? 'true' : 'false';
  const useTrailing       = config.useTrailingStop       ? 'true' : 'false';
  const trailingPips      = config.trailingStopPips      ?? 15;
  const signalTimeout     = config.signalTimeoutSeconds  ?? 60;
  const fullAIMode        = config.fullAIMode            ? 'true' : 'false';
  const useAILotSize      = config.useAILotSize          ? 'true' : 'false';
  const useAITrailing     = config.useAITrailing         ? 'true' : 'false';
  const useAIRiskLimits   = config.useAIRiskLimits       ? 'true' : 'false';

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

//--- ══════════════════════════════════════════════════════════════
//--- MODO DE OPERAÇÃO
//--- ══════════════════════════════════════════════════════════════
input bool     FullAIMode       = ${fullAIMode};  // ✅ IA controla 100% de tudo (lote, SL, TP, trailing, limites)

//--- ══════════════════════════════════════════════════════════════
//--- CONEXÃO COM O SERVIDOR
//--- ══════════════════════════════════════════════════════════════
input string   ServerURL        = "${serverUrl}";
input string   ApiToken         = "${token}";
input string   TradingSymbol    = "";               // Vazio = par atual do gráfico

//--- ══════════════════════════════════════════════════════════════
//--- LOTE
//--- ══════════════════════════════════════════════════════════════
input bool     UseAILotSize     = ${useAILotSize};  // IA define o lote ideal por operação
input double   LotSize          = ${lotSize};        // Lote fixo (ignorado se UseAILotSize=true ou FullAIMode=true)

//--- ══════════════════════════════════════════════════════════════
//--- STOP LOSS / TAKE PROFIT
//--- ══════════════════════════════════════════════════════════════
input bool     UseAIStopLoss    = ${useAISL};        // IA calcula SL/TP baseado em ATR e volatilidade
input int      StopLoss         = ${stopLoss};        // SL em pips (ignorado se UseAIStopLoss=true ou FullAIMode=true)
input int      TakeProfit       = ${takeProfit};      // TP em pips (ignorado se UseAIStopLoss=true ou FullAIMode=true)

//--- ══════════════════════════════════════════════════════════════
//--- TRAILING STOP
//--- ══════════════════════════════════════════════════════════════
input bool     UseAITrailing    = ${useAITrailing};  // IA ativa trailing quando a operação está lucrativa
input bool     UseTrailing      = ${useTrailing};     // Trailing fixo (ignorado se UseAITrailing=true ou FullAIMode=true)
input int      TrailingPips     = ${trailingPips};    // Distância trailing em pips

//--- ══════════════════════════════════════════════════════════════
//--- GESTÃO DE RISCO
//--- ══════════════════════════════════════════════════════════════
input bool     UseAIRiskLimits  = ${useAIRiskLimits}; // IA gerencia posições máx. e limites diários
input int      MaxPositions     = ${maxPositions};     // Máx. posições simultâneas (ignorado se UseAIRiskLimits=true ou FullAIMode=true)
input double   MaxDailyLoss     = ${maxDailyLoss};     // Perda máx. diária em $ (ignorado se UseAIRiskLimits=true ou FullAIMode=true)
input double   MaxDailyProfit   = ${maxDailyProfit};   // Lucro alvo diário em $ (ignorado se UseAIRiskLimits=true ou FullAIMode=true)

//--- ══════════════════════════════════════════════════════════════
//--- TÉCNICO
//--- ══════════════════════════════════════════════════════════════
input int      SignalTimeout    = ${signalTimeout};
input int      PollIntervalSec  = 5;
input int      HeartbeatSec     = 15;
input int      CandlesHistory   = 200;

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

//--- Variáveis de modo IA (atualizadas via sinal e heartbeat)
bool   aiTrailingEnabled  = false;   // IA recomenda trailing para o trade atual
int    aiTrailingPips     = 15;      // Pips de trailing recomendados pela IA
int    aiMaxPositions     = 5;       // Máx. posições da IA (via heartbeat)
double aiMaxDailyLoss     = 100.0;   // Perda máx. da IA (via sinal)
double aiMaxDailyProfit   = 500.0;   // Lucro alvo da IA (via sinal)

//--- Helpers: obter limite de posições e limites diários conforme o modo ativo
int    GetEffectiveMaxPositions()  { return (FullAIMode || UseAIRiskLimits)  ? aiMaxPositions   : MaxPositions;  }
double GetEffectiveMaxDailyLoss()  { return (FullAIMode || UseAIRiskLimits)  ? aiMaxDailyLoss   : MaxDailyLoss;  }
double GetEffectiveMaxDailyProfit(){ return (FullAIMode || UseAIRiskLimits)  ? aiMaxDailyProfit : MaxDailyProfit; }

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

   // Resumo do modo de operação ativo
   if(FullAIMode) {
      Print("🤖 MODO COMPLETO IA — A IA controla: lote, SL/TP, trailing, limites");
   } else {
      if(UseAILotSize)    Print("🤖 Lote: controlado pela IA");
      else                Print("💰 Lote: fixo em ", DoubleToString(LotSize, 2));
      if(UseAIStopLoss)   Print("🛡️ SL/TP: dinâmico pela IA");
      else                Print("🛡️ SL/TP: fixo ", StopLoss, "/", TakeProfit, " pips");
      if(UseAITrailing)   Print("📈 Trailing: controlado pela IA");
      else if(UseTrailing) Print("📈 Trailing: fixo em ", TrailingPips, " pips");
      if(UseAIRiskLimits) Print("⚠️ Limites: controlados pela IA");
      else                Print("⚠️ Limites: Máx.", MaxPositions, " pos | SL $", DoubleToString(MaxDailyLoss,2), " | TP $", DoubleToString(MaxDailyProfit,2));
   }
   
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
   // Usar trailing se: manual ativado OU (modo IA ativado E IA recomendou trailing)
   bool doTrailing = UseTrailing || ((FullAIMode || UseAITrailing) && aiTrailingEnabled);
   if(doTrailing) ManageTrailingStop();
   
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
   if(CountOpenPositions() >= GetEffectiveMaxPositions()) return;
   
   string symbol  = GetSymbol();
   string url     = ServerURL + "/api/mt5/signal?symbol=" + symbol + "&token=" + ApiToken;
   char   req[], res[];
   string headers = "";
   
   int code = WebRequest("GET", url, headers, 8000, req, res, headers);
   if(code != 200) { Print("⚠️ Falha ao buscar sinal: HTTP ", code); return; }
   
   string response = CharArrayToString(res);
   
   string action            = ExtractJsonString(response, "action");
   string signalId          = ExtractJsonString(response, "id");
   double confidence        = ExtractJsonDouble(response, "confidence");
   double slPrice           = ExtractJsonDouble(response, "stopLoss");
   double tpPrice           = ExtractJsonDouble(response, "takeProfit");
   double aiLotSize         = ExtractJsonDouble(response, "lotSize");
   string reason            = ExtractJsonString(response, "reason");
   // Campos de controle autônomo da IA
   bool   sigAITrail        = ExtractJsonBool(response, "aiTrailingEnabled");
   int    sigAITrailPips    = (int)ExtractJsonDouble(response, "aiTrailingPips");
   double sigAIMaxLoss      = ExtractJsonDouble(response, "aiMaxDailyLoss");
   double sigAIMaxProfit    = ExtractJsonDouble(response, "aiMaxDailyProfit");
   int    sigAIMaxPos       = (int)ExtractJsonDouble(response, "aiMaxPositions");

   if(signalId == lastSignalId || action == "HOLD" || action == "") return;

   // Atualizar limites da IA com valores do sinal (quando modo IA ativo)
   if(FullAIMode || UseAITrailing) {
      aiTrailingEnabled = sigAITrail;
      if(sigAITrailPips > 0) aiTrailingPips = sigAITrailPips;
   }
   if(FullAIMode || UseAIRiskLimits) {
      if(sigAIMaxLoss   > 0) aiMaxDailyLoss   = sigAIMaxLoss;
      if(sigAIMaxProfit > 0) aiMaxDailyProfit  = sigAIMaxProfit;
      if(sigAIMaxPos    > 0) aiMaxPositions    = sigAIMaxPos;
   }

   // Determinar lote efetivo
   double lotSize = (FullAIMode || UseAILotSize) ? (aiLotSize > 0 ? aiLotSize : LotSize) : LotSize;

   Print("🔔 Sinal recebido: ", action, " ", symbol, " | Confiança: ", DoubleToString(confidence * 100, 1), "% | Lote: ", DoubleToString(lotSize, 2), " | ", reason);
   if(FullAIMode) Print("🤖 Modo IA: trailing=", aiTrailingEnabled ? "SIM" : "NÃO", " pips=", aiTrailingPips, " | MaxPos=", aiMaxPositions);
   
   double entryPrice = (action == "BUY") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   double point      = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int    digits     = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   
   //--- Determinar se é índice de spike (Crash/Boom)
   string symUp = symbol;
   StringToUpper(symUp);
   bool isSpikeIdx = (StringFind(symUp, "CRASH") >= 0 || StringFind(symUp, "BOOM") >= 0);

   //--- Para TODOS os ativos (inclusive Crash/Boom): usar SL/TP calculados pela IA.
   //--- A IA calcula SL/TP adaptativos para cada tipo de operação:
   //---  • CONTINUIDADE em Crash/Boom: SL/TP moderados para seguir a tendência natural
   //---  • SPIKE em Crash/Boom: SL/TP apertados para capturar o movimento rápido
   //--- Se a IA não forneceu valores, usar os parâmetros manuais configurados.
   bool useAISL = (FullAIMode || UseAIStopLoss);
   if(!useAISL || slPrice <= 0) {
      slPrice = (action == "BUY") ? entryPrice - StopLoss * point : entryPrice + StopLoss * point;
   }
   if(!useAISL || tpPrice <= 0) {
      tpPrice = (action == "BUY") ? entryPrice + TakeProfit * point : entryPrice - TakeProfit * point;
   }

   //--- Garantir distância mínima exigida pelo broker
   //--- IMPORTANTE: Deriv retorna SYMBOL_TRADE_STOPS_LEVEL=0 para índices sintéticos,
   //--- por isso usamos mínimos fixos por família de ativo como fallback obrigatório.
   long   stopsLevel  = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double brokerMin   = (double)stopsLevel * point;

   //--- Mínimos por família baseados em % do preço atual (Deriv retorna STOPS_LEVEL=0)
   //--- Usando percentual do preço porque os índices sintéticos têm preços muito variados.
   double fixedMinSL = 0;
   string symUpLocal = symbol; StringToUpper(symUpLocal);
   if(StringFind(symUpLocal, "JUMP 100") >= 0 || StringFind(symUpLocal, "JUMP100") >= 0 || StringFind(symUpLocal, "JD100") >= 0)
      fixedMinSL = entryPrice * 0.040;   // Jump 100: 4% do preço
   else if(StringFind(symUpLocal, "JUMP 75") >= 0  || StringFind(symUpLocal, "JUMP75") >= 0  || StringFind(symUpLocal, "JD75") >= 0)
      fixedMinSL = entryPrice * 0.030;   // Jump 75:  3% do preço
   else if(StringFind(symUpLocal, "JUMP 50") >= 0  || StringFind(symUpLocal, "JUMP50") >= 0  || StringFind(symUpLocal, "JD50") >= 0)
      fixedMinSL = entryPrice * 0.020;   // Jump 50:  2% do preço (~600 pts em 30000)
   else if(StringFind(symUpLocal, "JUMP 25") >= 0  || StringFind(symUpLocal, "JUMP25") >= 0  || StringFind(symUpLocal, "JD25") >= 0)
      fixedMinSL = entryPrice * 0.015;   // Jump 25:  1.5% do preço
   else if(StringFind(symUpLocal, "JUMP 10") >= 0  || StringFind(symUpLocal, "JUMP10") >= 0  || StringFind(symUpLocal, "JD10") >= 0)
      fixedMinSL = entryPrice * 0.010;   // Jump 10:  1% do preço
   else if(StringFind(symUpLocal, "CRASH") >= 0 || StringFind(symUpLocal, "BOOM") >= 0)
      fixedMinSL = entryPrice * 0.005;   // Crash/Boom: 0.5% do preço
   else if(StringFind(symUpLocal, "VOLATILITY") >= 0 || StringFind(symUpLocal, "R_") >= 0)
      fixedMinSL = entryPrice * 0.002;   // Volatility (R_X): 0.2% do preço

   double minDist = MathMax(MathMax(brokerMin, fixedMinSL),
                            (SymbolInfoDouble(symbol, SYMBOL_ASK) - SymbolInfoDouble(symbol, SYMBOL_BID)) * 3.0);

   if(minDist > 0)
   {
      if(action == "BUY")
      {
         if(slPrice > 0 && (entryPrice - slPrice) < minDist) { slPrice = NormalizeDouble(entryPrice - minDist, digits); Print("⚠️ SL ajustado para mínimo broker: ", DoubleToString(slPrice, digits)); }
         if(tpPrice > 0 && (tpPrice - entryPrice) < minDist) { tpPrice = NormalizeDouble(entryPrice + minDist, digits); Print("⚠️ TP ajustado para mínimo broker: ", DoubleToString(tpPrice, digits)); }
      }
      else
      {
         if(slPrice > 0 && (slPrice - entryPrice) < minDist) { slPrice = NormalizeDouble(entryPrice + minDist, digits); Print("⚠️ SL ajustado para mínimo broker: ", DoubleToString(slPrice, digits)); }
         if(tpPrice > 0 && (entryPrice - tpPrice) < minDist) { tpPrice = NormalizeDouble(entryPrice - minDist, digits); Print("⚠️ TP ajustado para mínimo broker: ", DoubleToString(tpPrice, digits)); }
      }
   }
   if(slPrice > 0) slPrice = NormalizeDouble(slPrice, digits);
   if(tpPrice > 0) tpPrice = NormalizeDouble(tpPrice, digits);
   if(isSpikeIdx) Print("ℹ️ Crash/Boom — SL: ", DoubleToString(slPrice, digits), " TP: ", DoubleToString(tpPrice, digits));
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
      if(dailyLoss >= GetEffectiveMaxDailyLoss())     closeReason = "SL";
      if(dailyProfit >= GetEffectiveMaxDailyProfit()) closeReason = "TP";
      
      if(closeReason != "") {
         trade.PositionClose(ticket);
         ReportTradeClose(ticket, posInfo.Symbol(), posInfo.TypeDescription(),
                          posInfo.Volume(), posInfo.PriceOpen(), current,
                          profit, closeReason);
      }
   }
}

//+------------------------------------------------------------------+
//| Trailing stop — só ativa quando a posição está no lucro         |
//| TrailingPips: distância do SL ao preço atual (em pips)          |
//| TrailingActivation: lucro mínimo em pips para ativar trailing   |
//+------------------------------------------------------------------+
void ManageTrailingStop() {
   string sym   = GetSymbol();
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double activationDist = TrailingPips * 0.5 * point; // Ativar quando lucro >= 50% do trailing

   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;

      double openPrice    = posInfo.PriceOpen();
      double currentPrice = posInfo.PriceCurrent();
      double currentSL    = posInfo.StopLoss();
      double currentTP    = posInfo.TakeProfit();
      ulong  ticket       = posInfo.Ticket();
      double newSL        = 0;
      bool   shouldModify = false;

      if(posInfo.PositionType() == POSITION_TYPE_BUY) {
         double profit = currentPrice - openPrice;
         // Só ativar trailing se a posição já tem lucro mínimo de TrailingPips/2
         if(profit < activationDist) continue;
         newSL = NormalizeDouble(currentPrice - TrailingPips * point, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
         // Mover SL apenas se o novo SL for MELHOR que o atual (mais alto para BUY)
         if(newSL > currentSL + point) shouldModify = true;
      } else {
         double profit = openPrice - currentPrice;
         // Só ativar trailing se a posição já tem lucro mínimo de TrailingPips/2
         if(profit < activationDist) continue;
         newSL = NormalizeDouble(currentPrice + TrailingPips * point, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
         // Mover SL apenas se o novo SL for MELHOR que o atual (mais baixo para SELL)
         if(currentSL == 0 || newSL < currentSL - point) shouldModify = true;
      }

      if(shouldModify) {
         trade.PositionModify(ticket, newSL, currentTP);
         Print("📉 Trailing stop movido: #", ticket, " → SL=", DoubleToString(newSL, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)));
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
   double effLoss        = GetEffectiveMaxDailyLoss();
   double effProfit      = GetEffectiveMaxDailyProfit();

   if(netDayLoss >= effLoss) {
      Print("🛑 Limite diário de PERDA LÍQUIDA atingido: -$", DoubleToString(netDayLoss, 2),
            " | Início: $", DoubleToString(startDayBalance, 2),
            " | Atual: $",  DoubleToString(currentBalance, 2),
            " | Limite: $", DoubleToString(effLoss, 2),
            (FullAIMode || UseAIRiskLimits) ? " [IA]" : " [Manual]");
      return false;
   }
   if(netDayProfit >= effProfit) {
      Print("🎯 Meta diária de LUCRO LÍQUIDO atingida: +$", DoubleToString(netDayProfit, 2),
            " | Limite: $", DoubleToString(effProfit, 2),
            (FullAIMode || UseAIRiskLimits) ? " [IA]" : " [Manual]");
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

//+------------------------------------------------------------------+
//| Extrai bool de JSON simples                                      |
//+------------------------------------------------------------------+
bool ExtractJsonBool(string json, string key) {
   string search = "\\"" + key + "\\":";
   int start = StringFind(json, search);
   if(start < 0) return false;
   start += StringLen(search);
   string val = StringSubstr(json, start, 4);
   return (StringFind(val, "true") == 0);
}
`;
}

router.post('/config', mt5DashboardAccess, (req: Request, res: Response) => {
  try {
    const updates = { ...(req.body ?? {}) };
    const currentConfig = metaTraderBridge.getConfig();
    if (updates.realTradingAuthorized !== undefined && typeof updates.realTradingAuthorized !== 'boolean') {
      return res.status(400).json({ ok: false, code: 'MT5_INVALID_REAL_AUTHORIZATION', error: 'realTradingAuthorized deve ser booleano.' });
    }
    if (updates.accountType === 'demo') updates.realTradingAuthorized = false;
    if (updates.realTradingAuthorized === true && updates.accountType !== 'real' && currentConfig.accountType !== 'real') {
      return res.status(400).json({ ok: false, code: 'MT5_REAL_AUTH_REQUIRES_REAL_MODE', error: 'Selecione o modo REAL antes de autorizar execução REAL.' });
    }
    if (updates.accountType !== undefined && !['demo', 'real'].includes(updates.accountType)) {
      return res.status(400).json({ ok: false, code: 'MT5_INVALID_ACCOUNT_MODE', error: 'accountType deve ser demo ou real.' });
    }
    let generatedToken = false;
    if (!String(currentConfig.apiToken ?? '').trim() && !String(updates.apiToken ?? '').trim()) {
      updates.apiToken = randomBytes(32).toString('hex');
      generatedToken = true;
    }
    if (updates.apiToken !== undefined && updates.apiToken !== null && String(updates.apiToken).length > 0 && String(updates.apiToken).length < 24) {
      return res.status(400).json({ ok: false, error: 'O token MT5 precisa ter pelo menos 24 caracteres.' });
    }
    metaTraderBridge.updateConfig(updates);
    res.json({
      ok: true,
      apiTokenConfigured: true,
      tokenGenerated: generatedToken,
      message: generatedToken
        ? 'Configuração salva e token seguro gerado. Baixe novamente o EA para receber a URL e o token corretos.'
        : 'Configuração atualizada',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/signal/generate', mt5DashboardAccess, async (req: Request, res: Response) => {
  try {
    const config = metaTraderBridge.getConfig();
    if (mt5EnvironmentMismatch()) {
      return res.status(409).json({ action: 'HOLD', executionEnabled: false, code: 'MT5_ACCOUNT_MODE_MISMATCH', expectedAccountType: config.accountType, actualAccountType: lastMt5ObservedAccountType, reason: 'Ambiente MT5 não confirmado ou divergente. Geração de sinais bloqueada.', timestamp: Date.now() });
    }
    const productionBlock = getMt5ProductionBlock(config.apiToken, process.env, config.accountType, config.realTradingAuthorized);
    if (productionBlock) {
      return res.status(productionBlock.status).json({
        action: 'HOLD',
        ...productionBlock,
        confidence: 0,
        timestamp: Date.now(),
      });
    }
    const { symbol } = req.body;
    const targetSymbol = symbol || config.symbols[0] || 'EURUSD';
    const signal = await metaTraderBridge.generateSignal(targetSymbol);
    if (!signal) return res.json({ action: 'HOLD', reason: 'Análise em progresso' });
    res.json(signal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ai-analysis', mt5DashboardAccess, (_req: Request, res: Response) => {
  try {
    const bridgeLog = metaTraderBridge.getAnalysisLog();
    const bridgeLatest = metaTraderBridge.getLatestAnalysis();

    // Fallback: quando o MT5 EA não está conectado, usar o cache do auto-trading-scheduler
    const cacheLatest = consensusCache.getLatest();
    const cacheAll = consensusCache.getLatestPerSymbol();

    // Enriquecer com dados do cache quando o bridge não tem análises recentes (EA offline)
    const hasBridgeData = bridgeLatest !== null && (bridgeLatest as any).aiConsensus > 0;
    const effectiveLatest = hasBridgeData ? bridgeLatest : (cacheLatest ? {
      id: `cache_${cacheLatest.timestamp}`,
      timestamp: cacheLatest.timestamp,
      symbol: cacheLatest.symbol,
      phase: 'auto_trading',
      status: cacheLatest.aiConsensus >= cacheLatest.requiredConsensus ? 'approved' : 'hold',
      aiConsensus: cacheLatest.aiConsensus,
      requiredConsensus: cacheLatest.requiredConsensus,
      aiDirection: cacheLatest.aiDirection,
      aiReasoning: cacheLatest.reasoning,
      participatingModels: cacheLatest.participatingModels,
      decisionReason: `[Deriv] ${cacheLatest.aiDirection.toUpperCase()} ${cacheLatest.symbol} — ${cacheLatest.aiConsensus.toFixed(1)}% / ${cacheLatest.requiredConsensus}% exigido`,
      source: cacheLatest.source,
    } : null);

    // Log extra: uma entrada por ativo analisado recentemente pelo scheduler
    const extraLog = cacheAll.map(e => ({
      id: `cache_${e.symbol}_${e.timestamp}`,
      timestamp: e.timestamp,
      symbol: e.symbol,
      phase: 'auto_trading',
      status: e.aiConsensus >= e.requiredConsensus ? 'approved' : 'hold',
      aiConsensus: e.aiConsensus,
      requiredConsensus: e.requiredConsensus,
      aiDirection: e.aiDirection,
      aiReasoning: e.reasoning,
      participatingModels: e.participatingModels,
      decisionReason: `[Deriv] ${e.aiDirection.toUpperCase()} ${e.symbol} — ${e.aiConsensus.toFixed(1)}% / ${e.requiredConsensus}% exigido`,
      source: e.source,
    }));

    const mergedLog = hasBridgeData ? bridgeLog : [...extraLog, ...bridgeLog];

    res.json({ log: mergedLog, latest: effectiveLatest, total: mergedLog.length });
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
router.post('/position/monitor', mt5EaTokenAccess, (req: Request, res: Response) => {
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
    if (process.env.NODE_ENV === 'production' && !isAllowedProductionSymbol(symbol)) {
      return res.status(403).json({ error: 'Ativo bloqueado pela allowlist de produção.' });
    }
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

/**
 * POST /api/mt5/reset-session
 * Zera o estado operacional de sessão de testes sem apagar dados de aprendizado da IA.
 *
 * O que é zerado:
 *   - Perdas consecutivas (remove modo Recovery e thresholds elevados)
 *   - Circuit Breaker (remove bloqueio de pausa)
 *   - Log de análise em memória da sessão atual
 *   - Modo pós-perda e ativo bloqueado do RealStatsTracker
 *
 * O que NÃO é alterado:
 *   - Dados de aprendizado da IA (pesos, acurácia, padrões)
 *   - Banco de dados (trades, configurações, usuários)
 *   - Contadores cumulativos de sinais e trades
 */
router.post('/reset-session', async (req: Request, res: Response) => {
  try {
    const result = await metaTraderBridge.resetSessionState();
    res.json({
      ok: true,
      message: 'Estado de sessão zerado com sucesso',
      cleared: result.cleared,
      resetAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mt5/brazil-news
 * Retorna o sentimento atual do mercado brasileiro baseado em noticiário em tempo real.
 * Atualizado automaticamente a cada 60 segundos pelo BrazilNewsService.
 *
 * Response:
 *   { score, direction, strength, topHeadline, newsCount, updatedAt, categories, aiInfluence }
 */
router.get('/brazil-news', async (req: Request, res: Response) => {
  try {
    const sentiment = await brazilNewsService.getBrazilMarketSentiment();
    res.json({
      success: true,
      ...sentiment,
      headlines: sentiment.headlines.map(h => ({
        title:       h.title,
        source:      h.source,
        sentiment:   h.sentiment,
        score:       h.score,
        publishedAt: h.publishedAt,
        keywords:    h.keywords.slice(0, 5),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
