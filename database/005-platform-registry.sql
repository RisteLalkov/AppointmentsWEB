-- Execute ONLY in a new, dedicated platform database, never in a clinic database.
-- Versioned, repeatable platform migration. Clinical schemas remain unchanged.
BEGIN;
SELECT pg_advisory_xact_lock(734251896);
DO $$ BEGIN
 IF to_regclass('public."Patients"') IS NOT NULL OR to_regclass('public."Settings"') IS NOT NULL THEN
  RAISE EXCEPTION 'The platform registry requires a separate database';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS "PlatformSchemaVersions" ("Version" integer PRIMARY KEY, "AppliedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "PlatformOperators" (
 "Id" text PRIMARY KEY, "Email" varchar(120) NOT NULL UNIQUE, "Name" varchar(80) NOT NULL,
 "PasswordHash" text NOT NULL, "Enabled" boolean NOT NULL, "FailedAttempts" integer NOT NULL,
 "LockedUntil" timestamptz NULL);
CREATE TABLE IF NOT EXISTS "PlatformSessions" (
 "TokenHash" varchar(64) PRIMARY KEY, "OperatorId" text NOT NULL REFERENCES "PlatformOperators"("Id") ON DELETE CASCADE,
 "ExpiresAt" timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS "IX_PlatformSessions_ExpiresAt" ON "PlatformSessions"("ExpiresAt");
CREATE TABLE IF NOT EXISTS "PlatformClinics" (
 "Id" varchar(40) PRIMARY KEY, "Name" varchar(100) NOT NULL, "ConnectionName" text NOT NULL UNIQUE,
 "TimeZone" varchar(100) NOT NULL, "State" text NOT NULL CHECK ("State" IN ('Provisioning','Ready','Failed')),
 "AdminEmail" varchar(120) NOT NULL, "AdminName" varchar(80) NOT NULL,
 "Description" varchar(1000), "Address" varchar(200), "Phone" varchar(30),
 "Discoverable" boolean NOT NULL, "AllowRegistration" boolean NOT NULL,
 "CreatedBy" text NOT NULL, "CreatedAt" timestamptz NOT NULL);
INSERT INTO "PlatformSchemaVersions" ("Version") VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
