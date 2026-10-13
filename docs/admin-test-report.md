# Urban Blade admin-panel test report

Date: 2026-10-13. Tested the local working tree, including previous ecommerce, admin and money-flow fixes.

## Research basis

- [Vendure entity access-control tests](https://github.com/vendurehq/vendure/blob/master/packages/core/e2e/entity-access-control.e2e-spec.ts): authorization and ownership boundaries.
- [Saleor Dashboard testing guidance](https://github.com/saleor/saleor-dashboard#testing): separate unit/component testing from browser journeys, with isolated seeded data.
- [OWASP authorization testing](https://github.com/OWASP/www-project-web-security-testing-guide/blob/master/stable/4-Web_Application_Security_Testing/05-Authorization_Testing/02-Testing_for_Bypassing_Authorization_Schema.md): test administrative functions with unauthorized identities.

Scenarios were adapted for Urban Blade, not copied from another application's tests. Project popularity is not a ranking of individual test cases.

## Final results

| Verification | Passed | Failed | Command |
| --- | ---: | ---: | --- |
| Full frontend unit/component/guard suite in ChromeHeadless | 79 | 0 | `npm test -- --watch=false --browsers=ChromeHeadless` |
| Full backend unit/API/database suite | 62 | 0 | `npm --prefix server test` |
| Admin operations audit | 49 | 0 | `npm run test:admin` |
| Guidelines audit | 15 | 0 | `npm run test:guidelines` |
| Frontend production build | Passed | — | `npm run build` |

Added **30 named admin scenarios**: 15 frontend and 15 backend. The full suite counts include earlier tests for other parts of the site. Backend counts also include parent tests; audit operations are a separate measure, not unique test requirements.

[Sanitized execution evidence](test-results/admin-2026-10-13.txt).

## Added scenarios

| IDs | Coverage | Final result | Location |
| --- | --- | --- | --- |
| AP-01–07 | Sellable-stock filters; reserved stock; search; exact vendor identity; missing tenant; duplicate saves/failure retention; forced vendor ownership | 7 passed | `src/app/features/admin/pages/admin-products/admin-products.spec.ts` |
| AS-01–04 | Timed admin logout; timed vendor logout; activity extending the deadline; malformed expiry failing closed | 4 passed | `src/app/core/services/admin-session.service.spec.ts` |
| AC-01–04 | Required coupon fields; percentage limit; failed-save preservation; normalized code and successful modal closure | 4 passed | `src/app/features/admin/pages/admin-coupons/admin-coupons.spec.ts` |
| AA-01–03 | Unauthenticated reads and vendor isolation across eight protected modules; similarly named vendor cannot edit another merchant's product | 3 passed | `server/tests/admin-standard.test.mjs` |
| AI-01–02 | Stale inventory version rejected; stock cannot fall below reservations | 2 passed | Same backend file |
| AT-01–04 | Task due date/customer context; blank title rejected; invalid status rejected; missing task returns 404 | 4 passed | Same backend file |
| AH-01–06 | Inquiry creation; empty reply rejection; sender validation; status validation; missing inquiry returns 404; concurrent replies retained with distinct IDs | 6 passed | Same backend file |

The role matrices exercise customers, vendors, bookings, tasks, support, system telemetry, finance audit, and coupons. Existing audits also cover dashboard metrics, product/vendor/coupon CRUD, order progression, booking operations, customer profiles/roles, support actions, cache management, and payment/carrier reconciliation. The broader backend suite reruns refunds, returns and payout-accounting checks.

## Failures found and fixed

The initial frontend run had **76 passes and 3 failures**. The initial backend admin scenarios had **7 failing cases**, plus the failing parent-test summary.

| Failing case | Observed behavior | Correction |
| --- | --- | --- |
| AP-04 | `Studio` also matched `Studio North` in the UI | Trimmed, exact vendor-name matching |
| AP-05 | Missing vendor identity left all supplied products visible | Empty vendor results until identity is available |
| AS-04 | Malformed expiry produced a non-finite countdown and no logout | Finite-value validation in startup, guard checks and heartbeat; expired countdown reset |
| AT-02 | Blank task accepted | Zod task-creation validation |
| AT-03 | Arbitrary task status accepted | Enumerated task-update validation |
| AT-04 | Missing task update returned success | Explicit 404 response |
| AH-02 | Blank support message accepted | Trimmed, non-empty reply validation |
| AH-03 | Admin reply endpoint accepted a `user` sender | Restrict sender to `admin` or `ai` |
| AH-04 | Arbitrary inquiry status accepted | Enumerated status validation |
| AH-05 | Missing inquiry update returned success | Explicit 404 response |

The backend vendor-ownership checks passed before the UI fixes; the filtering failures are not evidence that the backend disclosed another tenant's records.

Support replies now append atomically in SQL and use UUID message IDs. The concurrent-reply scenario passed on the tested adapter before and after this change; the rewrite removes the read-then-write race structurally, but real multi-connection contention was not stress tested.

The legacy 49-operation audit initially reported four failures after strict validation: one invalid task fixture caused two dependent failures, and one inquiry fixture used an unsupported status. Replaced `assignedTo` with the API's `assignee`, and `resolved` with the supported `closed` state. Added persisted-value assertions, then all 49 operations passed. Validation was retained.

## Test environment and limits

API/database checks used disposable PGlite databases and controlled provider fixtures. No production records, real payments, refunds or payouts were changed. Frontend tests run in ChromeHeadless through Angular/Karma; session tests use a controlled clock rather than waiting fifteen real minutes.

Not covered: complete browser admin click-through journeys, mobile/visual/accessibility audits, Firefox/Safari compatibility, live payment/carrier/AI provider behavior, production Redis, multi-connection PostgreSQL stress, or production-scale load. Passing these checks does not certify every admin workflow.
