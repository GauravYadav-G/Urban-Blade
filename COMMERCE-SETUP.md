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

Subscribe to `payment.captured` and `order.paid`. Configure automatic capture in the merchant dashboard. Both browser verification and webhook settlement fetch the payment from Razorpay and require the correct gateway order, INR amount, currency, and captured status. Webhooks validate the original request bytes. Repeated notifications do not decrement stock twice. A background worker also checks pending gateway orders.

See [Razorpay integration guidance](https://razorpay.com/docs/server-integration/python/test-app/) and [webhook signature validation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md).

The previous source contained a payment secret and shared demo credentials. Rotate those merchant credentials and reset any deployed demo/admin/vendor accounts before accepting payments. Existing plaintext vendor passwords must be reset to bcrypt hashes; plaintext login is no longer accepted.

## Production requirements and limitations

- Set `NODE_ENV=production`, `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, exact comma-separated `CORS_ORIGINS`, and Redis credentials. Checkout idempotency fails closed when Redis is unavailable in production. Database TLS verifies certificates; use `DATABASE_CA_CERT` for a private CA ([node-postgres TLS configuration](https://node-postgres.com/features/ssl)).
- Run migrations explicitly before starting the API. Automatic schema changes and demo seeding are disabled by default. Provision a real administrator; development seed credentials must not be used in production.
- Verify a real test-mode purchase, COD order, replayed webhook, browser-close recovery, concurrent stock reservations, and logged-out access against an isolated database before deployment. Automated tests currently use database/provider boundaries, not a real database or payment account.
- Online payment holds are intentionally retained while payment is unresolved. Review stale holds and gateway reconciliation failures operationally; do not manually release stock while bank authorization is pending. Refunds and late-payment exceptions need operator reconciliation in Razorpay. Automatic refunds and a complete returns workflow are not implemented.
- Shipping is currently ₹99, free at a pre-discount subtotal of ₹999. Coupon rules are server-defined. Local admin coupon/settings edits are not an authoritative pricing system. Configure and validate business tax/shipping rules before launch.
- Further work remains on account recovery, persistent customer profile/address editing, and replacing demo/local-only admin features. This change is a core checkout/security repair, not a claim that every legacy feature is production-ready.

## Checks performed

The regression suite covers authentication, blocked legacy payment certification, forged signatures, cross-order payment substitution, order ownership, authoritative discounts, quantity/stock validation, concurrent idempotency, stock-ledger failures, and webhook payload tampering. Run it with `npm --prefix server test`.
