# Urban Blade admin payment and transaction audit — 14 October 2026

Scope: customer checkout pricing and order ownership, Razorpay creation/verification/capture, signed payment/refund webhooks, inventory reservations and expiry, admin fulfilment/cancellation, full-order returns and offline repayments, finance totals/imports, vendor settlement balances and RazorpayX transfers. This review used source inspection and disposable PGlite fixtures. No business database changes or real charges, refunds, beneficiary validations, or payouts were performed.

## Verified lifecycle

| Stage | Backend authority and safeguards | Admin/customer surface |
| --- | --- | --- |
| Quote | Catalogue prices, availability, shipping, coupon discount and tax calculated on server | Checkout compares displayed total with current quote |
| Create online order | Authenticated owner; production idempotency response commits with local order, items and reservation ledger | Saved pending checkout can resume or reconcile |
| Capture | Browser HMAC or exact-byte signed webhook; provider payment fetched and amount, currency and gateway-order checked | Payment remains uncertain when provider confirmation fails |
| Inventory settlement | Order row locked; reserve/commit ledger prevents duplicate decrement; expiry releases holds; late paid stock exceptions retain captured money and block dispatch | Finance shows explicit inventory review and guarded repair |
| Fulfilment | Explicit order transition graph, tracking/carrier required to ship; unpaid Razorpay/refund/reconciliation exceptions blocked | Orders processing, shipping, delivery |
| COD collection | Delivered COD payment remains pending until administrator records actual collected money and reference | Explicit collection action; auditable offline ledger |
| Pre-dispatch refund | Full Razorpay refund; stable receipt, ambiguous submissions retained pending, full amount/payment validated | Refund status is gateway pending/processed/failed |
| Full-order return | Delivered owner or administrator requests; requested → approved → received, or requested → rejected; stock decision and actor history stored atomically | Dedicated paginated admin return queue, details, review and receipt; customer order history |
| Returned-goods repayment | Receipt required; inspected sellable goods restocked once; damaged goods excluded; online refund through Razorpay, offline payment recorded only after actual repayment | Return details connect receipt to refund, financial status and history |
| Vendor payout | Eligible delivered collected merchandise after allocated discount and commission; outstanding claims reserve balance; provider POST happens only after durable ledger commit | Vendor balances plus payout ledger and reconciliation |
| Provider settlement updates | RazorpayX exact-byte signature with its separate secret; amount/currency/reference/ID validated; terminal settlement/reversal survive stale events | Saved payout can reconcile through provider GET or safe identical retry |

## Concrete defects found and repaired in this change

1. **P1 — provider transfer could precede durable payout record.** The original `/admin/finance/process-payout` called RazorpayX inside the database transaction before inserting `vendor_payouts`. A timeout or database error after provider acceptance rolled back the local ledger and released payable balance. A new reference could then send the same liability again. `durable-payout.service.ts` now commits a `submitting` claim, immutable provider payload and UUID idempotency key before any external request. Timeout or persistence errors retain the reserved amount. Duplicate creation returns the same record. Explicit recovery reuses exactly the original body/key only inside a conservative six-day window; a known provider ID uses GET.
2. **P1 — invalid payout idempotency header.** The previous SHA-256 hex header was 64 characters; RazorpayX supports 4–36. Provider references also exceeded the provider's 40-character limit. New claims use UUID keys and a deterministic 35-character provider reference independent from the operator's transaction reference. Contact references are hashed to a stable 39-character value. Keys and saved responses have Zod validation.
3. **P1 — RazorpayX payout status could remain stale indefinitely.** There was no provider reconciliation or signed payout event handler. New admin payout reconciliation and RazorpayX webhook support handle pending/processed/failed/reversed states. Amount, currency, reference and transfer ID must match the durable claim. Out-of-order events cannot turn a processed payout back into queued/processing or resurrect a reversed payout. Legacy known-ID payouts can reconcile safely using their original reference without replaying legacy money POSTs.
4. **P1 — generic full refund could be attempted after an external partial refund.** A dashboard refund could occur after the last local snapshot. New full-refund preflight fetches provider payment and existing refund requests, validates amount/currency/order and refuses a second full-amount request when money has already been returned or another provider request remains open. Partial refunds require explicit finance review.
5. **P2 — return handling relied on recent order cache and prompts.** Existing return records were difficult to find beyond the latest order limit and had no complete administrative lifecycle page. Dedicated APIs and UI provide paginated filtering, admin-initiated requests, persistent review/receipt decisions and chronological actor history.
6. **P2 — offline transaction references lacked their own financial history.** COD collections and external refunds now commit auditable records with actor, amount, order and unique references. Replays preserve the original record; changing an existing reference or reusing it for another order is rejected.
7. **P2 — requested/failed refunds and actual returned money were conflated across dashboards.** Shared `orderMoneyCte` calculates confirmed repayment only from terminal local refund states or the gateway ledger, clamped to the order amount. Finance audit, global metrics/daily totals, finance macro gross/refunded/net and the admin-order proof field now share these semantics. Signed processed refund events update an existing gateway payment snapshot inside the same database transaction.

8. **P2 — inclusive GST was counted in vendor merchandise earnings.** Vendor balances now remove persisted inclusive tax pro rata after discounts, matching the existing rule that earnings exclude shipping and tax. Separately added exclusive tax remains excluded. Existing stored payouts are retained.

## Verified existing protections

- Admin financial and refund actions require authenticated master-admin privileges. Vendors are limited by a server allowlist and current active vendor identity. Customer order/return operations require ownership.
- Payment charges/refunds/transfers run on the server. Credentials stay in environment variables. SQL values use parameter placeholders.
- Checkout idempotency prevents duplicate production orders; stock ledger operations and order transitions lock shared rows.
- Provider payment snapshots preserve captured/refunded money and the maximum confirmed refund amount under stale responses.
- Failed checkout attempts are distinct from a paid order: reconciliation prioritizes successful attempts rather than failing the checkout because one attempt failed.
- Signed webhook validation preserves original request bytes and uses timing-safe HMAC comparison.
- Pending or ambiguous customer refunds are never automatically recreated. Already processed refunds remain terminal even during gateway outages.
- Carrier state is fulfilment evidence, not payment evidence. Delivery does not mark COD paid.

## Remaining explicit limitations and audit observations

- **Full-order returns/refunds only.** Partial item quantities, partial restock decisions, policy-window enforcement and automated pickup/return labels are not implemented. Staff review eligibility and inspect the entire order.
- **Historical vendor earnings are not an accounting subledger.** `vendor-finance.service.ts` joins order items to current product ownership and uses the vendor's current commission rate. Changing a rate recalculates past earnings. Refunds after a vendor payout reduce later payable totals but do not track recoverable debt or perform a clawback. Historical attribution/rate snapshots and post-payout recovery need an accounting policy and migration; present balances conservatively exclude open returns/refunds.
- **Provider-failed customer refunds are not blindly recreated.** Their existing provider ID is reconciled. A pending refund with no provider ID is kept pending after an ambiguous timeout; provider records must be checked before any operational reissue.
- **Unknown payout ID beyond the safe idempotency window requires review.** The original amount remains reserved. The application deliberately refuses a new money POST for that claim after the conservative six-day window. No live bank settlement is inferred from a local manual record.
- **Imports are financial snapshots, not bank balances.** Razorpay totals include imported provider attempts and actual fees, not confirmed bank settlement. Local order-date and provider payment-date ranges can differ.
- **Order creation date remains the reporting cohort.** Daily/period order reports show current net money attached to orders created in that period; a refund on a later day adjusts the original order cohort. A cash movement report grouped by actual capture/refund date would require a separate transaction-event ledger. Product financials explicitly report gross historical merchandise, whereas vendor balances report currently eligible payable sales.

- **Legacy offline history:** the new immutable offline ledger records transactions entered after migration. Older order references remain visible in order and finance views; they are not automatically backfilled because ambiguous or duplicated references need staff review.

## Validation

- Backend TypeScript build passed.
- `node --test --test-concurrency=1 server/tests/*.test.mjs`: 92/92 tests passed, including 75 grouped API/database assertions. Schema was applied twice to disposable databases to verify migration replay.
- `npm run test:admin`: 49/49 operations passed.
- `npm run test:guidelines`: 15/15 checks passed.
- Focused Angular return, customer form and route-authorization tests: 15/15 passed in ChromeHeadless. Spec TypeScript compilation passed. The guard test fixtures emit an existing component selector collision warning.
- `npm run build`: production frontend passed within bundle budgets. Angular bundling aborted inside the sandbox with exit 134; the build and browser tests succeeded outside it with two workers.
- Inspected the admin Returns queue and details dialog in Chrome against a separate localhost preview using disposable fixtures. No live gateway or business database operations were performed. Preview servers and disposable data were cleaned up.
- Parallel PGlite test processes plus compilation triggered real load-shedding 503 responses. Final backend verification ran sequentially; the production guard was retained.
- Regression fixtures cover customer/admin authorization, return transitions, mismatched stock rollback, receipt before refund, damaged goods, unpaid COD closure, duplicate transactions, partial external refunds, gross/refunded/net consistency, inclusive GST, payout timeout/storage failure recovery, immutable provider payloads/keys, signed payout events and legacy reconciliation. These checks do not certify live provider credentials or bank settlement.

## Deployment requirements

Apply the updated schema to the selected deployment database, deploy frontend/backend together, configure Razorpay payment/refund webhooks and the separate RazorpayX payout endpoint `/api/payments/razorpayx/webhook` with `RAZORPAYX_WEBHOOK_SECRET`, then review payment/refund/payout exceptions through Finance. Migration and deployment are outside the actions performed by this audit.

## Primary provider references

- [RazorpayX payout idempotency: matching bodies, 4–36 character keys and seven-day validity](https://d6xcmfyh68wv8.cloudfront.net/docs/api/x/payout-idempotency/)
- [RazorpayX fetch payouts and payout/reference fields](https://razorpay.com/docs/api/x/payouts/fetch-all/)
- [RazorpayX payout webhook events](https://github.com/razorpay/markdown-docs/blob/master/webhooks/payouts.md)
- [RazorpayX contacts and 40-character contact references](https://d6xcmfyh68wv8.cloudfront.net/docs/api/x/contacts/)
- [Razorpay refund idempotency](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md)
