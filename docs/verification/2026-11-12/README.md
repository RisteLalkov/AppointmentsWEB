# Audit fixes — implementation and verification

This is the remediation record for the [12 November production-readiness audit](../../audit/2026-11-12/PRODUCTION_READINESS_QA_REPORT.md).
The original audit and its evidence remain unchanged. No production server or company data was accessed.

## Changes

| Audit finding | Result |
| --- | --- |
| H01 — full-history bootstrap and expensive date formatting | Fixed. PostgreSQL bootstrap is bounded, overview totals come from SQL, directory/history/appointment search and pagination run on the server, and calendar reads request only their date window. Browser record caches and date formatters are bounded/reused. |
| M01 — stale clinic tabs break logout/language | Fixed. Personal controls bind to the authenticated shared patient identity; clinical writes retain strict clinic binding. |
| M02 — authenticated cross-origin framing | Fixed. API and Web send CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY` and nosniff headers. |
| M03 — default-theme contrast | Fixed for the reported breadcrumb, booking, specialty, warning and muted calendar text. Real-database axe scenarios cover all three themes. |
| M04 — keyboard-inaccessible calendar scrolling | Fixed. Existing time-grid cells are focusable; the surrounding region is labelled and focus is visible. PageDown scrolling was exercised. FullCalendar's grid semantics are preserved. |
| M05 — Swagger clinic-header omission | Fixed for plural patient CRUD and the new workspace routes. |
| M06 — missing operational security/company/read audit | Implemented structured failed-login/lockout events across staff, shared patients and company operators, company session/password/clinic actions, and individual appointment/history reads. Failure counters and lockout events commit together. Retention and external tamper-resistant audit storage remain owner decisions. |
| L01 — JSON demo booking replay ignores agreed-time flag | Fixed. Durable normalized request receipts compare the complete command and preserve the original response after cancellation, rescheduling and restart. |
| L02 — stale API documentation | Updated required contact fields, readiness/liveness, paging and operational audit documentation. |
| L04 — regression/dependency gaps | Added a real PostgreSQL workspace/accessibility/growth CI job, advisory gates and a hashed vendored FullCalendar inventory. Manual screen-reader testing and owner-specific CI/action maintenance remain necessary. |

New regressions also cover full-directory dropdown searches, newly added records beyond the first page, late responses, retry after read failure, old history/details, and calendar windows intersecting overnight visits. Existing doctor, patient, receptionist and company permissions remain enforced.

## Verification

Release solution build: **0 warnings, 0 errors**. EF reports **no pending model changes**. The packaged output includes both new SQL scripts and the clinical index migration. Local tests use PostgreSQL 17, two Production-mode API hosts and a Web host with generated ordinary database-owner roles; HTTP is explicitly enabled only for these disposable loopback fixtures.

| Verification | Result / evidence |
| --- | --- |
| Core scheduling/persistence | 110/110 — [log](logs/baseline-core.log) |
| DOM + language/password/theme/date controls | 85 + 23 + 16 + 14 + 42 — [log](logs/dom-release-final.log); also exercised against live API in the integration suite |
| API/MVC + database integration | 126/126, plus direct SQL constraint checks — [log](logs/api-verified-final4.log) |
| Clinic isolation | 75 API/MVC + 12 DOM — [log](logs/baseline-tenancy.log) |
| Platform/discovery PostgreSQL | 103/103 — [log](logs/baseline-platform.log) |
| Shared patients and clinic switching | 64 API/database + 30 browser — [log](logs/baseline-global.log) |
| Booking review | 21 API/database + 22 browser — [log](logs/baseline-booking.log) |
| Existing high-severity regressions | 65/65 — [log](logs/baseline-high.log) |
| Tester feedback | 52 browser checks and immutable patient-number verification — [log](logs/feedback-verified-final.log) |
| Tester round two | 40 API/database + 59 browser — [log](logs/baseline-round2.log) |
| Overnight/late-response recovery | 8 API/database + 11 browser — [log](logs/baseline-overnight.log) |
| Discovery/company MVC and Chromium | 89 contract + 138 discovery + 87 settings + 72 language + 46 theme checks — [log](logs/baseline-discovery.log); public API is stubbed in this suite |
| Baseline accessibility and HTTP | Passed — [accessibility](logs/baseline-accessibility.log), [38 HTTP checks](logs/baseline-http.log) |
| New workspace/security regressions | 72/72 — [individual results](evidence/remediation-api.json) |
| Real-data cross-tab, framing, roles, mobile and axe checks | 60/60 — [results](evidence/browser-targeted.json); zero uncaught JavaScript errors in these flows |
| All role/status/time-phase combinations | 225/225 — [results](evidence/status-matrix.json); synthetic starting states are injected only into the test fixture, transitions execute through the real API |
| Offline upgrade from retained pre-fix published binaries | 15/15 — [results](evidence/upgrade-results.json); original records/passwords/memberships/history preserved, existing sessions survive, maintenance repeatable, new booking succeeds |
| Paired backup/restore | 11/11 — [results](evidence/restore-results.json); every restored table fingerprint matches, login/new booking works, raw dumps/temporary databases removed |
| JSON audit probes | Both pass — [log](logs/core-audit-probes.log) |
| Dependency checks | No reported NuGet/npm vulnerabilities in these scans — [NuGet](evidence/nuget-advisories.json), [npm](evidence/npm-advisories.json); vendor hash/license check passes |

Counts describe assertions in individual suites, not unique scenarios or a code-coverage percentage. Several suites overlap. The 18-check new browser workflow includes 17 real-workflow assertions and one explicitly stubbed cache-boundary assertion; its individual results are retained in [remediation-browser.json](evidence/remediation-browser.json).

Earlier failed/interrupted runs are retained in `logs/`. `evidence/baseline-results.json` records the initial batch and includes two superseded failures: the API suite reused a previously populated disposable coordinator with a different generated password; its fresh-database rerun then exposed DOM checks assuming synchronous data. The feedback test also asserted rows before asynchronous filters completed. Tests now wait for actual responses/results while preserving their original expectations; authoritative successful reruns are linked above. Development runs also caught and corrected remote email-result filtering, stale detail-dialog handling, calendar ARIA hierarchy and overnight-window coverage. Initial physical drag attempts selected a cancelled overlapping event or proposed an off-grid 14:40 time, which the server correctly rejected. The final gesture selects the active event, centers it and targets 14:30; its successful write and subsequent independent detail read are verified. Their raw earlier failures remain visible. One additional calendar contact-cache test explicitly stubs paged responses for a UI-only 1,600-contact boundary; it is not credited as database/E2E coverage.

## Growth result

The fixture adds 5,000 synthetic contacts and 30,000 historical appointments, alongside the focused history/security test data. Exact row counts, API samples and browser measurements are retained under `evidence/performance*.json`, `evidence/browser-performance.json` and `evidence/query-plans.json`.

The original audit measured a **12,107,744-byte** receptionist bootstrap and about **21.7 seconds** to the overview, including a roughly **20.5-second** browser long task. The post-fix fixture produces approximately **40 KB** and the final receptionist overview opens in approximately **1 second**, with no observed browser long task. The response includes complete SQL totals despite bounded record collections. Broad CI guards cap bootstrap at 256 KiB/100 appointments/150 patients, overview time at 10 seconds and longest task at 1.5 seconds; [budget results](evidence/workspace-budget-results.json) pass. These are regression measurements on the test container, not a production latency/SLA or multi-clinic capacity certification.

## Deployment and remaining conditions

Follow [the deployment steps](DEPLOYMENT.md). This release requires **both API and Web publishes and an offline database upgrade**. Keep all hosts stopped during the coordinated deployment. No reset or sample-data generation is required.

M07 (verification/MFA provider and account-recovery policy), M08 (approved legal/privacy copy), the retention/external-audit part of M06, and L03 (aggregate PostgreSQL connection-pool budget across clinic schemas) remain open deployment-owner decisions. Do not infer production capacity from one-clinic load tests. Public HTTPS/IIS/proxy/domain behavior, real email/SMS providers, production backups/RTO/RPO, production data and assisted screen-reader testing were not certified here. Google Maps remains an external integration; no live private/production endpoint was contacted.

**Assessment:** the independently implementable code fixes are verified locally. Production launch remains conditional on the deployment-owner items above and a staging smoke test with the real hosting configuration. This record does not retroactively replace the original audit verdict or claim exhaustive production certification.
