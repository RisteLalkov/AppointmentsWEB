# Backend delivery verification — 22 September 2026

Verified implementation commit: [`39076557c8741a98bdb9910f3c3d3db26dea3c43`](https://github.com/RisteLalkov/AppointmentsWEB/commit/39076557c8741a98bdb9910f3c3d3db26dea3c43). Later delivery documentation commits do not change executable source. [Actions run](https://github.com/RisteLalkov/AppointmentsWEB/actions/runs/35777736060).

| Check | Result | Execution environment |
| --- | --- | --- |
| Release solution build | 0 warnings, 0 errors | Local Linux; GitHub Ubuntu and Windows |
| Core scheduling/JSON rules | 56/56 passed | Local Linux; GitHub Ubuntu and Windows |
| MVC/JSON HTTP integration | 36/36 passed | Local Linux; GitHub Ubuntu and Windows |
| DOM/JSON workflows | 21/21 passed | Local Linux; GitHub Ubuntu and Windows |
| PostgreSQL + two API instances + MVC | 64/64 passed | GitHub Ubuntu, real PostgreSQL 17.11 service |
| Direct SQL constraints | 7/7 passed | Same PostgreSQL service; independent transaction rollbacks |
| DOM with API/PostgreSQL backend | 21/21 passed | Same Ubuntu job, actual MVC/JavaScript/API/database |
| NuGet vulnerability query including transitive packages | No known vulnerable packages reported by configured NuGet source | Local `dotnet package list --vulnerable --include-transitive --no-restore` |
| JavaScript/Python syntax checks | Passed | Local |

The SQL tests independently verify doctor and patient exclusion constraints, invalid time ranges/statuses, patient foreign keys, role/profile links, and cancelled-slot behavior. They create isolated temporary fixture rows and roll back; a different constraint cannot masquerade as the one under test.

The API suite verifies authenticated access, registration restricted to Patient, duplicate identity handling, account provisioning, role/ownership denial, repeat-submission idempotency, simultaneous double-booking across API instances, overlapping patient bookings across different doctors, doctor phone booking, rescheduling/stale versions, protected schedules, exceptions, cancellation, browser antiforgery, MVC-to-API writes, API outage behavior, persistence/session durability after restart, audit events, account disabling, password change/logout revocation, password lockout, and Production demo/session/OpenAPI guards. The entire schema is created by the actual EF migration on a fresh database.

Earlier runs exposed test-fixture assumptions (an unnamed service selected as a doctor login, an HTML-encoding assertion, and two SQL constraints competing in one fixture). These were corrected and the complete suite rerun successfully. No failed check was suppressed or changed to a skip.

Not executed: real-browser visual/mobile/screen-reader/pointer-drag QA, interactive Visual Studio F5 setup, or a deployed TLS/reverse-proxy environment. Windows CI compiles the solution and exercises HTTP/DOM flows but is not an interactive Visual Studio session. The local development container could not host PostgreSQL; database claims above are based on the successful GitHub-hosted real PostgreSQL run. jsdom validates behavior, not layout.

No known failing automated checks remain. Outstanding product scope: email verification/recovery, MFA/OIDC, reminders/sync, large-clinic windowed UI loading, production operations/retention/monitoring and reviewed deployment security. Legacy JSON data is preserved but not automatically imported into verified accounts.
