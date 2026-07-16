# Dalai Eej Ops

Adaptive operations app and POS for Dalai Eej Resort.

## Routes

- `/` - adaptive entry: desktop register on wider screens, phone-first mobile app on mobile screens.
- `/ops` - desktop operations dashboard, always.
- `/register` - touch-friendly POS/register workflow for sales, room charges, settlements, refunds, and day close.

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

## Connectivity safeguards

- Read-only mobile and operations views retain the last successful snapshot in the browser and use it when live requests fail.
- The register retains the active sale draft locally and restores it after a refresh or browser restart.
- Register writes are blocked when the browser reports that it is offline. A failed write keeps the form intact and asks the cashier to check History before retrying, avoiding an accidental duplicate.
- The installed app caches its main navigation routes so a previously loaded route can reopen during an outage.
- Reconnecting triggers an immediate refresh. The current safeguards do not queue sales, payments, voids, or day-close actions for automatic replay.
