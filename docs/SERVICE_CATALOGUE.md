# Doctor, specialty and service catalogue

Administrators open **Каталог**. The three tabs manage doctors/profiles,
specialties and examination services. All screens use Macedonian labels and the
existing workspace controls. Catalogue writes are administrator-only in both MVC
and API, validated by shared Core rules, version checked, and audited in PostgreSQL.

## Workflow

1. Add or edit a specialty. Renaming it updates linked doctor descriptions.
2. Add a doctor with specialty and optional subspecialty. New doctors have no
   invented working hours. Use **Работно време** to open the existing availability
   editor and enter their actual schedule. Create their login separately in
   **Сметки и пристап** if required.
3. Add a service, choose its specialty and duration (10–120 minutes in steps of 5),
   and select the doctors/profiles providing it. A service can be offered by several
   doctors. Availability inherits each doctor's hours, breaks, dated exceptions,
   existing appointments and booking restrictions. The service's active flag
   controls whether it is available for new bookings.
4. Booking offers assigned active services and uses the chosen service's duration.
   Calendar filters, appointment-list filters and reports use actual service IDs.

Doctor/service deactivation blocks new bookings, preserving appointments and
history. Doctor login access is a separate setting. Existing appointments remain
cancellable and can be completed; rescheduling requires an active doctor and
preserves the original duration and service name, even if the service was later
renamed, retired or unassigned. No automatic cancellation or patient notification
occurs. Reactivation is supported; destructive catalogue deletion is not exposed.

Doctors without any service assignments retain legacy booking using the doctor's
default duration. Once assignments exist, selecting an active assigned service is
required. If all assigned services are inactive, no new slots can be booked.
Removing every assignment returns that doctor to legacy booking mode. Existing
appointments with no service stay explicitly unassigned. Imported unnamed service
profiles remain intact and identifiable; they are not silently converted into
new examinations. No prices or real-world service names are invented.

## Persistence and concurrency

`Specialties`, `Services` and the `DoctorServices` join table use foreign keys.
Doctors gain `SpecialtyId`, `Subspecialty`, `Enabled` and `CatalogVersion`.
Appointments gain nullable `ServiceId` and a booking-time `ServiceName` snapshot;
the original start/end retain the booked duration. Catalogue records use optimistic
versions. Catalogue changes take an exclusive PostgreSQL advisory lock; booking
and rescheduling take its shared counterpart before the existing doctor lock.
The database overlap constraints remain the final concurrency protection.

Specialties are populated from exact existing doctor labels. No service catalogue
is seeded because examination details were not supplied. JSON demo data is upgraded
additively and uses the same catalogue and booking rules.

Reports count actual service IDs, including inactive services and historical
assignments. Legacy service-profile bookings retain a separate grouping; remaining
old appointments are unassigned. Service capacity is estimated from current doctor
hours and current service duration. Doctors can offer multiple services, so their
capacity is shared and **must not be summed across services**. Historical schedule
snapshots are not implemented. Specialty grouping uses current doctor metadata.

## Deploy to an existing server (DBeaver)

This release **requires a database migration and BOTH API and Web publishes**.

1. Pull `main` and build the solution in Release.
2. Back up the server's `appointments` database. Stop the Appointments API and Web
   sites during the update so the API cannot write against a partially updated schema.
3. In DBeaver, connect to the server's `appointments` database with its migration
   owner. Open `database/002-service-catalogue.sql` and **execute the entire script**.
   It is an idempotent upgrade from the initial schema and records the migration in
   `__EFMigrationsHistory`. Do not run it against another application's database.
4. If `careline_app` is a separate runtime role, grant it SELECT, INSERT, UPDATE,
   DELETE on the new `Specialties`, `Services`, and `DoctorServices` tables, just as
   for the existing application tables. The script does not assume a role name or
   change credentials. No new sequence grants are required for these three tables.
5. Publish `Appointments.Api` and `Appointments.Web`. Preserve the server-specific
   appsettings, connection string, hosting flags and API URL. Ensure Web includes
   both `wwwroot/js/app.js` and `wwwroot/css/site.css`.
6. Start the sites, refresh with Ctrl+F5, sign in as administrator and open **Каталог**.
   Check an existing appointment, then configure a service and test a new booking.

For a new database, run the existing `001-initial.sql` then `002-service-catalogue.sql`,
or let EF apply all migrations using the documented `--migrate` command. Local
Development with `Database:ApplyMigrations=true` applies the pending migration on
API startup. Never reset the database to deploy this feature. Rolling back this
migration deletes the new catalogue columns/tables; use a backup-based rollback
plan if necessary instead of blindly invoking Down.

## API

Bootstrap includes `specialties`, `services` and `doctorServices`.
Administrator POST routes: `/api/catalogue/doctors`, `/api/catalogue/specialties`,
`/api/catalogue/services`. Omit/null `id` for creation; supply the current version
for editing (`catalogVersion` for doctor, `version` for specialty/service).
A service body includes `doctorIds`, `specialtyId`, `durationMinutes`, `enabled`
and `name`. No delete route is exposed. `/api/slots` accepts optional `serviceId`;
new booking commands accept it too. When rescheduling, the saved appointment
controls duration and service, and access is checked before availability is returned.
