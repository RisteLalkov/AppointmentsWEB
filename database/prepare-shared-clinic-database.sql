-- Run in the CLINICAL database (appointments), with all API instances stopped.
-- For an existing extension, use its PostgreSQL administrator: trusted extension
-- objects can be owned by the bootstrap superuser even when the app owns the extension.
-- Repeatable. Does not delete/reset/relabel any clinic records.
BEGIN;
SELECT pg_advisory_xact_lock(734251895);
DO $$ BEGIN
 IF to_regclass('public."PlatformClinics"') IS NOT NULL THEN
  RAISE EXCEPTION 'Run this script in the clinical database, not the platform database';
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS careline_extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA careline_extensions;
DO $$ BEGIN
 IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist') <> 'careline_extensions' THEN
  ALTER EXTENSION btree_gist SET SCHEMA careline_extensions;
 END IF;
END $$;
-- Extension types/functions/operator classes are shared, not clinical data.
-- USAGE does not grant CREATE or any access to clinic tables.
GRANT USAGE ON SCHEMA careline_extensions TO PUBLIC;
COMMIT;
