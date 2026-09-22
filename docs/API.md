# API reference

Base URL in local Development: `http://localhost:5181`. OpenAPI schema: `/openapi/v1.json` (Development only). JSON properties use camelCase; enums are strings. Local booking date/time fields are ISO `yyyy-MM-dd` / `HH:mm:ss` in the configured clinic timezone. Returned start/end instants include UTC offsets. Send `Content-Type: application/json` for POST.

## Sessions

`POST /api/auth/login` accepts `{"email":"you@example.test","password":"your-password"}` and returns `accessToken`, `expiresAt`, `actor`, `demoMode`. Use `Authorization: Bearer <accessToken>` thereafter. Never log or commit tokens/passwords. The MVC client stores this token in its protected HttpOnly authentication cookie, not localStorage.

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

`GET /health` is anonymous process liveness after startup; it does not continuously check PostgreSQL. `GET /health/database` requires authentication and checks connectivity. API request bodies are limited to 64 KiB. No production OpenAPI route, CORS wildcard, automatic migration outside Development, or public database reset is enabled.
