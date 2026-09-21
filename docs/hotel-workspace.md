# Mobile hotel workspace

`/hotel` is a phone-width workspace on every screen, with **Өнөөдөр**, **Байшин**, and **Ажил** tabs. The existing manager/owner accounts can open it from the Operations service menu. Reception and housekeeping roles are supported but no staff credentials are created automatically.

## Data ownership

- Cloudbeds remains authoritative for reservations, room assignments, occupancy and check-in/check-out. The existing `dalaieej-cloudbeds-notion-integration` Worker now exposes an authenticated read-only hotel projection. Its Notion mapping and webhook behavior are unchanged.
- Notion's existing `Баталгаажсан` label combines confirmed and checked-in bookings. The hotel feed preserves original reservation status and normalizes Cloudbeds room status `in_house` to occupied. Never derive occupancy from the Notion label.
- The feed includes physical rooms, arrivals over the next 14 days, all checked-in reservations (including overdue departures), and today's departures. Canceled/no-show reservations are excluded. A lack of a reservation is not an availability guarantee.
- Existing POS PostgreSQL datasets hold `Hotel_Feed`, `Hotel_Rooms`, `Hotel_Tasks`, and `Hotel_Operations`. The existing storage audit and backup mechanism includes these datasets. No additional database/service is introduced.
- Accommodation balances and POS guest debts are intentionally absent. POS debts require an explicit reservation-ID relationship before they can be associated safely.

## Freshness and safety

The page refreshes while visible every minute. The shared durable feed cache expires after two minutes, with Cloudbeds fetched outside the POS transaction lock. Complete successful source reads replace the cache; failures retain the last feed and display a stale warning. Failed source reads never become an empty healthy board. No guest data is stored in browser local storage.

Room occupancy and cleaning readiness are separate. A room starts as **Шалгаагүй**. A ready inspection applies for the Ulaanbaatar calendar day, and a newly observed checkout requires another inspection. Marking ready requires a source refresh within five minutes. Cloudbeds-blocked rooms cannot be marked ready in Operations. Completing a task does not automatically mark a room ready.

Task creation, claiming, completion, notes, readiness changes and their audit records are atomic. Mutations use request IDs and payload fingerprints; updates compare record versions to reject competing staff changes. Housekeeping may complete its own claimed tasks. Reception/managers/owners may complete or reopen tasks. Notes are shared operational text and should not contain private guest information.

## Permissions

- `owner`, `manager`, `reception`: hotel board plus on-demand guest phone information and a Cloudbeds link. Reservation ID is shown for lookup in Cloudbeds; external login is still required.
- `housekeeping`: room state, guest counts and tasks; guest names, phone details and property links are removed server-side. The contact endpoint requires reception permission.
- Existing waiter, kitchen and cashier roles gain no hotel access.
- Hotel-only roles cannot access POS sales, debts, kitchen or manager APIs. Their root page directs to `/hotel`.

Add named reception/housekeeping accounts only after the owner identifies the intended staff, through the existing protected `OPS_AUTH_ACCOUNTS` configuration. Never use a shared owner account for housekeeping.

## Deployment configuration

- Integration Worker: `HOTEL_FEED_TOKEN` secret.
- POS: matching `HOTEL_FEED_TOKEN` and `HOTEL_FEED_URL` pointing to the existing Worker origin, production scope. Both are server-only.
- Worker routes: `GET /hotel/feed`, `GET /hotel/reservation?id=...`. Bearer authentication is mandatory and responses are `private, no-store`. Only the minimal projected fields are returned; no passports, email addresses, payment cards or financial balances.
- Deploy/test the Worker first; deploy the POS to a candidate URL and verify before promotion.

Firebase/web push is a separate follow-up requiring validation on the actual Sunmi device. This release keeps an authoritative visible task list and does not claim to send background notifications.
