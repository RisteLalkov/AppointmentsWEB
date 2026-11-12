# API reference

Base URL in local Development: `http://localhost:5181`. Swagger UI: `/swagger`; OpenAPI schema: `/openapi/v1.json`. Both are available in Development and published environments. JSON properties use camelCase; enums are strings. Local booking date/time fields are ISO `yyyy-MM-dd` / `HH:mm:ss` in the configured clinic timezone. Returned start/end instants include UTC offsets. Send `Content-Type: application/json` for POST.

## Sessions

`POST /api/auth/login` accepts `{"email":"you@example.test","password":"your-password"}` and returns `accessToken`, `expiresAt`, `actor`, `demoMode`, `clinic`. The API resolves staff to their one assigned clinic. A patient receives a shared personal login and may supply an optional clinic preference; it grants access only with an existing enabled membership. Use `Authorization: Bearer <accessToken>` thereafter. Never log or commit tokens/passwords. The MVC client stores this token in its protected HttpOnly authentication cookie, not localStorage.

| Method / route | Access / purpose |
| --- | --- |
| POST `/api/auth/register` | Anonymous; `name`, `email`, `phone`, `password` (12–128 characters), creates new patient only |
| POST `/api/auth/login` | Anonymous password sign-in; generic failure and lockout feedback |
| GET `/api/auth/me` | Current authenticated actor |
| POST `/api/auth/logout` | Revoke current session; body `{}` |
| POST `/api/auth/password` | `currentPassword`, `newPassword`; revoke all sessions on success |
| GET `/api/auth/demo-users` | Development + Demo enabled only |
| POST `/api/auth/demo-login` | Same guard; `{"userId":"p01"}` |

## Scheduling

All routes below require a session. Patient reads contain only that patient's appointments/contact record. A doctor sees only their own appointments and can edit only their own availability. Staff can search the scheduling patient directory to arrange phone bookings. Public doctor directory/schedule metadata is shared with signed-in users.

| Method / route | Request / behavior |
| --- | --- |
| GET `/api/bootstrap` | Actor, provider metadata, bounded initial patients/appointments, SQL overview totals, clinic date/time and mode/capabilities; `windowed: true` in PostgreSQL mode |
| GET `/api/appointments?from=…&to=…&skip=0&take=100` | Authorized date-window query; `items` and `total`; take 1–500; timestamps must include offset |
| GET `/api/slots?doctorId=d01&date=2026-10-01` | Computed available slots; optional `excludeId` for an accessible appointment being rescheduled |
| POST `/api/appointments` | Create booking (example below) |
| POST `/api/appointments/{id}/move` | `date`, `time`, current `version` |
| POST `/api/appointments/{id}/status` | `status`, current `version` |
| POST `/api/patients` | Staff only: `name`, valid `email` and `phone` are required; demo flag derives from session |
| POST `/api/schedule/{doctorId}` | Staff scope; `periods`, `durationMinutes`, current doctor `version` |
| GET `/api/exceptions?doctorId=d01` | Staff scope; dated blocks/additional sessions |
| POST `/api/exceptions/{doctorId}` | Staff scope; `date`, `start`, `end`, `isAvailable`, `reason` |
| POST `/api/exceptions/{id}/remove` | Staff scope; body `{}`; cannot strand appointments |

Booking example (choose a date/time actually returned by `/api/slots`; do not copy the example blindly):

```json
{
  "doctorId": "d01",
  "patientId": "p01",
  "date": "2026-10-01",
  "time": "10:00:00",
  "durationMinutes": 30,
  "requestId": "d8ec6c67312a408c987e4d4180d999cc"
}
```

Use a new UUID per intended booking and retain it when retrying the same request. The API normalizes UUID formatting and returns the original response for an identical replay, even after subsequent rescheduling. A reused key with different booking fields is 409. Refresh the appointment list after a replay to see its current state.

Schedule example: `{"durationMinutes":30,"version":1,"periods":[{"day":"Monday","start":"09:00:00","end":"12:00:00"}]}`. This **replaces all weekly periods**. Read the doctor `scheduleVersion` from bootstrap and send it as `version`. Empty periods are allowed only when they do not invalidate active bookings. Split shifts/breaks use separate non-overlapping periods.

Valid statuses: Scheduled, Confirmed, Completed, Cancelled, NoShow. See the README transition table. Closed appointments are never reopened. Mutation returns the updated appointment (including incremented version), exception, patient, or a `saved` flag as appropriate.

## Account administration

Administrator only. Do not create Doctor accounts for unnamed service providers.

| Method / route | Behavior |
| --- | --- |
| GET `/api/accounts` | Safe summaries; no hashes/tokens |
| POST `/api/accounts` | `email`, `name`, `password`, `role` Doctor/Administrator; `doctorId` required for Doctor, no profile for Administrator; Patient creation returns 403 |
| POST `/api/accounts/{id}/credentials` | `email`, `password`; staff accounts only; patient targets return 403 |
| POST `/api/accounts/{id}/access` | `enabled` boolean; disabling revokes sessions; self-disabling refused |
| GET `/api/accounts/audit?take=100` | Recent operational audit events; at most 500 |

## Errors and health

Errors normally have `{"error":"Useful explanation"}`. Authentication/authorization middleware can return an empty 401/403; clients must check HTTP status before decoding. 400 = invalid fields/transition; 401 = missing/expired/revoked session or failed login; 403 = role denied; 404 = missing/inaccessible record or disabled demo endpoint; 409 = conflict, stale version or duplicate; 429 = auth rate limit; 503 = unavailable database. A network timeout does not prove a write failed: refresh, or retry the exact booking with its original request ID.

`GET /health/live` is anonymous process liveness. `GET /health` is readiness: it checks registry initialization, shared PostgreSQL connectivity and the required identity/security store; failures return 503. `GET /health/database` requires clinic authentication and checks that clinic’s connectivity. API request bodies are limited to 64 KiB. Swagger/OpenAPI documentation is public; operation authorization remains enforced. No CORS wildcard or public database reset is enabled. Existing clinic migrations remain explicit outside Development; company onboarding explicitly migrates its reserved clinic schema in the shared database.

## Bounded workspace reads (12 November 2026)

PostgreSQL `/api/bootstrap` now returns `windowed: true`, up to 50 next active
appointments plus 50 recent/other appointments, and the first 50 patients plus
contacts needed for those visits (at most 150 patients). It is **not a history
export**. `overview` contains complete role-scoped database counts and seven
Monday–Sunday counts; `calendarDoctorServices` preserves historical service
filter choices. Demo/JSON mode retains its existing complete collections and
`windowed: false`.

| Method / route | Response / purpose |
| --- | --- |
| GET `/api/workspace/patients` | `{ items, total, locatedSkip }`; staff directory or patient’s own record |
| GET `/api/workspace/appointments` | `{ items, patients, total }`; role-scoped appointment page and its contacts |
| GET `/api/workspace/appointments/{id}` | `{ appointment, patient }`; accessible current details, including visits outside bootstrap |
| GET `/api/workspace/patients/{id}` | Patient, one page of role-scoped `appointments`, `total`, `canEdit`, complete `counts` |

All require a bearer and the matching `X-Clinic`. Query fields: `skip` (>=0),
`take` (1–500, default 12), `search` (<=200 chars), `doctorId`, `patientId`,
`serviceId`, `status`, inclusive local `from`/`to` (`yyyy-MM-dd`), and `period`
(`all`, `upcoming`, `previous`, `past`). Patient directory search covers name,
email, phone and permanent PT number, including Cyrillic under C-locale databases.
Its optional `doctorId` limits contacts to that doctor’s accessible appointments;
`locateId` returns the page containing a matching contact and its `locatedSkip`.
Appointment search covers patient identifiers/contacts and doctor name.
`overlap=true` includes visits ending after `from`, for calendar windows that
start during an overnight appointment; the default list filter uses start dates.
`previous` means everything outside active future visits; `past` means ended
visits. Patient-history pages default to newest first; upcoming pages oldest first.
The browser uses these endpoints for complete search, paging, old details and
calendar windows; it retains a bounded record cache. A calendar window above
5,000 appointments asks the user to narrow filters.

## Appointment history and combined filters

See [APPOINTMENT_HISTORY.md](APPOINTMENT_HISTORY.md) for the role-scoped
`GET /api/appointments/{id}/history` endpoint, snapshot fields, and optional
patient/doctor/service/status filters on the appointment list endpoint.

## Clinic selection

`GET /api/clinics` returns enabled, discoverable clinic summaries. Clinical calls use `X-Clinic: <id>`; multiple clinics require it and a single enabled clinic supports omission for compatibility. Unknown/disabled IDs return 404, missing selection returns 400, and another clinic's bearer returns 401. **Credentials-only `/api/auth/login`, `/api/public/*`, and `/api/platform/*` do not select a clinic from this header.** Registration/demo endpoints still use it. Login sessions and `/api/auth/me` include a `clinic` object. MVC sends the clinic stored in its protected cookie; `/data/*` AJAX also requires `X-Workspace-Clinic` matching the rendered page. See [operator setup](MULTI_TENANCY.md) and [identity migration](PLATFORM_AND_DISCOVERY.md).

## Patient profiles

`GET /api/patients/{id}` returns the patient, role-scoped appointments and `canEdit`. `POST /api/patients/{id}` accepts `{ name, email, phone, version }` for staff contact edits. Stale versions/duplicate email return 409; inaccessible profiles return 404; patient edits return 403. Login credentials remain independent of contacts. See [patient profiles](PATIENT_PROFILES.md).

## Public discovery and company operations

| Method / route | Access / purpose |
|---|---|
| GET `/api/public/clinics` | Anonymous paginated public clinic search |
| GET `/api/public/clinics/{id}` | Anonymous public clinic profile |
| GET `/api/public/doctors` | Anonymous paginated doctor search: `search`, `clinic`, `clinicId`, `specialty`, `service`, `page`, `pageSize` |
| GET `/api/public/clinics/{clinicId}/doctors/{doctorId}` | Anonymous public doctor projection |
| POST `/api/platform/login` | Separate company credentials; returns platform token, expiry, ID/name |
| GET `/api/platform/clinics` | Platform token only; configured and managed clinic summaries |
| POST `/api/platform/clinics` | Platform token only; validated `ProvisionClinicInput`, resumable clinic + admin provisioning |
| POST `/api/platform/password` | Platform token only; `currentPassword`, `newPassword`; revoke all operator sessions |
| POST `/api/platform/logout` | Platform token only; revoke current session; body `{}` |
| GET `/api/platform/audit?take=100` | Platform token only; most recent operational events, capped at 500 |

Public pages are limited to 24 rows/page and pages 1–100; query text is bounded.
Company tokens use the separate `PlatformSession` authentication policy and do not
authorize clinical endpoints. Clinic Administrator tokens do not authorize platform
operations. Full provisioning/configuration and failure recovery: [PLATFORM_AND_DISCOVERY.md](PLATFORM_AND_DISCOVERY.md).

## Swagger UI

Open `/swagger` on the **API** base URL (local default:
`http://localhost:5181/swagger`). Publish the full API output, including the
SwaggerUI dependency; no Web or database update is required. The UI serves its
assets locally, and its relative OpenAPI URL supports an IIS application subpath.

For clinic operations, execute `POST /api/auth/login`, copy the returned
`accessToken`, click **Authorize**, and paste that token without adding `Bearer`.
Supply the matching clinic ID (for example `main`) in the documented **X-Clinic**
header. For company operations obtain a platform token from
`POST /api/platform/login` and use that token instead. Tokens are opaque sessions,
not JWTs. Public operations require no token; registration still selects a clinic.

**Try it out** executes the actual API with the supplied account's permissions.
No extra privileges are granted by Swagger. Authorization is not configured for
persistent browser storage; sign out of the UI when done with a shared computer.

## Global patient accounts (10 November 2026)

Patients use `u1.` bearer tokens for one shared login; staff retain `c1.<clinic>.`
tokens and company operators retain the separate `p1.` scheme. Login accepts an
optional `clinicId` preference **only for patients**. It never creates a membership.
Clinical requests still select `X-Clinic` and require an enabled local membership.
`GET auth/me` without X-Clinic returns the personal patient identity, not a local
profile. Its response and `SessionResponse` include `globalPatient`.

| Endpoint | Access and behavior |
| --- | --- |
| GET `/api/patient/home` | Global patient only; own joined/available clinic choices and up to 100 own upcoming visits |
| POST `/api/patient/clinics/{clinicId}` | Global patient; explicit join/select, registration policy checked for first join; idempotent profile creation |
| POST `/api/auth/password` | Current patient password required; changes the one shared password and revokes all its sessions |
| POST `/api/auth/logout` | Revokes this patient session across its clinic contexts |
| GET `/api/platform/patients?email=...` | Company operator only; exact normalized email search, no unfiltered directory/history |
| POST `/api/platform/patients/{id}/password` | Company operator only; newPassword 12–128 chars, revoke all sessions, audited reset |

Personal identity routes do not require X-Clinic. Staff cannot join another clinic
or use these patient endpoints. Local account access toggles apply only to the
selected clinic. See [design and migration](GLOBAL_PATIENT_ACCOUNTS.md).

## Operational audit records

Clinical `AuditEvents` include failed staff logins, lockouts and individual
appointment/history reads. Shared `careline_identity.SecurityEvents` records
patient login failures/lockouts and anonymous unknown-identity failures. Company
`PlatformAuditEvents` records login/lockout, session/password and clinic
provisioning/adoption/edit actions. Failed authentication uses actor `anonymous`,
never the unverified identity as the actor. Entries contain action/target IDs and
times; passwords, tokens and submitted contact values are excluded. Failure
counters and lockout events commit together. These are operational records;
retention, external tamper-resistant storage, legal policy and MFA/verification
providers still require deployment-owner decisions.
