const SENSITIVE_FIELD = /(?:^key$|password|passphrase|token|secret|api[_-]?key|authorization|auth[_-]?key|access[_-]?(?:key|token)|refresh[_-]?(?:key|token)|private[_-]?key|encryption[_-]?key|session[_-]?(?:id|key|token)|cookie|credential|signature)/i;

/**
 * Recursively redact credential-like fields before they reach logs.
 * Works for nested objects and arrays and does not mutate the input.
 */
export function sanitizeSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveData(item));
  if (value === null || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    SENSITIVE_FIELD.test(key) ? "[REDACTED]" : sanitizeSensitiveData(nested),
  ] as const);
  return Object.fromEntries(entries);
}
