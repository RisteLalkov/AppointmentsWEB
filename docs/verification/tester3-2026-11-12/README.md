# Tester report 3 — implemented changes

Implemented the four authorized findings from the 12 November tester report:

- **Service editor:** existing selections appear first. The doctor list follows the selected specialty. Selections from another specialty remain visible as removable chips and survive filtering/saving; filtering never silently removes a service assignment. Checkbox changes preserve keyboard focus and current form/version handling.
- **Reports:** Today/This week/This month synchronize the visible DD.MM.YYYY controls, underlying ISO form fields and dates sent to the report endpoint. A shared date setter also prevents blur from restoring an older value.
- **Desktop navigation:** the top-left menu button hides/restores the sidebar, releases workspace width and remembers the browser preference. Hidden controls are inert. Mobile drawer, Escape/focus behavior and resize transitions remain supported.
- **Combined availability:** in **Лекари**, open **Пребарај слободни термини**, use the existing specialty/service/name filters, choose a date and search. Results span all matching doctors, including doctors outside the first directory page, sorted by appointment time. Twelve choices display initially; more can be shown. Choosing a time prefills the normal booking dialog, where availability is checked again. If another staff member deactivates a service, stale search results are rejected instead of silently switching to a different service. Patient, doctor and clinic restrictions use the existing protected API. Four concurrent reads limit request pressure; changed filters invalidate old results, and failed reads show an error instead of misleading empty availability.

Macedonian and English, all three themes and 320px mobile layouts are covered. Successful searches clear their own form's dirty flag without clearing unrelated unsaved forms, so changing language does not prompt about an already-completed search.

**Explicitly excluded:** the calendar bug where selecting one day shows seven columns. The complete `renderCalendar` implementation is byte-for-byte identical to the previous release; a hash assertion records this in `evidence/calendar-unchanged.json`. Its behavior has not been corrected or relabelled as passed.

## Verification

All tests use disposable databases and generated accounts on loopback; production was not accessed.

| Check | Result / evidence |
| --- | --- |
| Release build | 0 warnings, 0 errors — `logs/build-release-verified.log` |
| Focused real Browser → Web → API → PostgreSQL workflows | 44/44, including a persisted patient booking, clinic switching, doctor scope, selection preservation, all date presets, failed/stale reads, mobile/English/themes and accessibility — `evidence/tester3-browser.json`, `logs/tester3-stale-service-verified.log` |
| DOM and shared controls | 85 workflows + 23 language + 16 password + 14 theme + 46 date assertions — `logs/dom-release-verified.log` |
| Earlier tester-feedback regressions | 52 browser assertions and database-number check — `logs/feedback-regression.log` |
| Tester round two | 40 API/database + 59 browser assertions — `logs/round2-regression.log` |
| Shared patients / clinic isolation | 64 API/database + 30 browser assertions — `logs/global-patients-regression.log` |
| Booking review | 21 API/database + 22 browser assertions — `logs/booking-regression.log` |
| Discovery/settings/languages/themes | 89 MVC contract + 138 discovery + 87 settings + 72 language + 46 theme browser assertions — `logs/discovery-regression.log`; this separate suite uses a stub public API/demo workspace |
| Baseline accessibility | 17 automated scenarios — `logs/accessibility-regression.log` |
| HTTP integration | 38 assertions — `logs/http-regression.log` |

Counts are assertions within suites, with overlap; they are not unique scenarios or a coverage percentage. Browser tests use real API/database results except explicit outage/delayed-response injections. Automated accessibility checks do not replace assisted screen-reader testing.

Earlier development logs are retained. One early test captured the initial report request rather than the clicked preset; the corrected test waits for the initial report to finish. A later language test exposed the search form retaining its dirty flag; successful searches now acknowledge only their own unchanged form revision. The final run passes all checks. Fixture setup uses the existing guarded audit fixture, `tests/tester3_seed.py` and `tests/frontend/tester3-browser.cjs`; these tests are added to the PostgreSQL workspace CI job.

## Deployment

This update needs a **complete Web publish**. It has no new API endpoints, database migrations or data reset. The shared translation resource is included with the Web publish. Stop the Web application pool, copy the complete new Web publish output, preserve the server's `appsettings.json`, restart the Web pool and hard-refresh the browser. Existing API/database upgrades from the previous release still apply if those have not yet been deployed.

The prior production-readiness audit and its remaining owner/deployment decisions are unchanged.
