# Architecture and the next backend phase

## First-phase structure

`Appointments.Web` is an ASP.NET Core MVC host. Razor renders the role-specific shell and demo entry screen. The browser's small application layer renders data-driven pages and dialogs and calls same-origin MVC JSON actions. These are presentation endpoints in the same application, **not a separate production Web API**. They validate model binding and antiforgery and map business-rule failures to useful HTTP responses.

`DemoIdentity` resolves the current cookie identity against existing demo users. `DemoActor` is constructed server-side, never accepted from a booking payload. Navigation is role-specific, but the service also verifies ownership for reads and writes. Patient names/contact details are filtered before sending the bootstrap payload to a patient. Staff patient-directory access is explicit; a doctor does not gain another doctor's appointment access.

`Appointments.Core` contains `Doctor`, `WorkingPeriod`, `SourceSchedule`, `AvailabilityException`, `Patient`, `Appointment`, DTO commands, and `IAppointmentService`. It has no ASP.NET dependency. `AppointmentService` enforces authorization, transitions, versions, idempotency and changes. `SchedulingRules` calculates availability with `SchedulingClock`, whose `TimeProvider` makes time-sensitive tests deterministic.

`IDemoStore` groups every write as one transaction. `JsonDemoStore` holds an exclusive instance lock, serializes access, clones the current state, runs validation/mutation, writes a temporary file with flush, atomically renames it and updates its in-memory state. Failed validation never alters the store. Callers receive copies rather than live references. This is intentionally a single-process local demonstration mechanism, not a scalable database design.

`Seed/doctors.json` contains sanitized normalized workbook information and clean-sheet row references. It is read-only. `DemoSeed` creates fictional people and valid relative-date appointments the first time a store is created or reset. Runtime JSON is outside the checkout.

## UI boundaries

- `Views/Demo/Index.cshtml` and `demo.js`: explicit role/user selection.
- `Views/Home/Workspace.cshtml`: accessible shell, navigation, dialog hosts and antiforgery token.
- `wwwroot/js/app.js`: directory, overview, booking/review/confirmation, appointments, patient directory, calendar and availability views. It centralizes fetch/error handling, escaping, date formatting and shared refresh.
- `wwwroot/css/site.css`: responsive visual system, calendar theme, dialogs and focus/reduced-motion behavior.
- FullCalendar Standard is a view/interaction component only. Its background slots come from the authoritative service. Dragged appointments are confirmed, revalidated on the server and reverted on failure.

ISO local date/time commands are distinct from UTC appointment instants. The FullCalendar UTC configuration is used only as a timezone-independent coordinate system for the configured clinic's wall-clock values. It is not a declaration that the clinic runs on UTC.

## Replace demonstration services with a real API

1. Add `Appointments.Api` with ASP.NET Core Web API and a separate contracts assembly for DTOs. Keep domain rules server-side. Introduce asynchronous service contracts and cancellation tokens as part of this migration.
2. Implement actual identity with ASP.NET Core Identity/OIDC and verified patient/doctor associations. Use stable account IDs; remove demo role switching from the production build/configuration. Map trusted server claims to application actors. Never accept a role, doctor identity or patient identity blindly from the browser.
3. Implement an HTTP-backed application service in the MVC host. The frontend may retain same-origin MVC endpoints as a backend-for-frontend; they translate view requests to authenticated API calls. Razor, UI flows and date contracts can remain essentially unchanged.
4. Move persistence behind repositories/unit-of-work or a narrow transactional application store. **Do not expose the demo whole-state clone/read/write model over the network or implement PostgreSQL by serializing the entire demo state.** Keep the useful service boundary and replace this local store design with purpose-built database transactions.
5. Use Npgsql/EF Core with migrations, relational keys, indexes, UTC timestamps, validated IANA clinic timezones, and structured recurring working hours/exceptions. Keep source provenance separate from operational schedule overrides. Patient/doctor names should not serve as primary keys.
6. Enforce both doctor and patient overlap prevention at the database level. Use PostgreSQL range/exclusion constraints for active appointment intervals, with appropriate `btree_gist` support and a policy excluding cancelled rows. Combine these with transactional availability checks and optimistic versions/ETags. Race-test the exact SQL behavior; an application-level check alone is insufficient across API instances.
7. Persist idempotency keys keyed by authenticated principal + operation with payload fingerprint/response, expiry and a unique index. Map conflicting inserts to HTTP 409; do not silently replace earlier bookings.
8. Protect schedule edits and appointment creation under a shared transactional locking strategy per doctor/date, so availability edits cannot race booking inserts. Validate active booking intervals before closing a working period or deleting an exception.
9. Add audit events for booking, cancellation, rescheduling, confirmation, schedule changes and privileged actions; avoid clinical or contact information in logs. Define retention, consent, backup/restore, encryption and access review before storing actual patient data.
10. Add API integration tests using disposable PostgreSQL databases, including simultaneous booking, schedule-edit races, DST and cross-role access. Add real browser tests against desktop/mobile widths and a production-like timezone configuration.

Suggested tables: Doctors, Specialties, DoctorSpecialties, WorkingPeriods, AvailabilityExceptions, Patients, Accounts, AccountPatientLinks, AccountDoctorLinks, Appointments, AppointmentAuditEvents, IdempotencyRequests. Appointments need start/end UTC, clinic timezone context, status, creator, timestamps and concurrency version. The initial UI treats a provider as one scheduling resource; procedure-specific durations and rooms/equipment should become explicit models when requirements are confirmed.

## Later integrations

Notifications should use a transactional outbox with delivery status, retries and provider receipts. Do not show “sent” on enqueue. Add SignalR or equivalent for immediate updates across already-open workspaces after committed API changes. Calendar synchronization requires provider authentication and stable external IDs; changes must still pass the same overlap rules. Confirm the real-world meaning of pending reservations, Tuesday priority, holidays, funding and missing shift hours with the clinic before production.

## Operational limits

The first phase intentionally has one configurable local file, no schema migrations beyond a version guard, no distributed locking, no automatic holiday feed, no notification delivery and no real identity assurance. Those limits are visible in the README and demo entry screen. A corrupt runtime file causes a clear startup error instead of silent data loss. The default launch profile is loopback HTTP for local development only.
