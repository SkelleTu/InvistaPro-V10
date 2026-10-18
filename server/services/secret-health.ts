type SecretState = "configured" | "missing" | "invalid_format" | "not_applicable";

function state(name: string, validator?: (value: string) => boolean): { name: string; state: SecretState } {
  const value = process.env[name];
  if (!value || !value.trim()) return { name, state: "missing" };
  if (validator && !validator(value.trim())) return { name, state: "invalid_format" };
  return { name, state: "configured" };
}

function optionalState(name: string, validator?: (value: string) => boolean): { name: string; state: SecretState } {
  const value = process.env[name];
  // Demo/REAL credentials are user-scoped and encrypted in Neon; global tokens are legacy fallbacks.
  if (!value || !value.trim()) return { name, state: "not_applicable" };
  if (validator && !validator(value.trim())) return { name, state: "invalid_format" };
  return { name, state: "configured" };
}

export function getSecretHealth() {
  // Automation credentials must be visible as presence/format checks too.
  // The public health endpoint reports only states, never the values.
  const platform = process.env.INVISTA_PLATFORM === "aura" ? "aura" : "main";
  const emailCandidates = [process.env.ADMIN_EMAIL];
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const automationEmail = String(emailCandidates.find(value => emailPattern.test(String(value ?? "").trim())) ?? "").trim();
  const automationPassword = String(platform === "aura"
    ? (process.env.AURA_STYLE_ACCOUNT_PASSWORD || process.env.AURA_ACCOUNT_PASSWORD || process.env.AURA_MASTER_PASSWORD || process.env.INVISTA_AURA_ACCOUNT_PASSWORD || "")
    : (process.env.INVISTAPRO_ACCOUNT_PASSWORD || process.env.INVISTA_ACCOUNT_PASSWORD || process.env.INVISTA_MASTER_PASSWORD || process.env.MASTER_PASSWORD || process.env.ADMIN_PASSWORD || "")
  ).trim();
  const automationToken = String(platform === "aura"
    ? process.env.AURA_STYLE_AUTOMATION_TOKEN ?? ""
    : process.env.INVISTAPRO_AUTOMATION_TOKEN ?? ""
  ).trim();
  const anyEmailCandidate = emailCandidates.some(value => String(value ?? "").trim());
  // These global automation values are legacy fallbacks. The current system
  // stores account credentials per user in encrypted storage, so absent global
  // fallbacks must not make the whole service look degraded. If a fallback is
  // supplied, still validate/report its presence without ever exposing values.
  const emailState: SecretState = automationEmail
    ? "configured"
    : anyEmailCandidate
      ? "invalid_format"
      : "not_applicable";
  const checks = [
    { name: `AUTOMATION_ENTRY_TOKEN_${platform.toUpperCase()}`, state: optionalState(`AUTOMATION_ENTRY_TOKEN_${platform.toUpperCase()}`).state },
    { name: `AUTOMATION_ACCOUNT_EMAIL_${platform.toUpperCase()}`, state: emailState },
    { name: `AUTOMATION_ACCOUNT_PASSWORD_${platform.toUpperCase()}`, state: optionalState(`AUTOMATION_ACCOUNT_PASSWORD_${platform.toUpperCase()}`).state },
    state("ENCRYPTION_KEY", v => /^[0-9a-fA-F]{64}$/.test(v)),
    state("DERIV_APP_ID", v => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)),
    optionalState("DERIV_API_KEY_DEMO"),
    optionalState("DERIV_API_KEY_REAL"),
    state("DATABASE_URL", v => /^(postgres|postgresql|file|libsql|https?):/i.test(v)),
    state("SESSION_SECRET", v => v.length >= 32 && !/^your-very-secure/i.test(v)),
    state("ADMIN_EMAIL", v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)),
    state("SENDGRID_API_KEY"),
    state("HUGGINGFACE_API_KEY"),
    state("UNIVERSAL_SERVER_URL", v => /^https?:\/\//i.test(v)),
    state("INVISTA_UNIVERSAL_SERVER_KEY", v => v.length >= 16),
    state("INTERNAL_DESKTOP_CTRL_SECRET", v => v.length >= 32),
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
