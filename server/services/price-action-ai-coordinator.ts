/**
 * Event-driven AI review coordinator for the Price Action strategy.
 * This module never places orders. Callers must rerun deterministic policy
 * and use a separately approved DEMO-only execution adapter.
 */
export type ReviewDecision = 'APPROVE' | 'REJECT' | 'WATCH' | 'HOLD';
export type Direction = 'BUY' | 'SELL';
export interface PreTrigger {
  id: string;
  symbol: string;
  direction: Direction;
  detectedAt: number;
  triggerPrice: number;
  invalidationPrice: number;
  marketSnapshot: unknown;
}
export interface AiEntryReview {
  decision: ReviewDecision;
  direction?: Direction;
  confidence: number;
  reasoning: string;
  risks: string[];
}
export interface OpenPositionReview {
  action: 'HOLD' | 'TAKE_PARTIAL' | 'MOVE_STOP' | 'CLOSE';
  confidence: number;
  reasoning: string;
  proposedStop?: number;
  closeReason?: string;
}
export interface PositionState {
  id: string;
  symbol: string;
  direction: Direction;
  currentPrice: number;
  currentStop: number;
  takeProfit: number;
  lastMaterialEventAt: number;
}
export interface PriceActionAiProvider {
  reviewPreTrigger(candidate: PreTrigger): Promise<AiEntryReview>;
  reviewPosition(position: PositionState, marketSnapshot: unknown): Promise<OpenPositionReview>;
}
export interface CoordinatorConfig {
  preTriggerCooldownMs: number;
  positionHeartbeatMs: number;
  minConfidence: number;
}
export const DEFAULT_COORDINATOR_CONFIG: CoordinatorConfig = {
  preTriggerCooldownMs: 60_000,
  positionHeartbeatMs: 15_000,
  minConfidence: 0.80,
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validatePositionReview(
  position: PositionState,
  review: OpenPositionReview,
  minConfidence = DEFAULT_COORDINATOR_CONFIG.minConfidence,
): { accepted: boolean; reason: string } {
  if (!finite(review.confidence) || review.confidence < minConfidence || review.confidence > 1)
    return { accepted: false, reason: 'AI confidence below policy threshold or invalid' };
  if (review.action === 'MOVE_STOP') {
    if (!finite(review.proposedStop)) return { accepted: false, reason: 'Missing stop proposal' };
    const tighter = position.direction === 'BUY'
      ? review.proposedStop >= position.currentStop && review.proposedStop < position.currentPrice
      : review.proposedStop <= position.currentStop && review.proposedStop > position.currentPrice;
    if (!tighter) return { accepted: false, reason: 'AI may tighten protection only' };
  }
  if (review.action === 'CLOSE' && !review.closeReason?.trim())
    return { accepted: false, reason: 'AI close requires an auditable reason' };
  return { accepted: true, reason: 'AI recommendation valid; deterministic risk policy remains authoritative' };
}

export class PriceActionAiCoordinator {
  private readonly lastEntryReview = new Map<string, number>();
  private readonly lastPositionReview = new Map<string, number>();
  private readonly pending = new Set<string>();
  constructor(
    private readonly provider: PriceActionAiProvider,
    private readonly config: CoordinatorConfig = DEFAULT_COORDINATOR_CONFIG,
  ) {}

  async reviewPreTrigger(candidate: PreTrigger): Promise<{ invoked: boolean; approved: boolean; review?: AiEntryReview; reason: string }> {
    const now = Date.now();
    if (now - (this.lastEntryReview.get(candidate.symbol) ?? 0) < this.config.preTriggerCooldownMs)
      return { invoked: false, approved: false, reason: 'Per-symbol AI cooldown active' };
    const key = 'entry:' + candidate.id;
    if (this.pending.has(key)) return { invoked: false, approved: false, reason: 'Duplicate review in progress' };
    this.pending.add(key);
    this.lastEntryReview.set(candidate.symbol, now);
    try {
      const review = await this.provider.reviewPreTrigger(candidate);
      const approved = review.decision === 'APPROVE' && review.direction === candidate.direction &&
        finite(review.confidence) && review.confidence >= this.config.minConfidence &&
        review.confidence <= 1 && typeof review.reasoning === 'string' && Array.isArray(review.risks);
      return { invoked: true, approved, review, reason: approved
        ? 'AI approved preliminary setup; wait for final deterministic entry trigger'
        : 'AI rejected or withheld approval; no entry permitted' };
    } catch {
      return { invoked: true, approved: false, reason: 'AI unavailable; fail closed' };
    } finally { this.pending.delete(key); }
  }

  async reviewOpenPosition(
    position: PositionState,
    marketSnapshot: unknown,
    materialEvent = false,
    force = false,
  ): Promise<{ invoked: boolean; accepted: boolean; review?: OpenPositionReview; reason: string }> {
    const now = Date.now();
    const last = this.lastPositionReview.get(position.id) ?? 0;
    if (!force && !materialEvent && now - last < this.config.positionHeartbeatMs)
      return { invoked: false, accepted: false, reason: 'No material event; heartbeat not due' };
    const key = 'position:' + position.id;
    if (this.pending.has(key)) return { invoked: false, accepted: false, reason: 'Position review already running' };
    this.pending.add(key);
    this.lastPositionReview.set(position.id, now);
    try {
      const review = await this.provider.reviewPosition(position, marketSnapshot);
      const validation = validatePositionReview(position, review, this.config.minConfidence);
      return { invoked: true, accepted: validation.accepted, review, reason: validation.reason };
    } catch {
      return { invoked: true, accepted: false, reason: 'AI unavailable; keep existing broker-side protections' };
    } finally { this.pending.delete(key); }
  }
}
