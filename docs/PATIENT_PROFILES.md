# Patient profiles

Open **Пациенти → Види профил** as reception or a doctor. Patients have **Мој профил** in their own navigation. Profiles use the workspace's existing cards, filters, buttons and appointment dialogs; all visible text is Macedonian.

## Workflows and access

- Contact summary: name, contact email and phone. Email and phone are optional.
- Reception and doctors may update clinic patient contacts. This preserves the existing staff-wide patient directory used for telephone bookings.
- Reception sees all appointments for the selected patient in the current clinic. Doctors see **only their own appointments** with that patient. Counts and filters use the same permitted subset.
- Patients can read only their own profile and appointments. Contact editing is staff-only; the API enforces this independently of the UI.
- History filters combine period (all/upcoming/past), status, doctor, service and inclusive clinic-local dates. Upcoming excludes cancelled/finished visits; past means the appointment has ended. Use All + Cancelled to include future cancelled visits.
- **Закажи термин** opens the existing booking flow with the patient preselected. **Детали** opens the existing appointment details, history, reschedule, cancellation and status controls. Existing scheduling and permission rules still apply.
- Missing or inaccessible patient IDs return 404. Profiles refresh with the workspace's existing polling, except while a dialog or input is active.
- Loading, empty, invalid-range and request-error states are included. Stale contact edits return 409, preserve typed input, and offer an explicit discard-and-reload action.

Patient contact information is separate from account identity. Changing a contact name/email does **not** change the account's login email, password, account name or sessions. Manage accounts in **Сметки и пристап**. No medical notes, messages or notification delivery are introduced.

## Implementation

- `IAppointmentService.PatientDetails` / `UpdatePatient`: shared role, normalization, uniqueness and optimistic-version rules; JSON writes retain existing process locking and atomic persistence.
- `PostgresAppointments.PatientDetailsAsync`: repeatable-read snapshot and role-scoped appointment query.
- `UpdatePatientAsync`: transaction, patient advisory lock, version validation, EF concurrency token, database unique email protection and `patient.updated` audit event. Audit events identify actor/target/time without copying contact values.
- API: `GET /api/patients/{id}` returns `{ patient, appointments, canEdit }`; `POST /api/patients/{id}` accepts `{ name, email, phone, version }` and returns the updated patient. Web proxies use the corresponding `/data/patients/{id}` routes with existing session, clinic and anti-forgery checks.
- Existing database-per-clinic routing is unchanged. No client-supplied tenant ID is accepted by these profile methods.
- Profiles currently load the permitted appointment history as a whole, like the existing workspace bootstrap. Server pagination can be added when data volume warrants it.

## Upgrade existing deployments

1. Pull `main` and build `Appointments.sln` in Release.
2. Back up each clinic database. Pause API/Web traffic during deployment.
3. In DBeaver, connect to the actual PostgreSQL server (**10.20.1.102** for the current deployment), select **appointments**, and execute the entire `database/004-patient-profiles.sql` script as its schema owner/migration account. Scripts 001–003 must already be applied. With multiple clinics, run 004 separately in every active clinic database.
4. The script only adds `Patients.Version` (existing patients start at 1) and its positive-value constraint, then records the EF migration. It does not replace patients, accounts, appointments or clinic settings. It is safe to rerun after successful completion.
5. Publish **Appointments.Api** and **Appointments.Web**, including static assets, and restart their application pools. Keep server connection strings and tenant settings. No change is needed to database passwords or API ports.
6. Open **Пациенти → Види профил** and test a fictional patient. Hard-refresh the browser if needed.

Fresh development databases using migrations receive the new schema automatically. JSON demo mode needs no SQL; older JSON patient records default to version 1. Do not enable automatic schema changes for a production runtime account merely to avoid the migration step.

## Verification

Tests cover profile access, doctor-specific history, staff editing, field validation, email uniqueness, concurrent stale writes, JSON restart, retained linked-account credentials, MVC proxy restrictions, clinic separation and legacy migration preservation. DOM checks exercise directory navigation, editing, conflict recovery, patient preselection, filters and unauthorized deep links. DOM tests do not verify browser layout.
