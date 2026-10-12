# Admin data and booking assignment review — 12 October 2026

## Data accuracy

The dashboard now loads the same `/api/admin/finance/audit` totals as Finance plus `/api/admin/overview` database counts. Payment totals cover orders created in the preceding 30 days. Each source has a snapshot timestamp. Failed loads show an error and identify previous snapshots as stale.

Removed dashboard formulas that treated appointment quotes as receipts, inferred bank balances from delivery, estimated commissions/expenses/profit, substituted stock value for empty sales, invented chart heights, and supplied fake customer details. No charts or download actions remain that claim data or files they cannot produce.

The legacy finance summary no longer reports assumed 15%/16.5% margins or INR 250 home-service charges. Unsupported values are null. Booking quoted value is separate from payment revenue. The vendor page labels its current-rate calculation as an estimate before discounts; actual payable balances remain in Finance.

Removed static telemetry infrastructure claims, assumed chair utilization, fabricated growth when there is no comparison baseline, default vendor records, and fallback stock quantities. Database read failures for bookings, customers, tasks, inquiries and daily metrics return errors instead of empty-success responses. Existing database records were not purged or reclassified as test data.

## Booking rules

- Customers cannot choose a stylist for salon or home service. Public creation rejects supplied stylist identity fields.
- Salon customer booking history returns no stylist name. Home-service history displays the assigned database name, or awaiting assignment.
- Admins select staff by database ID for either visit type. Empty assignment explicitly clears the assignment.
- Admins can add, edit, archive and reactivate stylists. Removal archives a record so existing booking history remains intact.
- Assignment requires an active stylist. The existing database index prevents two active assignments for the same stylist/date/time-slot value.
- Booking status updates validate the status and return errors for missing records or persistence failures. UI state changes only after a saved response.
- Public booking prices and service IDs are resolved from active database catalogue services, not trusted from customer-submitted amounts.
- The customer form prevents duplicate submissions while saving, reports errors, and removes unsupported callback and SMS promises. The chat booking form no longer offers staff selection or invents a default stylist/service.

## APIs

Admin only: `GET/POST /api/admin/stylists`, `PUT/DELETE /api/admin/stylists/:id`, `GET /api/admin/overview`.
Existing admin booking creation/rescheduling accepts `stylistId` or the creation payload's `stylist_id`; name matching is no longer used for assignment. The public stylist directory returns an empty list by design.

## Verification and release

Regression tests cover stylist CRUD permissions, home/salon assignment, slot conflicts, archived-staff rejection, retained history, customer name visibility, server-authoritative service pricing, invalid/missing booking status updates, honest financial nulls, and database outage responses. Required admin and guideline checks and Angular production compilation pass.

Deploy frontend and backend together. Apply the earlier finance schema changes before using the new dashboard if they are not deployed yet. This turn did not modify live business records, migrate a production database or deploy.

## Remaining limits

There is no booking-payment collection ledger, configured chair capacity, staff working-hours calendar, service-duration overlap detection or travel-time allocation. Appointment amounts remain quotes; utilization and booking cash revenue are deliberately unavailable. Conflict protection uses the stored time-slot value; legacy time formats are not automatically rewritten. Full browser visual regression was not performed in this turn.

## Dashboard visual refinement

Restored a richer dashboard presentation: Obsidian net-collections card, payment metric tiles, daily order-activity bars, payment-status donut, operational summary, appointment table and review queue. Date filters cover 7, 30 or 90 rolling days. Charts aggregate all matching orders in SQL, not a paginated client list. Daily grouping uses India time and includes partial first/last dates in a rolling period. Collected-order counts include orders later refunded and are explicitly labelled.

Chart bars support pointer, keyboard focus and tap inspection, with a toggleable data table. Zero values have zero-height bars; empty payment distributions show an empty ring. Current operational counts remain clearly separate from period-based charts. Desktop browser preview was visually checked against live local records; mobile uses responsive breakpoints but has not received a full device visual pass. SQL regression checks reconcile chart totals to matching order counts and validate period bounds.
