# Urban Blade ecommerce test report

Date: 2026-10-13. Scope: current local working tree, including the earlier admin and payment/refund fixes.

## Research basis

These are adapted scenarios, not copies of another application's test suite. Individual test cases have no dependable popularity ranking. Repository stars were used as a rough indicator of established projects, not as evidence that these are the globally most popular tests.

| Primary source | Selection rationale | Patterns applied here |
| --- | --- | --- |
| [Saleor](https://github.com/saleor/saleor), approximately 23.4k stars observed | Established ecommerce platform | [Tax and checkout calculations](https://github.com/saleor/saleor/blob/main/saleor/checkout/tests/test_utils.py): inclusive/exclusive tax and discounted totals |
| [Vendure](https://github.com/vendurehq/vendure), approximately 8.5k stars observed | Established TypeScript commerce platform | [Order-process tests](https://github.com/vendurehq/vendure/blob/master/packages/core/e2e/order-process.e2e-spec.ts): guarded state transitions, payment settlement, rollback |
| [Cypress Real World App](https://github.com/cypress-io/cypress-realworld-app), approximately 5.9k stars observed | Official testing reference for a payment application | [Authentication tests](https://github.com/cypress-io/cypress-realworld-app/blob/develop/cypress/tests/ui/auth.spec.ts): registration, login errors, authenticated access, logout |
| [OWASP payment testing](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/10-Business_Logic/10-Payment_Functionality/) | Security testing guidance | Server-authoritative amounts, invalid quantities, payment verification, repeated requests and workflow ordering |

Searches also surfaced small ecommerce automation examples. Established projects and primary test files were preferred as the basis for this audit.

## Final execution results

| Run | Passed | Failed | Evidence |
| --- | ---: | ---: | --- |
| Angular unit tests in ChromeHeadless | 64 | 0 | `npm test -- --watch=false --browsers=ChromeHeadless` |
| Backend unit/API/database suite | 46 | 0 | `npm --prefix server test` |
| Admin operations audit | 49 | 0 | `npm run test:admin` |
| Guidelines audit | 15 | 0 | `npm run test:guidelines` |
| Production frontend build | Passed | — | `npm run build` |

The runner counts above are not a count of unique business requirements: backend counts include parent tests, and the audit scripts count operations/checks. The new coverage added in this audit consists of **39 named scenarios**: 20 frontend scenarios and 19 backend scenarios.

[Sanitized execution evidence](test-results/ecommerce-2026-10-13.txt) preserves the final summaries and the original failures. Angular tests and build ran outside the execution sandbox because the local compiler aborts inside it.

## Newly added scenario matrix

| IDs | Scenarios | Final result | Test location |
| --- | --- | --- | --- |
| CART-01–09 | Empty cart; add item; combine repeat additions; quantity totals; remove/clear; quantity cap; fractional/out-of-stock rejection; exclude appointments; reload persistence | 9 passed | `src/app/core/services/cart.service.spec.ts` |
| CART-10–12 | Invalid persisted quantities; malformed-entry isolation; negative merge prices | 3 passed after fixes | `src/app/core/services/cart.service.spec.ts` |
| CAT-01–08 | Search; categories; deals; both price sort directions; rating; audience; no results | 8 passed | `src/app/core/services/catalog.service.spec.ts` |
| AUTH-01–06 | Customer-only registration; duplicates; invalid fields; wrong credentials; login/profile; token revocation on logout | 6 passed | `server/tests/ecommerce-standard.test.mjs` |
| SEC-01–02 | Customer blocked from admin financial records; unauthenticated/customer refund requests blocked | 2 passed | Same backend file |
| CAT-09–10 | Public API search/filter; sort/pagination | 2 passed | Same backend file |
| INV-01–02 | Reserved stock excluded from availability; unavailable products rejected at checkout quote | 2 passed | Same backend file |
| COUPON-01–03 | Discount cap; expired codes; minimum order value | 3 passed | Same backend file |
| CART-13 | Server cart persistence and duplicate product rejection | 1 passed | Same backend file |
| TOTAL-01–03 | Free-shipping threshold; inclusive tax; exclusive tax after discounts | 3 passed | Same backend file |

## Failures discovered and corrected

Initial frontend run: **61 passed, 3 failed**.

| Case | Observed failure | Customer impact | Fix |
| --- | --- | --- | --- |
| CART-10 | A saved quantity of `1.5` remained fractional | Invalid cart count and subtotal after reload | Reject invalid quantities at restoration |
| CART-11 | `[null, validItem]` restored as an empty cart | One corrupt entry erased valid saved purchases | Validate each entry independently |
| CART-12 | A merged line with price `-500` was accepted; subtotal became `-500` | Invalid displayed cart totals | Reject negative and non-finite prices |

`CartService` now uses the same validation boundary for saved carts and server-cart merges. The three original regression tests now pass. The backend already rejects invalid prices and recalculates checkout amounts; these failures concern frontend cart state, not evidence of a negative real charge.

## Existing lifecycle coverage rerun

The existing suites additionally verify authenticated checkout, ownership isolation, server prices, stale quotes, duplicate/fractional cart quantities, checkout idempotency, COD creation/collection, online capture, payment signatures, exact-byte webhook signatures, stock commit/release, late captures, pending/processed refunds, timeout recovery, delayed refund responses, partial refunds, received returns, damaged-goods handling, manual repayments, vendor payout accounting, and payment/inventory reconciliation.

These checks exercise API routes and real SQL in disposable PGlite databases. External payment/carrier boundaries use controlled fixtures. Frontend tests run in ChromeHeadless through Angular/Karma and test services, guards, and components; they are not a complete browser shopping journey.

## Limits and untested areas

- Live Razorpay charges, bank settlement, real webhook delivery, and actual refund arrival were not tested. No real charges/refunds were made.
- Full storefront click-through journeys, visual regressions, accessibility audits, mobile layouts, Firefox/Safari compatibility, email delivery, and production deployment/network behavior were not tested in this run.
- Real multi-connection PostgreSQL contention, Redis-backed behavior, and production-scale load were not stress tested. Duplicate-request and stock-ledger checks do not replace those tests.
- Password reset, guest checkout, gift cards, subscriptions, and loyalty schemes were not covered. Guest checkout is intentionally blocked by this application's current authentication policy.

Passing the tested scenarios demonstrates local coverage, not complete production certification.
