# Admin, payment, return and vendor review

Current follow-up: [14 October payment and return audit](payment-return-audit-2026-10-14.md), including the dedicated Returns workflow and durable transaction ledgers. The sections below preserve earlier audit history.

## Implemented fixes

- Vendor inventory and order queries use the authenticated vendor identity. Order item lists and item totals are scoped to that vendor. Master-admin APIs are denied to vendors. Vendor sessions validate current account status on each request, so suspension takes effect without waiting for token expiry. Renaming a vendor updates product ownership and its user account in one transaction.
- Admin order loading reports database errors instead of pretending there are no orders. Staff caches no longer persist customer/vendor data or vendor passwords in local storage; account switches clear state and cancel outstanding requests.
- Counter orders validate customer details, quantities, catalogue prices and totals. The order, items and stock ledger commit together. Existing orders cannot be overwritten by another counter-order POST. Storefront confirmation no longer causes a second client-side stock decrement.
- Stock edits cannot reduce quantity below active reservations. Products linked to orders or reservations cannot be deleted and lose their ownership history.
- Refund updates validate payment, full amount, refund ID and status. Duplicate or delayed notifications cannot reverse a processed refund or restock twice. Replayed capture notifications cannot undo a refund.
- An ambiguous gateway timeout leaves the refund pending; retries search for the original refund instead of creating another. Fulfilment is blocked while a refund is pending.
- Customers can request a full-order return after delivery. Admins approve or reject it, then record physical receipt and an explicit restock decision. Damaged items are excluded from restocking. Delivered online orders cannot be refunded through the application before receipt.
- COD collections and completed external refunds have explicit reference-recording APIs. Recording an external payment never claims the application transferred money.
- Vendor payouts have a durable ledger, unique bank references, positive amount validation, duplicate-request handling and balance checks under a vendor lock. Earnings include delivered, collected merchandise sales after allocated discounts and commission, excluding open returns/refunds. Recorded payments reduce the available balance.
- Carrier outages no longer generate fictional scans, delivery signatures or shipment status. Carrier sync cannot resurrect cancelled orders or regress delivered orders.

## Lifecycle

1. Checkout uses server-priced items and reserves inventory. Razorpay capture is confirmed by the gateway before stock is committed. COD commits stock with payment pending.
2. Admin fulfilment progresses through processing, shipped (tracking required), and delivered. Record COD collection only after money is actually collected.
3. Pre-dispatch online cancellation initiates a full Razorpay refund. Its pending/processed/failed state comes from provider responses and signed webhooks. Counter payment cancellations record an already completed external refund.
4. Delivered customer orders can enter `requested → approved → received`, or `requested → rejected`. Requesting or approving a return does not itself restock or transfer funds.
5. On receipt, staff inspect the goods and choose whether to restock. Online refunds go through Razorpay. Offline refunds require the reference of an actual completed repayment.
6. Vendor balances exclude refunds and accepted returns. External vendor payouts are recorded separately from customer refunds.

## Added APIs

All paths use the `/api` prefix. Admin actions require a master-admin token.

| Method / path | Payload | Purpose |
| --- | --- | --- |
| `POST /orders/:id/return` | `{ reason }` | Customer requests a return for their own delivered order |
| `PUT /admin/orders/:id/return` | `{ status, note, restock? }` | Approve/reject/receive; receipt requires a boolean restock decision |
| `POST /admin/orders/:id/collection` | `{ reference }` | Record collected COD payment on a delivered order |
| `POST /admin/orders/:id/refund/manual` | `{ reference, reason }` | Record completed repayment for an offline payment |

Existing `/admin/orders/:id/refund`, `/admin/finance/process-payout`, `/admin/finance/summary`, vendor CRUD, order status and inventory APIs were repaired.

## Validation and deployment

The audit scripts now run against disposable PGlite databases and fixture carrier responses, not the configured business database. The regression suite applies the schema twice and checks API ownership, refunds, returns, payout balances, stock holds, counter orders and carrier failure behavior. These tests do not prove a live Razorpay/bank/carrier integration.

Apply `npm run server:migrate` to the intended deployment database before starting the updated backend. Deploy the frontend and backend together. No production migration or deployment was performed. The live order repair below updated order and stock records without charging, refunding or paying out money.

Configure and verify Razorpay's signed webhook endpoint `/api/payments/razorpay/webhook`, including payment and refund events. Provider reference: https://github.com/razorpay/markdown-docs/blob/master/webhooks/refunds.md

## Limits requiring operational decisions

- Returns/refunds currently cover the entire order. Partial item refunds and automated return-policy windows are not implemented; staff review eligibility.
- No bank payout provider or reverse-logistics pickup integration is added. External payout/refund actions record completed transactions with references.
- A pending refund with no provider ID is deliberately not automatically reissued after an ambiguous timeout. If lookup/webhooks never find it, verify the provider record before any operational repair. A provider-failed refund is reconciled by ID and is not blindly recreated.
- Vendor earnings use current commission rates and product ownership. Historical rate snapshots, post-payout refund recovery and a full accounting ledger require a separate accounting design. Existing historical orders with no product link cannot be allocated to a vendor automatically.
- Vendor access is inventory management plus scoped order visibility. Whole-order fulfilment/refunds remain master-admin actions because an order can contain several vendors.
- Carrier portal support remains provider-dependent; unavailable/unsupported tracking now reports failure instead of fabricated progress.

## Final verification results

- `npm run test:admin`: 49/49 operations passed, against disposable fixtures.
- `npm run test:guidelines`: 15/15 checks passed.
- `npm --prefix server test`: 18/18 tests passed, including 59 grouped API/database assertions.
- `npm run build`: production Angular bundle passed; the sandbox initially aborted the bundler, so final builds ran outside it with two workers.
- Angular template/type compilation and backend TypeScript compilation passed.
- Unrelated existing layout/style files still have whitespace warnings.

Running the admin audit simultaneously with compilation caused the real load-shedding guard to return 503s. Running the final audit independently passed; the guard was not weakened.

## Razorpay and stock follow-up — 11 October 2026

Order d1d9a22d-48d7-4b7e-bbd7-ffe9c53eff28 had a failed attempt followed by captured payment pay_Tlq1Crl2HXKNoQ for INR 189,900. Locally it remained accepted/failed without a payment reference. Its active 100-unit reservation disagreed with the zero reserved product aggregate.

After verifying the captured, unrefunded payment with Razorpay, a guarded transaction rebuilt the reservation aggregate and committed this order once. Verified result: confirmed/captured, payment attached, reservation committed, product quantity 220 and reserved quantity zero. An audit note records the repair. No gateway money mutation occurred.

Further fixes:
- Reconciliation checks all attempts and prioritizes captured payments over failures. Failed attempts alone do not fail a checkout.
- Inventory settlement errors preserve captured money, flag the order, and block fulfilment until explicit repair.
- Finance uses a consistent server snapshot with order and gateway totals, actual refunds, inclusive fees, unknown fees, unmatched attempts and check timestamps. Fabricated margins, booking revenue and bank settlement claims were removed.
- Gateway imports are paginated and replay-safe; totals represent imported payments, not bank balances.
- Stock adjustments use atomic deltas, request IDs and audit records. Absolute edits require matching versions. Availability toggles never rewrite quantities. Reservation drift blocks adjustments and appears in the audit.
- Cache invalidation follows commit. Repeated reservations do not increment holds twice.
- Vendor balances conservatively exclude partially refunded orders; item-level allocation remains outside scope.

New API paths under /api: GET /admin/finance/audit, POST /admin/finance/sync-gateway, POST /admin/orders/:id/repair-inventory, and staff/vendor-scoped POST /admin/inventory/:id/adjust.

Release: migrate the schema for gateway_payments, stock_adjustments and order reconciliation fields; deploy backend and frontend together; then use Finance → Sync Razorpay for the required period and review exceptions. Verify signed payment and refund webhooks in the deployed environment.

The individual live order repair is complete. Broader code changes remain local until deployment. No general historical inventory rebuild was performed. Regression fixtures cover captured-after-failed recovery, reservation drift, repeated repair/adjustment, fee tax and partial refunds.

Provider references: https://github.com/razorpay/markdown-docs/blob/master/api/payments/fetch-all-payments.md and https://github.com/razorpay/markdown-docs/blob/master/webhooks/payments.md
