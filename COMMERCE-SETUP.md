# Commerce setup and verification

The storefront uses the Fastify API for catalog data, authenticated checkout, COD orders, and Razorpay orders. Payment failures are surfaced to the customer; there is no offline payment success or offline administrator login.

## Local setup

1. Install dependencies: `npm ci` and `npm --prefix server ci`.
2. Start PostgreSQL and Redis, or configure isolated development services. Copy `server/.env.example` to `server/.env`; supply your own database URL, Redis URL and random JWT secret. Never commit this file.
3. Apply schema with `npm run server:migrate`. Test migrations on an isolated database/Neon branch first. For Neon migrations, use a direct connection URL. No production database has been migrated by this change.
4. Optionally run `npm run server:seed` against a development database only. Demo seeding is refused in production. Existing accounts are no longer reset by seed reruns.
5. Run `npm run server:dev` and `npm start` in separate terminals. Development uses the local API; set `src/environments/environment.ts` to your own backend before a production build.
6. Run `npm --prefix server test` and `npm run build`.

## Razorpay setup

Start with test-mode merchant keys in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. No keys are bundled. Set a separate `RAZORPAY_WEBHOOK_SECRET` and configure the public HTTPS webhook:

`https://YOUR_API/api/payments/razorpay/webhook`

Subscribe to `payment.authorized`, `payment.captured`, and `order.paid`. Configure automatic capture in the merchant dashboard. Both browser verification and webhook settlement fetch the payment from Razorpay and require the correct gateway order, INR amount, currency, and captured status. Webhooks validate the original request bytes. Repeated notifications do not decrement stock twice. A background worker also checks pending gateway orders.

See [Razorpay integration guidance](https://razorpay.com/docs/server-integration/python/test-app/) and [webhook signature validation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md).

The previous source contained a payment secret and shared demo credentials. Rotate those merchant credentials and reset any deployed demo/admin/vendor accounts before accepting payments. Existing plaintext vendor passwords must be reset to bcrypt hashes; plaintext login is no longer accepted.

## Production requirements and limitations

- Set `NODE_ENV=production`, `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, exact comma-separated `CORS_ORIGINS`, and optional Redis credentials. Production checkout idempotency is persisted atomically with the order in PostgreSQL; Redis is not required to open Razorpay. Database TLS verifies certificates; use `DATABASE_CA_CERT` for a private CA ([node-postgres TLS configuration](https://node-postgres.com/features/ssl)).
- Startup applies schema migrations transactionally by default. For externally managed migrations, run them before startup and set `AUTO_MIGRATE=false`. Demo seeding remains disabled by default. Provision a real administrator; development seed credentials must not be used in production.
- Verify a real test-mode purchase, COD order, replayed webhook, browser-close recovery, concurrent stock reservations, and logged-out access against an isolated database before deployment. Automated tests use embedded PostgreSQL for real schema/query checks and controlled payment-provider responses; they do not charge a payment account.
- Online payment holds are intentionally retained while payment is unresolved. Review stale holds and gateway reconciliation failures operationally; do not manually release stock while bank authorization is pending. Refunds and late-payment exceptions need operator reconciliation in Razorpay. Automatic refunds and a complete returns workflow are not implemented.
- Default shipping is ₹99, free at a pre-discount subtotal of ₹999. Website settings and coupon definitions are persisted by authenticated admin APIs and used for authoritative quotes. Saved order totals are used in receipts. Validate the configured business tax/shipping rules before launch.
- Further work remains on account recovery, persistent customer profile/address editing, and replacing demo/local-only admin features. This change is a core checkout/security repair, not a claim that every legacy feature is production-ready.

## Checks performed

The regression suite covers authentication, blocked legacy payment certification, forged signatures, cross-order payment substitution, order ownership, authoritative discounts, quantity/stock validation, concurrent idempotency, stock-ledger failures, and webhook payload tampering. Run it with `npm --prefix server test`.

## September checkout fixes

- The API now runs migrations by default (set `AUTO_MIGRATE=false` only after applying them manually). Deploy the API before deploying the frontend. The schema adds shared settings, coupons, saved tax totals, and durable checkout responses.
- Set Razorpay test/live key pairs and webhook secret consistently. Subscribe the signed webhook `/api/payments/razorpay/webhook` to `payment.authorized`, `payment.captured`, and `order.paid`. Verify using Razorpay test mode before accepting live payments.
- Failed gateway lookups retain holds. Pending orders are reconciled; after 30 minutes, holds with no in-progress/authorized/captured payment can expire. A late capture reacquires inventory transactionally; insufficient stock requires operator reconciliation. Never promise an automatic refund: no automatic refund service exists.
- Coupons and website settings are now shared server data. Recreate any coupons previously stored only in an administrator’s browser; they are not silently trusted or imported.
- The hardcoded NVIDIA credential was removed. Its owner must revoke the previously exposed key and set a replacement `NVIDIA_API_KEY` in the deployment environment. Removing source text does not revoke a key or remove it from repository history.
- Customer documents are order receipts with persisted totals; no fabricated GST registration, tax invoice number, or COD payment transaction is shown.
