# Stylist directory management

Open **Admin → Floor Appointments → Stylist directory**.

- **Archive** prevents new assignments and keeps the stylist record and existing booking assignments. Use Edit & reactivate to restore them.
- **Permanently delete** is available for active and archived stylists. Review the warning, type the exact saved name and confirm. This physically deletes the roster record. Every linked booking remains, with its stylist assignment cleared and version incremented. Reassign upcoming appointments to a current stylist.

Permanent deletion is restricted to master administrators. The server validates the UUID and confirmation payload, locks the saved stylist before checking the current name, clears assignments and deletes the record in one transaction. A changed name requires fresh confirmation; failures roll back both steps. Deleting again returns not found. The directory lists all stored records, including archived entries.

API: `DELETE /api/admin/stylists/:id/permanent` with `{ "confirmationName": "Exact stylist name" }`. The response includes `id`, `deleted`, `unassignedBookings` and a confirmation message. Existing `DELETE /api/admin/stylists/:id` remains the archive action.

Stylist roster records and staff login accounts are separate. This option deletes the roster entry; login accounts are managed separately in the user directory. No schema migration is needed specifically for permanent stylist deletion.

Verification: 10 backend deletion test records and 8 focused Angular tests passed. Existing booking/payment integration regressions passed, along with the 49-operation admin audit, 15 guideline checks and production build. All deletion tests use disposable fixtures; no live stylist record was deleted during implementation.
