import assert from "node:assert/strict";
import { sanitizeSensitiveData } from "../server/services/sensitive-data-redaction";
import { getSecretHealth } from "../server/services/secret-health";

const original = {
  email: "audit@example.invalid",
  password: "not-a-real-password",
  apiKey: "not-a-real-api-key",
  api_key: "not-a-real-api-key",
  accessToken: "not-a-real-token",
  sessionId: "not-a-real-session",
  key: "not-a-real-key",
  nested: [{ refresh_token: "not-a-real-refresh-token", label: "safe" }],
  items: [{ cookie: "not-a-real-cookie", count: 3 }],
};

const sanitized = sanitizeSensitiveData(original) as Record<string, any>;
assert.equal(sanitized.email, original.email);
assert.equal(sanitized.password, "[REDACTED]");
assert.equal(sanitized.apiKey, "[REDACTED]");
assert.equal(sanitized.api_key, "[REDACTED]");
assert.equal(sanitized.accessToken, "[REDACTED]");
assert.equal(sanitized.sessionId, "[REDACTED]");
assert.equal(sanitized.key, "[REDACTED]");
assert.equal(sanitized.nested[0].refresh_token, "[REDACTED]");
assert.equal(sanitized.nested[0].label, "safe");
assert.equal(sanitized.items[0].cookie, "[REDACTED]");
assert.equal(sanitized.items[0].count, 3);
assert.equal(original.password, "not-a-real-password", "sanitizer must not mutate input");

process.env.DERIV_APP_ID = "app12345";
const derivIdHealth = getSecretHealth().checks.find((item) => item.name === "DERIV_APP_ID");
assert.equal(derivIdHealth?.state, "configured", "Current Deriv developer App IDs may use the app12345 format, not only digits.");

console.log("Sensitive-data redaction and current Deriv App ID format checks passed.");
