-- InvistaPRO V10: durable financial ledger foundation.
-- Additive migration: does not alter or delete legacy users/movimentos/trade_operations.
-- Run first on a Neon child branch; promote only after application tests and review.

CREATE TABLE IF NOT EXISTS financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code varchar(100) NOT NULL UNIQUE,
  owner_user_id varchar(32) NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_kind varchar(32) NOT NULL CHECK (account_kind IN (
    'client_available','client_reserved','client_capital','client_yield',
    'provider_clearing','platform_fee','platform_equity','suspense'
  )),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, account_kind, currency)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  event_type varchar(48) NOT NULL,
  reference_type varchar(48),
  reference_id varchar(160),
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_created_at
  ON ledger_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_reference
  ON ledger_transactions (reference_type, reference_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  direction varchar(6) NOT NULL CHECK (direction IN ('debit','credit')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_created ON ledger_entries(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(32) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status varchar(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','approved','rejected','cancelled','expired','refunded')),
  provider varchar(40),
  provider_payment_id varchar(160),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  expires_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user_created ON payment_intents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL UNIQUE REFERENCES payment_intents(id) ON DELETE RESTRICT,
  provider varchar(40) NOT NULL,
  provider_payment_id varchar(160) NOT NULL,
  external_reference varchar(160) NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  provider_status varchar(40) NOT NULL,
  verified_at timestamptz NOT NULL,
  raw_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_payment_id)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(32) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  net_amount_cents bigint NOT NULL CHECK (net_amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status varchar(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','reserved','submitted','paid','failed','cancelled')),
  provider varchar(40),
  provider_transfer_id varchar(160),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  destination_fingerprint varchar(160),
  destination_encrypted text,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (net_amount_cents + fee_cents = amount_cents)
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_created ON withdrawal_requests(user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(40) NOT NULL,
  provider_event_id varchar(160) NOT NULL,
  event_type varchar(100) NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status varchar(20) NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  processing_error text,
  UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_received ON provider_webhook_events(received_at DESC);

CREATE TABLE IF NOT EXISTS financial_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id varchar(32),
  subject_user_id varchar(32),
  action varchar(80) NOT NULL,
  entity_type varchar(48) NOT NULL,
  entity_id varchar(160) NOT NULL,
  before_state jsonb,
  after_state jsonb,
  reason text,
  request_id varchar(160),
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_financial_audit_subject_created ON financial_audit_events(subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_audit_created ON financial_audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by varchar(32) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  report_scope varchar(24) NOT NULL CHECK (report_scope IN ('client','platform','financial','operational')),
  subject_user_id varchar(32) REFERENCES users(id) ON DELETE RESTRICT,
  period_start timestamptz,
  period_end timestamptz,
  row_count bigint NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  content_sha256 char(64) NOT NULL,
  private_storage_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_report_exports_subject_created ON admin_report_exports(subject_user_id, created_at DESC);

-- A posted transaction is append-only. Corrections are new reversing transactions.
CREATE OR REPLACE FUNCTION reject_posted_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_APPEND_ONLY: posted financial records cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_transactions_immutable ON ledger_transactions;
CREATE TRIGGER trg_ledger_transactions_immutable
BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION reject_posted_ledger_mutation();

DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_posted_ledger_mutation();

DROP TRIGGER IF EXISTS trg_financial_audit_events_immutable ON financial_audit_events;
CREATE TRIGGER trg_financial_audit_events_immutable
BEFORE UPDATE OR DELETE ON financial_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_posted_ledger_mutation();

-- Deferred validation: every ledger transaction must balance at commit time.
CREATE OR REPLACE FUNCTION assert_ledger_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  debit_total numeric;
  credit_total numeric;
  entry_count integer;
  invalid_currency boolean;
BEGIN
  target_id := CASE WHEN TG_TABLE_NAME = 'ledger_transactions' THEN NEW.id ELSE NEW.transaction_id END;
  SELECT
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'credit'), 0),
    COUNT(*),
    COALESCE(bool_or(e.currency <> a.currency), false)
  INTO debit_total, credit_total, entry_count, invalid_currency
  FROM ledger_entries e
  JOIN financial_accounts a ON a.id = e.account_id
  WHERE e.transaction_id = target_id;

  IF entry_count < 2 OR debit_total <> credit_total OR invalid_currency THEN
    RAISE EXCEPTION 'LEDGER_TRANSACTION_UNBALANCED: % (entries %, debit %, credit %, invalid_currency %)',
      target_id, entry_count, debit_total, credit_total, invalid_currency;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_transaction_balanced ON ledger_transactions;
CREATE CONSTRAINT TRIGGER trg_ledger_transaction_balanced
AFTER INSERT ON ledger_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_balanced();

DROP TRIGGER IF EXISTS trg_ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_balanced();

-- Report metadata is retained; the PDF itself must live in private object storage.
