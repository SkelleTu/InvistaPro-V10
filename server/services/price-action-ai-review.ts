import fetch from 'node-fetch';
import type { PriceActionSetup } from './price-action-engine';

export interface PriceActionAIReview {
  decision: string;
  direction: string;
  confidence: number;
  riskOverride?: unknown;
  rationale: string;
}

interface OriginalSignal {
  action: string;
  confidence: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

const GROQ_API_KEY = String(process.env.GROQ_API_KEY ?? '').trim();

/**
 * Dedicated second-pass review of the already-approved deterministic setup.
 * Any unavailable, malformed, or nonconforming response fails closed.
 */
export async function reviewPriceActionSetup(
  setup: PriceActionSetup,
  originalSignal: OriginalSignal,
): Promise<PriceActionAIReview> {
  const rejected: PriceActionAIReview = {
    decision: 'reject',
    direction: 'HOLD',
    confidence: 0,
    riskOverride: 'review_unavailable',
    rationale: 'Revisão IA dedicada indisponível ou inválida; entrada bloqueada.',
  };
  if (!GROQ_API_KEY || !setup.approved || !['BUY', 'SELL'].includes(setup.action)) return rejected;

  const payload = {
    strategy: {
      action: setup.action,
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
      riskReward: setup.riskReward,
      reasons: setup.reasons,
      checks: setup.checks,
      features: setup.features,
    },
    originalAI: {
      action: originalSignal.action,
      confidence: originalSignal.confidence,
      entryPrice: originalSignal.entryPrice,
      stopLoss: originalSignal.stopLoss,
      takeProfit: originalSignal.takeProfit,
    },
  };
  const system = [
    'You are an independent risk reviewer for a deterministic Price Action trading setup.',
    'The deterministic strategy owns direction, entry, stop loss, take profit, costs, and risk limits.',
    'You must not create or change a trade. You may only approve or reject the exact candidate.',
    'Approve only if the original AI signal agrees with the candidate direction and no supplied check contradicts it.',
    'Never propose alternative prices, lot sizes, risk overrides, or new directions.',
    'Return exactly one JSON object with keys decision (approve or reject), direction (BUY or SELL or HOLD), confidence (number from 0 to 1), riskOverride (must be null), rationale (short string).',
  ].join(' ');

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        temperature: 0,
        max_tokens: 250,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ...rejected, rationale: 'Provedor de revisão IA respondeu com erro HTTP; entrada bloqueada.' };
    const body = await response.json() as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return rejected;
    const parsed = JSON.parse(content);
    const decision = String(parsed.decision ?? '').toLowerCase();
    const direction = String(parsed.direction ?? '').toUpperCase();
    const confidence = Number(parsed.confidence);
    if (!['approve', 'reject'].includes(decision)
      || !['BUY', 'SELL', 'HOLD'].includes(direction)
      || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      || parsed.riskOverride !== null) return rejected;
    return {
      decision,
      direction,
      confidence,
      riskOverride: parsed.riskOverride,
      rationale: String(parsed.rationale ?? '').slice(0, 500),
    };
  } catch {
    return rejected;
  }
}
