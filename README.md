# Dalai Eej Ops

Adaptive operations app and POS for Dalai Eej Resort.

## Routes

- `/` - adaptive entry: desktop register on wider screens, phone-first mobile app on mobile screens.
- `/ops` - desktop operations dashboard, always.
- `/register` - touch-friendly POS/register workflow for sales, room charges, settlements, refunds, and day close.
- `/kitchen` - live kitchen order display.
- `/waiter` - order-only mobile waiter workflow.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run lint
npm run build
```

The app reads live data from Google Sheets through the existing API routes. If the Google environment variables are missing or invalid, the dashboard shows partial/error states while the register falls back to its sample catalog.

## Ops data model

- `Sales_Log` remains the compatible order-level record.
- `Order_Items` stores one row per sold item. New orders and edits write it atomically with the order record.
- The management board checks normalization coverage, duplicate IDs, pending operations, receipt/payment totals, missing business dates, and zero-sale sessions.
- Managers can safely backfill missing historical `Order_Items` rows from the management board. The repair is append-only and never writes to Master Ledger.

## Connectivity safeguards

- Read-only mobile and operations views retain the last successful snapshot in the browser and use it when live requests fail.
- The register retains the active sale draft locally and restores it after a refresh or browser restart.
- Register writes are blocked when the browser reports that it is offline. A failed write keeps the form intact and asks the cashier to check History before retrying, avoiding an accidental duplicate.
- The installed app caches its main navigation routes so a previously loaded route can reopen during an outage.
- Reconnecting triggers an immediate refresh. The current safeguards do not queue sales, payments, voids, or day-close actions for automatic replay.
