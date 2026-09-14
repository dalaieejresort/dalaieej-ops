# Standalone receipt reconciliation

This module is intentionally isolated from Dalai Eej's Master Ledger, Google
Sheets operations data, and local finance SQLite files. It uses a dedicated
PostgreSQL schema named `reconciliation`.

## Current workflow

1. An owner opens `/reconciliation` and connects a supported mailbox read-only.
2. Datacom sync searches only for TDB and Khan Bank transaction messages;
   Gmail sync searches only for Khan Bank transfer receipts. Yahoo additionally
   imports only transfers whose exact source account is in
   `RECONCILIATION_YAHOO_KHAN_ACCOUNT_NUMBERS`.
3. The parser verifies the sender authentication results and extracts the
   transfer details.
4. Only parsed metadata and the final four account digits are stored. Full
   message bodies and full account numbers are not persisted. Yahoo compares
   the full source account to its allowlist in memory before import.
5. Transactions enter an `awaiting_receipt` queue. Receipt ingestion and match
   approval use the dedicated `receipts` and `matches` tables.

## Configuration

Telegram receipt Paid via matching is separate from this tool. See
[`lib/receipt-payments/README.md`](../lib/receipt-payments/README.md) for its
dedicated authorization, storage, connection screen and matching endpoint.

Copy the variables listed in `.env.example` into the deployment environment.
The Google OAuth web client must enable the Gmail API, include the configured
callback URL, and request the `gmail.readonly` scope. The database schema is
initialized from `schema.postgres.sql` on first use.
