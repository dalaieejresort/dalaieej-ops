# Waiter workflow and design brief

Status: reset to the shared POS interface. Updated 2026-09-14.

This document records the user's requirements and distinguishes them from proposals and unresolved questions. It describes the intended product, not a claim that these capabilities are implemented. Scope is `/waiter`; discovery for `/kitchen` follows separately, with the handoff between them considered here.

## Purpose

Take a correct, legible, typed order beside the guest and send it to the kitchen without unnecessary delay. Support the waiter through serving and eventual payment or cabin charging, preserving responsibility for the order and money.

## Agreed direction

### Decision 01: Waiter is a focused mobile version of POS

Explicitly accepted by the user on 2026-09-14:

> Waiter is a focused mobile version of POS, sharing its order and payment rules.

Use this decision to guide subsequent scope and interaction choices. Reuse existing POS rules wherever they apply; any waiter-specific departure must be identified and discussed. The user subsequently authorized implementation of ordering, serving, and settlement, and explicitly confirmed that waiters may settle bills. `/waiter` renders the shared `RegisterApp`; the later reset decision below supersedes the custom waiter layout.

### Confirmed requirements

- Use POS as the foundation for a streamlined, mobile-friendly waiter interface. Reuse its order and payment rules rather than independently reinventing previously established POS decisions.
- The waiter responsible for the table should be able to present the bill and take payment.
- Support paying as guests go, leaving a balance on the cabin/guest account, and settlement at checkout.
- Approximately 4–6 waiters are expected; staffing count is provisional.
- Devices are camp-owned Android phones. The intended setup restricts them to Ops and identifies each waiter individually, even when phones change hands between shifts.
- Restaurant tables have their own numbers, separate from cabins 1–18. There are approximately 16 tables; the exact count is unconfirmed.
- Serving location and the cabin/guest account carrying the bill are distinct information. A table number must not automatically become a cabin charge reference.
- Owner and manager roles already exist and should be used. Detailed approval rules remain to be decided.

## Payment responsibility: agreed requirements

Taking payment and confirming receipt of money are separate events.

| Method | Waiter workflow | Accountability requirement |
| --- | --- | --- |
| Card | Present the terminal to the guest. | Until integration is available, match terminal approval to the order. A manual “paid” action alone is not proof that money arrived. |
| Cash | Record the amount received and change given. | Track cash attributable to the waiter until handover. The cashier confirms the amount actually received; differences require manager attention. |
| Cabin charge | Assign the order to the correct cabin/guest account. | Keep the balance outstanding for checkout; charging a cabin is not receipt of payment. |

Orders and money remain attributed to people, not merely to a device such as “Phone 3.” Card-terminal integration is desired; feasibility with the actual terminal and provider in Mongolia has not been established.

## Agreed decision: simple shift handover

Accepted during discovery on 2026-09-14. A waiter ends their own shift independently of the whole POS business-day close.

1. **Hand over cash.** Calculate the amount the waiter owes. The cashier counts and records the amount actually received under their own identity. Preserve any difference and refer it to the manager rather than silently changing the expected amount.
2. **Transfer remaining tables.** Select the next waiter once and transfer the active tables together. Record who made the transfer. Cabin balances remain on their guest accounts.

Do not require a separate acceptance step for each table transfer. This replaces the earlier, unaccepted proposal that every receiving waiter must accept before responsibility transfers. Cash receipt confirmation remains required: table reassignment is not a cash handover and does not rewrite who collected a payment.

The normal mobile summary should emphasize cash to hand over and the number of active tables to transfer. Avoid compulsory printed reports, a per-table approval chain, and tip-accounting workflows unless a later operational requirement justifies them. Manager intervention is for discrepancies and exceptions, not every routine handover.

Rationale: keep the routine manageable for approximately 4–6 waiters while retaining clear responsibility for money and service. Use established restaurant POS workflows as references, adapting them to Dalai Eej rather than copying every feature.

Reference documentation reviewed during discovery:

- [Toast Shift Review](https://support.toasttab.com/en/article/Shift-Review-Overview): close or transfer outstanding checks and reconcile cash owed; review requirements are configurable.
- [Toast transfers](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments): receiving-server acceptance is not required in its documented transfer workflow.
- [Square restaurant shift reports](https://squareup.com/help/us/en/article/8140-run-shift-report-with-square-for-restaurants): employee cash transactions and configurable closing procedures.
- [Lightspeed End Shift](https://resto-support.lightspeedhq.com/hc/en-us/articles/115000694554-Using-End-Shift): remaining tables, payment, reports, and clock-out.

These references support workflow discovery, not a claim of availability or payment integration in Mongolia.

## Decision 02: reset the interface to POS

On 2026-09-14, after reviewing the first waiter layout, the user requested: “purge this page and then duplicate the POS page and then start from there.”

The custom Захиалах / Үйлчлэх / Тооцоо navigation, service board, mobile styling, and its unused read-only API are removed. Both `/waiter` and the waiter’s home route render the same `RegisterApp` and POS styles. The page title is Зөөгч. Further waiter-specific layout decisions start from this POS baseline rather than the discarded design.

Current behavior:

- POS catalogue, cart, payment forms, debt list, history, desktop navigation, and mobile navigation are shared. Cash is the default payment method, as in POS.
- Waiters retain permission to settle their own orders, including partial payments. Payment attribution uses authenticated staff identity; card/transfer entries require a supporting reference. A reference is not independent bank verification.
- Permissions derive from the authenticated role, never the page title. Waiters can start service (Decision 05) but cannot confirm opening cash, close the business day, void/refund orders, view reconciliation, or access management controls. The shared Хаалт navigation is disabled for waiters. Their caches, drafts and payment history remain scoped to their identity.
- Table/cabin separation and preparation notes are shared order fields. Kitchen queue metadata and POS food routing remain intact; this reset does not delete orders or payment records.
- Cash receipts retain tender and change. Automatic printing remains off for waiters, with shared manual print actions available.
- The proposed shift cash handover, bulk reassignment and managed-device setup remain unimplemented. An uncertain submission after a device restart still requires checking existing orders before resending.

Validation uses TypeScript, ESLint, build checks and isolated browser sample data, without production bank/Sheets writes.

## Further design refinement

- Share appropriate POS components and logic; avoid maintaining an independent copy of the register.
- Organize the mobile experience around taking orders, serving active orders, and settlement.
- Keep cashier cash opening and day closing, reconciliation, business-wide reports, inventory administration, and management controls outside the waiter interface. Keep relevant order and payment details accessible.
- Retain the existing visual language while prioritizing readable text, generous touch targets, minimal typing, a persistent order summary, and an obvious next action.
- Distinguish saving an order from delivery to the kitchen. Never imply that kitchen staff have acknowledged an order merely because a server accepted it.
- Surface failed delivery, kitchen questions, and ready food when action is needed.
- Preserve drafts and make retry behavior safe and understandable. Define an operational outage fallback before relying on an offline workflow.
- Consider recorded corrections and manager approval for cancellations after kitchen acceptance. The exact boundary is not yet agreed.
- Consider making kitchen-declared unavailable items visible to all waiters. Staff currently communicate availability verbally.

## Open decisions

1. Exact table list and how serving location and billing account are selected or changed without losing identity.
2. Staff sign-in, shift changes, device enrollment, and whether access from unapproved devices is prohibited.
3. Cash handover details: timing of interim handovers, any change float issued to waiters, and how a manager resolves recorded differences. Cashier confirmation and discrepancy escalation are agreed above.
4. Shift handover exceptions: no incoming waiter available, concurrent edits or payments during transfer, and what happens during a connectivity failure. Routine bulk table reassignment is agreed above.
5. Card confirmation evidence and the terminal/provider available for integration.
6. Kitchen delivery confirmation, whether human acknowledgement is needed, and how ready food or questions reach waiters.
7. Permission boundaries for edits, cancellations, discounts, refunds, and changes after partial payment; inherit established POS decisions wherever applicable.
8. Behavior during connection loss, uncertain submission, device restart, and a service day not yet started.
9. Preparation notes, unavailable items, and how essential guest requests are conveyed.

## Documentation and implementation boundary

Continue refining the remaining decisions alongside the implemented shared workflow. Keep approved requirements, proposals, and current behavior distinct. Add a separate design document when interaction details warrant it, and decision notes only for consequential choices needing rationale. `AGENTS.md` is for enduring contributor instructions, not a duplicate product specification.

## Decision 03: staff selection and PIN login

Accepted 2026-09-14: each waiter selects their own name and enters a PIN. The requested initial PIN is **1003 for all four placeholder waiters**: Билгүүн, Саруул, Болор, Номин. These are temporary names, not identified employees. Shared PINs identify the selected account, but do not establish which person actually operated the device.

Implemented locally:

- `/login?next=/waiter` shows active waiter names and a four-digit keypad. Cashier/manager/owner password login remains separate.
- Server-only `OPS_WAITER_ACCOUNTS` stores unique usernames, display names, salted password hashes and optional `active` flags. Only username and display name reach the login UI. Do not add privileged roles to this list. Inactive waiters disappear from the list, cannot sign in, and their existing sessions are rejected.
- `node scripts/configure-local-waiters.mjs` initializes the four placeholder accounts in gitignored `.env.development.local`. It refuses to overwrite an existing roster. It does not deploy or change production accounts. PINs are hashed independently; the existing owner password remains unchanged.
- The waiter header shows the selected name, with **Түгжих / солих**. Successful logout clears the session and fully navigates back to staff selection; failed logout stays on the page and reports the error. Existing per-waiter draft storage remains separate.
- Existing order/payment endpoints derive the recorded staff name from the server session. Current receipt ownership still uses that name; choose unique display names and do not rename staff who have transaction history until durable staff IDs are added to the transaction schema. Creator/assigned waiter/payment collector separation and handover remain future work.
- Code search and manual amounts have a compact on-screen numeric keypad. Text entry uses the phone's normal keyboard. Existing permissions on manual prices remain unchanged.

The local staff setup is not the planned manager-facing staff administration screen. Replace placeholders before operational use; preserve historical attribution when deactivating actual staff. Managed-device enforcement and personal PIN changes remain to be implemented.

## Decision 04: phone layout at every screen width

Accepted 2026-09-14: `/waiter` has one phone-oriented layout, with no desktop POS rail or side-by-side cart. On larger screens it stays centered at a maximum width of 480px; narrower phones use the available width. The bottom navigation and full-height cart remain the same at every breakpoint. Inputs retain mobile keyboard behavior.

`RegisterApp` exposes a `layout="phone"` presentation option. `/waiter` and the waiter-role home page select it; cashier POS keeps its adaptive layout. Permissions, ordering and payment code remain shared. This changes presentation, not device access policy, staff permissions or the agreed future tab structure.


## Decision 05 — Service start is separate from opening cash

Accepted 2026-09-15. A signed-in waiter may select **Үйлчилгээ эхлүүлэх**. It starts the shared business session used by orders and payments and records the authenticated name, username and timestamp. It does not confirm any drawer money. The existing cashier opening action can still start both service and cash together.

For service-only openings, `Day_Sessions.opening_mode=service` and an empty `cash_opened_at` explicitly mean cash is pending. Numeric `starting_cash=0` is only the accounting placeholder until confirmed; the cashier UI shows **Баталгаажаагүй**. Cashier/manager/owner uses **Касс нээх** to count the starting float, excluding payments already collected during service. This updates the same session and preserves its creator, orders and payments. Separate cash opening fields record who confirmed it and when. Confirmed opening cash cannot be overwritten by a second request. Historical rows without `opening_mode` retain their earlier, cash-confirmed meaning.

Waiters and kitchen users cannot confirm opening cash or close a day. Managers/owners may close after cash is confirmed. A closed date cannot be restarted, and the existing stale-business-day guard remains in force. These are server checks as well as interface restrictions.

All day transitions coordinate through an Upstash Redis lock scoped to the spreadsheet. Simultaneous starts get a retry response, and unavailable coordination fails closed. Lock ownership is checked before writes; a five-minute lease allows recovery after a crashed request. This serializes day transitions, not all sales writes, and does not make Google Sheets a transactional database.

This change does not implement the previously agreed cash handover/shift reconciliation workflow. Payment collector attribution remains as implemented; day cash totals still represent aggregate business cash, not a newly verified cashier drawer balance. Opening cash confirmation is not confirmation that waiter collections have been handed over.
