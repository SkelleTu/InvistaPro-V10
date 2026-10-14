# Active session reconciliation audit

This change set validates that existing authenticated sessions reconcile their saved Deriv credential with the encrypted Universal Server vault, while preserving the normal platform session and keeping trading disarmed. The reconciliation checks live status first and is throttled to avoid repeated reconnect attempts.
