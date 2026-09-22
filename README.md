# Careline · AppointmentsWEB

A complete, interactive first-phase doctor appointment application in **ASP.NET Core MVC / Razor / C#**, with a shared JSON demonstration store. No PostgreSQL, separate API server, external account, npm install, CDN, or API key is required to run the application.

## Run in Visual Studio on Windows

1. Install **Visual Studio 2026, version 18.0 or later**, with the **ASP.NET and web development** workload and the **.NET 10 SDK**. Use the latest serviced Visual Studio 2026 release. .NET 10 is the LTS target; Visual Studio 2022 does not support targeting .NET 10.
2. Clone this repository, or download its ZIP from GitHub and extract it to a normal writable folder.
3. Open **`Appointments.sln`**.
4. Right-click the solution and select **Restore NuGet Packages**. There are no third-party NuGet runtime dependencies.
5. Right-click **Appointments.Web** → **Set as Startup Project**.
6. Select the **Careline (local demo)** launch profile, then press **F5**.
7. The browser opens **http://localhost:5180**. Choose Patient, Reception or Doctor, select an identity, and enter the workspace.

`global.json` requests SDK 10.0.100 with `latestFeature` roll-forward within .NET 10. The build was executed using **SDK 10.0.401** and **ASP.NET Core 10.0.12**. Install the current serviced .NET 10 SDK that matches your Visual Studio update; the application has no dependency on that exact patch. The SDK includes the ASP.NET Core runtime. The local HTTP launch profile avoids development-certificate setup.

Command-line equivalent:

```sh
dotnet restore Appointments.sln
dotnet build Appointments.sln -c Release
dotnet run --project src/Appointments.Web
```

If port 5180 is occupied, change `applicationUrl` in `src/Appointments.Web/Properties/launchSettings.json`.

## What is implemented

| Workspace | Workflows |
| --- | --- |
| Patient | Doctor directory, name/specialty search, profiles and original schedule notes, date/slot picker, review/confirmation, upcoming/history views, details, cancellation, rescheduling |
| Reception | All-doctor day/week/month calendar, doctor/status filters, appointment list/search, fictional patient search/creation, booking for patients, confirmation/status management, schedule and exception management, reset |
| Doctor | Own calendar and appointments, bookings for patients, rescheduling/cancellation/statuses, own weekly hours and one-off availability |

FullCalendar Standard **6.1.20** is bundled locally. It includes day/week/month views, appointment cards, status colors, current-time indicator, navigation, free drag/drop rescheduling, server-derived available-time backgrounds, and unavailable-period backgrounds. The all-doctor view overlays appointments; select a doctor for availability shading. There is no paid resource timeline. The appointment list provides a keyboard-friendly alternative to dragging and calendar cells.

The responsive interface includes mobile navigation, dialogs, loading/empty/error states, confirmations, focus styling, reduced-motion support and a simpler patient picker. UI labels are English; source doctor names, specialties and workbook notes retain their original Macedonian spelling. Location is explicitly unspecified; it is not invented.

## Demo identities and shared data

- Use **Switch demo user** in the sidebar to change perspective.
- Reception: **Alex • Reception**.
- Patients: **Ana Petrova (Demo)**, **Marko Nikolov (Demo)** and four other fictional examples. Added demo patients also become selectable identities.
- Doctor: any named doctor from the workbook. Unnamed service entries have no doctor login.
- All users share the same server-side store. A new role/page load sees current data immediately. Already-open calendars/lists refresh on window focus and every 20 seconds while idle; no SignalR dependency is included.
- Original hours are used wherever complete. Doctors without precise hours require an explicit staff-added session before times can be booked.
- Generated sample appointments are relative to the date the store is first created/reset. Samples become historical over time; reset to populate fresh examples.
- Sample patients, contact emails and appointments are fictional. **Do not enter real patient information or medical details.** No clinical-note fields exist.
- Email/SMS/calendar integrations are absent. The UI explicitly says that no notification has been sent.

### Demo security boundary

This is **not production authentication**. Anyone who can reach the demo can choose any demo identity. Cookie-protected role selection, server-side ownership checks and antiforgery validation are included to exercise permissions, not to establish real identity. Patient responses contain only the current patient's records. Doctors can access only their own private appointment records and schedule changes; staff can search the fictional patient directory.

Run on your own computer. Before production, implement real authentication, authorization, patient-data protection, encrypted transport/storage, auditing, retention, backup, rate limiting and appropriate operational/legal review. The demo is not intended for internet deployment or real medical records.

## Persistence and reset

On Windows, runtime data lives at:

```text
%LOCALAPPDATA%\CarelineAppointments\demo-state.json
```

On Linux/macOS it uses the platform's .NET `LocalApplicationData` directory plus `CarelineAppointments/demo-state.json`. Data is outside source control. All writes are serialized, validated within a transaction copy, flushed to a temporary file, and atomically renamed. Failed writes do not update the live state. A lock file prevents two application instances sharing a demo store.

**Reset:** enter as Reception → Availability → **Reset demo**, then confirm. This resets all demo users/appointments/schedule adjustments. The original workbook seed stays unchanged. Alternatively, stop the application and remove the runtime `demo-state.json` file. Back it up first if you want to preserve demonstration changes. A corrupt or unsupported state fails visibly; it is not silently overwritten.

Override storage via `Demo:DataPath` in configuration or `Demo__DataPath` in the environment. Use an absolute path outside the repository. The store supports **one application process only**. Separate sessions within that process can book concurrently safely.

## Workbook interpretation and assumptions

The input was `Raspored_Doktori_Restrukturiran.xlsx`. All four sheets were inspected. The clean `Распоред_Доктори` sheet supplies the seed: **46 schedule rows → 40 profiles (38 named providers and 2 unnamed services) → 87 weekly working periods**. **25 profiles** have fully specified recurring hours; 15 do not. The categories and booking-method sheets provide vocabulary. The original-data sheet contains old/conflicting, flattened material and phone numbers: it was inspected for ambiguity but is **not** committed or used to guess additional schedules.

See [docs/WORKBOOK_ANALYSIS.md](docs/WORKBOOK_ANALYSIS.md) for detailed decisions and traceability. Important assumptions:

- **30 minutes** is a configurable demonstration duration per doctor because no duration column exists. It is not a clinical recommendation. Staff may change it to 10–120 minutes in five-minute increments. Each doctor's supplied working hours remain independent.
- No lunch breaks, holiday dates, locations or explicit date-specific exceptions are supplied. None are invented. Staff can model breaks with split weekly periods and holidays/time away with unavailable exceptions.
- Incomplete shift labels, on-call arrangements and once-monthly schedules do not create automatic slots. Add specific available periods through Availability after agreeing the demo time.
- Working-day ranges are inclusive; weekdays follow the clean sheet exactly. There are no default weekend hours.
- Confirmation-dependent bookings start **Scheduled / Awaiting confirmation** and reserve the time. Authorized staff explicitly confirm them. Secretary-only entries reject patient self-booking. Operational notification instructions remain visible notes, not fake notification integrations.
- For **Др. Филип Дума**, Wednesday is available only after the same week's remaining future Tuesday slots are full. This is an explicit interpretation of “Tuesday first.” Past Tuesday slots do not block future Wednesday booking. Existing Wednesday bookings are never invalidated if a Tuesday slot later opens.
- `Наведено во изворот` does not establish funding eligibility; it is shown as unspecified. Only explicit `Фонд` and `Само приватно` values are treated as specified.
- Appointments can be booked at most **180 days ahead**, on the doctor's configured slot grid, and cannot cross a working-period boundary.

## Scheduling and statuses

The service is authoritative. It checks working periods, exceptions, doctor and patient overlaps, duration, past times, ownership, and optimistic versions on every write. Cancelled visits release capacity; other states retain the original occupied interval. Repeat submissions use an idempotency key. Conflicting moves leave the original appointment intact. Schedule edits cannot invalidate existing future or ongoing visits.

| Current status | Allowed next state |
| --- | --- |
| Scheduled | Confirmed by staff before start; Cancelled before start |
| Confirmed | Cancelled before start; Completed or NoShow by staff after end |
| Completed / Cancelled / NoShow | Terminal; create a new appointment instead |

Rescheduling is allowed only before start for Scheduled/Confirmed appointments. Confirmation-dependent visits return to Scheduled after moving. Patients can cancel their own upcoming visits; secretary-only visits must be moved by staff. Staff cannot mark an unconfirmed past request completed; the demo intentionally has no administrative override.

### Dates and time zones

`Scheduling:TimeZone` defaults to **Europe/Skopje**. C# uses `DateOnly`, `TimeOnly`, `TimeZoneInfo` and UTC `DateTimeOffset` instants. JSON request fields use ISO dates and 24-hour time. The frontend converts persisted instants into the configured zone using `Intl.DateTimeFormat`.

FullCalendar runs in a **wall-clock display adapter** using its UTC mode: the app sends offset-free **Skopje wall times**, and translates dragging back to a local date/time command. These calendar `Date` objects are presentation coordinates, never persisted instants. This avoids browser-location drift without requiring a timezone plugin. All actual timezone resolution happens in C#.

Nonexistent spring-forward times and ambiguous fall-back times are unavailable. Slots whose real duration differs from their wall-clock duration are excluded. The initial calendar is Monday-first and 24-hour. Change the timezone only with a fresh/reset demo store; a startup guard rejects a mismatch to prevent reinterpreting persisted schedules. Use a browser-supported IANA identifier.

## Tests and actual verification

```sh
dotnet build Appointments.sln -c Release
dotnet run --project tests/Appointments.Tests -c Release
```

The dependency-free executable test runner exits nonzero on failure. It intentionally needs no external testing NuGet package; **`dotnet test` does not run this suite**. Run the command above. It covers source counts, three-role consistency, ownership, doctor/patient overlaps, concurrency, idempotency, working-hour boundaries, split shifts, exceptions, protected schedule edits, status transitions, time zones/DST, JSON restart and resets.

Optional HTTP smoke tests (Python 3 standard library, only needed to run this additional suite):

```sh
python tests/http_smoke.py
```

This script launches a disposable local instance and isolates its data; it does not reset your demo store.

Optional DOM workflow checks (Node.js 24; dependencies are used for tests only):

```sh
npm ci --prefix tests/frontend
npm test --prefix tests/frontend
```

The GitHub Actions workflow runs build and all three test suites on Windows and Ubuntu. DOM tests execute the real Razor shell and browser JavaScript against a disposable live server using jsdom; they are not a substitute for browser visual/drag testing.

Verified in the delivery environment:

- Release solution build: **0 warnings, 0 errors**.
- Domain/persistence tests: **56/56 passed**.
- DOM interaction checks: **21/21 passed** (jsdom; this does not verify layout or pointer dragging).
- Live HTTP integration checks: **36/36 passed**.
- JavaScript syntax checks: passed.
- Browser-based visual/mobile/drag interaction testing: **not verified** because the provided cloud browser cannot access the loopback application. [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) contains the remaining manual checks. Responsive styles and drag rejection/revert handling are implemented, but are not represented as visually tested.

## Project map and next steps

```text
Appointments.sln
src/
  Appointments.Core/       Domain models, scheduling rules, service contracts, JSON store
  Appointments.Web/        MVC controllers, view models, Razor views, JS/CSS, doctor seed
tests/
  Appointments.Tests/      Executable business-rule tests
  frontend/               Optional jsdom workflow tests
  http_smoke.py           Real MVC/cookie/antiforgery integration checks
docs/
  ARCHITECTURE.md          API/PostgreSQL integration plan
  WORKBOOK_ANALYSIS.md     Source interpretation and ambiguities
  QA_CHECKLIST.md          Manual role and responsive checks
THIRD_PARTY_NOTICES.md
```

Next, implement an ASP.NET Core API with authenticated identities and PostgreSQL transactions, then replace `IAppointmentService` with an HTTP-backed implementation. Preserve the authoritative server-side rules and add database overlap constraints and optimistic concurrency. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

No known failing automated checks remain. Material phase-one limitations: single-process JSON storage, demo identity switching, English UI with Macedonian source text, no real notifications, no external calendar sync, no automatic holidays, no defined availability for incomplete source schedules, and no completed browser visual QA.

Technology references: [Microsoft .NET Windows/Visual Studio support](https://learn.microsoft.com/en-us/dotnet/core/install/windows), [.NET support lifecycle](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core), [FullCalendar licensing](https://fullcalendar.io/license). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled licenses.
