# Urban Blade mobile 2.5.4 (24) — customer account update

Date: 2026-10-15

## Delivered behavior

- Website-inspired account overview, profile editor, settings, order/receipt, return/refund, payment and appointment entry points.
- Website account address book: add/edit/remove multiple addresses, choose delivery address, set default, reconcile selected delivery fields after changes, and isolate late replies across account changes.
- Website return workflow: full-order acknowledgement, validated reasons/details, confirmed server status only, review notes, timeline, decimal amounts, refund references, pending/failed/processed states and unpaid-COD handling.
- Customer appointment rescheduling for upcoming confirmed appointments. Date and time availability comes from the server. Confirmation preserves service, price, visit address and staff assignment.
- Server verifies customer ownership, valid future date/time, availability, concurrent schedule changes and closed appointments. Existing database uniqueness protects assigned-staff slot races.

## Shared API contracts

| Feature | API |
| --- | --- |
| Saved addresses | GET/POST `/api/account/addresses`; PUT/DELETE `/api/account/addresses/:id`; PATCH `/api/account/addresses/:id/default` |
| Order history | GET `/api/orders` |
| Return request and audit | POST/GET `/api/orders/:id/return` |
| Appointment history | GET `/api/bookings` |
| Customer availability (new) | GET `/api/bookings/:id/available-slots?date=YYYY-MM-DD` |
| Customer rescheduling (new) | PUT `/api/bookings/:id/schedule` with requested and expected original schedule |

## Verification

- Android release APK compiled successfully: `UrbanBlade-2.5.4.apk` (about 134 MiB).
- Flutter analyzer: no issues.
- Complete Flutter suite: **196 passed** (includes visual regressions and new account/address/refund/reschedule checks).
- Complete backend suite: **103 passed**, using isolated test databases.
- `npm run test:guidelines`: **15/15 passed**.
- `npm run test:admin`: **49/49 passed**.
- Angular production build passed with `NG_BUILD_MAX_WORKERS=2` after the sandboxed process terminated without output.
- `git diff --check`: passed for tracked changes.
- Phone-size customer account, address and refund renders were visually inspected; snapshots are in [mobile-account-2.5.4](mobile-account-2.5.4/).

The tests check ownership denial, invalid/past dates, occupied slots, stale update rejection, immutable booking details, website-visible updated schedule, decimal order/refund amounts, full-order return consent, account isolation and address selection/edit/removal.

## Deployment and device limits

Deploy the updated server routes before using customer rescheduling against the hosted API. No database migration is required. No production database or payment provider was mutated during verification. Customer rescheduling UI was added to the Flutter app; the Angular account page was not redesigned in this update. Both clients read the same stored bookings.

No physical phone was connected, so on-device rendering, live production integration and installation still require device verification. Existing liquid-glass native GPU behavior retains the device-testing limit recorded in the preceding glass report.
