# 12 November 2026 audit harnesses

These are **audit-only tools**, not application migrations or production setup scripts. Findings and authoritative retained results are in [the report](../../docs/audit/2026-11-12/PRODUCTION_READINESS_QA_REPORT.md). Some probes deliberately expose known defects and therefore report FAIL/exit nonzero. No product fix is included.

## Safety and requirements

- Use Linux, .NET 10, Python 3, Docker, Node, Playwright/Chromium and axe-core. This one-off cloud harness uses `/workspace/AppointmentsWEB`, `/workspace/.setup/qa20261112`, `/workspace/.setup/qa-20261112-publish` and the named local Docker container. Adapt paths explicitly in another isolated workspace; do not point it at company databases.
- The fixture coordinator must be a **dedicated disposable database on loopback**. The helpers reject non-loopback connections and database names outside generated `careline_test_*` names. They do not accept a production connection string.
- Runtime credentials, tokens, connection strings and raw restore dumps stay in private workspace files, excluded from Git. Do not paste or commit `runtime.json`, `fixtures.json`, `clients.json` or backup dumps.
- Run one fixture coordinator at a time. Starting a second fixture while runtime metadata exists is refused. For a complete rerun, stop the prior fixture, archive/remove prior result files, and start a fresh fixture. Some security and browser scenarios intentionally mutate fixture state and are not arbitrary-order/idempotent production probes.
- Do not run the growth seeder, SQL rollback/constraint probes or status-state injector on production. The status matrix inserts synthetic starting states directly, then tests transitions through the real API and removes its temporary appointment/history rows.

## Fixture setup used for this audit

The audit used PostgreSQL 17.11, the `postgres:17-alpine` image, and ordinary generated application roles. Local trust authentication is solely for this loopback disposable container; it is not a recommended server setting.

```bash
docker --host=unix:///var/run/docker.sock run --detach --name medtermin-qa-20261112 \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_DB=medtermin_qa_20261112_test \
  --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
```

Build once and publish complete immutable outputs (not individual DLLs):

```bash
dotnet build Appointments.sln -c Release
dotnet publish src/Appointments.Api -c Release --no-build -o /workspace/.setup/qa-20261112-publish/api
dotnet publish src/Appointments.Web -c Release --no-build -o /workspace/.setup/qa-20261112-publish/web
```

If using the managed cloud SDK, first source `/workspace/.setup/activate.sh`. Supply `NODE_PATH` for the installed Playwright and axe-core modules and use `/usr/bin/chromium` as in the retained commands. The existing fixture utility must have been built under `tests/Appointments.DatabaseTests/bin/Release/net10.0`.

Start the fixture in a separate terminal/process:

```bash
python3 tests/audit/fixture_20261112.py
```

This creates separate clinical and platform databases, runs the real complete maintenance command, starts **two Production-mode APIs and one Web host**, and keeps the hosts alive until the stop file is written. Test HTTP is explicitly enabled. Private generated secrets are not printed. The fixture uses main/east/closed clinics with source import/demo seeding disabled.

## Execution order

Run the existing baseline suites listed in `evidence/baseline-results.json` with their documented disposable coordinator, `TEST_API_DLL`, `TEST_WEB_DLL`, `TEST_BROWSER_EXECUTABLE`, `NODE_PATH` and `CARELINE_TEST_CONNECTION` environment variables. Their fixtures are separate from the targeted fixture above. Tests requiring a real browser should not silently fall back to DOM-only checks.

With the targeted fixture ready, run these sequentially:

```bash
python3 tests/audit/api_matrix_20261112.py
python3 tests/audit/database_20261112.py
python3 tests/audit/columns_keys_20261112.py
python3 tests/audit/security_20261112.py
python3 tests/audit/status_matrix_20261112.py
node tests/audit/browser_20261112.cjs
node tests/audit/browser_extra_20261112.cjs
dotnet run --project tests/audit/ModelAudit -c Release
dotnet run --project tests/audit/CoreProbes -c Release
```

Run commands individually so an expected finding does not prevent independent later tests. The browser audit exposes M01–M04; CoreProbes exposes L01. Their findings are test outcomes, not permission to fix product code. Route/role probes and mutation scenarios are complementary: an anonymous/invalid-body call is not credited as successful CRUD.

Then measure growth:

```bash
python3 tests/audit/performance_20261112.py
node tests/audit/browser_performance_20261112.cjs
```

The growth experiment adds **5,000 synthetic contacts and 30,000 historical appointments** only to the fixture. It records bytes/latency and browser long tasks. Do not relabel measurement completion as performance acceptance. Preserve the small-data measurements before adding the workload. Resume metadata is scoped to the current fixture start time; for an independent new benchmark archive/remove prior measurement output first.

After all mutating/browser workloads stop, rehearse restore:

```bash
python3 tests/audit/restore_20261112.py
```

The tool takes a checked stable-data-window pair of logical dumps, restores both to new databases, compares every table fingerprint, validates migration, starts the restored API and verifies authentication/new booking. It deletes restored databases and raw dumps even on normal failure paths. Existing generated roles are reused; it does not certify new-server role/password restoration, hot cross-DB backup atomicity, PITR or production RTO/RPO.

## Cleanup and reporting

Stop the fixture and wait for its process to finish. Its finally block terminates hosts and drops both generated databases/roles:

```bash
touch /workspace/.setup/qa20261112/stop
```

Once the fixture process has exited, remove **only the named disposable container created for this audit**:

```bash
docker --host=unix:///var/run/docker.sock rm --force medtermin-qa-20261112
```

Generate appendices from retained evidence without requiring running hosts:

```bash
python3 tests/audit/build_report_20261112.py
```

`TEST_LEDGER.csv` deliberately includes repeated invocations and superseded harness attempts. It is not a unique-test count or code-coverage percentage. Original raw logs remain intact; see `TEST_RUNS.md` for adjudication. Two initial guarded patient "staff token" entries issued no request; these are excluded from the 76 meaningful security assertions and marked NOT TESTED in the ledger rather than credited as passes.

Application source under `src/`, migrations, production data and deployment configuration were not changed. The two existing browser-test edits improve the CSRF target and resize-event synchronization. Audit projects are not added to the production solution or publish outputs.

Printable report rendering uses `export_report_20261112.py` with python-docx and markdown-it-py 4.0.0 (audit-only dependency), then Chromium's PDF print API through a temporary loopback HTTP server. File-scheme navigation is intentionally blocked in the managed browser; no browser policy bypass is required. The Word report contains actual hyperlinks to the repository evidence.
