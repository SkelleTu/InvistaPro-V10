import { invistaPriceActionAiProvider } from './price-action-ai-provider';\nimport {
  detectPriceActionPreTrigger,
  evaluatePriceActionSetup,
  validateAIEntryReview,
  type Candle,
  type MarketContext,
  type PriceActionSetup,
  type Timeframe,
} from './price-action-engine';
import {
  PriceActionAiCoordinator,
  type AiEntryReview,
} from './price-action-ai-coordinator';

export type PipelineState = 'AI_REVIEW' | 'WAITING_AI' | 'WAITING_TRIGGER' | 'ENTRY_APPROVED' | 'HOLD';

export interface PipelineResult {
  state: PipelineState;
  symbol: string;
  setup?: PriceActionSetup;
  aiReview?: AiEntryReview;
  reasons: string[];
}

interface ApprovedCandidate {
  patternTime: number;
  side: 'BUY' | 'SELL';
  review: AiEntryReview;
}

/**
 * Connects the cheap early-warning scanner to the AI coordinator and then to
 * the full deterministic gate. The injected provider must call the real
 * Invista PRO AI ensemble; this class itself never fabricates AI responses
 * and never sends exchange orders.
 */
export class PriceActionAiPipeline {
  private readonly approved = new Map<string, ApprovedCandidate>();

  constructor(
    private readonly coordinator: PriceActionAiCoordinator,
  ) {}

  async evaluate(
    symbol: string,
    frames: Partial<Record<Timeframe, Candle[]>>,
    context: MarketContext,
  ): Promise<PipelineResult> {
    const early = detectPriceActionPreTrigger(frames);
    const previous = this.approved.get(symbol);

    if (previous) {
      const entryFrame = frames.M5 && frames.M5.length >= 30 ? frames.M5 : frames.M1;
      const patternStillPresent = Array.isArray(entryFrame) && entryFrame.some(c => c.time === previous.patternTime);
      const last = Array.isArray(entryFrame) ? entryFrame[entryFrame.length - 1] : undefined;
      const invalidated = !last || (previous.side === 'BUY'
        ? last.low < (entryFrame!.find(c => c.time === previous.patternTime)?.low ?? Number.POSITIVE_INFINITY)
        : last.high > (entryFrame!.find(c => c.time === previous.patternTime)?.high ?? Number.NEGATIVE_INFINITY));
      if (!patternStillPresent || invalidated) this.approved.delete(symbol);
    }

    const active = this.approved.get(symbol);
    if (active) {
      const setup = evaluatePriceActionSetup(frames, context);
      if (!setup.approved || setup.action !== active.side) {
        return {
          state: 'WAITING_TRIGGER', symbol, setup, aiReview: active.review,
          reasons: setup.reasons.length ? setup.reasons : ['Aguardando confirmação final do gatilho'],
        };
      }
      const validation = validateAIEntryReview(setup, {
        decision: active.review.decision,
        direction: active.review.direction,
        confidence: active.review.confidence,
      });
      this.approved.delete(symbol);
      if (!validation.approved) return { state: 'HOLD', symbol, setup, aiReview: active.review, reasons: [validation.reason] };
      return {
        state: 'ENTRY_APPROVED', symbol, setup, aiReview: active.review,
        reasons: ['Pré-gatilho aprovado pela IA', 'Gatilho final confirmado', 'Todos os gates determinísticos aprovados'],
      };
    }

    if (!early) {
      return { state: 'HOLD', symbol, reasons: ['Nenhum pré-gatilho válido; IA não foi acionada'] };
    }

    const pattern = (frames.M5 && frames.M5.length >= 30 ? frames.M5 : frames.M1)!.find(c => c.time === early.patternTime);
    if (!pattern) return { state: 'HOLD', symbol, reasons: ['Candle do pré-gatilho não está mais disponível'] };
    const candidate = {
      id: [symbol, early.side, early.patternTime].join(':'),
      symbol,
      direction: early.side,
      detectedAt: Date.now(),
      triggerPrice: early.triggerLevel,
      invalidationPrice: early.invalidationLevel,
      marketSnapshot: { frames, context, early },
    };
    const result = await this.coordinator.reviewPreTrigger(candidate);
    if (!result.invoked && !result.approved) {
      return { state: 'WAITING_AI', symbol, reasons: [result.reason] };
    }
    if (!result.approved || !result.review) {
      return { state: 'HOLD', symbol, aiReview: result.review, reasons: [result.reason] };
    }
    this.approved.set(symbol, { patternTime: early.patternTime, side: early.side, review: result.review });
    return {
      state: 'WAITING_TRIGGER', symbol, aiReview: result.review,
      reasons: ['IA aprovou a análise preliminar', 'Aguardando rompimento final; nenhuma ordem foi enviada'],
    };
  }
}
\n/** Shared strategy instances; importing this module does not start market feeds or trading. */\nexport const priceActionAiCoordinator = new PriceActionAiCoordinator(invistaPriceActionAiProvider);\nexport const priceActionAiPipeline = new PriceActionAiPipeline(priceActionAiCoordinator);\n