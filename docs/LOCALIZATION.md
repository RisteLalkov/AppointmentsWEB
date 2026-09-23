# Македонски интерфејс / Macedonian interface

Macedonian (`mk-MK`) is the default and only interface language in this version. No language selector or external translation service is required.

## Coverage

- Patient, receptionist and doctor navigation, dashboards and directories.
- Doctor profiles, appointment booking/review/confirmation, details, cancellation and rescheduling.
- Day/week/month calendars, month and weekday names, availability, status legends and accessibility labels.
- Working schedules, exceptions, patient creation, search, filters, empty/loading/error states and dialogs.
- Login, registration, password changes, account provisioning/access, demo selection and sign-out feedback.
- Scheduling, conflict, permission and account validation messages returned by Core/API/MVC.
- Browser form constraint-validation messages (including dynamically inserted forms).

Razor text is in `Views`, dynamic workspace text in `wwwroot/js/app.js`, and native form validation in `wwwroot/js/validation-mk.js`. Role presentation is in `Services/DisplayExtensions.cs`. Both hosts establish `mk-MK` request culture. FullCalendar is configured with a local Macedonian locale object; dates use explicit Macedonian month/day labels (including browsers without Macedonian Intl data), Monday-first weeks and 24-hour times.

## Compatibility

Only presentation labels and user-facing messages change. JSON property names, route names, CSS status classes, role/status/weekday enum values, ISO date/time payloads and the Europe/Skopje scheduling rules stay unchanged. Translated select options submit explicit invariant values, e.g. `Monday` and `Patient`.

No database migration, reset, doctor re-import, or modification of existing patient/account names is performed. Doctor information from the supplied workbook stays intact. New fictional demo seeds use Macedonian names; existing persisted names, entered notes and email addresses retain their original spelling. Brand names, technical time-zone identifiers and reference numbers are retained.

Native date/time popup controls are supplied by the browser/operating system and may follow its language settings even though the page and validation messages are Macedonian. Developer logs, configuration keys and technical documentation remain English where useful.

## Update your PC

1. Stop debugging and save your work. In Visual Studio's **Git Changes**, commit your own source changes or stash them before pulling. Do not commit database passwords or publishing credentials.
2. Confirm that the repository is `RisteLalkov/AppointmentsWEB` and the branch is `main`.
3. Choose **Git → Pull**. Alternatively run `git pull --ff-only origin main` in the repository folder. If Git reports diverging/uncommitted changes, resolve them rather than overwriting your work.
4. Open `Appointments.sln`, restore packages, and build the solution. Run the API and Web startup projects as before.
5. Refresh the browser with **Ctrl+F5** if it still shows cached assets.

If working from a ZIP, download `main` into a new folder and keep the old solution as a backup. Transfer only your local configuration/publish settings as necessary; do not overwrite the newly translated source with old source files. Existing PostgreSQL data is reused with the same connection string.

## Update IIS

Publish **Appointments.Api** and **Appointments.Web** separately, using the existing profiles. Class-library changes are bundled automatically. Preserve the server-only connection string/password and the internal test `Hosting:AllowHttpForTesting` settings. The server Web API address remains `http://localhost:5543/` for the existing HTTP test bindings; development may still use port 5181. This update does not change either configuration or the user's publishing profiles.

Recycle the two application pools, check the API `/health` endpoint, and refresh the website. No PostgreSQL transfer or schema update is required for this translation.

## Verification

The existing workflow suites exercise booking, cancellation, rescheduling, permissions, scheduling conflicts and persistence. Localization assertions additionally check the document language, Macedonian navigation/months/weekdays/statuses, required-field feedback, translated server errors, and saving schedules while preserving API weekday values. The PostgreSQL integration suite exercises the actual API and MVC database path.
