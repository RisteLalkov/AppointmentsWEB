# System reliability review — 10 November 2026

This review starts from `86d23bb` and covers the shared-patient-account and booking-review updates. It supplements the [2 November production audit](../2026-11-02/PRODUCTION_READINESS_AUDIT.md); that older report is a historical snapshot.

**Result:** the executed local regression suites passed, and nine reproduced application defects were fixed. The application is ready for another test deployment. This is not an unconditional production sign-off: the production infrastructure was unavailable to this review, and the remaining launch decisions below still matter.

## What was actually tested

Tests ran against disposable local databases and isolated browser sessions. No production or private-network database was accessed, reset, migrated, or seeded. API/Web publish output was exercised in addition to project builds. Temporary fixture roles deliberately lacked PostgreSQL superuser, `CREATEDB`, and `CREATEROLE` privileges; the coordinator alone created and removed those fixtures.

The environment used .NET SDK **10.0.100**, installed ASP.NET/Core runtime **10.0.0**, PostgreSQL **17.11**, Node **24.19.0**, Chromium **154.0.8037.57**, and axe-core **4.14.0**. Application package versions are recorded in the project files. NuGet and npm advisory scans reported no known vulnerable packages at scan time. Those scans do not assess the installed runtime, IIS Hosting Bundle, operating system, PostgreSQL server, or bundled vendor JavaScript; production must use supported, patched installations.

The repository inventory covered 151 tracked application source/assets files, plus database, deployment, scripts, and test files. All seven solution projects built with **zero warnings and zero errors**. JSON, JavaScript syntax, and project/configuration XML were checked. This inventory and successful compilation are not a claim that every possible input or execution path was tested.

### Executed coverage

| Area | Result | What this establishes |
|---|---:|---|
| Core scheduling, persistence, permissions and reports | 102/102 | Booking/status rules, overlaps, adjacency, duration, exceptions, optimistic versions, report calculations, legacy-import independence, new boundary regressions |
| MVC HTTP smoke | 38/38 | Workspace navigation, role-specific UI, HTTP/CSRF behavior, packaged local assets |
| Discovery/company MVC contracts | 89/89 | Razor, forwarding, redirects, localization and account forms against a deterministic API stub |
| Discovery/workspace Chromium | 138/138 | Public profiles/maps integration, booking controls, management views, navigation, dialogs, mobile layout and keyboard interactions; public API is stubbed and workspace uses isolated JSON demo data |
| Account settings Chromium with MVC fixture | 87/87 | Three roles, keyboard/focus, sign-out/password entry points, themes, languages and narrow viewports |
| English/Macedonian Chromium with MVC fixture | 72/72 | Translated flows and preserved record names, preferences, form actions and SVG icons |
| Themes Chromium with MVC fixture | 46/46 | Standard/Dark/Vibrant, persisted settings, contrast checks, mobile widths, blocked storage |
| Real PostgreSQL/API/MVC integration | 126/126 | Two API processes, real sessions, authorization, mutations, history, reports, Swagger and publish/startup behavior |
| Direct SQL constraint suite | 7/7 | Doctor/patient exclusion, invalid range/status, missing parent, role/profile constraint, cancelled-slot reuse |
| DOM suites | 23 + 16 + 14 + 42 + 85 checks | Localization, password visibility, themes, date controls and workspace interactions; these are DOM checks, not layout tests |
| Tenant isolation | 75/75, plus 12 DOM checks | Shared database/separate schemas, cross-clinic access rejection, binding validation, upgrade and restart scenarios |
| Company platform/public API | 103/103 | Provisioning, adoption, shared schemas, metadata, discovery, Cyrillic search and registry updates |
| Global patient accounts | 64 API/database + 30 browser | One login across clinics, memberships, clinic-bound staff, cross-clinic conflicts, local quotas and rescheduling |
| Booking review/sample data | 21 API/database + 22 browser | Service-first filtering, available-day calendar, first slots, identifiers, sample seed and repeatability |
| Prior high-severity regressions | 65/65 | HTTPS fail-closed, real local TLS, signed visitor attribution/rate limits, concurrent last-admin protection, clinic failure isolation, bounded registry outage handling and booking abuse limits |
| Tester-feedback regressions | 52 browser + database assertion | Layout/validation changes and immutable patient numbers |
| New reliability suite | 8 API/database + 11 browser | Saved-but-refresh-failed behavior, late callbacks, rescheduling reload, precision, DST, oversized body and empty-service normalization |
| Automated WCAG A/AA scan | 17/17 scenarios | Three roles across workspace sections; additional doctor-page scans in Dark/Vibrant; no detected violations in these scans |

The additional standalone preference suites also passed. They are not added to the table totals a second time. Counts are assertion/scenario counts, not a percentage of source-code coverage.

### Realistic workflow checklist

- [x] Visitor finds a clinic/doctor, searches with Macedonian Cyrillic, selects service/date/time, and continues through login to booking.
- [x] Patient registers once, joins/selects another clinic, and uses the same credentials while clinical records remain scoped to each clinic.
- [x] Patient cannot read or book for another patient, impersonate staff, book staff-only appointments, or bypass overlap/booking limits.
- [x] Receptionist creates patients/doctors/services, edits contacts/hours, adds/removes exceptions, books normal or agreed times, and handles appointment status/history.
- [x] Doctor sees permitted patients/appointments and manages permitted availability without access to another doctor's private work.
- [x] Two staff sessions compete for slots or edit the same appointment/schedule; database exclusions and version checks reject conflicting writes.
- [x] Company administrator provisions/adopts/updates clinics; provisioning creates schemas in the shared clinical database.
- [x] Staff remain clinic-bound; global patient identity does not grant company or staff privileges.
- [x] Stale tabs cannot silently write into a newly selected clinic.
- [x] Failed reads after successful writes and late responses after closing a form are exercised in Chromium.
- [x] Browser Back/Forward, authenticated login-page redirects, logout, CSRF and access-denied flows are exercised.
- [x] Macedonian/English, password visibility, themes, responsive layouts down to 320 px, and keyboard modal behavior are exercised.
- [x] Sample seeding remains explicit, synthetic and repeatable; it does not create login credentials.
- [ ] Production-domain/IIS smoke testing, real mobile Safari/Firefox, screen-reader/manual accessibility and production-scale soak testing were not performed.

## Reproduced and fixed findings

Severity reflects this application's observed impact. No new Critical or High application defect was confirmed in the executed scenarios. That does not establish that none exists.

### F01 — Medium: another clinic consumed the selected clinic's booking allowance

**Reproduction:** register a global patient, join two clinics, book three future visits at clinic A, then try a non-overlapping visit or valid reschedule at clinic B. It was rejected by B's future-visit limit.

**Cause:** external busy intervals were represented as synthetic local appointments. The local quota counted them as visits in the selected clinic.

**Fix:** keep external intervals as private rule inputs and consult them only for patient overlap checks. They are not persisted/serialized as local visits and cannot consume local quotas. PostgreSQL's shared-patient exclusion remains the final concurrent-write guard.

**Locations:** `src/Appointments.Data/PostgresAppointments.cs:245`, `src/Appointments.Core/Models.cs:67`, `src/Appointments.Core/SchedulingRules.cs:8`, `src/Appointments.Core/AvailabilityOverview.cs:34`.

**Verification:** three A bookings no longer block B; B rescheduling succeeds; A still rejects its fourth booking; cross-clinic overlapping bookings remain rejected. Unit tests also cover adjacent busy intervals and exclusion from serialized state.

### F02 — Medium: delayed responses affected a different dialog

**Reproduction:** submit a booking, delay its error response, close the modal and open another booking. The old callback wrote its error into the new form and could throw when accessing missing review controls. Catalogue/patient saves had related callback-lifetime problems.

**Fix:** bind each response to its originating booking, form and DOM elements. Closing/replacing a dialog prevents its late callback from updating or closing the new one. Slot-error retry handlers are scoped the same way.

**Locations:** `src/Appointments.Web/wwwroot/js/app.js:985`, `:1022`, `:1401`, `:1553`, `:1588`.

**Verification:** delayed booking failure, delayed catalogue failure and delayed successful patient creation all leave a different active form intact, with no uncaught JavaScript error.

### F03 — Medium: successful writes were presented as failures

**Reproduction:** let the booking POST commit, then return HTTP 503 for its subsequent bootstrap refresh. The booking existed in PostgreSQL, but the UI showed a failed operation. Retrying could confuse users or produce unnecessary duplicates for non-idempotent forms.

**Fix:** distinguish the mutation result from its follow-up read. Retain the saved object locally and show success with a refresh warning when appropriate. Apply the same principle to patient/contact/catalogue/status saves.

**Locations:** `src/Appointments.Web/wwwroot/js/app.js:195`, `:693`, `:1042`, `:1401`, `:1553`, `:1588`.

**Verification:** the real booking POST commits exactly one appointment, the UI acknowledges it despite an injected bootstrap failure, and patient creation remains acknowledged and visible when refresh fails. Network faults injected here concern the post-save read; a response lost during the actual mutation remains an inherently uncertain outcome. Booking request IDs still support safe replay.

### F04 — Medium: stale rescheduling could not recover in the form

**Reproduction:** open rescheduling, move the same appointment from another session, then submit the first form. HTTP 409 was correct, but retrying/back navigation retained the old version and there was no reload action.

**Fix:** provide “Вчитај ја тековната состојба” on rescheduling conflicts. Reload current version/date/time; if the appointment is no longer editable, show its current details instead.

**Location:** `src/Appointments.Web/wwwroot/js/app.js:1061`.

**Verification:** a concurrent move from 09:00 to 11:00 produces a conflict; reloading selects 11:00 and a subsequent move to 12:00 succeeds.

### F05 — Medium: valid calendar days could fail at a DST midnight transition

**Reproduction:** use `America/Havana` and request public availability/reporting for 14 March 2027. Midnight does not exist on that day: public availability returned HTTP 500 and reporting rejected a valid day.

**Fix:** date-query boundaries use the earliest real instant of the day, including midnight gaps/repetitions. Individual nonexistent or ambiguous appointment wall times remain unbookable.

**Locations:** `src/Appointments.Core/SchedulingClock.cs:12`, `src/Appointments.Api/Services/PublicDiscovery.cs:46`, `src/Appointments.Data/PostgresAppointments.cs:25`.

**Verification:** real API/SQL queries pass for the gap day; fixed-clock unit tests establish the 23-hour spring day and earliest boundary of the 25-hour repeated-midnight day. Maximum report dates still return controlled validation. This was an edge case for supported configurable zones, not a reproduced Skopje-midnight failure.

### F06 — Medium: sub-minute hours could offer a slot before working time

**Reproduction:** submit fractional-second working hours, or an availability exception starting at 09:00:30. The accepted period could generate a 09:00 slot because slot enumeration used whole minutes.

**Fix:** require whole-minute boundaries for schedules and exceptions; fail closed for invalid legacy/imported periods instead of rounding them into bookable slots.

**Locations:** `src/Appointments.Core/AppointmentService.cs:192`, `:210`, `src/Appointments.Core/SchedulingRules.cs:7`, `:21`.

**Verification:** domain and actual API tests reject seconds/fractional ticks; legacy sub-minute periods cannot generate a slot before their start. Invalid legacy hours need staff correction; no automatic data rewrite was performed.

### F07 — Medium: Standard-theme functional text had low contrast

**Reproduction:** automated Chromium/axe scans of overview, calendar, management and appointment pages. Examples included 3.71:1 overview links, 3.36:1 chart counts and very light footer/calendar labels. Pending/completed/cancelled/no-show status labels also needed stronger contrast. Some decorative initials were reported too.

**Fix:** slightly darken the affected Standard-theme text colors and remove opacity that washed out event times/cancelled-event text. Existing theme palettes and layout are preserved.

**Locations:** `src/Appointments.Web/wwwroot/css/site.css:233`, `:805`, `:1002`, `:1040`, `:1291`, `:1337`, `:1396`, `:1423`, `:1453`.

**Verification:** 17 role/page/theme scans now detect no WCAG A/AA violations. This is automated sampled coverage; incomplete automated checks and manual/assistive-technology testing still require human review.

### F08 — Low: oversized requests were classified as server errors

**Reproduction:** send a login request with a JSON body exceeding the API's 64 KiB limit. The generic exception handler returned HTTP 500 instead of 413.

**Fix:** preserve `BadHttpRequestException.StatusCode` and return a controlled localized error without exposing exception details.

**Location:** `src/Appointments.Api/Program.cs:103`.

**Verification:** the real oversized request now returns HTTP 413; the 64 KiB limit remains in place.

### F09 — Low: an empty optional service became a database error

**Reproduction:** book a doctor with no assigned services using `serviceId: ""`. Rules treated it as absent, but persistence wrote an empty foreign key and returned HTTP 503.

**Fix:** normalize empty optional service IDs to null before rule evaluation and before calculating the PostgreSQL idempotency fingerprint.

**Locations:** `src/Appointments.Data/PostgresAppointments.cs:101`, `src/Appointments.Core/AppointmentService.cs:53`.

**Verification:** API booking succeeds with a null stored service; replay using null returns the same appointment. Domain tests cover equivalent JSON-demo behavior.

### Other corrections

- The discovery browser test still expected receptionist-created patient logins. It now verifies the staff-only form introduced by shared patient accounts. This was an outdated test expectation, not a product regression.
- CI now runs that full discovery browser fixture, the new reliability suite, and automated accessibility checks. The PostgreSQL job has a 30-minute budget. These commands passed locally; remote CI status must be checked on GitHub.
- Removed the obsolete “Tuesday first” reference from report explanations in both languages. `Doctor.TuesdayFirst` and imported source notes remain compatibility metadata; scheduling uses saved hours, exceptions, service duration, doctor settings and actual bookings. They do not execute instructions from the spreadsheet.

## Database inspection and restore verification

The inspected clinical test database contained **23 tables, 146 columns, 67 constraints and 53 indexes** across `public` and `careline_identity`; the separate platform test database contained **4 tables, 28 columns, 7 constraints and 6 indexes**. Extension-owned objects are outside these application-table counts.

All 18 EF-mapped tables matched actual database column names and nullability. The model reported no pending changes and the clinical database no pending EF migrations. All catalogued constraints were validated. The clinical constraints include 20 foreign keys, 17 checks and three exclusion constraints; identity/registry SQL objects outside EF were inspected through PostgreSQL's catalogues too.

The executed suites go beyond schema inspection: direct SQL deliberately violates key rules, concurrent API requests compete for slots/versions, and shared-schema fixtures verify ordinary application-role behavior. This does not mean every constraint was independently fault-injected.

A custom-format `pg_dump` of the disposable clinical database was restored to another fresh database. Row counts and ordered content fingerprints matched across all 23 application tables, including **1,497 appointments**. This proves this test backup restored consistently. It does not validate production backup permissions, encryption, scheduling, retention, off-server storage, recovery timing, or coordinated restoration with production platform metadata and secrets.

Metadata and verification evidence are in [evidence](evidence/). They contain no production records or connection passwords. Schema evidence is a snapshot for review, not a deployment/reset script.

## Remaining concerns and next work

These are code observations, product/operational gaps, or explicitly untested areas; they are not newly proven production incidents.

| ID / severity | Concern and location | Recommended next step |
|---|---|---|
| R01 — Medium | Bootstrap returns all visible appointment history and the workspace polls every 20 seconds (`src/Appointments.Data/PostgresAppointments.cs:14`, `src/Appointments.Web/wwwroot/js/app.js:1832`). Cost grows with clinic history. | Introduce date windows/paging incrementally, use the existing paged appointment API, and measure representative clinic loads before claiming a supported capacity. No production-scale concurrency/soak benchmark was run here. |
| R02 — Medium | Public identity assurance/privileged-account protection still needs a policy (`GlobalPatients.cs`, `AccountService.cs`, `PlatformService.cs`). No implemented email-verification/MFA workflow was established by this review. | Agree verification, recovery and optional/required MFA with the project owner; implement and test the chosen delivery/support process. Multiple identities can bypass per-account abuse limits. Do not merge records solely by matching contact email. |
| R03 — Medium | Selected account/booking events are recorded, including global-patient events, but complete failed-authentication/read-access/company-administration monitoring and external retention were not established (`AccountService.cs`, `GlobalPatients.cs`, `PlatformService.cs`, audit tables). | Define the required event catalogue, correlation, access/retention and protected external log sink; test incident reconstruction without logging passwords/tokens or unnecessary patient data. |
| R04 — Medium | Privacy and terms remain disabled “Наскоро” items (`src/Appointments.Web/Views/Discover/Index.cshtml:167`). | Publish owner-approved content and working links before collecting real patient data, matching actual retention, support and external-map behavior. This review is not a legal compliance assessment. |
| R05 — Low | Explicit browser framing/content policies are incomplete (`src/Appointments.Web/Program.cs:101`). | Add a tested framing policy and introduce CSP in report-only mode first, accounting for Google Maps and current inline styles; then enforce after reviewing violations. |
| R06 — Low | JSON-demo and PostgreSQL idempotency still differ for changes to the agreement flag (`AppointmentService.Book`, `PostgresAppointments.BookAsync`). Production uses the full command fingerprint; demo stores a narrower replay identity. | Harmonize demo request fingerprints if demo parity is required. Do not treat demo behavior as the security boundary of production. |
| R07 — Low | Documentation contains historical deployment/status instructions; some account-creation validation paths can discard nonsecret form input (`README.md`, historical docs, `Views/Accounts/Index.cshtml`). | Maintain a current deployment index and preserve/repopulate safe fields after validation errors. Never repopulate a password. |

Before a real-data launch, verify the actual production IIS bindings, patched .NET Hosting Bundle, HTTPS/certificates/proxy trust, database TLS/firewall/role grants, persistent Web data-protection keys, secret storage, backup/restore procedure, and monitoring. These were outside available access. Live Google Maps positioning/provider availability was not guaranteed: tests checked our integration and address encoding, with the external frame stubbed for layout checks. No email/SMS delivery service was tested or implied by booking success.

Additional testing gaps are Firefox/Safari and real device behavior, manual screen-reader/keyboard/zoom review across every page/theme, long-running failover and resource-exhaustion tests, arbitrary database corruption, and a complete route × method × role × invalid-input enumeration. The successful local tests are strong regression evidence, not proof of every possible state.

## Deployment impact

Publish **both API and Web** from the resulting commit and preserve server-specific configuration/secrets. This audit batch introduces **no new schema migration** and requires no manual data cleanup. Earlier shared-patient-account migrations are still required if that prior update has not yet been installed. No test seed or audit script should be run against production.

After deployment, perform a short staging/production smoke check with controlled accounts: public discovery → patient login → booking → receptionist confirmation/history → permitted doctor view → patient cancellation; then verify a second clinic remains isolated and a second staff session receives a clear conflict instead of overwriting a change.
