# One clinic database for every clinic

Careline now uses **one PostgreSQL database for all clinic data** and an optional,
separate platform database for company operators and clinic registration.
Adding a clinic never creates a database, database role or connection string.

## Layout

| Database | Schema | Contents |
|---|---|---|
| `appointments` | `public` | Existing `main` clinic (Моја Клиника) |
| `appointments` | `clinic_<clinic_id>` | Each other clinic's tables and migration history |
| `appointments` | `careline_extensions` | Shared PostgreSQL `btree_gist` extension, no clinic tables |
| `appointments_platform` | `public` | Company operators, platform sessions, clinic registration metadata |

This is schema-per-tenant multi-tenancy inside **one database**, rather than shared
rows in one set of tables. Doctors, patients, accounts, bookings, schedules,
services, history, reports, audit, settings, sessions and idempotency all remain
clinic-local. Identical doctor/patient IDs and appointment times can exist in two
clinics without conflicts. Login emails remain globally unique through the existing
coordinated identity checks; an account still belongs to one clinic.

`main` keeps its existing tables and records in `public`; no data copy or reset is
needed for the current single-clinic test installation. Other schemas are named
from immutable lowercase clinic IDs: `north-clinic` becomes `clinic_north_clinic`.
Underscores are forbidden in clinic IDs, so this mapping cannot collide.

Every tenant connection is generated from `ConnectionStrings:Appointments`.
The server sets its search path to that clinic's schema and `careline_extensions`.
**It does not include `public` for other clinics.** Each request verifies the fully
qualified `Settings.ClinicId` binding before authentication/data access. A missing
schema or table fails instead of falling back to the main clinic. Npgsql connection
pools are separated by connection string/search path. API bearer sessions, MVC
cookies, stale-tab guards and clinic-bound antiforgery tokens remain enforced.

The API's database login is trusted to access the tenant schemas. These are not
separate database users/security sandboxes: an infrastructure administrator or
arbitrary SQL executed with that login can access multiple schemas. Browser users
have no database credentials or SQL access. Back up the complete shared database;
a database outage affects all clinics. Schema-aware export/restore requires operator
care with extension dependencies and the clinic binding.

## Update the existing test deployment

There is only one existing test clinic, so no consolidation tooling is needed.
These instructions update it in place. No change has been applied to the IIS or
PostgreSQL machines by this development task.

1. Build `dotnet build Appointments.sln -c Release`, then publish API and Web as
   usual. Stop all API instances while replacing files and preparing the database.
2. Keep the API's existing `ConnectionStrings:Appointments` pointing to
   `appointments` and the Web's working `Backend:ApiBaseUrl`. Keep the clinic ID
   `main`. Remove `Platform:ClinicPool` and any unused `ClinicPoolXX` connections.
   All explicit `Tenancy:Clinics` entries now use `Appointments`; new entries need
   no `ConnectionStringName` at all.
3. In DBeaver connected to **appointments**, as the PostgreSQL administrator,
   execute the **whole** `database/prepare-shared-clinic-database.sql` script
   (Ctrl+A, Alt+X). It moves the existing extension into `careline_extensions`
   without changing clinic records and can be rerun safely. This administrator
   step is needed because trusted extension types can belong to PostgreSQL's
   bootstrap superuser even when the application owns the extension itself.
4. If company onboarding is used, keep/create the separate platform database and
   its `ConnectionStrings:Platform`. From the **published API folder**, with its
   effective private configuration and a migration-capable database login, run:

   ```powershell
   dotnet Appointments.Api.dll --migrate
   ```

   This applies clinical migrations to each enabled clinic schema, prepares
   `careline_extensions`, and applies platform scripts 005 and **006** when the
   platform is configured. The administrator script in step 3 relocates the
   existing extension; foreign keys/exclusion constraints retain their references.
   Clinical records and passwords are not reset. Production startup does not
   automatically migrate; `Database:ApplyMigrations=false` remains appropriate.
5. Start API then Web, sign in, and check existing appointments. Visit
   `/Platform/Login` with the company operator account and add a second test
   clinic. It starts empty in `appointments.clinic_<id>`; configure its catalogue,
   hours and patients through the existing screens. No new database is needed.
6. Confirm that both clinics can log in and see only their own data; check doctor
   search across clinics and book a test appointment in each.

The migration login needs schema creation and table migration permissions and
administrator preparation of an existing `btree_gist` extension as described above.
With separate runtime and migration roles, grant runtime schema USAGE, table DML and sequence access in
all clinic schemas. Company onboarding itself performs schema DDL; its configured
clinic connection needs those permissions if onboarding is enabled. No superuser,
CREATEDB or CREATEROLE permission is needed by the application.

Script `database/006-shared-clinic-registry.sql` belongs **only in the platform
DB**, after 005; it allows multiple registration rows to reference `Appointments`.
Do not execute it in the clinical database. `--migrate` runs both scripts in the
correct destination. Existing managed rows with an old pool `ConnectionName` fail
closed rather than silently being redirected to an empty schema. The current
single-clinic test installation has no such rows; a real multi-database installation
would need an explicit data migration before changing those bindings.

## Configuration

Only two connections are needed when company onboarding is enabled. Store their
actual passwords in protected server configuration, never in the repository:

```json
{
  "ConnectionStrings": {
    "Appointments": "Host=DB_HOST;Database=appointments;Username=clinic_owner;Password=SET_PRIVATELY",
    "Platform": "Host=DB_HOST;Database=appointments_platform;Username=platform_owner;Password=SET_PRIVATELY"
  },
  "Tenancy": { "ClinicName": "Моја Клиника" },
  "Demo": { "Enabled": false },
  "Database": { "ApplyMigrations": false }
}
```

The platform connection is optional for operator-configured clinics and login.
Bootstrap a first company operator using private `Platform:Bootstrap:Email` and
`Platform:Bootstrap:Password` (at least 12 characters), then remove those settings.
Existing operators are never overwritten. If configuring clinics manually, keep
`main` as an explicit entry when adding another:

```json
"Tenancy": {
  "Clinics": [
    { "Id": "main", "Name": "Моја Клиника", "TimeZone": "Europe/Skopje" },
    { "Id": "north", "Name": "Северна Клиника", "TimeZone": "Europe/Skopje" }
  ]
}
```

For a manually configured new clinic supply its private `BootstrapEmail` and
`BootstrapPassword`, then run `--migrate --clinic north`. Its catalogue/patients
start empty unless explicit development seeding is enabled. Remove bootstrap
passwords after verifying access. Renaming a clinic ID is not a display-name edit:
IDs determine schema/session identity and must stay permanent.

## Tests

Build Release and install `tests/frontend` dependencies with `npm ci`. Set
`CARELINE_TEST_CONNECTION` to a disposable database whose name includes `test` or
`integration`, then run:

```sh
python tests/api_integration.py --dom
python tests/tenancy_integration.py
python tests/platform_integration.py
```

The tenancy suite uses three schemas in one clinic database, two API instances,
and MVC. It covers overlapping IDs/slots, requests, reports, history, contacts,
sessions, stale tabs/forms, mixed concurrent requests, schema bindings and missing
table fallback. The platform suite uses one shared clinical database plus a
separate platform DB and proves additional clinics provision without a database
pool and survive restart. Fixture creation/removal needs CREATEDB/CREATEROLE on
the disposable test server; the API fixture roles themselves have neither.

## Original clinic managed through the platform

The original `main` clinic can now be deliberately adopted from `/Platform` without
moving its `public` schema or changing accounts. Platform migration 007 adds the
adoption marker and clinic-metadata version. See the deployment and one-time steps
in [PLATFORM_CLINIC_TRANSFER.md](PLATFORM_CLINIC_TRANSFER.md). Routine details then
come from the platform row and are editable in the Web interface; duplicate IDs
without explicit adoption remain invalid.
