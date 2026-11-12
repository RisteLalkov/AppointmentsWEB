-- Shared appointments database. Minimal security metadata, no credentials/contact values.
BEGIN;
SELECT pg_advisory_xact_lock(734251899);
CREATE TABLE IF NOT EXISTS careline_identity."SecurityEvents" (
    "Id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Scope" varchar(20) NOT NULL,
    "ActorId" varchar(64) NOT NULL,
    "Action" varchar(80) NOT NULL,
    "TargetId" varchar(64),
    "OccurredAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_security_events_time ON careline_identity."SecurityEvents"("OccurredAt");
CREATE INDEX IF NOT EXISTS ix_security_events_target ON careline_identity."SecurityEvents"("TargetId","OccurredAt");
COMMIT;
