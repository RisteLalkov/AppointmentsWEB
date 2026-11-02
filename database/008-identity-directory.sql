-- Shared clinical database only. Run through API --migrate with all old hosts stopped.
BEGIN;
SELECT pg_advisory_xact_lock(734251899);
CREATE SCHEMA IF NOT EXISTS careline_identity;
CREATE TABLE IF NOT EXISTS careline_identity.clinics (
    clinic_id text PRIMARY KEY,
    schema_name text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS careline_identity.accounts (
    email text NOT NULL,
    clinic_id text NOT NULL,
    account_id text NOT NULL,
    is_demo boolean NOT NULL,
    PRIMARY KEY (clinic_id, account_id)
);
CREATE INDEX IF NOT EXISTS ix_identity_email ON careline_identity.accounts(email);
CREATE OR REPLACE FUNCTION careline_identity.sync_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(734251899);
    IF TG_OP <> 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM careline_identity.accounts
            WHERE email=NEW."NormalizedEmail" AND (clinic_id,account_id)<>(TG_ARGV[0],NEW."Id")
              AND (NOT NEW."IsDemo" OR NOT is_demo)) THEN
            RAISE EXCEPTION 'Account identity already reserved' USING ERRCODE='23505';
        END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        DELETE FROM careline_identity.accounts WHERE clinic_id=TG_ARGV[0] AND account_id=OLD."Id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
        INSERT INTO careline_identity.accounts(email,clinic_id,account_id,is_demo)
        VALUES(NEW."NormalizedEmail",TG_ARGV[0],NEW."Id",NEW."IsDemo");
        RETURN NEW;
    END IF;
    RETURN OLD;
END $$;
COMMIT;
