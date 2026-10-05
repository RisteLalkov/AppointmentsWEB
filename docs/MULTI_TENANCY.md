# Multiple clinics on one Careline deployment

## What is implemented

One published **Appointments.Web** and one **Appointments.Api** serve multiple
clinics. Every clinic has its own PostgreSQL database, accounts, patients, doctors,
catalogue, schedules, exceptions, appointments, history, audit events, sessions,
idempotency records and timezone setting. No clinical data is shared between
clinics. The same email address can have a separate account/password in each clinic.
Patient self-service remains available; registration can be disabled per clinic.

Users choose a clinic on the Macedonian login/registration page. The workspace and
account-management page show the active clinic. To change clinics, sign out and
sign into the other clinic. This is not a cross-clinic account or a global patient
record. A clinic administrator has no platform-administration privileges.

This is **database-per-tenant multi-tenancy**, not a separate Web/API installation
per customer. Databases may run on the same PostgreSQL server. Operator-managed
configuration is the clinic registry. There is no billing, automatic clinic
signup, platform-admin dashboard, cross-clinic reporting or custom-domain routing.

## Existing server: preserve the current clinic

Your PostgreSQL host is **10.20.1.102**, database **appointments**. Your IIS API/Web
remain on **10.20.1.100**, ports **5543/5544**.

1. Back up the database and the two published configurations. Pull `main` and build.
2. Ensure database scripts **001, 002 and 003** have already been applied. There is
   **no new schema migration or patient-data conversion for multi-tenancy**.
3. Publish both API and Web, including updated JS/CSS, keeping your connection
   string/password and IIS settings. Stop the sites while replacing files.
4. With your existing configuration (no `Tenancy:Clinics` array), the API adopts
   the existing database as clinic ID **`main`**. No existing IDs, accounts,
   passwords, schedules or appointments are changed. It adds a `ClinicId=main`
   row to the existing `Settings` table on startup. The API already needs access
   to `Settings` for initialization; if your runtime grants were narrowed, the
   owner can insert this binding before startup instead:

   ```sql
   INSERT INTO public."Settings" ("Key", "Value") VALUES ('ClinicId', 'main')
   ON CONFLICT ("Key") DO NOTHING;
   SELECT "Key", "Value" FROM public."Settings" WHERE "Key" = 'ClinicId';
   ```

   Expect `main`. Never overwrite a different binding to force a database to fit.
5. Optional API configuration to replace the initial display name:

   ```json
   "Tenancy": { "ClinicName": "Името на вашата клиника" }
   ```

6. Restart API then Web; refresh with Ctrl+F5 and **sign in again**. Sessions from
   the previous version are intentionally rejected because they lack clinic
   binding. Accounts/passwords remain valid. Old open forms require a refresh.
7. Verify existing appointments/history, book a test appointment and check the
   clinic name. No second database is necessary until you add another clinic.

## Add another clinic (operator only)

Create a **new, empty** database. Do not clone the original clinic database: it
contains that clinic's records and identity binding. Keep the original ID `main`
when switching from compatibility configuration to the explicit registry.

### 1. PostgreSQL in DBeaver

Connect to **10.20.1.102**, using the PostgreSQL administrator. On the `postgres`
database, run these statements individually with auto-commit enabled (`CREATE
DATABASE` cannot run inside a transaction). Replace the example password locally;
do not put real passwords in Git:

```sql
CREATE ROLE clinic_two_app LOGIN PASSWORD 'REPLACE_WITH_A_NEW_STRONG_PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE appointments_clinic_two OWNER clinic_two_app ENCODING 'UTF8';
REVOKE ALL ON DATABASE appointments_clinic_two FROM PUBLIC;
GRANT CONNECT ON DATABASE appointments_clinic_two TO clinic_two_app;
```

Also isolate connection privileges on the existing database, retaining all of your
explicitly authorized runtime/migration roles:

```sql
GRANT CONNECT ON DATABASE appointments TO careline_app;
REVOKE CONNECT ON DATABASE appointments FROM PUBLIC;
```

Use a different database login per clinic; never use a superuser as the API login.
The simple new-clinic example makes the clinic login its own database owner for
local setup. For tighter production privileges, use a separate migration owner
and grant the runtime login only schema USAGE, table SELECT/INSERT/UPDATE/DELETE,
and sequence USAGE/SELECT within that clinic's database. Reapply appropriate
runtime grants after migrations. Neither login needs access to another clinic DB.
Configure `pg_hba.conf` for the API host/new role using your existing connection
security policy. Do not broaden it to trust authentication.

### 2. API configuration

Merge this example into the API's server configuration; keep logging, hostnames,
HTTP/HTTPS settings and other required settings. Store connection/password values
in protected server configuration/environment variables. `appsettings` examples
below are placeholders, not working credentials.

```json
{
  "ConnectionStrings": {
    "Appointments": "Host=10.20.1.102;Port=5432;Database=appointments;Username=careline_app;Password=EXISTING_PASSWORD",
    "ClinicTwo": "Host=10.20.1.102;Port=5432;Database=appointments_clinic_two;Username=clinic_two_app;Password=NEW_PASSWORD"
  },
  "Tenancy": {
    "Clinics": [
      {
        "Id": "main",
        "Name": "Прва клиника",
        "ConnectionStringName": "Appointments",
        "TimeZone": "Europe/Skopje",
        "Enabled": true,
        "AllowRegistration": true,
        "ImportSourceDoctors": false,
        "SeedDemoData": false
      },
      {
        "Id": "clinic-two",
        "Name": "Втора клиника",
        "ConnectionStringName": "ClinicTwo",
        "TimeZone": "Europe/Skopje",
        "Enabled": true,
        "AllowRegistration": true,
        "ImportSourceDoctors": false,
        "SeedDemoData": false,
        "BootstrapEmail": "reception@your-second-clinic.example",
        "BootstrapPassword": "SET_LOCALLY_AT_LEAST_12_CHARACTERS"
      }
    ]
  },
  "Demo": { "Enabled": false },
  "Database": { "ApplyMigrations": false }
}
```

Clinic IDs are permanent lowercase slugs (letters, numbers, hyphens, 1–40 chars).
Display names can change. Timezone is fixed after initialization: changing it
requires a deliberate schedule/data migration, as before. Each clinic's registration
flag affects only self-registration; staff can still create patient accounts.
`ImportSourceDoctors` defaults to false for explicit clinics. Do not turn it on for
another real clinic: the workbook belongs to the original project. `SeedDemoData`
is additionally gated by Development and `Demo:Enabled`; production demo login is
always disabled. Shared top-level `Bootstrap` applies only in legacy single-clinic
mode; explicit clinics use their own bootstrap settings.

### 3. Initialize and onboard

In DBeaver connected to the **new** database, execute whole scripts **001 → 002 →
003** in order, with the migration owner. Apply runtime table/sequence grants if
using a separate owner. Restarting the API then records its clinic binding/timezone
and creates the bootstrap administrator. Alternatively, from the **published API
folder**, with the above configuration and a migration-capable database login:

```powershell
dotnet Appointments.Api.dll --migrate --clinic clinic-two
```

For a self-contained publish use `./Appointments.Api.exe --migrate --clinic clinic-two`.
`--migrate` alone applies pending migrations to all enabled clinics. The API must
be stopped for a controlled migration; take per-clinic backups first. Production
never automatically applies schema migrations. Migrations use the same code and
migration history in each database.

Remove `BootstrapPassword` after the first successful initialization. Sign in to
the new clinic and use **Каталог** to add specialties, doctors and services; use
**Достапност** for schedules; create patients and accounts as needed. An empty
clinic shows empty states and cannot book until configured. No real doctor hours
or patients are invented.

The Web still points to the same API URL and needs no per-clinic connection strings.
Restart all API instances together after changing the registry. Set `Enabled=false`
to disable a clinic: it disappears from the directory and requests, including
existing sessions, are refused after restart. This preserves its database. If you
want to revoke all its tokens permanently before re-enabling, its database owner
can delete rows from its `Sessions` table during the maintenance window.

## Isolation and operational boundaries

- API resolves `X-Clinic` from the operator's registry before creating a scoped
  DbContext/clock or authenticating. Unknown/disabled clinics never fall back.
  With multiple configured clinics the header is required. Exactly one enabled
  configured clinic supports missing-header compatibility for old API clients.
- The database's `Settings.ClinicId` must match the selected clinic. Startup checks
  it and every tenant API request verifies it, protecting against configuration
  aliases and accidentally restoring the wrong clinic's backup. Duplicate
  connection targets are rejected at startup as an additional check.
- Bearer tokens are clinic-bound and hashed in that clinic's database. A token
  cannot select another clinic or be moved by editing its prefix. Existing role
  checks run inside the selected database; all existing endpoints are isolated,
  including raw SQL, history, audits, account administration and reports.
- Web routes authenticated requests using the protected cookie's clinic claim,
  never a browser-supplied connection string or override header. AJAX requests
  echo the page's clinic and are rejected after a switch in another tab. Form
  anti-forgery tokens also carry the clinic binding, even if IDs coincide.
- Authentication/bootstrap responses include public clinic metadata. The anonymous
  `/api/clinics` endpoint lists enabled clinic IDs, names, timezones and registration
  policies; these names are intentionally public on the login page. No database
  names, addresses, credentials or patient information are exposed by it.
- Configuration is snapshotted at startup; there is no partially applied hot
  switching. A startup validation/database failure prevents that API instance
  starting. After startup a database outage returns an error for that clinic;
  it never switches to another DB or to demo data. Health `/health` is liveness,
  `/health/database` is authenticated and clinic-specific.
- JSON `Backend:Mode=Demo` remains an isolated **single-clinic development sandbox**.
  Multi-clinic operation requires the API/PostgreSQL backend.
- Infrastructure administrators can access databases/backups according to their
  server privileges. This design is not a claim of medical/regulatory certification.
  Use HTTPS, least-privilege grants, protected configuration and per-clinic backups
  for production. DB/schema migrations and backup restore remain operator work.

## Verification

`tests/tenancy_integration.py` creates three disposable databases with distinct
non-superuser PostgreSQL roles and exercises a shared Web plus two API instances.
It checks legacy adoption, empty-clinic onboarding, same-email independence,
clinic-specific sessions/registration/timezone, cross-clinic reads and writes,
booking/idempotency, history, schedules, accounts/audits/reports, concurrent scopes,
stale tabs/forms, disabled clinics, duplicate routing and DB identity mismatches.
`tests/frontend/tenancy.mjs` checks all empty-clinic pages through the actual MVC/API.
The fixture also verifies a clinic role cannot connect to another clinic database.
GitHub Actions runs these alongside the existing business/HTTP/DOM/SQL suites.
DOM checks do not assert visual layout; manually check desktop/mobile rendering.

Implementation references: [EF Core database-per-tenant guidance](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy)
and [ASP.NET Core additional anti-forgery data](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery).
