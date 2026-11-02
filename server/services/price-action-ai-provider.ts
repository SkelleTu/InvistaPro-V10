import {
  huggingFaceAI,
} from './huggingface-ai';
import type {
  AiEntryReview,
  OpenPositionReview,
  PositionState,
  PreTrigger,
  PriceActionAiProvider,
} from './price-action-ai-coordinator';

/** Adapts the existing Invista PRO multi-model AI ensemble to Price Action. */
export class InvistaPriceActionAiProvider implements PriceActionAiProvider {
  async reviewPreTrigger(candidate: PreTrigger): Promise<AiEntryReview> {
    const result = await huggingFaceAI.reviewPriceActionSnapshot(
      candidate.symbol,
      'ENTRY',
      candidate.marketSnapshot,
    );
    return {
      decision: result.decision,
      direction: result.direction,
      confidence: result.confidence,
      reasoning: result.reasoning,
      risks: result.risks,
    };
  }

  async reviewPosition(position: PositionState, marketSnapshot: unknown): Promise<OpenPositionReview> {
    const base = marketSnapshot && typeof marketSnapshot === 'object'
      ? marketSnapshot as Record<string, unknown>
      : {};
    const result = await huggingFaceAI.reviewPriceActionSnapshot(
      position.symbol,
      'POSITION',
      { ...base, position },
    );
    return {
      action: result.action,
      confidence: result.confidence,
      reasoning: result.reasoning,
      proposedStop: result.proposedStop,
      closeReason: result.closeReason,
    };
  }
}

export const invistaPriceActionAiProvider = new InvistaPriceActionAiProvider();
