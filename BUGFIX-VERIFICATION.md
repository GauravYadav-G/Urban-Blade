# Bug report resolution and verification

Changes are in the workspace. No production deployment, live charge, production database migration, or credential revocation was performed.

## Immediate checkout blockers

- The live health endpoint reported Redis `memory-fallback`. Previous production idempotency rejected checkout in this mode. Production now saves the order and successful response in one PostgreSQL transaction, keyed by authenticated user and request key; Redis is optional.
- The Vercel origin is accepted exactly, including deployments with the previous environment allowlist. CORS runs before load shedding and permits PATCH.
- Startup migrations run by default, serialize across workers, and roll back on failure. Missing `site_settings` reads fall back only for PostgreSQL's missing-table error. Other database errors still surface.
- Checkout uses the existing Plus Jakarta Sans / Inter font stack and shared theme tokens, including dark mode. Receipt amounts retain paise, shipping, discount, and tax snapshots. COD is explicitly unpaid; invented tax-registration details and transaction identifiers are not displayed.

## First report

| Finding | Resolution |
| --- | --- |
| 1. Guest checkout | Existing route guard sends guests to sign-in with return URL. |
| 2. Migrations | Default-on transactional startup migrations; Render retains AUTO_MIGRATE=true. |
| 3. Cached failures | Only successful checkout responses persist; failed transactions roll back and retries can execute. |
| 4. Abandoned holds | Reconcile gateway state; retain uncertain/in-progress holds; expire eligible 30-minute holds; handle late captures transactionally. |
| 5. Optional auth | Invalid tokens remain guest access on public routes. Private booking history now requires authentication. |
| 6. Cache headers | Existing hook preserves explicit route cache headers. |
| 7. Refresh flow | Existing frontend refresh-and-retry retained; logout excluded from refresh recursion. |
| 8. Repeated auth | Verified request state prevents duplicate verification; cache is checked first, persistent revocations remain enforced. |
| 9. Catalog pagination | Existing unpaginated search and full catalog loading retained. |
| 10. Home recommendations | Existing computed recommendations retained. |
| 11. Development JWT | Existing stable development secret retained; unused random import removed. |
| 12. Price sync | Existing UUID/slug normalization retained; quote is authoritative and changed totals require review. |
| 13. Dead paths | Retired routes remain 410; obsolete saga implementation and initialization removed. Old modal/diagnostic files were already absent. Token lifetime now uses configuration. |
| 14. Idempotency race | Production uses transaction advisory locks; development Redis retries NX and only its lock owner can release/save. |
| 15. Unmapped webhook | Existing acknowledgement retained; verified mapped payments still use settlement. |
| 16. NULL metrics | Existing COALESCE guards retained. |
| 17. Cancellation stock | Only committed ledger entries restore on-hand stock. COD now writes/commits that ledger. Manual orders without a ledger do not inflate inventory. |

## Second report

| Finding | Resolution |
| --- | --- |
| 1. Exposed AI credential | Removed from code; environment-only. **Provider revocation remains required.** |
| 2. AI cost abuse | Customer AI routes require a session and have route rate limits. |
| 3–4. Chat cancellation | Order queries use verified user ID and exact references. Shared transactional cancellation replaces raw SQL; captured/online orders require support; no false refund claim. |
| 5. Support tickets | Authenticated ownership checks, admin-only deletion, exact scoped list; admin support APIs are admin-only. |
| 6. Booking privacy | Authenticated customer email determines scope; query parameters cannot impersonate another customer. |
| 7. Coupons | Persistent admin CRUD and server validation replace browser-only authority. Old browser coupons must be recreated. |
| 8. Shipping settings | Persistent shared settings govern quotes, checkout totals, and saved receipts. |
| 9. Vendor matching | Exact normalized vendor equality for product modification/deletion. |
| 10. Product targeting | Exact ID/slug resolution updates one product; inventory no longer silently falls back to seed rows. |
| 11. Vendor login takeover | Provision only absent users; conflict never overwrites existing credentials or role. |
| 12. Storage collision | Catalog and admin cache keys are separate. |
| 13. Reservations in inventory | Admin API and display include on-hand, reserved, and available quantities. |
| 14. Wishlist aliases | Normalize IDs and deduplicate slug/UUID references; detail indicator uses resolved product. |
| 15. Cart sync | Login merges validated server cart; changes sync; server enforces bounded typed items. |
| 16. Vendor session expiry | Legacy endpoint delegates to shared login/refresh-token flow. |
| 17. Ticket creation | Authenticated identity, bounded message fields, priority reset, ownership checks, and rate limits. |
| 18. ILIKE scope bypass | Exact owner/reference comparisons replace wildcard email and tracking lookups. |

## Verification

- `npm --prefix server test`: unit tests plus an embedded PostgreSQL scenario, including migrations applied twice, CORS, access controls, persisted coupons/settings, production checkout without Redis, replay, failed-attempt retry, stock cancellation, duplicate settlement, amount mismatch, gateway outage, expiration, and late capture.
- `npm run build`: production Angular compilation; the existing admin-orders stylesheet budget warning remains.
- Headless Chrome: desktop/mobile checkout, light/dark theme, exact Razorpay amount and order creation, successful receipt, confirmation-error recovery, mobile overflow, console errors, and print header visibility. Browser API/SDK responses are test doubles.

## Operational follow-up

Deploy backend before frontend and let migrations finish. Verify a merchant test-mode purchase and webhook on the deployed domain. Revoke the leaked NVIDIA key in the provider account. Automatic refunds are not implemented; exceptional captured payments without available stock require operator reconciliation. Tests do not establish that every provider/network failure is impossible.
