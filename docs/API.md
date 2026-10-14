# API reference

Base URL in local Development: `http://localhost:5181`. OpenAPI schema: `/openapi/v1.json` (Development only). JSON properties use camelCase; enums are strings. Local booking date/time fields are ISO `yyyy-MM-dd` / `HH:mm:ss` in the configured clinic timezone. Returned start/end instants include UTC offsets. Send `Content-Type: application/json` for POST.

## Sessions

`POST /api/auth/login` accepts `{"email":"you@example.test","password":"your-password"}` and returns `accessToken`, `expiresAt`, `actor`, `demoMode`, `clinic`. The API resolves a unique clinic account from the email; a clinic hint cannot choose the account. Use `Authorization: Bearer <accessToken>` thereafter. Never log or commit tokens/passwords. The MVC client stores this token in its protected HttpOnly authentication cookie, not localStorage.

| Method / route | Access / purpose |
| --- | --- |
| POST `/api/auth/register` | Anonymous; `name`, `email`, `password` (12–128 characters), creates new patient only |
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
| GET `/api/bootstrap` | Actor, providers, role-visible patients/appointments, clinic date/time, mode/capabilities |
| GET `/api/appointments?from=…&to=…&skip=0&take=100` | Authorized date-window query; `items` and `total`; take 1–500; timestamps must include offset |
| GET `/api/slots?doctorId=d01&date=2026-10-01` | Computed available slots; optional `excludeId` for an accessible appointment being rescheduled |
| POST `/api/appointments` | Create booking (example below) |
| POST `/api/appointments/{id}/move` | `date`, `time`, current `version` |
| POST `/api/appointments/{id}/status` | `status`, current `version` |
| POST `/api/patients` | Staff only: `name`, optional `email`/`phone`; demo flag derives from session |
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
| POST `/api/accounts` | `email`, `name`, `password`, `role`, and exactly its `doctorId` or `patientId` link (neither for Administrator) |
| POST `/api/accounts/{id}/credentials` | `email`, `password`; set credentials, disable demo switching for that identity, revoke sessions |
| POST `/api/accounts/{id}/access` | `enabled` boolean; disabling revokes sessions; self-disabling refused |
| GET `/api/accounts/audit?take=100` | Recent operational audit events; at most 500 |

## Errors and health

Errors normally have `{"error":"Useful explanation"}`. Authentication/authorization middleware can return an empty 401/403; clients must check HTTP status before decoding. 400 = invalid fields/transition; 401 = missing/expired/revoked session or failed login; 403 = role denied; 404 = missing/inaccessible record or disabled demo endpoint; 409 = conflict, stale version or duplicate; 429 = auth rate limit; 503 = unavailable database. A network timeout does not prove a write failed: refresh, or retry the exact booking with its original request ID.

`GET /health` is anonymous process liveness after startup; it does not continuously check PostgreSQL. `GET /health/database` requires authentication and checks connectivity. API request bodies are limited to 64 KiB. No production OpenAPI route, CORS wildcard or public database reset is enabled. Existing clinic migrations remain explicit outside Development; company onboarding explicitly migrates only its reserved empty clinic database.

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

Public pages are limited to 24 rows/page and pages 1–100; query text is bounded.
Company tokens use the separate `PlatformSession` authentication policy and do not
authorize clinical endpoints. Clinic Administrator tokens do not authorize platform
operations. Full provisioning/configuration and failure recovery: [PLATFORM_AND_DISCOVERY.md](PLATFORM_AND_DISCOVERY.md).
