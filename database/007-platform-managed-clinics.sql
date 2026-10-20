-- Platform database only: allow deliberate adoption and safe metadata editing.
BEGIN;
SELECT pg_advisory_xact_lock(734251896);
ALTER TABLE "PlatformClinics" ADD COLUMN IF NOT EXISTS "Adopted" boolean NOT NULL DEFAULT false;
ALTER TABLE "PlatformClinics" ADD COLUMN IF NOT EXISTS "Version" integer NOT NULL DEFAULT 1;
INSERT INTO "PlatformSchemaVersions" ("Version") VALUES (3) ON CONFLICT DO NOTHING;
COMMIT;
