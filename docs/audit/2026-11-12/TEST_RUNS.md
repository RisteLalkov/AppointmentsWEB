# Test runs, evidence and unsuccessful-attempt adjudication

Application source revision remained unchanged. Original failures are retained even when the test harness was subsequently corrected. Per-assertion outcomes are in TEST_LEDGER.csv; result JSON and raw logs provide richer request/database detail.

## Baseline invocations

| Suite | Command | Original status | Exit | Seconds | Raw log |
|---|---|---|---|---|---|
| core | dotnet run --project tests/Appointments.Tests -c Release --no-build | PASS | 0 | 1.63 | docs/audit/2026-11-12/logs/baseline-core.log |
| dom | npm test --prefix tests/frontend | PASS | 0 | 16.43 | docs/audit/2026-11-12/logs/baseline-dom.log |
| api | python tests/api_integration.py --dom | PASS | 0 | 33.44 | docs/audit/2026-11-12/logs/baseline-api.log |
| tenancy | python tests/tenancy_integration.py | PASS | 0 | 28.79 | docs/audit/2026-11-12/logs/baseline-tenancy.log |
| platform | python tests/platform_integration.py | PASS | 0 | 25.74 | docs/audit/2026-11-12/logs/baseline-platform.log |
| global | python tests/global_patients_integration.py | FAIL | 1 | 24.2 | docs/audit/2026-11-12/logs/baseline-global.log |
| booking | python tests/booking_review_integration.py | PASS | 0 | 23.3 | docs/audit/2026-11-12/logs/baseline-booking.log |
| high | python tests/high_severity_integration.py | PASS | 0 | 84.83 | docs/audit/2026-11-12/logs/baseline-high.log |
| feedback | python tests/tester_feedback_integration.py | FAIL | 1 | 16.16 | docs/audit/2026-11-12/logs/baseline-feedback.log |
| round2 | python tests/tester_round2_integration.py | PASS | 0 | 38.85 | docs/audit/2026-11-12/logs/baseline-round2.log |
| overnight | python tests/overnight_integration.py | PASS | 0 | 16.34 | docs/audit/2026-11-12/logs/baseline-overnight.log |
| discovery | python tests/discovery_web_smoke.py | PASS | 0 | 191.47 | docs/audit/2026-11-12/logs/baseline-discovery.log |
| accessibility | node tests/frontend/accessibility-browser.cjs | PASS | 0 | 17.0 | docs/audit/2026-11-12/logs/baseline-accessibility.log |
| http | python tests/http_smoke.py | PASS | 0 | 2.83 | docs/audit/2026-11-12/logs/baseline-http.log |

## Revalidation and additional execution

| Execution | Final outcome | Evidence |
|---|---|---|
| Shared-patient full revalidation | PASS: 64 API + 30 browser | logs/global-revalidated.log |
| Feedback full revalidation | PASS: 52 browser + database check | logs/feedback-revalidated.log |
| API route/method/role matrix | PASS 379/379 | logs/targeted-api.log; evidence/api-matrix-results.json |
| Database checks and keys | PASS 46 + 266 | logs/database-probes.log; logs/columns-keys-final.log |
| Role/session/security matrix | PASS 76/76 | logs/security-targeted.log |
| Complete status matrix | PASS 225/225 | logs/status-matrix.log |
| Additional real-DB browser flows | 49 PASS, 11 FAIL | logs/browser-targeted-final.log |
| Stored HTML, aligned physical drag, drawer | PASS 3/3 | logs/browser-extra-final-positive.log |
| Off-grid pointer drop | Correctly rejected 409, saved visit unchanged | evidence/calendar-off-grid-rejection.json |
| API growth measurements | HTTP requests succeeded; measured acceptance failure H01 | logs/performance.log; logs/performance-final.log |
| Browser growth measurements | Rendering completed; 20.5s blocking task, H01 | logs/browser-performance.log |
| Paired restore and app verification | PASS 11/11 | logs/restore-verified.log |
| EF model inspection | PASS no pending changes/migrations | logs/model-audit-reproducible.log |
| Extra Core probes | One PASS / one expected exposed FAIL, executable exit 1 | logs/core-additional-final.log |
| Production public access | BLOCKED by environment CONNECT proxy 403 | evidence/production-access.json |

## Attempt adjudication

- Original global browser failure: patient POST /data/patients now receives authorization 403 before CSRF. Replaced with a valid booking to isolate stale-token rejection; full revalidation passed.
- Original feedback failure: assertion ran before matchMedia resize event completed. Added event-state wait; full suite and 20 further transitions passed.
- Initial API-matrix failures: singular /api/patient route classification accidentally included plural /api/patients; anonymous platform login was not a protected role test. Corrected harness; 379 final assertions passed. Independently found a similar real prefix bug in OpenAPI generation (M05).
- SQL harness: JSON t/f parsing and identity ALWAYS versus BY DEFAULT SQLSTATE expectations refined. Final 312 independent database assertions passed. Those refinements did not alter constraints.
- Browser harness: awaited slot population, disambiguated password-submit buttons, corrected PatientSessions.PatientAccountId probe, and synchronized seeded data. Final source flow completed with failures only for reproduced application findings.
- Early drag requests landed off-grid at 10:40 and were rejected safely. Final pointer coordinates produced a valid 10:30 reschedule with version increment and history verification.
- Early restore attempts hit local harness /proc access and SDK PATH issues after successful physical restore. Environment construction/SDK activation corrected; final restore passed completely.
- Growth helper initially assumed all JSON responses were objects; the next-slot endpoint returns a list. Corrected measurement adapter and retained existing small/large measurements instead of relabelling large data as a small baseline.
- The default intermediate targeted-results filename was superseded by catalogue setup. The complete 379 API records were recovered exactly from the preserved JSON-lines log and the API script now uses its own result filename.

## Log inventory

- [baseline-accessibility.log](logs/baseline-accessibility.log)
- [baseline-api.log](logs/baseline-api.log)
- [baseline-booking.log](logs/baseline-booking.log)
- [baseline-core.log](logs/baseline-core.log)
- [baseline-discovery.log](logs/baseline-discovery.log)
- [baseline-dom.log](logs/baseline-dom.log)
- [baseline-feedback.log](logs/baseline-feedback.log)
- [baseline-global.log](logs/baseline-global.log)
- [baseline-high.log](logs/baseline-high.log)
- [baseline-http.log](logs/baseline-http.log)
- [baseline-overnight.log](logs/baseline-overnight.log)
- [baseline-platform.log](logs/baseline-platform.log)
- [baseline-round2.log](logs/baseline-round2.log)
- [baseline-tenancy.log](logs/baseline-tenancy.log)
- [browser-extra-complete.log](logs/browser-extra-complete.log)
- [browser-extra-final-positive.log](logs/browser-extra-final-positive.log)
- [browser-extra-final-verified.log](logs/browser-extra-final-verified.log)
- [browser-extra-final.log](logs/browser-extra-final.log)
- [browser-extra-revalidated.log](logs/browser-extra-revalidated.log)
- [browser-extra-small-fixture.log](logs/browser-extra-small-fixture.log)
- [browser-extra-verified.log](logs/browser-extra-verified.log)
- [browser-extra.log](logs/browser-extra.log)
- [browser-performance.log](logs/browser-performance.log)
- [browser-targeted-final.log](logs/browser-targeted-final.log)
- [browser-targeted-revalidated.log](logs/browser-targeted-revalidated.log)
- [browser-targeted.log](logs/browser-targeted.log)
- [build.log](logs/build.log)
- [columns-keys-final.log](logs/columns-keys-final.log)
- [columns-keys-revalidated.log](logs/columns-keys-revalidated.log)
- [columns-keys.log](logs/columns-keys.log)
- [core-additional-final.log](logs/core-additional-final.log)
- [core-additional.log](logs/core-additional.log)
- [database-probes.log](logs/database-probes.log)
- [feedback-revalidated.log](logs/feedback-revalidated.log)
- [fixture-migrate.log](logs/fixture-migrate.log)
- [git-fetch-final.log](logs/git-fetch-final.log)
- [git-fetch.log](logs/git-fetch.log)
- [global-revalidated.log](logs/global-revalidated.log)
- [model-audit-reproducible.log](logs/model-audit-reproducible.log)
- [model-audit.log](logs/model-audit.log)
- [npm-audit.log](logs/npm-audit.log)
- [nuget-audit.log](logs/nuget-audit.log)
- [performance-final.log](logs/performance-final.log)
- [performance.log](logs/performance.log)
- [publish-api.log](logs/publish-api.log)
- [publish-web.log](logs/publish-web.log)
- [restore-final.log](logs/restore-final.log)
- [restore-migrate.log](logs/restore-migrate.log)
- [restore-verified.log](logs/restore-verified.log)
- [restore.log](logs/restore.log)
- [security-targeted.log](logs/security-targeted.log)
- [status-matrix.log](logs/status-matrix.log)
- [targeted-api-initial-harness.log](logs/targeted-api-initial-harness.log)
- [targeted-api.log](logs/targeted-api.log)
