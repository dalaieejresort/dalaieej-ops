# Telegram receipt payment lookup — 2027 season

Routine workflow remains Telegram → OCR → read-only bank-email lookup → Google
Sheets. `/receipt-payments/connect` is an owner-only Gmail authorization screen,
not another reconciliation dashboard.

Public OAuth information is available at `/receipt-payments` and its linked
`/receipt-payments/privacy` policy. Only these two exact paths bypass sign-in;
the Gmail connection page, callback, and private operational routes remain gated.

## Isolation

- Dedicated OAuth client and refresh token; no reconciliation credential fallback.
- Dedicated database connection and `receipt_payments.gmail_connection` table.
  Only the encrypted Gmail token is stored. No bank transaction/match imports.
- Only `dalaieejcamp@gmail.com` may be authorized; wrong accounts are rejected.
- The former `theenerzaya@gmail.com` credential is retained as an inactive record,
  never used as a fallback. The credential-table constraint is migrated atomically
  when the new inbox is authorized. No historical ledger or bank records change.
- Only verified Khan Bank outgoing-transfer emails from suffix 9325 can match.
- The only shared reconciliation module is the stateless Khan email parser.
- No access to reconciliation tables, sync runs, DGB/Global/Batsarai records,
  or the 2026 SQLite files. Use a separate database/database role for deployment.
- Re-forward enrichment in the bot only fills blank Paid via from row 976 onward.

## Deployment setup

Configure these on dalaieej-ops (no fallbacks to existing reconciliation values):

- `RECEIPT_GMAIL_CLIENT_ID` and `RECEIPT_GMAIL_CLIENT_SECRET`: a dedicated Google
  OAuth web client, ideally in its own Google Cloud project so consent/revocation
  cannot affect the existing reconciliation integration. Enable Gmail API.
- `RECEIPT_GMAIL_REDIRECT_URI`:
  `https://ops.dalaieej.mn/api/receipt-payments/gmail/callback`
  (register this exact authorized redirect URI on the new OAuth client).
- `RECEIPT_PAYMENTS_DATABASE_URL`: a separate PostgreSQL database/role, with
  permission to create its own `receipt_payments` schema and table.
- `RECEIPT_TOKEN_ENCRYPTION_KEY`: a new random secret of at least 32 characters.
- `RECEIPT_MATCH_SECRET`: existing dedicated bot-to-ops bearer secret.

On the bot set `RECEIPT_MATCH_URL` to
`https://ops.dalaieej.mn/api/receipt-payments/paid-via`.
The former `/api/reconciliation/paid-via` URL is a compatibility alias to this
isolated handler, never to reconciliation credentials or data.

After configuration, an owner signs in, opens the connection screen and grants
Gmail read-only access for the expected mailbox. No chat-connector credentials
are copied. The token is encrypted with AES-256-GCM before storage.

## Matching

The bearer-authenticated POST accepts `amount` (VAT-inclusive payable total),
`currency`, `supplier`, `reference`, and `date`. Exact amount/currency and either
an exact normalized reference (at least six characters) or exact normalized
supplier within 30 days are required. Searches are bounded to 31 days before/
32 days after the receipt date, capped at 50 messages. Ambiguous matches or
lookup/setup failures do not assign a bank label and do not block saving a receipt.

The browser consent permits mailbox read access; application queries restrict
usage to Khan transfer-receipt emails. Full email bodies are parsed in memory,
not persisted. Match evidence is written only by the bot to Google Sheets.
