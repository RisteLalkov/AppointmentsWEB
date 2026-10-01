START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001070652_AppointmentHistory') THEN
    CREATE TABLE "AppointmentHistory" (
        "Id" character varying(64) NOT NULL,
        "AppointmentId" character varying(64) NOT NULL,
        "AppointmentVersion" integer NOT NULL,
        "Kind" character varying(20) NOT NULL,
        "ActorId" character varying(64) NOT NULL,
        "ActorName" character varying(200) NOT NULL,
        "ActorRole" character varying(20) NOT NULL,
        "OccurredAt" timestamp with time zone NOT NULL,
        "BeforeStart" timestamp with time zone,
        "BeforeEnd" timestamp with time zone,
        "BeforeStatus" character varying(20),
        "AfterStart" timestamp with time zone NOT NULL,
        "AfterEnd" timestamp with time zone NOT NULL,
        "AfterStatus" character varying(20) NOT NULL,
        CONSTRAINT "PK_AppointmentHistory" PRIMARY KEY ("Id"),
        CONSTRAINT "CK_History_AfterRange" CHECK ("AfterStart" < "AfterEnd"),
        CONSTRAINT "CK_History_Before" CHECK (("Kind" = 'Created' AND "BeforeStart" IS NULL AND "BeforeEnd" IS NULL AND "BeforeStatus" IS NULL) OR ("Kind" <> 'Created' AND "BeforeStart" IS NOT NULL AND "BeforeEnd" IS NOT NULL AND "BeforeStart" < "BeforeEnd" AND "BeforeStatus" IS NOT NULL)),
        CONSTRAINT "CK_History_Version" CHECK ("AppointmentVersion" > 0),
        CONSTRAINT "FK_AppointmentHistory_Appointments_AppointmentId" FOREIGN KEY ("AppointmentId") REFERENCES "Appointments" ("Id") ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001070652_AppointmentHistory') THEN
    CREATE UNIQUE INDEX "IX_AppointmentHistory_AppointmentId_AppointmentVersion" ON "AppointmentHistory" ("AppointmentId", "AppointmentVersion");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261001070652_AppointmentHistory') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261001070652_AppointmentHistory', '10.0.12');
    END IF;
END $EF$;
COMMIT;

