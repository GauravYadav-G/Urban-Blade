# Customer rescheduling: hosted API update

The Android 2.5.4 app calls two new customer endpoints. A read-only production
probe on 2026-10-15 confirmed that the hosted server does not have these routes:

- GET `/api/bookings/00000000-0000-4000-8000-000000000001/available-slots?date=2026-10-20` → HTTP 404, Fastify “Route … not found”.
- GET `/api/bookings` → HTTP 401 (expected without authentication).

This establishes a missing server deployment, rather than a general booking API
outage. No customer credentials or real booking IDs were used.

## Required deployment

The reviewable `customer-rescheduling.patch` contains the server routes and their
isolated regression test. Apply it to the server's source checkout if those changes
are not already present, verify it, and deploy that revision to Render's
`urbanblade-api` service. The current workspace already contains the patch.

```sh
git apply --check customer-rescheduling.patch
git apply customer-rescheduling.patch
npm --prefix server run build
(cd server && node --test tests/customer-reschedule.test.mjs)
```

The existing `render.yaml` uses `server` as its root directory, builds with
`npm install --include=dev && npm run build`, and starts `node dist/server.js`.
No new environment variables or database migration are needed. Preserve the
existing production environment. Deploy the revision containing these changes;
redeploying the old revision will retain the 404.

After deployment, repeat the dummy availability request above. It should return
401 because authentication is required, instead of “Route … not found”. Then use
a signed-in customer with an upcoming confirmed appointment to check available
slots and a successful schedule change. Verify the website and admin history show
the new time and unchanged service, price, visit address and staff assignment.

## App compatibility improvement

Version 2.5.5 recognizes missing rescheduling routes and explains that rescheduling
is unavailable and the appointment has not changed. Ownership 404s and occupied-slot
409s retain their original actionable messages. It never fakes available slots or
updates an appointment without server confirmation.

The app compatibility change does not enable rescheduling on an old server. The
server deployment above is required. This session has neither a Render connection
nor authenticated GitHub CLI access, so the hosted deployment could not be made.

## Verification of the prepared update

- Complete mobile suite: 200 passed.
- Flutter analysis: no issues.
- Customer reschedule backend regression: passed (isolated PGlite, no live mutation).
- Backend TypeScript build: passed.
- Required guidelines checks: 15/15 passed.
- Required admin checks: 49/49 passed.

No authenticated customer scheduling request was made against production, and no
production appointment was modified. Phone installation was not tested.
