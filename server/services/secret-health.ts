type SecretState = "configured" | "missing" | "invalid_format" | "not_applicable";

function state(name: string, validator?: (value: string) => boolean): { name: string; state: SecretState } {
  const value = process.env[name];
  if (!value || !value.trim()) return { name, state: "missing" };
  if (validator && !validator(value.trim())) return { name, state: "invalid_format" };
  return { name, state: "configured" };
}

export function getSecretHealth() {
  const checks = [
    state("ENCRYPTION_KEY", v => /^[0-9a-fA-F]{64}$/.test(v)),
    state("DERIV_APP_ID", v => /^\d+$/.test(v)),
    state("DERIV_API_KEY_DEMO"),
    state("DERIV_API_KEY_REAL"),
    state("DATABASE_URL", v => /^(postgres|postgresql|file|libsql|https?):/i.test(v)),
    state("SESSION_SECRET", v => v.length >= 32 && !/^your-very-secure/i.test(v)),
    state("ADMIN_EMAIL", v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)),
    state("SENDGRID_API_KEY"),
    state("HUGGINGFACE_API_KEY"),
    state("UNIVERSAL_SERVER_URL", v => /^https?:\\/\\//i.test(v)),
    state("INVISTA_UNIVERSAL_SERVER_KEY", v => v.length >= 16),
  ];

  const missing = checks.filter(c => c.state === "missing").map(c => c.name);
  const invalid = checks.filter(c => c.state === "invalid_format").map(c => c.name);

  return {
    status: invalid.length ? "invalid" : missing.length ? "degraded" : "healthy",
    checks,
    missing,
    invalid,
    timestamp: new Date().toISOString(),
    note: "Presence/format is checked here. Expiration or revocation is detected only by the provider's authenticated request and is never inferred from the secret value.",
  };
}
