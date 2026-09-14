CREATE SCHEMA IF NOT EXISTS reconciliation;

CREATE TABLE IF NOT EXISTS reconciliation.gmail_connections (
  connection_key TEXT PRIMARY KEY,
  email_address TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  scopes TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reconciliation.imap_connections (
  connection_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  email_address TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  encrypted_password TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ
);

DELETE FROM reconciliation.imap_connections AS legacy
WHERE legacy.connection_key = 'primary'
  AND legacy.provider IN ('datacom', 'yahoo')
  AND EXISTS (
    SELECT 1
    FROM reconciliation.imap_connections AS current
    WHERE current.connection_key = legacy.provider
  );

UPDATE reconciliation.imap_connections AS target
SET connection_key = target.provider
WHERE target.connection_key = 'primary'
  AND target.provider IN ('datacom', 'yahoo')
  AND NOT EXISTS (
    SELECT 1
    FROM reconciliation.imap_connections AS existing
    WHERE existing.connection_key = target.provider
  );

CREATE TABLE IF NOT EXISTS reconciliation.bank_accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution TEXT NOT NULL,
  account_suffix TEXT NOT NULL,
  display_name TEXT NOT NULL,
  ownership_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (
    ownership_scope IN ('business', 'personal', 'mixed', 'unknown')
  ),
  currency TEXT NOT NULL DEFAULT 'MNT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (institution, account_suffix)
);

CREATE TABLE IF NOT EXISTS reconciliation.bank_email_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'gmail',
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT,
  internet_message_id TEXT,
  sender_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  institution TEXT NOT NULL,
  transaction_at TIMESTAMPTZ,
  journal_no TEXT,
  direction TEXT NOT NULL DEFAULT 'unknown' CHECK (
    direction IN ('inflow', 'outflow', 'unknown')
  ),
  bank_account_id BIGINT REFERENCES reconciliation.bank_accounts(id),
  to_account_suffix TEXT,
  destination_bank TEXT,
  counterparty_text TEXT,
  description TEXT,
  amount_minor BIGINT,
  currency TEXT,
  minor_unit_digits INTEGER NOT NULL DEFAULT 0 CHECK (
    minor_unit_digits BETWEEN 0 AND 4
  ),
  authenticity_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    authenticity_status IN ('verified', 'unverified', 'failed')
  ),
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    parse_status IN ('parsed', 'partial', 'unsupported', 'failed', 'pending')
  ),
  reconciliation_status TEXT NOT NULL DEFAULT 'awaiting_receipt' CHECK (
    reconciliation_status IN (
      'awaiting_receipt', 'candidate', 'matched', 'no_receipt_required', 'exception'
    )
  ),
  raw_metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS bank_email_events_transaction_at_idx
ON reconciliation.bank_email_events(transaction_at DESC);

CREATE INDEX IF NOT EXISTS bank_email_events_reconciliation_status_idx
ON reconciliation.bank_email_events(reconciliation_status);

CREATE TABLE IF NOT EXISTS reconciliation.receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'email',
  merchant TEXT,
  document_number TEXT,
  issued_at TIMESTAMPTZ,
  amount_minor BIGINT,
  currency TEXT,
  minor_unit_digits INTEGER NOT NULL DEFAULT 0 CHECK (
    minor_unit_digits BETWEEN 0 AND 4
  ),
  storage_reference TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    extraction_status IN ('pending', 'extracted', 'partial', 'failed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reconciliation.receipts
ADD COLUMN IF NOT EXISTS original_filename TEXT;

ALTER TABLE reconciliation.receipts
ADD COLUMN IF NOT EXISTS content_type TEXT;

ALTER TABLE reconciliation.receipts
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

CREATE TABLE IF NOT EXISTS reconciliation.matches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bank_email_event_id BIGINT NOT NULL
    REFERENCES reconciliation.bank_email_events(id) ON DELETE CASCADE,
  receipt_id BIGINT NOT NULL
    REFERENCES reconciliation.receipts(id) ON DELETE CASCADE,
  confidence NUMERIC(5, 4) CHECK (confidence BETWEEN 0 AND 1),
  match_status TEXT NOT NULL DEFAULT 'proposed' CHECK (
    match_status IN ('proposed', 'confirmed', 'rejected')
  ),
  match_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_email_event_id, receipt_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS matches_one_confirmed_per_event_idx
ON reconciliation.matches(bank_email_event_id)
WHERE match_status = 'confirmed';

CREATE TABLE IF NOT EXISTS reconciliation.daily_supporting_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_key TEXT NOT NULL UNIQUE,
  reconciliation_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual_upload',
  storage_reference TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_supporting_documents_date_idx
ON reconciliation.daily_supporting_documents(reconciliation_date, created_at DESC);

CREATE TABLE IF NOT EXISTS reconciliation.gmail_sync_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'completed', 'partially_completed', 'failed')
  ),
  messages_found INTEGER NOT NULL DEFAULT 0,
  messages_imported INTEGER NOT NULL DEFAULT 0,
  messages_skipped INTEGER NOT NULL DEFAULT 0,
  messages_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS reconciliation.imap_sync_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'completed', 'partially_completed', 'failed')
  ),
  messages_found INTEGER NOT NULL DEFAULT 0,
  messages_imported INTEGER NOT NULL DEFAULT 0,
  messages_skipped INTEGER NOT NULL DEFAULT 0,
  messages_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
