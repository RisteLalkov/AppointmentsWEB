-- Install once in the shared appointments database, with all old API/Web hosts stopped.
BEGIN;
SELECT pg_advisory_xact_lock(734251899);
CREATE SCHEMA IF NOT EXISTS careline_identity;
CREATE TABLE IF NOT EXISTS careline_identity."PatientAccounts" (
    "Id" varchar(64) PRIMARY KEY,
    "Email" varchar(120) NOT NULL UNIQUE,
    "Name" varchar(80) NOT NULL,
    "PasswordHash" text NOT NULL,
    "Enabled" boolean NOT NULL DEFAULT true,
    "FailedAttempts" integer NOT NULL DEFAULT 0,
    "LockedUntil" timestamptz,
    "HomeClinicId" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS careline_identity."PatientSessions" (
    "TokenHash" text PRIMARY KEY,
    "PatientAccountId" varchar(64) NOT NULL REFERENCES careline_identity."PatientAccounts"("Id") ON DELETE CASCADE,
    "ExpiresAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_patient_sessions_account ON careline_identity."PatientSessions"("PatientAccountId");
CREATE TABLE IF NOT EXISTS careline_identity."PatientEvents" (
    "Id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "PatientAccountId" varchar(64) NOT NULL REFERENCES careline_identity."PatientAccounts"("Id"),
    "ActorId" text NOT NULL,
    "ActorType" text NOT NULL CHECK ("ActorType" IN ('Patient','PlatformOperator')),
    "Action" text NOT NULL,
    "OccurredAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS careline_identity."PatientMemberships" (
    "PatientAccountId" varchar(64) NOT NULL REFERENCES careline_identity."PatientAccounts"("Id"),
    "ClinicId" text NOT NULL,
    "AccountId" text NOT NULL,
    "PatientId" text NOT NULL,
    "PatientNumber" bigint NOT NULL CHECK ("PatientNumber" > 0),
    PRIMARY KEY ("PatientAccountId", "ClinicId"),
    UNIQUE ("ClinicId", "AccountId"), UNIQUE ("ClinicId", "PatientId")
);
-- Minimal busy intervals prevent one shared patient from booking overlapping clinic visits.
-- No other clinic's doctor, service, notes or contact data is copied here.
SET LOCAL search_path = pg_catalog,careline_extensions;
CREATE TABLE IF NOT EXISTS careline_identity."PatientBookings" (
    "PatientAccountId" varchar(64) NOT NULL REFERENCES careline_identity."PatientAccounts"("Id"),
    "ClinicId" text NOT NULL,
    "AppointmentId" text NOT NULL,
    "Start" timestamptz NOT NULL,
    "End" timestamptz NOT NULL,
    PRIMARY KEY ("ClinicId", "AppointmentId"),
    CHECK ("Start" < "End"),
    EXCLUDE USING gist ("PatientAccountId" WITH =, tstzrange("Start","End",'[)') WITH &&)
);
CREATE OR REPLACE FUNCTION careline_identity.sync_patient_booking() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE identity_id varchar(64);
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM careline_identity."PatientBookings" WHERE "ClinicId"=TG_ARGV[0] AND "AppointmentId"=OLD."Id";
        RETURN OLD;
    END IF;
    SELECT "PatientAccountId" INTO identity_id FROM careline_identity."PatientMemberships"
        WHERE "ClinicId"=TG_ARGV[0] AND "PatientId"=NEW."PatientId";
    IF identity_id IS NOT NULL AND NEW."Status" IN ('Scheduled','Confirmed') THEN
        INSERT INTO careline_identity."PatientBookings" ("PatientAccountId","ClinicId","AppointmentId","Start","End")
          VALUES (identity_id,TG_ARGV[0],NEW."Id",NEW."Start",NEW."End")
          ON CONFLICT ("ClinicId","AppointmentId") DO UPDATE SET
            "PatientAccountId"=EXCLUDED."PatientAccountId", "Start"=EXCLUDED."Start", "End"=EXCLUDED."End";
    ELSE
        DELETE FROM careline_identity."PatientBookings" WHERE "ClinicId"=TG_ARGV[0] AND "AppointmentId"=NEW."Id";
    END IF;
    RETURN NEW;
END $$;
-- A staff identity cannot also become a global patient identity with the same email.
CREATE OR REPLACE FUNCTION careline_identity.check_patient_email() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(734251899);
    IF EXISTS (SELECT 1 FROM careline_identity.accounts WHERE email=NEW."Email") THEN
        RAISE EXCEPTION 'Account identity already reserved' USING ERRCODE='23505';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS global_patient_email ON careline_identity."PatientAccounts";
CREATE TRIGGER global_patient_email BEFORE INSERT OR UPDATE OF "Email" ON careline_identity."PatientAccounts"
    FOR EACH ROW EXECUTE FUNCTION careline_identity.check_patient_email();
-- Clinic patient memberships have no passwords and never reserve a second login identity.
CREATE OR REPLACE FUNCTION careline_identity.sync_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(734251899);
    IF TG_OP <> 'DELETE' AND (to_jsonb(NEW)->>'GlobalPatientId') IS NULL THEN
        IF EXISTS (SELECT 1 FROM careline_identity.accounts
            WHERE email=NEW."NormalizedEmail" AND (clinic_id,account_id)<>(TG_ARGV[0],NEW."Id")
              AND (NOT NEW."IsDemo" OR NOT is_demo))
          OR EXISTS (SELECT 1 FROM careline_identity."PatientAccounts" WHERE "Email"=NEW."NormalizedEmail") THEN
            RAISE EXCEPTION 'Account identity already reserved' USING ERRCODE='23505';
        END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        DELETE FROM careline_identity.accounts WHERE clinic_id=TG_ARGV[0] AND account_id=OLD."Id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
        IF (to_jsonb(NEW)->>'GlobalPatientId') IS NULL THEN
            INSERT INTO careline_identity.accounts(email,clinic_id,account_id,is_demo)
            VALUES(NEW."NormalizedEmail",TG_ARGV[0],NEW."Id",NEW."IsDemo");
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END $$;
COMMIT;
