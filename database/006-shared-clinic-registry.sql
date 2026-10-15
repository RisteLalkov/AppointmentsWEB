-- Platform database ONLY. Repeatable upgrade; does not move or relabel clinic data.
-- Old ConnectionName values deliberately remain until their data is consolidated.
BEGIN;
SELECT pg_advisory_xact_lock(734251896);
DO $$ BEGIN
 IF to_regclass('public."PlatformClinics"') IS NULL THEN
  RAISE EXCEPTION 'Apply 005-platform-registry.sql in the platform database first';
 END IF;
END $$;
ALTER TABLE "PlatformClinics" DROP CONSTRAINT IF EXISTS "PlatformClinics_ConnectionName_key";
DROP INDEX IF EXISTS "IX_PlatformClinics_ConnectionName";
INSERT INTO "PlatformSchemaVersions" ("Version") VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
