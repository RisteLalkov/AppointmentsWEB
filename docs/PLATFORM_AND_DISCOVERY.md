# Public discovery, automatic login and company onboarding

This change is based on main commit `dcbe0f78d99b921e2f08939a9f35e18190e229fc`.
It preserves existing clinical database schemas and appointment rules. No live database
was changed during development. Read the verification report before deployment.

## What users see

| Location | Purpose | Access |
|---|---|---|
| `/` | Anonymous visitors enter the public directory; signed-in clinic users retain their workspace | Public |
| `/Discover` | Landing page and paginated doctor search by name, clinic name, specialty and service | Public |
| `/Discover?view=clinics` | Searchable clinic directory | Public |
| `/Discover/Clinic/{id}` | Clinic public description/contact details and its doctors | Public |
| `/Discover/Doctor/{id}?clinicId=…` | Doctor specialty, subspecialty, active services and booking action | Public |
| `/Account/Login` | Email and password; clinic resolved by API | Public sign-in |
| `/Account/Register` | Patient registration for a selected clinic that permits registration | Public form |
| `/Workspace` | Existing appointment, patient, doctor, calendar and reporting workflows | Clinic session |
| `/Platform/Login` | Separate company operator sign-in | Public sign-in, no public onboarding |
| `/Platform` | Company clinic list, onboarding and company password change | Platform operator only |

The public directory does not fabricate reviews, hours, ratings, location or availability.
Optional clinic details appear only when configured. Source spreadsheet notes, patient
records, account fields, schedules/exceptions and appointment records are not public DTOs.
Doctor profiles marked reception-only direct visitors to reception. Available slots are
still computed by the existing protected scheduling service after login.

Choosing a doctor retains the doctor ID and clinic in a local return URL through login
or registration. MVC rejects external return URLs. After login, the server checks the
session's clinic before opening the existing booking dialog. A patient account still
belongs to **one clinic**: an account for clinic A does not acquire access to clinic B.
A cross-clinic attempt receives an explanation and does not switch the workspace.
Registration in another clinic requires a different, globally unique sign-in email;
shared cross-clinic patient identities are not introduced by this change.

In the workspace, **Достапност** is reached through **Список на лекари → Достапност и
работно време**. The existing `#availability` route remains usable. Doctors see their own
entry. **Шифрарници** has a keyboard/touch-operated native expandable menu with direct
`#catalogue/doctors`, `#catalogue/specialties` and `#catalogue/services` routes. Existing
catalogue tabs and API operations are reused. Shared teal, mint and violet tokens provide
the slightly stronger accents; no dashboard layout rewrite was made.

## Database layout and why it stays separate

Each clinic retains its own PostgreSQL database and database role. Existing clinics
remain configured using `Tenancy:Clinics` or the legacy `ConnectionStrings:Appointments`.
A new optional **platform database** contains only:

- `PlatformOperators`: company identities and password hashes, enabled flag, lockout counters.
- `PlatformSessions`: hashes of opaque company tokens, operator link and expiry.
- `PlatformClinics`: provisioning state, public metadata, first-admin email/name, creator,
  and a **configuration connection name**, never a connection password.
- `PlatformSchemaVersions`: applied version of the separate platform SQL migration.

Clinical data never moves to this database. The initial admin is written into the new
clinic's existing `Accounts` table. A `CarelineProvisioning` marker inside newly provisioned
clinic databases binds a provisioning attempt to its clinic ID. Existing clinical
`Settings.ClinicId` remains the authoritative runtime database binding.

Platform schema evolution deliberately uses the separate, versioned, repeatable
`database/005-platform-registry.sql`; it is **not** an EF migration for clinic databases.
Do not run it against `appointments`. Existing clinic schemas need no new migration for
these six features. A fresh pool database receives the existing clinical EF migrations
001–004 during provisioning, including the overlap constraints and history/profile schema.

## Safe deployment sequence

1. Back up existing clinic databases and host configurations. Resolve duplicate login
   emails as described below. Test this update on an isolated copy first.
2. Stop **all API instances** while enabling this version or changing the identity lock
   coordinator. Do not run old and new account-writing APIs side by side.
3. In DBeaver, connected to the intended PostgreSQL host, create a new database such as
   `appointments_platform` with its own owner/login role. Also prepare one or more
   **empty databases**, each with its own owner/login role, for future clinics.
   These roles must not be superusers and need no CREATEDB or CREATEROLE permissions.
   Do not reuse `appointments`, another clinic DB, or the platform DB as a pool entry.
4. Open a SQL editor explicitly attached to `appointments_platform`. Execute the entire
   `database/005-platform-registry.sql` script. It refuses known clinical schemas and
   records version 1. Keep the existing clinic database and its rows unchanged.
5. Add the settings below to the **API's effective private configuration**, preserving
   existing connection strings and tenancy configuration. Environment variables/secrets
   are preferred for passwords. Never commit populated connection strings.
6. Start the API. First-run platform bootstrap creates an operator only if there are
   **no platform operators**. Remove the bootstrap email/password settings after verifying
   sign-in. They do not reset an existing account's password on restart.
7. Publish the matching Web build and preserve its actual API URL and production HTTPS
   settings. No platform database connection belongs in Web configuration.
8. Visit `/Platform/Login`, sign in with the company credentials, and onboard a test clinic.
   Deliver that clinic's unique initial administrator password through a secure channel.
   Ask the administrator to use **Промени лозинка** at first sign-in. There is no email
   activation, automatic password delivery or forced first-login reset in this version.
9. Verify public search, credentials-only login and cross-clinic denial, then the existing
   booking workflows. Run the real PostgreSQL integration suites before production rollout.

Example **API additions** (merge, do not replace your whole configuration):

```json
{
  "ConnectionStrings": {
    "Platform": "Host=YOUR_DB_HOST;Port=5432;Database=appointments_platform;Username=platform_owner;Password=SET_PRIVATELY",
    "ClinicPool01": "Host=YOUR_DB_HOST;Port=5432;Database=appointments_pool_01;Username=clinic_pool_01_owner;Password=SET_PRIVATELY"
  },
  "Platform": {
    "ClinicPool": ["ClinicPool01"],
    "Bootstrap": {
      "Email": "YOUR_COMPANY_OPERATOR_EMAIL",
      "Password": "SET_A_UNIQUE_PRIVATE_PASSWORD_OF_AT_LEAST_12_CHARACTERS"
    }
  }
}
```

The database host is wherever your PostgreSQL databases actually run; it need not be the
IIS host. For your reported topology, PostgreSQL moved to `10.20.1.102`; use the actual
current database host in all three kinds of connection strings. API/Web ports remain
independent. Preserve the Web's working `Backend:ApiBaseUrl`; don't use a database port there.

Pool roles need schema-creation/migration permissions in **their own database**, including
installation of the existing `btree_gist` extension where permitted. Ask the PostgreSQL
operator to prepare that extension if local policy prevents its installation. The API
holds these restricted per-database migration credentials for onboarding; it never receives
cluster administrator credentials. Separating migration and runtime roles further is an
operational hardening task, not something this change silently implements.

If you already use `dotnet Appointments.Api.dll --migrate`, that maintenance command also
applies the platform SQL when the platform connection is configured. In production,
`Database:ApplyMigrations=false` remains appropriate: explicit maintenance or the DBeaver
step above initializes the platform schema. Pool initialization is the explicitly requested
company onboarding operation and applies clinical migrations only to the reserved pool DB.

### Existing clinic public metadata

For a legacy single clinic, optional API settings are:

```json
{
  "Tenancy": {
    "ClinicName": "Your actual clinic name",
    "Discoverable": true,
    "Description": "Only a real, approved public description",
    "Address": "Only the actual public address",
    "Phone": "Only the actual public telephone"
  }
}
```

For configured multi-clinic entries put `Discoverable`, `Description`, `Address`, and
`Phone` inside the corresponding `Tenancy:Clinics` item. Enabled existing clinics default
to discoverable; explicitly set `Discoverable=false` before enabling public access if
publication is not approved. Hidden clinics can still authenticate their own users.
Company-created clinics choose discovery and registration policies during onboarding.
Editing those managed metadata/policy values later has no dedicated screen yet; it is an
operator-controlled registry/configuration task. No billing/subscription features are added.

### Database pool and recovery

The company screen assigns the next unused connection from `Platform:ClinicPool`; it does
not ask the company user to enter server passwords. Add more empty databases and private
connection entries when the pool is exhausted, retaining existing connection entries.
All API instances must have identical registry and pool configuration.

Onboarding reserves a durable row (`Provisioning`), binds an empty pool DB, migrates it,
then commits Settings + initial administrator + audit entry in one clinic transaction.
Only after that commit does the platform state become `Ready` and join public/auth routing.
This is a resumable operation across two databases, **not a distributed atomic transaction**.

If it fails or times out, `Failed`/`Provisioning` is never published as a usable clinic.
Check logs and the pool database. Retry **the same ID, metadata, admin email/name and password**.
The password is never stored in the platform registry. A repeated successful request returns
the existing clinic without changing credentials. A conflicting retry is rejected. A
nonempty unbound database is rejected without migration/reset/deletion. Never delete real
clinic data to repair a failed onboarding attempt; correct the connection or permissions
and retry. If provisioning committed the clinical transaction, keep its assigned database
and retry with the original credentials. Company screens retain nonsecret fields on errors.

## Credentials-only login and existing duplicates

`AutomaticLogin` normalizes the email and searches account IDs server-side across all
configured/ready clinics. Exactly one match is required; its clinic must be enabled.
The existing account service then verifies the password, account state, lockout and session.
`X-Clinic` and a browser clinic hint cannot choose the login account. Login failures are
generic; they don't list matching clinics. Disabled accounts/clinics still reserve emails,
so re-enabling one cannot accidentally redirect another user's identity.

Because the old model allowed the same login email in different clinic databases, this
is a deliberate **migration requirement**, not an automatic account merge. If more than
one account uses an email, neither password chooses a tenant: login fails safely until
an authorized operator resolves the ambiguity. Existing valid clinical sessions still
work and can be used to update account credentials through the normal admin screen.

Before rollout, run this **read-only** query in every clinic database, keeping the results
private. Compare the `NormalizedEmail` values across databases, including disabled accounts:

```sql
SELECT "Id", "Email", "NormalizedEmail", "Role", "Enabled"
FROM "Accounts"
WHERE "IsDemo" = false
ORDER BY "NormalizedEmail";
```

Demo accounts with empty password hashes are not intended for normal login, but also reserve
an email. If a real login collides with a demo email, resolve that collision too. For a full
inventory remove the `WHERE` clause. Failed/provisioning platform rows reserve `AdminEmail`.

Agree on a distinct real sign-in email for each clinical account. Prefer the existing
administrator **credentials** action while an authorized session is available. It updates
the login, rehashes the supplied new password and revokes sessions without changing the
patient record. If every admin is blocked, an authorized database operator can, during the
maintenance window, update **only** the selected account's `Email` and `NormalizedEmail`
to the agreed unique lowercase trimmed email and revoke that account's `Sessions` rows in
a transaction. Confirm the account ID and clinic first, and preserve its password hash,
role and patient/doctor link. Do not merge patients or copy password hashes between clinics.
Restart all API instances together after completing the migration checks.

All new registration/admin creation/email changes and onboarding use one PostgreSQL
advisory transaction lock while checking global uniqueness. With a platform database it
is the coordinator; otherwise it is the configured clinic with the ordinally first ID.
Changing this coordinator requires stopping all hosts together. Direct SQL edits and old
API versions cannot participate in this application lock: use controlled maintenance.

This implementation favors safe resolution over scale: account lookup queries every clinic,
and a down/uninitialized clinic database causes login/identity writes to fail closed. An
existing configured disabled clinic must therefore retain a reachable migrated database.
For a large fleet, a centrally indexed identity directory with a planned migration would
be the next optimization. No patient or account bulk list is sent to the browser.

## Security and request boundaries

- Clinical opaque tokens remain `c1.<clinic>.<random>` and are validated against that
  clinic's database, account, expiry and database binding on protected requests.
- Company opaque tokens use `p1.<random>`, a separate table, authentication scheme,
  policy and Web cookie. A clinical Administrator cannot onboard tenants. A company
  token is not a clinical session and cannot read clinical data through clinical APIs.
- Both kinds of passwords use the existing ASP.NET PasswordHasher configuration; no
  plaintext password is persisted. Tokens are stored hashed in their databases.
- Company login uses five failed attempts / 15-minute lockout and two-hour sessions.
  Password changes revoke company sessions; logout revokes the current token.
- MVC POSTs retain global antiforgery validation. Company HTML never echoes submitted
  passwords. Clinical forms retain the clinic-bound CSRF/stale-tab checks.
- Public query lengths, page 1–100 and page size 1–24 are validated. Doctor/service filters
  are executed on the server and database, not by downloading all patients/doctors.
- Public API rate limiting is 90 requests/minute per source IP; auth retains 30/minute.
  Behind Web's server-side proxy, clients share the Web server's API source IP; tune a
  trusted reverse-proxy/rate-limit design for real traffic before high-volume rollout.
- HTTPS, restricted database roles, private connection secrets and existing production
  deployment protections remain required. HTTP testing switches are not production security.

## File map

| Area | Important files |
|---|---|
| Public DTOs and validation | `src/Appointments.Contracts/Discovery.cs` |
| Separate platform data model | `src/Appointments.Data/PlatformDbContext.cs` |
| Platform migration | `database/005-platform-registry.sql` |
| Clinic registry/routing | `src/Appointments.Api/Services/ClinicRegistry.cs`, API `Program.cs` |
| Global identity/lock | API `Services/ClinicConnections.cs`, `AutomaticLogin.cs`, `AccountService.cs` |
| Public database projections | API `Services/PublicDiscovery.cs`, `Controllers/DiscoveryController.cs` |
| Company provisioning/auth | API `Services/PlatformService.cs`, `PlatformAuthentication.cs`, `Controllers/PlatformController.cs` |
| MVC public screens | Web `Controllers/DiscoverController.cs`, `Views/Discover/`, `Views/Shared/_PublicHeader.cshtml` |
| Login and continuation | Web `Controllers/AccountController.cs`, `HomeController.cs`, `Views/Account/`, `wwwroot/js/app.js` |
| MVC company screens | Web `Controllers/PlatformController.cs`, `Views/Platform/`, `wwwroot/js/platform.js` |
| Authentication forwarding | Web `Program.cs`, `Services/ApiClient.cs` |
| Sidebar and colors | Web `Views/Home/Workspace.cshtml`, `wwwroot/js/app.js`, `wwwroot/css/site.css` |
| Tests | `tests/discovery_web_smoke.py`, `tests/platform_integration.py`, updated HTTP/DOM/tenancy suites |

## Tests to run before release

```powershell
dotnet build Appointments.sln -c Release
dotnet run --project tests/Appointments.Tests -c Release --no-build
python tests/http_smoke.py
python tests/discovery_web_smoke.py
npm ci --prefix tests/frontend --ignore-scripts --no-audit --no-fund
npm test --prefix tests/frontend
```

With a **disposable** PostgreSQL test server and a test runner role permitted to create
and remove its own test databases/roles, set `CARELINE_TEST_CONNECTION` to a database name
containing `test` or `integration`, then run:

```powershell
python tests/api_integration.py --dom
python tests/tenancy_integration.py
python tests/platform_integration.py
```

Never use live clinic connections for these suites. The platform suite checks two API
instances, public projections/pagination/filtering, unauthorized access, safe failed
provisioning and retry, new admin routing, duplicate identities, private data isolation,
publication eligibility and company session revocation. The Web smoke test uses an API
**stub** and cannot substitute for those PostgreSQL/security integration checks.

### Optional real Chromium checks

For the public/company pages and the JSON demo workspace, install optional Playwright test tooling:

```powershell
npm install --prefix tests/frontend --no-save --package-lock=false playwright
# Use a separately installed Playwright Chromium executable:
$env:TEST_BROWSER_EXECUTABLE = "C:\path\to\chrome.exe"
python tests/discovery_web_smoke.py
```

With `TEST_BROWSER_EXECUTABLE` set, the Web suite runs `tests/frontend/discovery-browser.cjs`
against its temporary stub API and a temporary JSON demo host. It checks desktop/mobile
widths, keyboard/touch submenu access, selected-doctor continuation and sidebar access.
It does not contact your published server and does not validate PostgreSQL provisioning.
