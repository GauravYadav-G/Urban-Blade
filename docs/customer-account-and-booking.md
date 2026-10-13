# Customer account and appointment changes

The account page follows the supplied account-details reference: a neutral sidebar, a spacious white details panel, restrained amber accents, and consistent fields. Profile details open by default; orders, appointments, addresses, and overview remain accessible. Mobile navigation scrolls horizontally and retains sign-out access.

The appointment page uses service choices from the live catalog, studio/home visit cards, date and time inputs, customer details, and a live summary. Home appointments can use the customer's saved address book. Confirmation shows the actual saved booking reference and visit location.

Design references reviewed:

- [Pinterest account-page references](https://au.pinterest.com/amyli75457/account-page/)
- [Dribbble account details design](https://dribbble.com/shots/22533736-Account-Details-Web-Design)
- [Figma dashboard templates](https://www.figma.com/templates/dashboard-designs/)

## Address persistence

Authenticated address records live in the existing `addresses` table under `user_id`, linked to `users.id`. The API takes the owner from the verified JWT. Reads, edits, deletion, and default changes enforce ownership. A transaction and a partial unique index keep one default per customer.

Customers' existing browser-only address books migrate after a successful authenticated load. Guest addresses remain local to that device. Import retries retain newer server edits. Checkout refreshes the address book and waits for it before selecting the default; details entered during loading are preserved.

The additive migration adds house, landmark, and map-location fields and an index. Deploy/restart the backend to activate these changes; startup applies the schema when `AUTO_MIGRATE` is enabled. If disabled, run the existing migration workflow first. The configured remote database was not altered during development; database tests used disposable PGlite instances.

## Verification

- Production Angular build and server TypeScript build.
- 20 frontend regression tests covering admin POS/export, address migration/isolation, checkout restoration, and booking interactions.
- 20 backend tests, including persistent address CRUD/defaults and cross-customer access denial.
- Admin operations audit: 49 passing operations.
- Guideline audit: 15 passing checks.

Interactive review of the signed-in pages remains to be completed against a running backend. Local browser review reached the signed-out state; no production deployment was performed.
