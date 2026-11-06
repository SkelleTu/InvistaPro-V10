# Financial provider integration contract (provider-neutral)

## Purpose

Prepare the platform for a later Mercado Pago integration without enabling real-money movement before the provider credentials, webhook, reconciliation and operational controls are configured and tested.

This document is an implementation contract, not evidence that payment processing is already implemented.

## Current architecture constraints

- The application has a Neon PostgreSQL + local SQLite architecture. Neon is intended to be the durable source for essential records; SQLite is a cache/runtime store.
- The current `users.saldo` and `movimentos` model is not, by itself, an auditable financial ledger.
- Existing PIX generation and manual deposit confirmation routes are intentionally disabled.
- Withdrawal quote is informational only. It must not reserve funds or transfer money.
- Provider callbacks must never write directly to a client-controlled balance field.
- Financial writes must fail closed if the durable database is unavailable. Never fall back to SQLite for a credit, debit, reservation, refund or settlement.

## Required domain model

Implement these as durable PostgreSQL tables with migrations, constraints and indexes before enabling provider operations:

1. `payment_intents`: immutable user, amount in integer BRL cents, currency, external reference, provider, status, expiry and timestamps. Unique external reference.
2. `provider_payments`: provider payment ID, intent ID, observed amount/currency/status, provider event ID, verified-at timestamps and sanitized metadata. Unique (provider, provider payment ID) and unique (provider, event ID) where event ID exists.
3. `ledger_accounts`: account owner and account type (customer available, customer invested, customer earnings, provider clearing, fees, withdrawals payable).
4. `ledger_transactions` and `ledger_entries`: immutable, balanced double-entry postings in integer cents. A transaction must balance to zero per currency. Never edit posted entries; reverse with a new transaction.
5. `withdrawal_requests`: user, destination key snapshot, requested cents, fee cents, net cents, status, idempotency key, provider transfer ID, failure reason and timestamps. Unique idempotency key.
6. `provider_webhook_events`: provider event ID, signature verification result, payload hash, processing state, retry count and timestamps. Store only necessary, sanitized payload data.
7. `financial_audit_events`: actor, action, entity, correlation ID, timestamp and redacted before/after metadata.

All money is integer cents. Reject non-integer cents, non-BRL currency unless explicitly supported, zero/negative values and values outside configured limits.

## Provider adapter boundary

Define a provider-neutral interface with operations equivalent to:

- createPixPayment(intent): returns provider payment ID, QR payload/image data, expiry and checkout URL where applicable;
- fetchPayment(providerPaymentId): retrieves authoritative provider state;
- verifyWebhook(headers, rawBody): verifies authenticity using the provider's documented signature procedure;
- createPixTransfer(withdrawal): initiates a transfer only after a durable withdrawal reservation and policy checks;
- fetchTransfer(providerTransferId): reconciles transfer state;
- verifyAccount/health(): validates configuration without exposing credentials.

The Mercado Pago adapter is the first implementation of this interface. No Mercado Pago SDK calls belong in client code. Access tokens and webhook secrets are server-side secrets only.

## Deposit state machine

Allowed progression: created -> pending -> approved | rejected | cancelled | expired. A refund is represented as a separate reversal/refund event; never rewrite the original approval.

1. Authenticated client requests an intent. Server derives user ID from the session, validates amount and limits, generates an unpredictable external reference and persists the intent.
2. Server creates the provider payment using the persisted reference and returns only the checkout/PIX details needed by that user.
3. Webhook endpoint reads the raw request body, verifies the provider signature, persists a deduplicated event and fetches the payment directly from the provider.
4. Reconciliation verifies provider payment ID, external reference, exact amount, currency, recipient/account and final status against the immutable intent.
5. In one PostgreSQL transaction, lock the intent, enforce legal state transition and idempotency, record provider payment, post balanced ledger entries and mark the intent approved.
6. Duplicate, out-of-order, malformed or unverifiable events must not credit funds. A scheduled reconciliation job must recover missed webhooks by querying pending provider payments.

Never trust browser redirects, screenshots, PIX copy-and-paste text, client-supplied status or webhook payload fields before provider verification.

## Withdrawal state machine

Allowed progression: requested -> reserved -> submitted -> paid | failed | cancelled. A failed/cancelled request releases its reservation through a compensating ledger transaction.

1. Client requests a quote; server returns requested amount, fee and net amount without moving money.
2. Client confirms; server revalidates identity/KYC, destination ownership/policy, limits, available balance and idempotency.
3. In one PostgreSQL transaction, reserve available funds and create the withdrawal request.
4. Worker submits the transfer to the provider using an idempotency key.
5. Reconcile transfer status with provider API/webhooks. Mark paid only after authoritative provider confirmation.
6. On definitive failure, release reservation exactly once. Unknown/pending provider state remains reserved and is reconciled; never automatically release while transfer outcome is ambiguous.

Never accept a destination key or amount from an untrusted callback. Record a snapshot of the destination key at request time and protect it as sensitive data.

## API contract to implement

- POST /api/client/payment-intents
- GET /api/client/payment-intents/:id
- GET /api/client/payment-intents
- POST /api/webhooks/:provider (raw body, signature verification, rate limits)
- POST /api/client/withdrawals/quote
- POST /api/client/withdrawals
- GET /api/client/withdrawals
- GET /api/client/financial-summary
- GET /api/client/ledger

Every client route is authenticated and scoped to the session user. Admin routes require explicit role authorization and immutable audit records. Never expose provider tokens, full webhook payloads, other users' financial data or internal fraud/risk signals to clients.

## Required tests before enabling live money

- Unit tests: cents parsing, fee rounding, state transitions, reference matching, currency and amount mismatch.
- Integration tests against a disposable PostgreSQL database: transaction rollback, row locking, concurrent duplicate webhook, concurrent withdrawal, unique constraints and ledger balancing.
- Provider sandbox tests: PIX generation, approved/pending/expired/rejected/refunded payments, invalid signature, replay, duplicate/out-of-order webhook, transfer paid/failed/pending and reconciliation after missed webhook.
- Authorization tests: cross-user intent/withdrawal/ledger access denied; client cannot set status, user ID, balance or provider IDs.
- Failure tests: Neon unavailable, provider timeout, worker restart, duplicate retry and partial failure. Financial mutations fail closed.
- Operational checks: secret rotation, webhook URL/TLS, alerting, reconciliation queue, audit retention, backup/restore and incident runbook.

## Activation gates

Keep all live deposit and withdrawal features disabled until all of the following are true:

- Durable PostgreSQL migrations have been applied and verified on the actual production database.
- Ledger invariants and concurrent/idempotency tests pass.
- Provider credentials and webhook secret are configured as deployment secrets.
- Provider account, legal business profile, settlement account and allowed payment methods are approved/configured with the provider.
- Sandbox end-to-end tests and reconciliation pass.
- Operational monitoring, limits, KYC/AML/fraud controls, refund/dispute handling and customer support procedures are ready.
- Explicit production enablement flag is reviewed and switched by an authorized operator.

Payment acceptance and investment/trading authorization are separate decisions. A successful deposit must not automatically enable trading or promise returns. The platform must clearly disclose risk, fees, withdrawal conditions and applicable regulatory requirements before accepting customer funds.
