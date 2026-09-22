# Careline · AppointmentsWEB

Doctor appointment scheduling with **ASP.NET Core MVC, a separate ASP.NET Core API, and PostgreSQL**. The existing patient, reception and doctor interfaces now share durable relational data through the API. All projects are in one Visual Studio solution.

## Run in Visual Studio on Windows

1. Install a current **Visual Studio 2026** with **ASP.NET and web development** and the **.NET 10 SDK**. .NET 10 requires Visual Studio 2026 version 18.0 or later; use the latest serviced update compatible with your SDK. Visual Studio 2022 cannot target .NET 10.
2. Install **PostgreSQL 17** locally, or start a Docker-compatible engine with Compose. Native PostgreSQL is fully supported and needs no container software or account. See the two setup choices below.
3. Clone/download this repository and open a PowerShell terminal in its root.
4. Complete **one** database setup choice below.
5. Open **`Appointments.sln`**, restore NuGet packages, and select the **Careline - API and Web** solution launch profile. If the profile is not shown, right-click the solution → **Configure Startup Projects** → **Multiple startup projects** → set **Appointments.Api** and **Appointments.Web** to **Start**, with API first. Other projects should be None.
6. Press **F5**. The API runs at **http://localhost:5181**, the web app at **http://localhost:5180**. Development startup applies the included migrations and seeds the workbook schedules on the first run. If the web page opens before the API is ready, retry after the API reports it is listening.
7. Sign in with your initial administrator credentials, create a patient account, or use **Explore the development demo**. In the workspace, reception can manage **Accounts & access**.

The solution targets **.NET 10 LTS**. `global.json` allows serviced 10.0 SDK feature bands. Verified build SDK: **10.0.401**, runtime **10.0.12**. EF Core is **10.0.12**, Npgsql EF provider **10.0.3**. No frontend build, external API key, paid scheduler or external account is required. Node/Python are needed only for optional tests.

### Choice A: automatic local database with Compose

With your container engine running, execute:

```powershell
.\scripts\setup-local.ps1
```

The script creates a random database password in ignored `.env`, starts PostgreSQL on **127.0.0.1:55432**, configures API user-secrets, generates an initial administrator password in ignored `.local-admin.json`, and restores the solution. The default sign-in email is **admin@careline.local**. Open `.local-admin.json` locally to obtain its password; it is never a repository default. Re-running setup preserves existing credentials and the database volume. Do not delete `.env` while keeping the same database volume: that would generate credentials that differ from the initialized database.

After your first sign-in, change the administrator password and remove the initial bootstrap secrets/file:

```powershell
dotnet user-secrets remove "Bootstrap:Email" --project src/Appointments.Api
dotnet user-secrets remove "Bootstrap:Password" --project src/Appointments.Api
Remove-Item .local-admin.json
```

Stop only the database with `docker compose stop`; resume with `docker compose up -d --wait`. Data remains in the named volume. Docker Desktop has its own licensing conditions; it is optional. Native PostgreSQL avoids that dependency entirely.

### Choice B: native PostgreSQL, no Docker

Using PostgreSQL's SQL Shell/psql as its administrator, create an isolated application role and database. Choose your own strong passwords; the values below are placeholders:

```sql
CREATE ROLE careline_app LOGIN PASSWORD 'YOUR_LOCAL_DATABASE_PASSWORD';
CREATE DATABASE appointments_dev OWNER careline_app;
\connect appointments_dev
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Set local API configuration (do not put passwords in tracked appsettings files):

```powershell
dotnet user-secrets set "ConnectionStrings:Appointments" "Host=localhost;Port=5432;Database=appointments_dev;Username=careline_app;Password=YOUR_LOCAL_DATABASE_PASSWORD" --project src/Appointments.Api
dotnet user-secrets set "Bootstrap:Email" "admin@careline.local" --project src/Appointments.Api
dotnet user-secrets set "Bootstrap:Password" "YOUR_INITIAL_PASSWORD_AT_LEAST_12_CHARACTERS" --project src/Appointments.Api
dotnet restore Appointments.sln
```

Then press F5 as above. Change/remove the bootstrap credentials after first sign-in. User-secrets are local development configuration, not an encrypted production secret vault.

### Command-line run

After database setup, use two terminals:

```sh
# Terminal 1
dotnet run --project src/Appointments.Api
# Terminal 2
dotnet run --project src/Appointments.Web
```

Launch profiles select Development and the local ports. For another API address set web `Backend:ApiBaseUrl` (environment variable `Backend__ApiBaseUrl`). Outside Development it must be HTTPS. The web project has **no database connection string**; only the API connects to PostgreSQL.

## What is implemented

| Workspace | Workflows |
| --- | --- |
| Patient | Password registration/sign-in, directory and profiles, genuine available slots, review/confirmation, upcoming/history, details, rescheduling and cancellation |
| Reception | All-doctor day/week/month calendar, filters/search, patient creation/search, phone booking, status changes, schedules and exceptions, account creation/provisioning/disable |
| Doctor | Own calendar/appointments, phone booking, statuses, rescheduling/cancellation, own working hours and time away |

FullCalendar Standard **6.1.20** remains bundled locally, with free day/week/month views, appointment cards, status colors, current-time indicator, availability backgrounds and validated/revertible drag rescheduling. No paid resource timeline is used. The list and slot-picker flows support keyboard operation without dragging. All existing visual design and role flows are retained; new account screens use the same style.

Password authentication uses ASP.NET Core's password hasher, database-backed opaque sessions, 2-hour expiry, sign-out revocation, account disabling and password-change revocation across instances. Five failed sign-ins lock an account for 15 minutes. Authentication endpoints have a 30 requests/minute/IP limit per API process. The browser has an encrypted HttpOnly SameSite cookie; API tokens are not placed in browser JavaScript or local storage. The API re-checks the live account and session on each request, and enforces role/ownership itself.

Registration always creates a **new patient**. It cannot claim an existing patient record by matching an email. Reception must verify identity and provision a sign-in linked to that profile through **Accounts & access**. In Development, every demo profile already has a demo account: use **Set sign-in credentials** on that account to convert it to password access. For a new normal patient/doctor, create an account and select exactly the matching profile. One sign-in is allowed per linked doctor/patient; administrators have no profile link.

Email verification, email password recovery, MFA, messages/reminders and external calendar synchronization are **not implemented**. No fake notifications are sent. Administrator credential provisioning is available locally until an identity verification/recovery policy is implemented.

## Development demo and persistence

In Development, `Demo:Enabled=true` is set by the development appsettings for both hosts. **Anyone with access to that mode can choose a demo identity, including an administrator.** Keep it local and use fictional data. Demo endpoints and issued demo sessions are rejected outside Development even if the flag is accidentally enabled.

The first startup of an empty Development database imports **40 source profiles**, six fictional patients, valid relative-date sample appointments, and demo accounts. The same PostgreSQL tables serve demo and password sessions; changing roles does not switch databases. Added demo patients get a selectable demo identity. Sample appointments are generated once and become historical over time.

In a fresh non-demo database only the workbook doctors/schedules and explicitly configured bootstrap administrator are seeded. Startup never overwrites operational data. Do not point a public deployment at a database that has been used with unrestricted demo administrator access.

Appointments, exceptions, hours, patients, account hashes, sessions, idempotency records and audit events all survive restarts. New page loads see current data immediately; open workspaces refresh on focus and every 20 seconds while idle. There is no SignalR push dependency. If the API/database is unavailable, the UI shows an error; it **never silently falls back to JSON**.

### Reset or preserve old phase-one data

There is **no browser reset for PostgreSQL**. For a disposable local Compose database only, stop both app hosts, back up anything you need, then run `docker compose down --volumes` followed by `docker compose up -d --wait`. This deletes all records in the local Careline database volume. Starting the Development API creates a fresh database schema and seed. Never use this operation for operational data.

The prior `%LOCALAPPDATA%\CarelineAppointments\demo-state.json` is untouched and is **not automatically imported**: its identities were unverified demonstration users. An audited, validated import is a separate migration if those examples need preserving.

The old standalone JSON demo is still available explicitly: set `Backend__Mode=Demo`, `Demo__Enabled=true`, run only `Appointments.Web` in Development. Its original reset button returns in that mode. It cannot be selected in Production and is not the default backend.

## Workbook interpretation and assumptions

The input was `Raspored_Doktori_Restrukturiran.xlsx`. All four sheets were inspected. The clean `Распоред_Доктори` sheet supplies the seed: **46 schedule rows → 40 profiles (38 named providers and 2 unnamed services) → 87 weekly working periods**. **25 profiles** have fully specified recurring hours; 15 do not. The categories and booking-method sheets provide vocabulary. The original-data sheet contains old/conflicting, flattened material and phone numbers: it was inspected for ambiguity but is **not** committed or used to guess additional schedules.

See [docs/WORKBOOK_ANALYSIS.md](docs/WORKBOOK_ANALYSIS.md) for detailed decisions and traceability. Important assumptions:

- **30 minutes** is a configurable initial duration per doctor because no duration column exists. It is not a clinical recommendation. Staff may change it to 10–120 minutes in five-minute increments. Each doctor's supplied working hours remain independent.
- No lunch breaks, holiday dates, locations or explicit date-specific exceptions are supplied. None are invented. Staff can model breaks with split weekly periods and holidays/time away with unavailable exceptions.
- Incomplete shift labels, on-call arrangements and once-monthly schedules do not create automatic slots. Add specific available periods through Availability after agreeing the demo time.
- Working-day ranges are inclusive; weekdays follow the clean sheet exactly. There are no default weekend hours.
- Confirmation-dependent bookings start **Scheduled / Awaiting confirmation** and reserve the time. Authorized staff explicitly confirm them. Secretary-only entries reject patient self-booking. Operational notification instructions remain visible notes, not fake notification integrations.
- For **Др. Филип Дума**, Wednesday is available only after the same week's remaining future Tuesday slots are full. This is an explicit interpretation of “Tuesday first.” Past Tuesday slots do not block future Wednesday booking. Existing Wednesday bookings are never invalidated if a Tuesday slot later opens.
- `Наведено во изворот` does not establish funding eligibility; it is shown as unspecified. Only explicit `Фонд` and `Само приватно` values are treated as specified.
- Appointments can be booked at most **180 days ahead**, on the doctor's configured slot grid, and cannot cross a working-period boundary.

## Scheduling and statuses

The service is authoritative. It checks working periods, exceptions, doctor and patient overlaps, duration, past times, ownership, and optimistic versions on every write. Cancelled visits release capacity; other states retain the original occupied interval. Repeat submissions use an idempotency key. Conflicting moves leave the original appointment intact. Schedule edits cannot invalidate existing future or ongoing visits.

| Current status | Allowed next state |
| --- | --- |
| Scheduled | Confirmed by staff before start; Cancelled before start |
| Confirmed | Cancelled before start; Completed or NoShow by staff after end |
| Completed / Cancelled / NoShow | Terminal; create a new appointment instead |

Rescheduling is allowed only before start for Scheduled/Confirmed appointments. Confirmation-dependent visits return to Scheduled after moving. Patients can cancel their own upcoming visits; secretary-only visits must be moved by staff. Staff cannot mark an unconfirmed past request completed; the application intentionally has no administrative override.

### Dates and time zones

`Scheduling:TimeZone` defaults to **Europe/Skopje**. C# uses `DateOnly`, `TimeOnly`, `TimeZoneInfo` and UTC `DateTimeOffset` instants. JSON request fields use ISO dates and 24-hour time. The frontend converts persisted instants into the configured zone using `Intl.DateTimeFormat`.

FullCalendar runs in a **wall-clock display adapter** using its UTC mode: the app sends offset-free **Skopje wall times**, and translates dragging back to a local date/time command. These calendar `Date` objects are presentation coordinates, never persisted instants. This avoids browser-location drift without requiring a timezone plugin. All actual timezone resolution happens in C#.

Nonexistent spring-forward times and ambiguous fall-back times are unavailable. Slots whose real duration differs from their wall-clock duration are excluded. The initial calendar is Monday-first and 24-hour. Change the timezone only with a fresh database or explicit data migration; a startup guard rejects a mismatch to prevent reinterpreting persisted schedules. Use a browser-supported IANA identifier.

## API, database and architecture

- [Architecture and transaction design](docs/ARCHITECTURE.md)
- [API routes, request examples and errors](docs/API.md)
- [Database operations, migration and backup guidance](docs/DATABASE.md)
- [Workbook analysis](docs/WORKBOOK_ANALYSIS.md)
- [Manual QA checklist](docs/QA_CHECKLIST.md)
- [Dependency licenses](THIRD_PARTY_NOTICES.md)

Development API schema: **http://localhost:5181/openapi/v1.json**. Liveness: `/health`; authenticated database readiness: `/health/database`. There is no Swagger UI package or external documentation service.

## Tests

```sh
dotnet build Appointments.sln -c Release
dotnet run --project tests/Appointments.Tests -c Release --no-build
python tests/http_smoke.py
npm ci --prefix tests/frontend --ignore-scripts --no-audit --no-fund
npm test --prefix tests/frontend
```

The dependency-free executable runner contains **56** domain/JSON tests, including scheduling boundaries, overlaps, permissions, versions, status transitions, exceptions and DST. **`dotnet test` does not execute it**. HTTP tests contain **36** checks and DOM tests **21** checks against the explicitly isolated legacy demo mode.

For the real backend, create a **new empty disposable** PostgreSQL database whose name contains `test` or `integration`, set `CARELINE_TEST_CONNECTION` to its connection string, and run:

```sh
python tests/api_integration.py --dom
```

This starts **two API processes and the MVC app**, applies the actual migration, exercises real password sessions and browser-to-API workflows, verifies persistence after API restart and races, and invokes **7 direct SQL constraint checks** that bypass application validation. It also repeats the 21 DOM checks against the PostgreSQL-backed application. It deliberately leaves fixture records in that disposable database; use a new database for every run.

GitHub Actions builds and runs the domain/legacy HTTP/DOM suites on **Windows and Ubuntu**, plus an **Ubuntu PostgreSQL 17 service** for the full backend suite. See the repository Actions tab for results on the delivered commit. Browser visual/mobile/pointer-drag QA and interactive Windows F5 setup remain manual; jsdom does not measure layout. The development environment cannot run a local PostgreSQL server, so database execution is verified in GitHub Actions rather than described as a local test.

## Scope and next development steps

This phase provides an actual connected backend, relational migrations, transactional scheduling and password access. It is still a development system, **not a certified production medical platform**. Before using real patient data, configure HTTPS/reverse proxy trust, separate migration/runtime database privileges, durable encrypted data-protection keys, encrypted backups with restore drills, centralized audit/monitoring, retention and incident procedures, email verification/recovery and MFA or a reviewed OIDC provider. Apply your jurisdiction's patient-data requirements. No clinical notes are collected.

Next priorities: complete browser/device QA; agree patient identity verification and onboarding; implement email verification/recovery or OIDC; add delivery-backed reminders via an outbox; replace full bootstrap appointment loading with windowed/paginated views for large clinics; add production deployment/backup automation and optionally real-time updates. Source entries without precise hours still require staff-defined availability; no holiday calendar, location or missing medical details are invented.

Official references: [Microsoft Visual Studio/.NET compatibility](https://learn.microsoft.com/en-us/dotnet/core/install/windows), [.NET support](https://dotnet.microsoft.com/en-us/platform/support/policy), [Npgsql EF provider](https://www.npgsql.org/efcore/), [PostgreSQL constraints](https://www.postgresql.org/docs/17/ddl-constraints.html).
