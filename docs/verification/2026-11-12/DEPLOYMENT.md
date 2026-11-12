# Deploying the 12 November audit fixes

This release updates **API, Web and both databases**. It adds indexes and operational
audit tables. It does not reset clinics, users, appointments or passwords.

1. Back up both `appointments` and `appointments_platform` and keep the previous
   complete API/Web publish folders. Preserve the server’s existing `appsettings.json`
   files, database passwords, shared `Hosting:WebProxyKey`, IIS settings and certificates.
2. Pull `main` on the development machine. Publish **both projects** using Visual
   Studio’s right-click → Publish, or the existing publish commands. Deploy complete
   publish outputs, including all dependencies and the API’s `database` folder.
3. Stop **every API and Web application pool/instance using these databases**.
   Keep them stopped throughout copying and maintenance. The new Web and API must
   be deployed together because workspace collections now use server-side pages.
4. Copy the new API and Web publish output into their respective server folders.
   Restore/preserve the server configuration; do not replace connection strings
   or the shared proxy key with development values.
5. In the published API folder, double-click `upgrade-databases.cmd`. It is beside
   `Appointments.Api.dll`. Accept its reminder only after all hosts are stopped.
   Wait for **Database upgrade finished successfully**. If it reports failure,
   keep the hosts stopped and retain the complete error.
6. Start API, then Web. Check API `/health` and `/swagger`, then sign in to the Web.
   Test reception paging/search, an old patient history, booking and clinic selection;
   also sign in to the company platform. A hard refresh loads the new browser assets.

The maintenance command is `dotnet Appointments.Api.dll --migrate`, run from the
published API folder; the supplied `.cmd` performs this step for you. Run it on the
**application server**, not by executing the individual SQL files in DBeaver. It uses
that API folder’s configured connections to update the remote database server.

Expected changes: clinical migration `20261112094540_WorkspaceQueryIndexes` in every
registered clinic schema; shared `careline_identity."SecurityEvents"` from
`database/010-security-audit.sql`; platform `"PlatformAuditEvents"` and platform schema
version 4 from `database/011-platform-audit.sql`. Keep all older packaged SQL files.

The previous published version was upgraded in an isolated rehearsal with ordinary
database-owner roles. Both clinic schemas, existing patient/staff/company sessions,
passwords, memberships and appointment history survived; rerunning migration was safe.
This does not replace your own production backup and staging check. If rollback is
needed, stop all hosts first; restore a coordinated backup pair and the matching
previous complete publish outputs/configuration. Do not manually delete migrations
or audit tables while hosts are running.

Before public launch, complete HTTPS/domain/cookie configuration and the owner’s
privacy, retention, backup/restore and verification/MFA decisions. No production
server or existing company data was changed by these tests.
