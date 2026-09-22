# PostgreSQL operations

## Initial schema

Supported/tested backend: PostgreSQL 17 with `btree_gist`. Use a dedicated database. EF migrations are in `src/Appointments.Data/Migrations`; a reviewed idempotent initial SQL script is in `database/001-initial.sql`. It includes foreign keys, checks, indexes and the two appointment exclusion constraints. The C# migration is the source of truth. The SQL script creates schema only; API initialization imports doctors and configured accounts after the schema exists.

In Development, `Database:ApplyMigrations=true` automatically applies pending migrations. Seeding takes a PostgreSQL advisory lock and is idempotent; existing doctors/patients/appointments are never replaced at startup. Production does not auto-migrate. To migrate explicitly, with the intended connection supplied through a secure environment:

```sh
dotnet run --project src/Appointments.Api --no-launch-profile -- --migrate
```

This command migrates, initializes source schedules/optional bootstrap administrator, then exits. Without a launch profile the default environment is Production, so no fictional patients or demo identities are added. To use this for Development explicitly set `ASPNETCORE_ENVIRONMENT=Development`; never carry that setting into deployment. A missing connection is a clear startup error, not a fallback.

For future schema changes:

```sh
dotnet tool restore
dotnet ef migrations add MeaningfulChange --project src/Appointments.Data --startup-project src/Appointments.Data
dotnet ef migrations script --idempotent --project src/Appointments.Data --startup-project src/Appointments.Data --output database/review-migration.sql
```

The design-time factory builds the model without connecting to PostgreSQL. Do not edit an already deployed migration; add another. Review manually authored exclusion SQL when generating future migrations because EF's model snapshot does not represent it. Test migrations on a restored copy before production. Use a privileged migration role for DDL and extension installation; the normal API account should have only needed table/sequence DML privileges. The local Compose development owner is intentionally not a production privilege template.

## Configuration

| Setting | Host | Meaning |
| --- | --- | --- |
| `ConnectionStrings:Appointments` | API | Npgsql connection string; user-secrets locally, secret manager in deployment |
| `Scheduling:TimeZone` | API / legacy web demo | Europe/Skopje initially; API determines connected UI timezone |
| `Database:ApplyMigrations` | API | Read only for automatic Development startup migrations |
| `Bootstrap:Email`, `Bootstrap:Password` | API | One-time initial administrator creation if email absent; no overwrites |
| `Demo:Enabled` | Both | Effective only in Development; keep disabled on real-data environments |
| `Backend:Mode` | Web | Api by default; Demo allowed only with Development + Demo enabled |
| `Backend:ApiBaseUrl` | Web | API URL; HTTPS required outside Development |

Environment variables replace `:` with `__`. Native PostgreSQL typically uses port 5432; the optional Compose recipe exposes 55432 on loopback. `.env`, `.local-admin.json`, secrets, certificates, build outputs and runtime JSON are ignored by Git. User-secrets aren't encrypted; keep your development account protected.

The configured timezone is recorded in the database. A mismatched new setting fails startup; do not change it casually while future appointments exist. Instants use UTC `timestamptz`; recurring periods use weekday plus `time`, exceptions use `date` and `time`. Patient/source names do not form keys.

## Backups and reset

Use standard PostgreSQL tools with credentials supplied outside command history. Example structure for a native installation (use a service file/PGPASSFILE rather than writing credentials into the command):

```sh
pg_dump --format=custom --file=careline.backup --host=localhost --port=5432 --username=careline_app appointments_dev
# Restore into a separately created EMPTY database, never over the original by default:
pg_restore --no-owner --host=localhost --port=5432 --username=careline_app --dbname=appointments_restore careline.backup
```

Backups contain scheduling identities, credential hashes and sessions. Protect/encrypt them, restrict access, and test restoration. The product does not yet provide automated backups, retention jobs or tamper-proof audit export. After restoring into a different environment, revoke all sessions using an approved administrative database procedure before opening access.

Local disposable Compose reset: stop API/Web, back up if needed, run `docker compose down --volumes`, then `docker compose up -d --wait`. This destroys the local named database volume. There is no reset endpoint exposed by the API and no automatic destruction script. Normal stop/restart preserves data.

Phase-one JSON records are left where they were. There is no implicit migration of unverified demonstration users into real accounts; import requirements must be reviewed explicitly.

## Troubleshooting

- **PostgreSQL is not configured:** run local setup or set the API connection string in user-secrets.
- **Connection refused:** start PostgreSQL; check 5432 vs Compose 55432 and the API secret value.
- **Password authentication failed after recreating `.env`:** the volume retains its original database password. Restore the correct local secret; do not delete a useful volume to hide the error.
- **Permission denied creating extension/tables:** have a migration administrator create `btree_gist` and apply reviewed migrations.
- **API unavailable in web:** start both startup projects and confirm `Backend:ApiBaseUrl`. The web deliberately does not use JSON as a fallback.
- **409 schedule changed:** refresh; another editor changed `ScheduleVersion`.
- **Old sample appointments:** the sample seed runs once. Use future real availability or intentionally reset a disposable Development database.
- **Database timezone differs:** restore the original setting and plan an explicit timezone/data conversion.
