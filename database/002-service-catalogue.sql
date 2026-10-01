START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Doctors" ADD "CatalogVersion" integer NOT NULL DEFAULT 1;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Doctors" ADD "Enabled" boolean NOT NULL DEFAULT TRUE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Doctors" ADD "SpecialtyId" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Doctors" ADD "Subspecialty" character varying(200) NOT NULL DEFAULT '';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Appointments" ADD "ServiceId" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Appointments" ADD "ServiceName" character varying(200);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE TABLE "Specialties" (
        "Id" text NOT NULL,
        "Name" character varying(200) NOT NULL,
        "Version" integer NOT NULL,
        CONSTRAINT "PK_Specialties" PRIMARY KEY ("Id")
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE TABLE "Services" (
        "Id" text NOT NULL,
        "Name" character varying(200) NOT NULL,
        "SpecialtyId" text NOT NULL,
        "DurationMinutes" integer NOT NULL,
        "Enabled" boolean NOT NULL,
        "Version" integer NOT NULL,
        CONSTRAINT "PK_Services" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_Service_Duration" CHECK ("DurationMinutes" BETWEEN 10 AND 120 AND "DurationMinutes" % 5 = 0),
        CONSTRAINT "FK_Services_Specialties_SpecialtyId" FOREIGN KEY ("SpecialtyId") REFERENCES "Specialties" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE TABLE "DoctorServices" (
        "DoctorId" character varying(64) NOT NULL,
        "ServiceId" text NOT NULL,
        CONSTRAINT "PK_DoctorServices" PRIMARY KEY ("DoctorId", "ServiceId"),
        CONSTRAINT "FK_DoctorServices_Doctors_DoctorId" FOREIGN KEY ("DoctorId") REFERENCES "Doctors" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_DoctorServices_Services_ServiceId" FOREIGN KEY ("ServiceId") REFERENCES "Services" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE INDEX "IX_Doctors_SpecialtyId" ON "Doctors" ("SpecialtyId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE INDEX "IX_Appointments_ServiceId" ON "Appointments" ("ServiceId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE INDEX "IX_DoctorServices_ServiceId" ON "DoctorServices" ("ServiceId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE UNIQUE INDEX "IX_Services_SpecialtyId_Name" ON "Services" ("SpecialtyId", "Name");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    CREATE UNIQUE INDEX "IX_Specialties_Name" ON "Specialties" ("Name");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    INSERT INTO "Specialties" ("Id", "Name", "Version")
    SELECT 'sp-' || md5("Specialty"), "Specialty", 1 FROM "Doctors" GROUP BY "Specialty";
    UPDATE "Doctors" SET "SpecialtyId" = 'sp-' || md5("Specialty");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Appointments" ADD CONSTRAINT "FK_Appointments_Services_ServiceId" FOREIGN KEY ("ServiceId") REFERENCES "Services" ("Id") ON DELETE RESTRICT;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    ALTER TABLE "Doctors" ADD CONSTRAINT "FK_Doctors_Specialties_SpecialtyId" FOREIGN KEY ("SpecialtyId") REFERENCES "Specialties" ("Id") ON DELETE RESTRICT;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260930135621_ServiceCatalogue') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260930135621_ServiceCatalogue', '10.0.12');
    END IF;
END $EF$;
COMMIT;

