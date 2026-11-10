# Shared patient account verification — 10 November 2026

The change implements one personal patient login across clinic schemas, while
doctor/receptionist accounts and clinical records remain clinic-local. Deployment
and user-facing behavior are described in [the account guide](GLOBAL_PATIENT_ACCOUNTS.md).

## Executed checks

| Check | Result |
| --- | --- |
| Release solution build | Passed; 0 warnings, 0 errors |
| Complete API and Web publish | Passed; SQL 008/009 and existing database scripts present in API output |
| EF `has-pending-model-changes`, AppointmentsDbContext | No pending model changes |
| Shared English/browser catalogue | 1,087 messages; generated copy matches |
| Core scheduling/persistence/localization | 95/95 |
| MVC HTTP smoke | 38/38 |
| Discovery/company MVC contracts, stub API | 89/89 |
| Real PostgreSQL/API/MVC regression, including DOM run | 126/126 API/MVC checks |
| Multi-tenant isolation regression | 75/75 |
| Company provisioning/discovery regression | 103/103 |
| Published security/concurrency regression | 65/65 |
| Published tester-feedback regression | 52/52 browser checks, immutable patient-number database assertion passed |
| DOM workflows | 85/85; localization, password visibility, theme and date DOM suites also passed |
| Account-settings Chromium regression | 75/75 |
| English Chromium regression | 55/55 |
| Theme Chromium regression | 40/40 |
| **Published shared-patient API/PostgreSQL suite** | **56/56** |
| **Published shared-patient Chromium suite** | **30/30** |

The focused suite runs two API instances against generated, isolated clinical and
platform databases. API roles own those databases and have no cluster superuser,
CREATEDB or CREATEROLE privileges. Fixture administration is separate. It exercises
actual PostgreSQL transactions, exclusion constraints, Razor forms, protected
cookies, antiforgery and Chromium at desktop/320px widths. New patient-home
desktop/mobile screenshots were inspected during development.

The focused checks include:

- Upgrade a password-bearing local patient from the preceding migration; retain
  password, account/profile identifiers and number; revoke the old local session.
- Register once, concurrently join another clinic through two API processes, and
  verify one credential identity plus distinct local profiles.
- Reject duplicate patient/staff emails, concurrent duplicate signups, staff
  patient-account creation/linking and staff resets of patient credentials.
- Deny unjoined/disabled membership reads, foreign profile identifiers and
  cross-clinic receptionist access. A local access ban cannot be bypassed by joining again.
- Keep other clinic access working after a local ban; enforce closed registration.
- Preserve the existing contact's privacy when somebody registers its email.
- Filter cross-clinic patient busy times; race bookings at two clinics and commit
  exactly one; release the central interval on cancellation.
- Aggregate only the current patient's upcoming visits, with the correct clinic
  and local patient number; explicitly switch before opening private details.
- Carry public doctor/date/time/service choices through login and clinic joining.
- Reject stale-tab workspace/antiforgery submissions after switching clinics.
- Share lockout and password changes across API instances; revoke global
  sessions on password change, company recovery and sign-out as appropriate.
- Allow exact-email company recovery without clinical history; reject clinic
  staff access; record the company operator's reset audit event.
- Let a patient sign in and reach healthy clinics when their default clinic's
  schema binding is damaged; fail closed for that damaged clinic itself.
- Repeat full maintenance without duplicate memberships or lost appointments.

## Boundaries

No production or deployed clinic database was accessed or changed. Testing used
local PostgreSQL 17, Linux .NET 10 and Chromium; Windows/IIS deployment and
production DNS/TLS are not claimed as locally verified. The existing CI matrix
continues to run Windows/Linux build/MVC/DOM checks and PostgreSQL regressions;
the shared-patient suite is added to published-output CI testing.

This work does not add email verification, automatic email recovery, record
merging, cross-clinic staff permissions or a new database. Company support must
verify identity through a trusted channel before a manual password reset. The
Development-only JSON demo retains its existing isolated identities.
