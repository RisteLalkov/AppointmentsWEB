# Connected architecture

## Project boundaries

| Project | Responsibility |
| --- | --- |
| Appointments.Web | Razor views, existing calendar/booking UI, encrypted browser cookie, antiforgery-protected same-origin `/data` actions; calls API via `ApiClient` |
| Appointments.Contracts | Shared typed request/response contracts and validation attributes |
| Appointments.Api | HTTP routes, password/session authentication, trusted actor construction, account lifecycle, errors, rate limiting, development OpenAPI and startup migrations/seeding |
| Appointments.Data | EF Core relational mappings/migrations, purpose-built PostgreSQL operations, transactions, locking, idempotency and audit writes |
| Appointments.Core | Framework-independent domain records, availability and status/ownership rules, testable scheduling clock; legacy JSON implementation remains for isolated demos/tests |

The browser never connects to PostgreSQL and never receives the API bearer token in JavaScript. It calls MVC on the same origin. MVC reads a protected token from its encrypted authentication cookie and adds it to its server-to-server API request. Account role/profile claims originate in the API. MVC navigation restrictions improve usability; the API independently authorizes every operation from the database session/account.

`ApiClient` does not retry mutations automatically. A timeout might occur after a commit; the user is told to refresh. Booking forms keep one request identifier for safe retry. No JSON fallback occurs if the backend is down. The default is `Backend:Mode=Api`; an explicit Development-only `Demo` configuration retains phase-one regression coverage.

## Relational model

- `Doctors` has independent `WorkingPeriods` and original `SourceSchedules` with workbook row references. `ScheduleVersion` protects stale edits.
- `AvailabilityExceptions` models dated additional hours and blocks separately from weekly periods.
- `Patients` contains scheduling identity/contact data, not clinical records.
- `Appointments` references doctor and patient, stores UTC `timestamptz` start/end, status and optimistic `Version`.
- `Accounts` links a patient or doctor, or is an unlinked administrator. Foreign keys, unique profile links and a role/link check prevent invalid associations.
- `Sessions` stores only SHA-256 hashes of random bearer tokens, expiry, account link and demo flag.
- `IdempotencyRequests` stores account/request key, canonical command fingerprint and original response in one transaction with the booking.
- `AuditEvents` stores actor, action, target and UTC time without credential/clinical payloads. It is an operational audit table, not tamper-proof compliance storage.
- `Settings` stores the scheduling timezone. Startup refuses a changed zone until an explicit data migration is planned.

EF owned working/source rows have independent generated keys. They are real relational rows, not serialized JSON state. Only idempotent response snapshots use PostgreSQL `jsonb`.

## Scheduling transaction

1. Authenticate the live session and construct its actor; clients cannot submit an actor or role for a booking.
2. Begin a PostgreSQL READ COMMITTED transaction.
3. For booking, lock `(account, request key)` with a transaction advisory lock. Return an existing response only if its normalized command fingerprint is identical.
4. Lock the doctor using a transaction advisory lock shared by all booking, reschedule, status, hours and exception operations. This works across API processes.
5. Query the required doctor, future/ongoing doctor appointments, the selected patient's future/ongoing appointments, and relevant dated exceptions. No full database state is loaded for a mutation.
6. Run the existing tested Core rules against this scoped operation state. Tracked entities retain EF concurrency versions. `OperationState` is a small in-memory domain adapter for this request; it does not persist or serialize whole-state snapshots.
7. Save the relational changes, idempotency snapshot and audit event, then commit. A failed validation/write rolls back.

The database additionally has **two GiST exclusion constraints** using `tstzrange(Start, End, '[)')`: one for a doctor's occupied intervals, one for a patient's. Every status except Cancelled reserves its interval. Adjacent appointments are allowed. The patient constraint protects races involving two different doctors, whose doctor locks intentionally differ. Direct SQL writers are also subject to these constraints.

Overlap SQLSTATE `23P01`, unique violations `23505`, and optimistic concurrency failures return HTTP 409 with useful messages. Application-level working-hour/exception checks remain necessary: a relational overlap constraint cannot express all recurring schedule rules. Direct administrative SQL schedule modifications must follow the documented application constraints; they are not a supported scheduling interface.

Availability reads do not lock the calendar and are advisory until submission. Every save recomputes availability within the transaction. Schedule/exception changes cannot strand active future/ongoing bookings. DST is resolved by the Core clock; nonexistent/ambiguous local times and duration-changing transitions cannot be booked. UI calendar coordinates remain clinic wall times while stored appointment instants are UTC.

## Authentication boundaries

PasswordHasher uses versioned salted PBKDF2 hashes with 210,000 iterations. Random 48-byte session secrets are base64url encoded; only their SHA-256 hashes enter the database. Expiry is absolute at two hours. Password changes, credential provisioning and disabling accounts revoke sessions. Sign-in locks the account row logically with a transaction advisory lock so failed-attempt counters cannot be lost across API instances.

Registration only creates a new patient. Existing patient identity must be verified by reception before account linking; matching an email is not proof. This implementation does not claim email ownership verification, MFA, federated OAuth/OIDC, or self-service password recovery. It is a first-party server session protocol; use a mature identity provider if third-party API clients or federation become requirements.

Development demo access requires both Development environment and `Demo:Enabled`. Production rejects demo routes and existing demo-issued sessions. Demo users start with empty password hashes, so they cannot use password login until an administrator explicitly provisions credentials. Demo and password sessions in Development use the same database, which must remain isolated from real patient information.

MVC cookies are HttpOnly/SameSite Strict and Secure outside Development. API bearer authentication has no cookie dependency and no CORS policy is opened. MVC forms and `/data` writes enforce antiforgery. Password/session responses are not cacheable. Production API URLs must use HTTPS. Deployments must configure proxy forwarding, TLS, allowed hosts and persistent protected ASP.NET data-protection keys explicitly; no proxy is blindly trusted by default.

## Scaling and evolution

The database is now the shared authority; multiple API processes are supported. API list queries support date windows and pagination. The current UI bootstrap still returns all appointments visible to its actor for continuity with phase one; adapt the UI to windowed queries before very large datasets. Administrative patient/account listings are also unpaged in this first backend release.

Separate migration and runtime database roles, move bootstrap configuration out after provisioning, add operational audit export and retention, verified recovery/OIDC, a transactional notification outbox and observability. Authentication rate limiting is per process; a deployed cluster needs a gateway/distributed limiter. Local cookie data-protection keys must be shared safely before multiple MVC hosts are used. Data migrations must never silently reinterpret the scheduling timezone or auto-import unverified legacy demo identities.
