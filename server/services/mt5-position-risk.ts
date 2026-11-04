/**
 * Calculates the stricter of the balance-based and volume-based MT5 position loss caps.
 * The per-lot cap is $20 per 1.00 lot; never round a micro-lot up to 1.00 lot.
 */
export function calculateMt5PositionHardStop(balance: number, lots: number): number {
  const safeLots = Number.isFinite(lots) && lots > 0 ? lots : 0.01;
  const lotBasedStop = -(20 * safeLots);
  const balanceBasedStop = Number.isFinite(balance) && balance > 0
    ? -(balance * 0.0025)
    : lotBasedStop;
  return Math.max(balanceBasedStop, lotBasedStop);
}
