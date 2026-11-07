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
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    target_id := NEW.id;
  ELSE
    target_id := NEW.transaction_id;
  END IF;
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


-- Archived report metadata is append-only; replace a report by creating a new export.
CREATE OR REPLACE FUNCTION reject_financial_archive_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_ARCHIVE_APPEND_ONLY: archived report metadata cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_report_exports_immutable ON admin_report_exports;
CREATE TRIGGER trg_admin_report_exports_immutable
BEFORE UPDATE OR DELETE ON admin_report_exports
FOR EACH ROW EXECUTE FUNCTION reject_financial_archive_mutation();


-- Guard state machines and immutable request terms at the database boundary.
CREATE OR REPLACE FUNCTION enforce_payment_intent_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.amount_cents <> OLD.amount_cents OR
     NEW.currency <> OLD.currency OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'PAYMENT_INTENT_IMMUTABLE_TERMS';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'created' AND NEW.status IN ('pending','cancelled','expired')) OR
    (OLD.status = 'pending' AND NEW.status IN ('approved','rejected','cancelled','expired','refunded')) OR
    (OLD.status = 'approved' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'PAYMENT_INTENT_INVALID_TRANSITION: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_intent_transition ON payment_intents;
CREATE TRIGGER trg_payment_intent_transition
BEFORE UPDATE ON payment_intents
FOR EACH ROW EXECUTE FUNCTION enforce_payment_intent_transition();

CREATE OR REPLACE FUNCTION enforce_withdrawal_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.amount_cents <> OLD.amount_cents OR
     NEW.fee_cents <> OLD.fee_cents OR NEW.net_amount_cents <> OLD.net_amount_cents OR
     NEW.currency <> OLD.currency OR NEW.idempotency_key <> OLD.idempotency_key OR
     NEW.destination_fingerprint IS DISTINCT FROM OLD.destination_fingerprint OR
     NEW.destination_encrypted IS DISTINCT FROM OLD.destination_encrypted THEN
    RAISE EXCEPTION 'WITHDRAWAL_IMMUTABLE_TERMS';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'requested' AND NEW.status IN ('reserved','cancelled','failed')) OR
    (OLD.status = 'reserved' AND NEW.status IN ('submitted','failed','cancelled')) OR
    (OLD.status = 'submitted' AND NEW.status IN ('paid','failed'))
  ) THEN
    RAISE EXCEPTION 'WITHDRAWAL_INVALID_TRANSITION: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_transition ON withdrawal_requests;
CREATE TRIGGER trg_withdrawal_transition
BEFORE UPDATE ON withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION enforce_withdrawal_transition();


-- Affiliate program tables are durable, but pending commissions are not wallet credits.
CREATE TABLE IF NOT EXISTS affiliate_profiles (
  user_id varchar(32) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referral_code varchar(20) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id varchar(32) PRIMARY KEY,
  referrer_user_id varchar(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id varchar(32) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_no_self_referral CHECK (referrer_user_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer ON affiliate_referrals(referrer_user_id);
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id varchar(32) PRIMARY KEY,
  referrer_user_id varchar(32) NOT NULL REFERENCES users(id),
  referred_user_id varchar(32) NOT NULL REFERENCES users(id),
  payment_reference varchar(160) NOT NULL UNIQUE,
  eligible_base_cents bigint NOT NULL,
  rate_bps integer NOT NULL DEFAULT 150,
  commission_amount_cents bigint NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_referrer ON affiliate_commissions(referrer_user_id);
