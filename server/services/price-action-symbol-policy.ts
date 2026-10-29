/** Strict whitelist for supported crypto bases/quotes and known broker affixes. */
export function isPriceActionCryptoSymbol(symbol: unknown): boolean {
  if (typeof symbol !== 'string') return false;
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const suffixes = ['', 'M', 'R', 'A', 'PRO', 'ECN', 'RAW', 'C', 'Z'];
  const prefixes = ['', 'M'];
  for (const prefix of prefixes) for (const base of ['BTC', 'XBT', 'ETH', 'SOL'])
    for (const quote of ['USDT', 'USD']) for (const suffix of suffixes)
      if (normalized === prefix + base + quote + suffix) return true;
  return false;
}
