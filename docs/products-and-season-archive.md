# Products, stock and season archives

Managers and owners can open https://ops.dalaieej.mn/products from **Бараа / Үлдэгдэл** in the POS navigation.

- **New product:** enter a distinct name, category and selling prices. The server allocates the next unused `INV-####` SKU. The product starts at zero stock.
- **Opening stock:** select an existing product, enter its physically counted quantity and a reason. Use this once, before any movements for that product.
- **Delivery:** select the product, quantity received and supplier/invoice reference. It adds to existing stock. Both forms work before opening the cash register.
- **Corrections:** use the stock-count adjustment on the Products page with a signed quantity difference and reason.
- Food and services with unlimited availability do not use stock receiving. Stock receiving does not create a financial payment or purchase receipt; record that separately on receipts.dalaieej.mn.

Creation and receiving require manager access and run in the same transaction as the operation journal. Repeating the same request cannot create a second product or delivery; changing the payload while reusing its request ID is rejected. Stock receipts use the catalogue's SKU and canonical name.

Owners can download history from https://ops.dalaieej.mn/archive. Seasons run **September 1–August 31**, named by ending year, matching receipts.dalaieej.mn. September 2026 belongs to Season 2027. Undated records remain separately identified. The complete recovery download includes the original catalogue, all record values, row counters, imports and audit history.

Archiving does not settle old debts or resolve historical SKU discrepancies. The reset removes them from live POS activity while preserving the evidence in private archives. Catalogue products remain; stock starts at zero. Order and receipt allocation counters continue, so identifiers are not reused.

## Daily workflow

The separate **Өдрийн тойм** dashboard has been removed. Existing `/ops` bookmarks redirect to **Өдрийн хаалт**.

- **Борлуулалт → Өр → Өдрийн хаалт:** sell, collect outstanding balances, then compare sales, payments, expected cash and counted cash before closing.
- **Бараа / Үлдэгдэл:** create products, receive stock, review every tracked product with stock at or below three, and enter signed stock-count corrections. Corrections retain their reason, actor and idempotent request ID, and require an open cash day.
- Managers and owners see **Анхаар!** in the shared header when data checks, unfinished operations or check-loading failures need attention. Details include the existing manual missing-line repair. Healthy checks stay out of the header; **Өгөгдлийн шалгалт** in the account menu opens them on demand. Checks refresh while the page is visible, and the dialog offers a fresh read.
- Failed saves remain visible at the affected form. A failed check is shown as unavailable/stale, not proof that the data is healthy.

## Cutover procedure

The reset is an operator command, not a web button. Confirm the scope explicitly with the owner before any future reset. Use credentials from protected environment files, never command-line connection strings or committed files.

1. Run `node scripts/pos-season-archive.mjs preview OUTPUT_DIRECTORY ADMIN_ENV_FILE` and review seasonal counts. Confirm September–August still matches the receipt settings.
2. Pass tests, type checking and lint. Build and deploy a paused release (`POS_WRITES_PAUSED=true`) with a temporary `NEXT_PUBLIC_POS_DATA_GENERATION` distinct from the final release. Promote it and verify health reports writes paused. Old deployed URLs must also be protected from operational use during cutover.
3. Run `node scripts/pos-season-archive.mjs apply NEW_OUTPUT_DIRECTORY ADMIN_ENV_FILE BACKUP_ENV_FILE`. It uploads the full snapshot and season exports to the existing private backup store, downloads and compares every file, and restores the full snapshot into isolated local PostgreSQL before modifying live records.
4. The reset takes the application advisory lock and compares every source table against the backup. Any intervening change aborts the entire reset. It then keeps the catalogue and prior archive index, zeros catalogue stock, removes live activity, and records the new archive manifests. Dataset allocation counters remain unchanged. Import provenance remains.
5. Verify the resulting record counts, stock, serial counters and authenticated archive downloads. Deploy/promote the final build with `POS_WRITES_PAUSED=false`, without the temporary public generation override. Persist the final `POS_DATA_GENERATION` in production; it must match the client generation in `lib/pos/data-generation.ts`.
6. Check health, products, empty sales/debts and archive downloads. Staff must reload their POS screens and enter opening stock before starting the next cash day. Old browser mutations receive `POS_GENERATION_CHANGED`; browser caches and Redis boards use the new generation.

The `OUTPUT_DIRECTORY` must be private and ignored by Git. It contains the snapshot, plan, manifests, recovery verification and post-reset snapshot. The backup environment file supplies only `POS_BACKUP_BLOB_TOKEN` (or the existing shared `FINANCE_BACKUP_READ_WRITE_TOKEN`). The admin file supplies `RECEIPT_PAYMENTS_DATABASE_URL` or `POS_DATABASE_URL`.

For recovery, download the complete snapshot and use the existing `scripts/pos-storage.mjs restore` command with a fresh `pos_restore_...` schema. The restore verifies all four tables and reinstates the audit identity sequence. Never overwrite the active schema blindly after new trading has begun. Existing daily backups include the archive manifest dataset automatically.

## Completed reset — 21 September 2026

The owner authorized a fresh start, including current-season activity. The reset retained 207 catalogue products and all original row-allocation counters, and cleared all live sales, debts, payments, receipts, stock movements, refunds, order items and cash-day sessions. Catalogue stock is zero.

| Archive | Activity records |
| --- | ---: |
| Season 2024 | 4 |
| Season 2026 | 4,991 |
| Season 2027 | 6 |
| Undated | 2 |
| Total | 5,003 |

A separate complete recovery file includes all 5,210 original records (history plus catalogue), dataset definitions, counters, import provenance and audit history. Its canonical SHA-256 is `43ad3daf7870447febcc67b3879e43190fc66187f5e8d82c4437bfaeb299a193`. Every private archive was downloaded and compared; the full snapshot was restored and compared in isolated PostgreSQL before the reset. The owner download API was also verified after the reset. Run evidence is retained locally under `.private/pos-season-reset-20260921-precise/`.

The initial attempt correctly rolled back when timestamp precision differed: JavaScript Date had rounded PostgreSQL microseconds to milliseconds. Cutover exports now preserve six fractional digits in UTC; the exact source comparison and restored-table comparison both pass. This change remains compatible with earlier recovery files.

The release also fixes packaged Chocopie being classified as an unlimited kitchen pie by a name keyword. Products in the packaged-food category now remain counted stock; prepared food and the explicit unlimited SKU keep their existing behavior.
