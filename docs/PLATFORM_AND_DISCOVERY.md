# Public discovery, automatic login and company onboarding

See [shared database setup](SHARED_DATABASE.md) for the current storage architecture.
Appointment rules and public/private application boundaries remain unchanged.

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

### Discovery search and motion

The main search matches part of a doctor's name, clinic name, specialty/subspecialty,
or active assigned service (OR across those fields). A new main search clears previous
refinements, including a clinic profile's scope, and starts at page 1. On the Clinics tab,
it searches clinic names. Search is case-insensitive and trims outer whitespace; it does
not transliterate Latin and Cyrillic or fuzzy-match spelling mistakes.

Optional clinic, specialty and service refinements work independently, or combine with
AND when more than one is supplied. All active criteria, including a clinic ID, have
visible removal chips. Removing a chip preserves the other criteria and resets page 1.
Pagination preserves criteria. These are ordinary GET forms/links and work without JS.
Public eligibility, private-data exclusions, pagination limits and booking permissions
remain unchanged.

Discovery has a scoped stylesheet and a small script for decorative motion only. Slow
SVG line tracing, softly drifting mint/lilac gradients and a floating care symbol have a pause button (remembered for the browser tab session),
respects reduced-motion preferences, and stays static without JavaScript. No external
assets, tracking, animation libraries or new production dependencies are required.

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

## Database layout and deployment

All clinics now share `ConnectionStrings:Appointments`, with isolated schemas in
that database. The platform database still holds company operators, platform
sessions and clinic registration metadata. Clinical data stays in the shared
clinical database. There is no database pool or per-clinic connection string.

Follow [shared database setup and deployment](SHARED_DATABASE.md), including the
explicit `--migrate` step and platform script **006** after **005**. Do not run
platform scripts in the clinical database. Preserve the Web's API URL and HTTPS
settings when publishing. The current single test clinic keeps its existing
`public` tables as `main`; adding a clinic creates a schema in that same database.

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

### Schema provisioning and recovery

The company screen registers clinics in the shared clinical database without a
finite pool, new database credentials or cluster administrator access. All API
instances must use the same clinical and platform connections.

Onboarding reserves a durable platform row (`Provisioning`), binds an empty clinic
schema with `CarelineProvisioning`, applies the clinical EF migrations and commits
Settings, the initial administrator and audit entry in one clinic transaction.
Only then does platform state become `Ready` and join discovery/auth routing.
The operation is resumable across the platform and shared clinic databases, not
a distributed atomic transaction.

If it fails, inspect logs and schema permissions, then retry **the same ID, metadata,
admin email/name and password**. Passwords are not stored in the platform registry.
Conflicting retries and nonempty unbound schemas are rejected. Provisioning never
deletes or resets a schema; existing credentials are not overwritten by retries.

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

## Discover visual refinement — 15 October 2026

The public directory retains Careline's mint, teal and violet palette. The hero
now uses a flowing SVG line with a traveling highlight, softly drifting gradients
and a floating care symbol instead of rotating orbit rings and floating text cards.
The three care steps stay still for reading. Search controls, segmented directory
tabs, result cards and profile links have lighter borders and refined spacing.
Arrow icons use inline SVG so they do not depend on system-font glyph support.

Motion remains optional: pause persists for the browser session, reduced-motion
preferences disable all decorative movement, and no-JavaScript rendering is static.
Existing GET search, filter chips, pagination and booking continuation are preserved.

Verified locally: Release build with zero warnings/errors, 39 MVC contract checks
and 30 real Chromium UI checks. Browser coverage includes moving line detection,
pause for every animated element, pause persistence, reduced motion, static no-JS
rendering, filters, empty results and navigation. The actual PostgreSQL-backed
38-doctor directory was also visually reviewed and checked for overflow at 1440,
768, 390 and 320 pixels. These are local results, not a new GitHub CI claim.

Deployment: pull main and publish **Appointments.Web** including `wwwroot`,
preserving server configuration. Refresh with Ctrl+F5. No API publication or SQL
script is required for this visual refinement.
