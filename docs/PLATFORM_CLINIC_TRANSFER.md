# Move the original clinic into platform management

This release adds a one-time **Управувај преку платформата** action and a normal
**Измени податоци** screen. It transfers ownership of clinic metadata, not clinical
data. The existing `main` clinic keeps its ID, `appointments.public` schema,
accounts, password hashes, sessions, patients, services, schedules and appointments.
There is no replacement clinic to populate and no cross-schema data copy.

## Deployment and one-time transfer

1. Back up `appointments`, `appointments_platform`, and the current API/Web publish
   folders, including server configuration. Use your existing backup procedure or
   DBeaver **Tools → Backup**. Record the locations of those backups.
2. On your PC, pull `main` and build the solution in Release. Publish both API and
   Web using your usual process. The API output must contain
   `database/007-platform-managed-clinics.sql` alongside the existing platform SQL.
3. Stop **all API instances/application pools**, and the Web application pool,
   while replacing the publish output. Preserve server connection strings,
   `appsettings` overrides, API URL and hosting settings. Keep the existing clinic
   configuration; do not create a duplicate `main` registration manually.
4. On the API server, open PowerShell in the API publish folder and run:

   ```powershell
   cd C:\inetpub\AppointmentsAPI
   dotnet .\Appointments.Api.dll --migrate
   ```

   The new migration adds `Adopted` and `Version` to the platform clinic registry.
   Existing clinic EF migrations are also checked. This is not a data reset.
   The published API runs the included SQL; no manual SQL execution is needed.
5. If the migration succeeds, start/recycle the API pool, then the Web pool.
   Do not mix old API hosts with the new adopted-registry behavior. An older API
   rejects the overlap after adoption; rollback needs matching registry state and
   binaries, not just an old DLL copied over the new release.
6. Open `/Platform/Login` and sign in with the **company/platform account**, not a
   clinic account or PostgreSQL database login.
7. In **Регистрирани клиники**, find **Мојата клиника**, identifier **main**, marked
   **Конфигурација**. Click **Управувај преку платформата**. This deliberate action
   verifies the existing schema binding and time zone and requires an active
   non-demo clinic administrator with password credentials. No password is reset.
8. The clinic details editor opens. Enter the display name, public address, phone,
   description, visibility and patient-registration preference. Click
   **Зачувај податоци**. The time zone and clinic ID remain fixed.
9. Confirm that the clinic appears once as platform-managed. In DBeaver,
   `appointments_platform.public.PlatformClinics` now contains `Id = main`,
   `ConnectionName = Appointments`, `State = Ready`, and `Adopted = true`.
   Clinical records remain in `appointments.public`; no `clinic_main` is created.
10. Check the public clinic page/map, sign in with an existing clinic account and
    verify its appointments. Other API instances pick up the new registry values
    on subsequent requests; a server configuration edit is not needed.

## Everyday management afterward

- **New clinic:** `/Platform` → **Додај нова клиника**. This creates its own schema
  and first administrator in the same shared clinic database.
- **Clinic name/address/phone/description and public options:** `/Platform` →
  **Измени податоци**. The same screen works for adopted and newly created clinics.
- **Additional clinic user accounts/access:** the clinic workspace's existing
  **Сметки и пристап / Корисници и пристап** screen. Company and clinic identities
  remain separate.
- **Simultaneous metadata edits:** a stale form is rejected, its entered values
  remain visible, and a link explicitly reloads current values.

After adoption the platform row is authoritative for routine business metadata.
Existing API clinic settings may remain as infrastructure/bootstrap configuration;
they no longer replace the adopted clinic's public details on restart. Database
connection strings, TLS, deployment and deliberate time-zone changes remain
infrastructure tasks. Do not change the clinic ID or time zone to relabel a clinic.

## Failure behavior and preservation

The transfer writes only a platform registry row. Unknown or disabled configured
clinics, incorrect bindings/time zones, missing non-demo administrator credentials,
and inconsistent existing registrations are rejected. Concurrent retries return
one ready adopted clinic. A failed request never deletes clinic tables or creates
new credentials. If adoption committed but the response was lost, reload the
platform list; retrying does not reset records.

The `Adopted` flag makes configured-ID overlap explicit. Unmarked overlaps remain
an error, and adopted rows must retain the configured time zone. This avoids
silently treating arbitrary duplicate registrations as a supported transfer.
