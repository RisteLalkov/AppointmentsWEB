# Feature inventory and testing coverage

Status applies only to the stated evidence and scope. PASS is not a claim that every input, theme, device or dataset combination was exercised. A mixed status explicitly retains failures/gaps.

| ID | Discoverable feature | Assessment | Evidence | Limits / notes |
|---|---|---|---|---|
| F01 | Architecture/build/publish assets | PASS | Release build/publish logs; dependency and repository inventories | Actual Windows/IIS execution BLOCKED |
| F02 | Public landing, branding, footer, navigation | PASS / GAP | baseline-discovery; real public doctor browser | External social destinations BLOCKED; legal content M08 |
| F03 | Public doctor/clinic search and refinements | PASS | baseline-platform; baseline-discovery; API matrix | SQL/HTML strings plus Cyrillic first/surname/full-name cases |
| F04 | Public pagination, empty/error states | PASS | baseline-platform; baseline-discovery | Stub-backed browser contract scenarios are labelled |
| F05 | Public clinic metadata and Maps/fallback URLs | PASS / BLOCKED | baseline-platform; baseline-discovery; Razor source | External map tiles/geocoding accuracy BLOCKED |
| F06 | Public doctor profile and service selection | PASS | browser-targeted; baseline-discovery | By-agreement/reception-only disclosure included |
| F07 | Anonymous free-slot selection to login | PASS | baseline-global revalidation; browser-targeted | Date/time/service retained through login/consent |
| F08 | Registration, required contacts and password visibility | PASS / GAP | baseline-api; round2; browser-targeted | Inbox/phone verification absent, M07 |
| F09 | Single patient identity across clinics | PASS | global-revalidated; security-results; browser-targeted | Explicit membership, own profiles and clinic-local history |
| F10 | Existing contact email cannot claim history | PASS | baseline-api; global-revalidated | No automatic contact-to-account merge |
| F11 | Closed/hidden clinics and consent | PASS | baseline-platform; global-revalidated | Existing member versus new registration rules |
| F12 | Global My clinics: visits/history/filter/join | PASS | global-revalidated; baseline-round2 | 100-item cap disclosed; arbitrary >100 cross-clinic histories not browser-exhausted |
| F13 | Breadcrumb clinic switcher, keyboard/retry/stale tab | PASS / FAIL | baseline-round2; browser-targeted | Clinical stale reads/writes protected; personal actions M01 |
| F14 | Reception clinic-bound login/session | PASS | baseline-tenancy; baseline-high; security matrix | No staff cross-clinic membership |
| F15 | Doctor role, own appointments/schedule | PASS | baseline-api; baseline-tenancy; browser-targeted | Clinic contact access is existing policy |
| F16 | Patient own-only records and appointments | PASS | baseline-api; global-revalidated; security matrix | Other patient/doctor object access denied |
| F17 | Independent company and clinical cookies | PASS | browser-targeted B020; baseline settings | Company logout leaves clinic session usable |
| F18 | Login/back/forward/return URL routing | PASS | baseline HTTP/discovery/overnight/settings suites | Cross-browser bfcache behavior NOT TESTED |
| F19 | Password changes and recovery | PASS | global-revalidated; browser-targeted B019; baseline-platform | Manual trusted-channel recovery, no delivery integration |
| F20 | Persistent distributed lockout | PASS | security-results; baseline-high/platform | Eight concurrent wrong logins across API instances for patient/staff/company |
| F21 | Expired/revoked/disabled sessions | PASS | security-results; baseline-api/high | Timestamp expiry forced in test; natural two-hour wait NOT TESTED |
| F22 | Last active administrator/self-disable guards | PASS | baseline-high; baseline-api | Concurrent account changes tested |
| F23 | Overview counts/date/week chart | PASS / FAIL | core/API reports; browser-targeted; browser-performance | Correct small state; H01 large-data usability |
| F24 | Reception/patient/doctor sidebar and responsive drawer | PASS | feedback-revalidated; browser-extra E3 | 20 repeated mobile/desktop transitions |
| F25 | Doctors cards/list/search/filter/pagination | PASS | baseline-round2; browser-targeted | 12/24/48 selection, menus and appropriate actions |
| F26 | Doctor edit/details/availability menus | PASS | baseline API/high/round2; browser-targeted | Catalog version conflicts and booking flags |
| F27 | First-free-slot summaries | PASS | booking-review; baseline-round2; API matrix/performance | Bounded 1–100 doctor query and 180-day horizon |
| F28 | By-agreement/reception-only restrictions | PASS | baseline API/core/high/round2 | Patient disabled self-service; staff agreed-time booking |
| F29 | Patient cards/list/search/number/pagination | PASS | feedback-revalidated; baseline-round2 | Same-name identities distinguished by permanent number |
| F30 | New manual patient phone+email and normalization | PASS | API matrix; baseline-round2 | Legacy edits have separate optional-email semantics |
| F31 | Patient profile/contact edits/history/filtering | PASS | baseline-api; feedback-revalidated; baseline-round2 | Concurrent versions, history scope, date controls |
| F32 | No patient deletion | BY DESIGN | Product requirement; source route inventory | History-preserving deletion deliberately deferred |
| F33 | Specialties list/create/edit/duplicates/version | PASS | core/API; round2; DOM | No card-view/status toggle expected |
| F34 | Services list/create/edit/duration/assignment | PASS | core/API; round2; DOM | Disabled/legacy service and duration-preserving reschedule |
| F35 | Booking doctor/service/patient comboboxes | PASS | booking-review; round2; DOM | Service-first doctor filtering, no contact email in label |
| F36 | Coloured availability date picker/date entry | PASS | feedback-revalidated; round2; dates DOM | DD.MM.YYYY, invalid dates, keyboard/Escape and stale responses |
| F37 | Booking slots/review/back/submit/success/details | PASS / FAIL | booking-review; browser-targeted | Full real DB flow PASS; review contrast M03 |
| F38 | Reception agreed-time/no-weekly-hours booking | PASS | core/API/booking-review | Atomic one-off availability, overlaps still rejected |
| F39 | Patient quotas and pending-per-doctor limits | PASS | baseline-high; core | Cross-host concurrent requests and staff override |
| F40 | Appointment creation/idempotent retries | PASS | baseline-api; API matrix; real browser | Complete PG fingerprint; demo exception L01 |
| F41 | Doctor/patient conflict and adjacency | PASS | core/API/SQL; cross-host matrix | Local doctor, local patient and shared patient exclusions |
| F42 | Cross-clinic shared-patient conflict | PASS | global-revalidated; security-results | Two different API hosts, one 200/one 409 |
| F43 | Appointment list/search/combined filters/pagination | PASS | core/API; baseline-round2; browser | Role-scoped list, reversed range and clear/reset |
| F44 | Details/history/actor/version snapshots | PASS | baseline-api; browser-targeted | Atomic writes, negative updates add no history |
| F45 | Confirm/cancel/complete/no-show/overdue | PASS | 225-case status matrix; core/API | All roles/current-target statuses/future-in-progress-past |
| F46 | Reschedule original date/duration/version | PASS | booking-review; core/API | No stale overwrite, disabled provider rules retained |
| F47 | Physical calendar pointer drag and confirm | PASS | browser-extra E2 | 10:00→10:30, HTTP 200, version 2; off-grid rejection also verified |
| F48 | Calendar views/day-week-month/range/filter/today | PASS / FAIL | round2; language/DOM/browser-targeted | Pointer and API work; keyboard scroller M04 |
| F49 | Calendar rendering at small screens | PASS | responsive browser and baseline tests | Real device/touch/OS controls NOT TESTED |
| F50 | Regular/dated working periods and ordering | PASS | core/API; round2 | Monday-first, date override/fallback, overlapping/invalid ranges |
| F51 | Schedule edit conflict/draft preservation | PASS | booking-review; core/API | Original version retained; other staff update cannot silently overwrite |
| F52 | Exceptions/absence/additional availability/remove | PASS | core/API; booking-review | Duplicate suppression, conflict/stranding rejection, role scope |
| F53 | Date/time/DST/closing-minute/180-day boundaries | PASS | core/API/overnight; API matrix | Invalid/ambiguous wall times fail closed |
| F54 | Imported prose/Tuesday preference not operational | PASS | core baseline and extra Core C002 | Wednesday available despite legacy TuesdayFirst flag |
| F55 | Reports range/group/service/status totals | PASS | core/API; UI DOM/browser | Read-only, consistent aggregate snapshot, role guard |
| F56 | Accounts list/filter/search/pagination | PASS | feedback-revalidated; DOM/browser | Patient versus staff permissions and clear empty/success states |
| F57 | Staff account creation/profile choices/access/reset | PASS | core/API/high; global browser | No service-only doctor or occupied profile; no patient credential linking |
| F58 | Platform clinic provision/adopt/edit/retry | PASS | baseline-platform; API matrix; real browser | Shared DB schemas, stale versions, preserved main data and sessions |
| F59 | Platform visibility/registration policy/restart | PASS | baseline-platform | Cross-instance refresh, hidden metadata and non-ready failure handling |
| F60 | Company password/logout/patient recovery | PASS | baseline-platform; browser-targeted | Global session revocation and patient-event evidence |
| F61 | Themes and language/settings/password controls | PASS / FAIL | language/theme/settings/DOM/browser | Controls work; stale-tab M01 and specific contrast M03 |
| F62 | Icons, focus traps, menus and dialogs | PASS / PARTIAL | settings/language/feedback/booking browser | Selected keyboard/focus cases; manual assistive-tech review outstanding |
| F63 | Responsive widths 320/768/1360 | PASS | browser-targeted; round2/feedback/discovery | No tested document overflow; does not certify physical devices |
| F64 | HTML escaping/SQL-style injection strings | PASS | API matrix; browser-extra E1 | Stored patient markup rendered literally, no event execution |
| F65 | CSRF/clinic scope/forged header/role boundaries | PASS / FAIL | global revalidation; API/security matrices | Clinical protections PASS; personal stale-token M01 |
| F66 | Framing/CSP policy | FAIL | browser-targeted B059 | Authenticated same-site cross-origin frame rendered, M02 |
| F67 | HTTPS/proxy/rate-limit/body limits | PASS / BLOCKED | baseline-high/API; API matrix | Real local TLS; actual IIS/proxy/network configuration BLOCKED |
| F68 | Public Swagger/OpenAPI/assets | PASS / FAIL | baseline API; endpoint matrix | UI/authorization work; missing patient clinic headers M05 |
| F69 | Registry/cache outage/freshness/recovery | PASS | baseline-high | Brief continuity, bounded stale lease, fail closed and recovery |
| F70 | Migration/identity triggers/tenant binding | PASS | fresh migration, SQL catalogues, high suite, restore | Actual production drift BLOCKED |
| F71 | Every observed column/constraint/index inventory | PASS | DATABASE_CATALOGUE; model comparison | Canonical mutation probes; cloned schemas inventoried, not duplicate-probed exhaustively |
| F72 | Database cascade/unique/FK/range/rollback | PASS | 312 additional probes; baseline SQL | Expected SQLSTATE/constraint and affected-row checks |
| F73 | Clinical+platform backup/restore/read/write | PASS | 11 restore assertions | Stable source window; hot cross-DB/PITR/new-server recovery NOT TESTED |
| F74 | Preview seeding safety/idempotency/history | PASS | baseline-high | Explicit opt-in, account/old appointment preservation |
| F75 | Authentication and record-access audit | PARTIAL | security patient events; audit source | Successful changes tracked; broader failure/read trail M06 |
| F76 | Identity verification/MFA/provider delivery | GAP / NOT TESTED | registration/session source and live registration | Not implemented provider workflow, M07 |
| F77 | Privacy/terms/policy content | GAP | landing footer source/browser | Intentionally deferred placeholders, M08 |
| F78 | Package advisory checks and bundled assets | PASS / PARTIAL | NuGet/npm audit; asset header | Covered feeds clean; vendor/runtime/OS scope L04 |
| F79 | CLI/deployment scripts/configuration | PASS / BLOCKED | published fixture migrate/preview; source review | Windows CMD execution/real server roles unavailable |
| F80 | Soak/hardware fault/failover/capacity certification | NOT TESTED | Bounded experiments only | See explicit production acceptance checklist |
