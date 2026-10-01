# Appointment history and filters

## Workspace

Open an appointment's **Детали** to see **Историја на терминот**, newest change
first. Entries show the authenticated actor's name and role, recording time,
previous/new date and time, and previous/new status. Cancellation explicitly
identifies the responsible role: patient, doctor, or reception/administrator.
Times are displayed in the configured clinic timezone. The timeline scrolls within
the dialog; its content is keyboard reachable. Loading, retry and stale-detail
messages are provided. A delayed response cannot overwrite another dialog.

New bookings record creation; rescheduling and every successful status transition
record their before/after values. Service and patient assignment are immutable in
the current booking workflow, so there is no change event for those fields.
Actor names/roles are snapshots at the time of the action. Entries contain no
passwords, session tokens, contact details or medical notes.

Old appointments are not backfilled. If creation was not captured, the UI clearly
explains that earlier detailed history is unavailable. Subsequent changes still
record actual before/after values. A demo reset intentionally clears history with
the rest of the demo data. Existing generic operational audit events remain intact.

The **Термини** page groups search, doctor, patient, service, status and inclusive
start/end date filters in the existing padded workspace card. Patient selection
is available to staff; the doctor's choices derive from their own appointments.
Patients retain access only to their own records. Date filtering uses the
appointment START date in the clinic timezone. Open-ended ranges are supported;
a reversed range shows validation. Filters combine with the existing
upcoming/previous/all tabs; choose **Сите** to search across all statuses/dates.
**Исчисти** resets the fields while preserving the selected tab and doctor scope.
These UI filters apply to the already role-scoped bootstrap records; they do not
replace server authorization. Large-dataset server-driven UI pagination remains
future work.

## API and storage

`GET /api/appointments/{id}/history` (MVC proxy `/data/appointments/{id}/history`)
returns `currentVersion`, `hasCreationRecord`, and `entries`. All roles must be
allowed to read that appointment. Missing and inaccessible IDs return 404; an
anonymous caller receives 401. A repeatable-read transaction returns a consistent
version/history pair. Histories are loaded on demand, not included in bootstrap.

`GET /api/appointments` also supports `doctorId`, `patientId`, `serviceId`, `status`
in addition to existing UTC-offset `from`/`to`, `skip` and `take`. Role scope is
applied first and cannot be widened with filters. As before, the API time window
uses interval overlap (exclusive end); `from >= to` is rejected. Service filtering
supports actual catalogue IDs, legacy service-profile IDs, and `unassigned`.

Core rules create immutable `AppointmentHistoryEntry` snapshots inside the same
write operation as an appointment. PostgreSQL inserts those rows in the same
transaction as the appointment, idempotency response and operational audit.
Rejected or rolled-back actions add no entries, and booking replays add none.
A unique appointment/version index prevents duplicate revisions. Foreign keys,
range checks and required before/after fields protect database consistency.
No API exists to edit or delete history. This is application audit history, not
a claim of tamper-proof storage against privileged database administrators.

## Existing server deployment with DBeaver

Database host: **10.20.1.102** (the migrated PostgreSQL server).
API/Web hosting remains **10.20.1.100**, unless separately moved.

1. Pull main and build Release. Back up the server `appointments` database.
2. Stop the two appointment sites for the update.
3. In DBeaver on **10.20.1.102 → appointments**, using the database migration owner,
   execute the entire `database/003-appointment-history.sql` script with **Alt+X**.
   This assumes the previous catalogue migration is installed. It creates the
   history table without changing or inventing old appointment records.
4. If using a separate runtime role named `careline_app`, grant its new privileges
   from the same database owner connection:

   ```sql
   GRANT SELECT, INSERT ON TABLE public."AppointmentHistory" TO careline_app;
   ```

   Replace the role/schema only if your installation uses different names. No
   new sequence privileges are needed. Direct history UPDATE/DELETE permissions
   are not required by the application.
5. Verify the migration:

   ```sql
   SELECT * FROM "__EFMigrationsHistory"
   WHERE "MigrationId" = '20261001070652_AppointmentHistory';
   ```

   Expect one row. Do not continue after SQL errors; roll back the failed
   transaction and resolve the first error before retrying the complete script.
6. Publish **both Appointments.Api and Appointments.Web**, preserving the API's
   database connection to `10.20.1.102` and other server settings. Include Web CSS
   and JavaScript. Restart both sites and refresh with Ctrl+F5.
7. Make a test booking, reschedule it, then cancel it. Open its details and verify
   the three attributed history entries. Existing appointments instead show the
   legacy-history notice until new changes occur.

The SQL is idempotent. Development automatic migrations apply it on API startup
when configured; Production does not migrate automatically. For a fresh manual
installation apply scripts 001, 002 and 003 in order. EF `--migrate` applies all
pending migrations. Never reset or reimport the database for this update. Dropping
the new table loses detailed history; plan rollback with a database backup.
