# POS PostgreSQL storage

The POS storage adapter supports `POS_STORAGE_BACKEND=postgres` and the legacy `sheets` backend. PostgreSQL is configured independently from the receipts/finance application, with the `pos` schema and the restricted `dalaieej_pos_app` login. The POS login cannot read finance tables. Redis still serves the kitchen queue and live/management board projections.

## Data and transaction boundaries

Nine source datasets are retained: Inventory_Catalogue, Inventory_Log, Sales_Log, Payments_Log, Receipts_Log, Day_Sessions, Voids_Log, Order_Items, and the historical Merged_Sales_Data snapshot. Row positions and next-row counters are preserved because existing order/receipt control numbers depend on them.

The initial storage representation retains named datasets and typed JSON records rather than changing the established POS business model during cutover. `pos.named_records` exposes named fields for SQL/reporting. `pos.stock_balances` replaces the catalogue's inventory formula. The other catalogue price formulas become explicit prices at their exported effective values. Merged_Sales_Data remains historical; new item records go to Order_Items.

All POS API operations execute in a PostgreSQL transaction. A shared advisory transaction lock is acquired before reading business state, preventing cross-instance overselling, duplicate claims, and overlapping day transitions. Non-success responses roll back claims, row counters, records and audit entries together. The existing request identifiers/fingerprints remain the idempotency keys. Kitchen effects are deferred until commit. No server-local data cache is reused in PostgreSQL mode.

The historical source is preserved exactly, including existing fractional monetary values and old inconsistencies. A storage migration does not reconcile or rewrite the underlying accounting history, automatically close days, or backfill missing old order-item rows.

## Environment

- `POS_STORAGE_BACKEND`: `postgres` in production; explicitly `sheets` for pre-cutover staging.
- `POS_DATABASE_URL`: restricted POS login; never use the finance administrator connection in application configuration.
- `POS_DATABASE_SCHEMA`: `pos`; isolated tests/recovery use another validated `pos_…` schema.
- `POS_WRITES_PAUSED=true`: reject mutating POS requests with HTTP 503 during cutover/recovery. Health reports this maintenance state.
- `POS_BACKUP_BLOB_TOKEN`: server-side token for the private backup store.
- `CRON_SECRET`: authenticates `/api/cron/pos-backup`.

The database role has SELECT/INSERT/UPDATE on datasets/records, SELECT/INSERT on audit, SELECT on imports/views, and sequence access. It cannot delete data or administer the schema. Provisioning/import/recovery uses an administrative connection outside the deployed application.

## Backup and recovery

Vercel schedules `/api/cron/pos-backup` daily at 20:00 UTC (04:00 Ulaanbaatar). Each run captures datasets, records, import manifests, and audit entries in a repeatable-read transaction, writes a timestamped private Blob under `pos/backups/`, downloads it, and verifies identical bytes. Failures return HTTP 500 and appear in Vercel logs. There is no automatic deletion of historical backups. Scheduling is configured in `vercel.json`; inspect execution logs to detect missed runs.

Backups use format `dalaieej-pos-backup-v1` and a canonical JSON SHA-256 checksum. The source archive separately retains entered/effective/formatted cell values, formulas and formatting for provenance. Neither source data nor backups belong in Git or deployments; `.private/` is excluded from both.

The migration CLI requires Node and an administrative `POS_DATABASE_URL` supplied through a protected environment file:

```sh
node --env-file=/secure/admin.env scripts/pos-storage.mjs backup unused /secure/pos-backup.json
POS_DATABASE_SCHEMA=pos_restore_YYYYMMDD node --env-file=/secure/admin.env scripts/pos-storage.mjs restore /secure/pos-backup.json /secure/restore-result.json
```

Restore only creates a new `pos_restore_…` or `pos_test_…` schema and refuses an existing schema. It verifies the archive checksum and then compares every restored table. It never overwrites live POS records. For real recovery, pause POS writes, take a current backup, restore into a new schema, validate totals/stock and application reads, grant the POS account access to that schema, then deploy the new `POS_DATABASE_SCHEMA`. Keep the previous schema for investigation.

Before accepting PostgreSQL writes, a paused Sheets deployment can be promoted as rollback. After accepting PostgreSQL writes, do **not** roll back to a Sheets-writing deployment: it would fork the record history. Roll back code with PostgreSQL configuration retained, or use the schema recovery process above.

## Verification

```sh
node --test tests/pos-storage.test.mjs tests/day-service.test.mjs tests/waiter-workflow.test.mjs
npx tsc --noEmit
npm run build
```

`POS_HOSTED_TEST_URL` optionally runs storage tests against real hosted PostgreSQL. Each test creates a randomly named test schema and drops only that schema afterward. Tests cover sale/replay/refund/stock/day closing, rollback and maintenance, concurrent duplicate sales, unpaid edits, and split-payment settlement/replay. Use an administrative test connection; the production restricted login intentionally cannot create schemas.

The import tool verifies all source row hashes, headers, counters, and every catalogue stock balance against SQL. A production cutover requires a paused source, a fresh final snapshot and verification, a private backup/restore check, then the application switch. Preserve the retired spreadsheet as an archive until a separate deletion decision.

## Owner login

`OPS_OWNER_ACCOUNT` contains the same owner credential hash and salt as the receipts owner's account. When configured, it replaces only owner entries from `OPS_AUTH_ACCOUNTS`; manager, cashier, waiter and kitchen accounts retain their credentials. Use username `owner` and the existing receipts password on either site. Each site keeps its own signed session cookie. Password changes must update both owner configurations; this is a shared credential, not a centralized identity provider.


Production cutover was completed on 2026-09-18. The detailed import manifest, archive locations and recovery evidence are kept in the private migration report, outside the public repository.
