START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261005225240_PatientProfiles') THEN
    ALTER TABLE "Patients" ADD "Version" integer NOT NULL DEFAULT 1;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261005225240_PatientProfiles') THEN
    ALTER TABLE "Patients" ADD CONSTRAINT "CK_Patient_Version" CHECK ("Version" > 0);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261005225240_PatientProfiles') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261005225240_PatientProfiles', '10.0.12');
    END IF;
END $EF$;
COMMIT;

