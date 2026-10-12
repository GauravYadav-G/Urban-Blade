# Automatic order tracking

The server polls configured Delhivery shipments in `processing` or `shipped` state.
A background worker checks for due orders every 15 seconds, claims up to ten using
PostgreSQL row locks, and schedules a successful shipment check five minutes later.
Failed requests retry with exponential backoff up to one hour. Expired leases allow
another server process to recover work after a restart. Redis is not required.

Both admin orders and the customer account load the same stored snapshot every
15 seconds while visible. Carrier calls happen on the server, independently of
whether anyone has the website open. There is no AI-generated delivery estimate.
Snapshots include the carrier's status, location, estimated delivery, scan history,
and verification time. A failed refresh preserves the last verified snapshot.

## Configuration

- Apply the schema using the normal deployment migration (`npm run server:migrate`).
- Set `DELHIVERY_API_TOKEN` in the server environment and restart the server.
- Set `CARRIER_TRACKING_ENABLED=false` to disable the background worker.
- Assign the correct carrier and AWB to the order. Bare numeric AWBs cannot identify
  a carrier safely. Changing dispatch identifiers resets previous tracking data.
- Keep the API server running; deployments that sleep will check shipments when
  the process resumes. Large backlogs can take longer than the five-minute cadence.

Without a token, automatic carrier fetching is unavailable and the screens say so.
BlueDart, DTDC, and internal deliveries do not currently have automated adapters.
No CAPTCHA bypass or undocumented public scraping endpoint is used.

Delhivery requires account credentials and says the waybill must belong to the
account associated with the token. Confirm API entitlement and any charges with
whoever books your shipments before obtaining a token. A different account's token
is not a universal tracking key.

Official references:
- https://one.delhivery.com/developer-portal/document/b2c/detail/order-tracking
- https://one.delhivery.com/developer-portal/document/b2c/detail/faq
- https://api.bluedart.com/tracking
- https://www.dtdc.com/b2b-enterprise/

## Safety and verification

Responses are schema-validated and must match the requested AWB. Older scans are
rejected; identical scans do not append duplicate history. Return scans, unknown
statuses, payment issues, returns, and refunds cannot automatically mark a forward
shipment delivered. Final order states cannot be reversed by a carrier response.
Tracking never changes the payment ledger.

Run `npm run server:build`, then
`CARRIER_TRACKING_ENABLED=false node --test server/tests/carrier-tracking.test.mjs`.
The test uses an isolated PGlite database and mocked HTTP responses. Live carrier
verification still requires a real account token and matching test shipment.
