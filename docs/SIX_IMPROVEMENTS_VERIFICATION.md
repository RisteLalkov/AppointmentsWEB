# Six improvements — implementation and verification

Date: 14 October 2026. Base: main `dcbe0f78d99b921e2f08939a9f35e18190e229fc`.
The initial implementation and validation were completed locally. Source publication
was subsequently authorized by the owner. Publishing code does not deploy the application
or apply database migrations; no live database changes were performed.

## Implemented

1. Macedonian public landing, clinic/doctor directories and profiles, filters and server
   pagination. Explicit safe public DTOs and eligibility checks. Selected-doctor booking
   resumes through login/registration with local-URL and clinic-membership checks.
2. Credentials-only login with server-side tenant resolution and generic ambiguous-login
   rejection; new identity writes enforce globally unique emails under a distributed lock.
3. Separate company role, cookies, opaque sessions, password/lockout handling, clinic list,
   and resumable provisioning into operator-prepared isolated database slots. Added the
   separate versioned platform SQL and secure first-operator bootstrap.
4. Availability moved into the doctor list; existing routes/rules retained.
5. Шифрарници expandable submenu with direct doctors/specialties/services routes.
6. Shared palette refresh, responsive public/company pages and preserved workspace design.

## Actually executed

| Check | Result | Scope |
|---|---|---|
| Release solution build, .NET SDK 10.0.100, Linux | Passed, 0 warnings / 0 errors | All seven solution projects, including Razor and database test helper |
| Core test executable | 76/76 passed | Scheduling, conflicts, statuses, exceptions, history, patient profiles, JSON persistence and existing business rules |
| Existing MVC HTTP suite | 38/38 passed | JSON demo workflows, role restrictions, CSRF, booking, rescheduling/cancellation and shared data |
| Existing DOM suite | 66/66 passed | JSON demo UI workflows plus moved availability and direct submenu navigation |
| New `discovery_web_smoke.py` | 28/28 passed | Real MVC process with deterministic stub API: public pages/filters, return URLs, registration continuation, cookie separation and CSRF, onboarding form validation/error behavior |
| New optional Chromium UI checks | 18/18 passed | Chromium 151; public/company pages via stub API, workspace via JSON demo; desktop/tablet/mobile widths, mouse/keyboard/touch navigation, automatic booking dialog, reachable sidebar logout |
| Visual screenshot review | Completed | Public desktop/mobile, company desktop/mobile, availability desktop and mobile sidebar; adjusted cramped company mobile fields to one column |
| JS and Python syntax; `git diff --check` | Passed | Modified/new scripts and whitespace checks |

Build used `-m:1 -nr:false -p:UseSharedCompilation=false` to avoid this environment's
cross-process compiler limitations. Normal Visual Studio builds do not need those flags.
Browser tests used fixture content, not private patient data. No new application package
or paid dependency is required. Playwright is optional test tooling only.

## Not executed here — required before production rollout

A usable PostgreSQL test server was unavailable. This execution environment maps only
UID 0 and could not install/start a normal PostgreSQL service. Therefore:

- Real PostgreSQL API/database suites were **not run** for this update.
- `tests/platform_integration.py` was added and syntax checked, but its real migrations,
  provisioning/retry, two-instance identity locks, database-backed role/token isolation,
  duplicate-email handling and public SQL projections remain **unverified at runtime**.
- Existing PostgreSQL API and multi-tenant integration suites were updated where needed,
  but also require execution on a disposable PostgreSQL server.
- The workflow file includes the new checks. The results above are local results; consult
  the GitHub Actions run for the published commit for remote PostgreSQL/Windows results.
- Windows/IIS publishing, the actual server configuration and real-data migration were
  not tested in this environment. No live server was contacted.

The Web stub tests and JSON tests do **not** prove database-backed onboarding or security
correctness. Run all three PostgreSQL suites and a staging deployment before release.

## Deliberate constraints

- Existing duplicate sign-in emails require operator resolution; no account/patient merge.
- Patient accounts remain clinic-specific; no shared cross-clinic patient membership.
- Account resolution scans all clinics and fails closed if a clinic DB is unavailable.
- Company onboarding needs a separate platform DB and pre-created empty clinic databases;
  it does not grant the application cluster-level CREATE DATABASE/ROLE privileges.
- Initial passwords are handed over securely by the company; no activation email or
  forced first-login password reset. Existing password-change functionality is available.
- Managed-clinic metadata editing, billing, notifications, MFA/OIDC and password recovery
  remain outside this change. Platform bootstrap creates the first operator only.
- Public discovery/auth rate limits are per API source IP. A Web proxy shares that budget;
  production rate-limit/proxy configuration needs traffic-specific review.

Configuration, migration, file map and exact test commands:
[PLATFORM_AND_DISCOVERY.md](PLATFORM_AND_DISCOVERY.md).
