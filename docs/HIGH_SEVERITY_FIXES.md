# High-severity audit fixes and deployment — 2 November 2026

This update addresses H01–H07 from the [production readiness audit](audit/2026-11-02/PRODUCTION_READINESS_AUDIT.md). That report remains the historical record of the audited version. Medium and Low findings have not all been resolved; this update alone is not production approval.

## What changed

| Finding | Implementation and verification |
|---|---|
| H01 — HTTP authentication | In Production with HTTP testing disabled, API and Web reject remaining HTTP requests with 403 when HTTPS redirection cannot find a target. Untrusted forwarded scheme headers are ignored. Configure real TLS at IIS and test the public URLs; application tests cannot establish your server's certificate or firewall configuration. |
| H02 — shared Web visitor quota | Web signs the actual client address with a shared random secret. API verifies the signature and timestamp before partitioning the existing auth/discovery limits. Arbitrary forwarded client headers cannot select a quota. Structured 429 responses include Retry-After. Real browser tests exercise different original visitors through one Web/backend connection. Limits remain per API process; multiple-instance distributed throttling is a separate improvement. |
| H03 — all administrators disabled | A clinic-scoped database advisory lock serializes access changes across API instances. The actor's enabled administrator role is rechecked inside the transaction, and at least one enabled administrator must remain. Concurrent mutual-disable tests preserve an administrator and reject the other request. |
| H04 — unrelated clinic blocks login | `careline_identity.accounts` in the shared **appointments** database routes normalized login identities directly to their clinic. Account triggers maintain the directory atomically for creation, credential changes and deletion, with global collision protection. Login validates only the selected clinic's binding. A newly indexed clinic can refresh routing on another API instance. Startup rejects an incomplete directory backfill. A misbound unrelated clinic no longer blocks healthy login. |
| H05 — platform outage/readiness | Registry reads run in the background every five seconds with a three-second query/cancellation budget. Ordinary clinical reads and known-clinic logins do not query the platform database. A validated snapshot has a hard **30-second lease**; failed refreshes do not extend it. Readiness becomes 503 after a failed refresh; `/health/live` remains a separate liveness probe. After lease expiry clinical requests fail closed until recovery. This bounds short-outage impact; it does **not** provide indefinite operation without the platform database or eliminate the need for platform availability. |
| H07 — Web account access forms | Both buttons post explicit `true`/`false` strings. Real Chromium tests submit both forms and verify session revocation. |
| H06 — full-day patient reservations | Patient self-service defaults to **three future active visits** and **one pending request per doctor per day**. Limits apply on booking and rescheduling, are checked under a patient-level database lock across doctors/instances, and exclude identical idempotent replays. Reception/doctor bookings can authorize additional visits. Canceling releases quota. No confirmed visit is automatically expired. |

Registry updates are immediate on the API instance making a platform change, and normally reach other instances within five seconds. During an outage the maximum snapshot age is 30 seconds. Non-ready managed clinics remain explicit disabled entries, so an adopted clinic cannot fall back to configured defaults. Patient registration rechecks the refreshed registration policy before creating an account. Startup still requires a working platform registry when configured; the routing lease is not an offline startup mechanism. A clinic rejected during non-migration startup remains quarantined until its configuration/schema is repaired and that API process is restarted. Global readiness covers shared dependencies; per-clinic `/health/database` remains an authenticated binding/database check.

## Required update steps for your server

**Do these before starting the new API/Web. This release needs a database upgrade and a new shared secret.** Keep your existing connection strings, passwords, hostnames and platform bootstrap settings.

1. Back up **both complete databases**, including every schema. Stop **all old API and Web instances/application pools**, including other copies using these databases. Do not run old/new versions together while installing the identity triggers.
2. From your repository folder on the PC, pull and publish both Windows outputs using the checked-in folder profiles:

   ```powershell
   git pull --ff-only origin main
   dotnet publish .\src\Appointments.Api\Appointments.Api.csproj -c Release -p:PublishProfile=FolderProfile -o .\publish-api
   dotnet publish .\src\Appointments.Web\Appointments.Web.csproj -c Release -p:PublishProfile=FolderProfile -o .\publish-web
   ```

   Copy the **complete publish outputs**, preserving the server appsettings files and their overrides. The API output must include `database/008-identity-directory.sql` and its other database scripts. Never copy just the application DLL or source directory.
3. Generate one random proxy secret in PowerShell (works in Windows PowerShell 5.1):

   ```powershell
   $proxyBytes = New-Object byte[] 32
   $proxyRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $proxyRng.GetBytes($proxyBytes)
   $proxyRng.Dispose()
   [Convert]::ToBase64String($proxyBytes)
   ```

   Save the result in your password manager. Set **the same value** as `Hosting:WebProxyKey` in both server appsettings files, or as the `Hosting__WebProxyKey` environment variable for both hosts. Each Production host refuses startup when the key is absent or shorter than 32 characters. Do not commit the real key to GitHub, send it in chat, or reuse the example CI test key.

   Merge with your existing Hosting section, for example:

   ```json
   "Hosting": {
     "AllowHttpForTesting": true,
     "WebProxyKey": "PASTE_THE_GENERATED_VALUE_HERE"
   }
   ```

   `true` is only for your existing private HTTP test URLs. For public production use **false**, valid HTTPS bindings on IIS, and an HTTPS `Backend:ApiBaseUrl`. With testing disabled, an HTTP-only listener now returns 403 instead of accepting credentials.
4. With all API/Web instances still stopped, run from the **published API directory**:

   ```powershell
   cd C:\inetpub\AppointmentsAPI
   dotnet .\Appointments.Api.dll --migrate
   ```

   Run the full command without `--clinic` for the first upgrade: every configured clinic, including disabled configured clinics, and every ready managed clinic must get its identity trigger/backfill. The operation is repeatable and does not reset appointments or credentials. EF may report no new EF migrations while the identity-directory upgrade still runs. If existing non-demo accounts share a normalized email across clinics, the upgrade deliberately stops rather than deleting accounts or choosing an identity silently. Correct that identity conflict before retrying.
5. Restart API and Web. Verify `/health` on API, Swagger, both existing and newly provisioned clinic logins, booking/canceling, and both account access buttons. Test two independent client addresses through the actual deployment to verify proxy attribution. Verify the seven audit regression scenarios in staging before public launch.

If an additional reverse proxy sits in front of Web/API, configure only its actual addresses in `Hosting:TrustedProxies`, for example `["10.20.1.50"]`. Both the forwarded address and scheme are trusted only from that explicit peer. Do not add arbitrary client networks or accept Internet-supplied forwarded headers. The checked-in publish profiles use IIS **in-process** hosting, where IIS supplies the connection address and scheme. If you deliberately switch to **out-of-process** IIS hosting, explicitly trust its actual loopback forwarding peer (for example `127.0.0.1` and/or `::1`) and keep the backend listener private. Inspect and test your actual topology before adding a trusted proxy.

Backups must continue to include all schemas in appointments, including `careline_identity`. Do not restore only clinical tables without their directory/triggers. Run `--migrate` with all hosts stopped after a partial/legacy restore. Keep the shared proxy key with the server configuration backup; rotate it on both hosts together.

### Booking configuration

The API accepts optional server-owned settings:

```json
"Booking": {
  "MaxFutureAppointments": 3,
  "MaxPendingPerDoctorPerDay": 1
}
```

The allowed ranges are 1–20 future visits and 1–3 pending requests per doctor/day. Defaults apply when omitted. Self-service caps include staff-created future visits for that patient, so staff can help when a legitimate additional visit exceeds the limit. Identity verification and public sign-up abuse policy remain launch decisions from the Medium findings; a booking quota does not verify a person's identity.

## Realistic sample clinic

The interface now labels patients normally, without “Измислен пациент” on each row/card. Fresh development demo data uses 32 natural Macedonian names, reserved `example.test` addresses, a partially occupied diary, historical completed/canceled/no-show visits and upcoming appointments. No real personal/contact or medical details are generated. Demo access remains Development-only.

For the **existing clinic that still contains only test data**, the explicit preview command can add this richer diary while preserving existing patients, appointments, accounts, credentials and schedules. It creates separate `preview-*` patient/appointment IDs, adds matching synthetic scheduling history, and does not create login credentials. It also removes demo suffixes from original flagged synthetic patient profiles and their demo account display names. Existing confirmed bookings and availability exceptions take priority. New services and doctor schedules must be configured by the clinic; the seed uses those settings and does not invent working hours.

After the upgrade and backup, with Web/API stopped:

```powershell
cd C:\inetpub\AppointmentsAPI
$env:Preview__AllowSeed = 'true'
try {
    dotnet .\Appointments.Api.dll --seed-preview --clinic main
} finally {
    Remove-Item Env:Preview__AllowSeed -ErrorAction SilentlyContinue
}
```

Restart normally and browse the clinic as reception, doctor and patient. Use Accounts & access to link a chosen sample patient to a new test login if needed. Repeating the command on the same day does not duplicate its generated appointments. Running it on later dates can add a new date window; it is an additive preview tool, not a cleanup/reset tool. **Do not run this against a clinic once it contains real patient data.** Normal startup and `--migrate` never run the preview operation.

## Excel source data versus application rules

The old `TuesdayFirst` property is retained only for database compatibility. It does not prioritize, block or reorder appointment availability; the regression suite explicitly proves that Wednesday availability does not depend on Tuesday being filled. `SourceSchedules` and workbook prose are historical metadata, not executable rules or user-facing instructions.

The system uses stored doctor hours, exceptions, services and explicit clinic controls. Existing imported hours/flags are still stored data; they are not silently discarded by this upgrade. Both **confirmation required** and **booking through reception only** are editable checkboxes in doctor management. Profile booking instructions are derived from those current settings rather than the old workbook description. Empty new Production databases no longer auto-import the historical spreadsheet roster. Development demo imports or an explicitly requested `Demo:ImportSourceDoctors` import remain opt-in sample-data paths.

## Regression commands

Build first. Run database suites only against disposable test/integration databases, using the existing guarded fixture coordinator. The ordinary API suite needs its own fresh empty database; the other suites create their own fixtures.

```text
dotnet build Appointments.sln -c Release
dotnet run --project tests/Appointments.Tests -c Release --no-build
python tests/http_smoke.py
python tests/discovery_web_smoke.py
npm test --prefix tests/frontend
python tests/api_integration.py --dom
python tests/tenancy_integration.py
python tests/platform_integration.py
python tests/high_severity_integration.py
```

The High suite covers two API instances, realistic Web form submission, signed/forged client attribution, concurrent administrator/booking changes, registry outage/lease/recovery, preview repeatability, and HTTP-only Production listeners. Chromium requires Playwright, `TEST_BROWSER_EXECUTABLE` and `NODE_PATH`; CI installs the browser and runs this gate explicitly.

## Verification completed in the cloud workspace

| Check | Result |
|---|---|
| Release build | Passed, zero warnings and errors |
| Domain/persistence executable tests | 92/92 |
| MVC HTTP smoke | 38/38 |
| Public discovery/company MVC contracts | 79/79, using the existing stub API |
| Existing Chromium UI suite | 140/140, stub public API and JSON demo workspace |
| Password visibility / DOM workflows | 16/16 and 85/85; DOM workflows also passed through the real API fixture |
| Real PostgreSQL/API/MVC integration | 125/125, plus 7/7 direct constraints and legacy/repeated SQL upgrade checks |
| Multi-tenant integration | 75/75, plus 12/12 tenant DOM checks |
| Platform/discovery integration | 103/103; the old ambiguous-identity injection now asserts SQL rejection instead |
| New High-severity integration suite | 62/62 against actual published API/Web outputs, plus successful real browser account-access, client-attribution and doctor-setting round trips |
| Backup/restore | Full clinical backup restored into an isolated database; existing row counts, identity trigger, newly indexed account login and original appointments verified |
| Windows self-contained folder profiles | Both cross-published successfully; executables, Swagger DLL, identity SQL and Web assets present |

The transport regression includes a real HTTPS Kestrel listener with a temporary test certificate and certificate validation enabled. Windows outputs were inspected but could not be executed under Windows/IIS here. Your live databases, IIS, DNS, ingress TLS, key settings and production permissions were not accessed or changed. The cloud restore/preview/fault tests used isolated databases; no real patient records were created. Revalidate the deployed topology and remaining audit findings before public launch.
