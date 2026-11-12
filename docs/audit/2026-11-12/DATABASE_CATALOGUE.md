# Actual PostgreSQL catalogue and integrity coverage

Generated from the migrated, running, disposable databases. This is not the actual production catalogue. Exact shared functions, trigger definitions and grants are in the matching JSON evidence. Identical tenant definitions are listed individually; canonical integrity probes do not imply every cloned column was independently mutated.

## Clinical database

### careline_identity.PatientAccounts

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Email | character varying(120) | NO |  |
| Name | character varying(80) | NO |  |
| PasswordHash | text | NO |  |
| Enabled | boolean | NO | true |
| FailedAttempts | integer | NO | 0 |
| LockedUntil | timestamp with time zone | YES |  |
| HomeClinicId | text | NO |  |
| CreatedAt | timestamp with time zone | NO | now() |
| Phone | character varying(30) | NO | ''::character varying |

Constraints:

- `PatientAccounts_Email_key`: `UNIQUE ("Email")`; validated=True.
- `PatientAccounts_pkey`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `PatientAccounts_Email_key`: `CREATE UNIQUE INDEX "PatientAccounts_Email_key" ON careline_identity."PatientAccounts" USING btree ("Email")`; valid=True; ready=True.
- `PatientAccounts_pkey`: `CREATE UNIQUE INDEX "PatientAccounts_pkey" ON careline_identity."PatientAccounts" USING btree ("Id")`; valid=True; ready=True.
- Trigger `global_patient_email` (O): `CREATE TRIGGER global_patient_email BEFORE INSERT OR UPDATE OF "Email" ON careline_identity."PatientAccounts" FOR EACH ROW EXECUTE FUNCTION careline_identity.check_patient_email()`.

### careline_identity.PatientBookings

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| PatientAccountId | character varying(64) | NO |  |
| ClinicId | text | NO |  |
| AppointmentId | text | NO |  |
| Start | timestamp with time zone | NO |  |
| End | timestamp with time zone | NO |  |

Constraints:

- `PatientBookings_PatientAccountId_fkey`: `FOREIGN KEY ("PatientAccountId") REFERENCES careline_identity."PatientAccounts"("Id")`; validated=True.
- `PatientBookings_PatientAccountId_tstzrange_excl`: `EXCLUDE USING gist ("PatientAccountId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&)`; validated=True.
- `PatientBookings_check`: `CHECK (("Start" < "End"))`; validated=True.
- `PatientBookings_pkey`: `PRIMARY KEY ("ClinicId", "AppointmentId")`; validated=True.

Indexes:

- `PatientBookings_PatientAccountId_tstzrange_excl`: `CREATE INDEX "PatientBookings_PatientAccountId_tstzrange_excl" ON careline_identity."PatientBookings" USING gist ("PatientAccountId", tstzrange("Start", "End", '[)'::text))`; valid=True; ready=True.
- `PatientBookings_pkey`: `CREATE UNIQUE INDEX "PatientBookings_pkey" ON careline_identity."PatientBookings" USING btree ("ClinicId", "AppointmentId")`; valid=True; ready=True.

### careline_identity.PatientEvents

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY ALWAYS |
| PatientAccountId | character varying(64) | NO |  |
| ActorId | text | NO |  |
| ActorType | text | NO |  |
| Action | text | NO |  |
| OccurredAt | timestamp with time zone | NO | now() |

Constraints:

- `PatientEvents_ActorType_check`: `CHECK (("ActorType" = ANY (ARRAY['Patient'::text, 'PlatformOperator'::text])))`; validated=True.
- `PatientEvents_PatientAccountId_fkey`: `FOREIGN KEY ("PatientAccountId") REFERENCES careline_identity."PatientAccounts"("Id")`; validated=True.
- `PatientEvents_pkey`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `PatientEvents_pkey`: `CREATE UNIQUE INDEX "PatientEvents_pkey" ON careline_identity."PatientEvents" USING btree ("Id")`; valid=True; ready=True.

### careline_identity.PatientMemberships

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| PatientAccountId | character varying(64) | NO |  |
| ClinicId | text | NO |  |
| AccountId | text | NO |  |
| PatientId | text | NO |  |
| PatientNumber | bigint | NO |  |

Constraints:

- `PatientMemberships_ClinicId_AccountId_key`: `UNIQUE ("ClinicId", "AccountId")`; validated=True.
- `PatientMemberships_ClinicId_PatientId_key`: `UNIQUE ("ClinicId", "PatientId")`; validated=True.
- `PatientMemberships_PatientAccountId_fkey`: `FOREIGN KEY ("PatientAccountId") REFERENCES careline_identity."PatientAccounts"("Id")`; validated=True.
- `PatientMemberships_PatientNumber_check`: `CHECK (("PatientNumber" > 0))`; validated=True.
- `PatientMemberships_pkey`: `PRIMARY KEY ("PatientAccountId", "ClinicId")`; validated=True.

Indexes:

- `PatientMemberships_ClinicId_AccountId_key`: `CREATE UNIQUE INDEX "PatientMemberships_ClinicId_AccountId_key" ON careline_identity."PatientMemberships" USING btree ("ClinicId", "AccountId")`; valid=True; ready=True.
- `PatientMemberships_ClinicId_PatientId_key`: `CREATE UNIQUE INDEX "PatientMemberships_ClinicId_PatientId_key" ON careline_identity."PatientMemberships" USING btree ("ClinicId", "PatientId")`; valid=True; ready=True.
- `PatientMemberships_pkey`: `CREATE UNIQUE INDEX "PatientMemberships_pkey" ON careline_identity."PatientMemberships" USING btree ("PatientAccountId", "ClinicId")`; valid=True; ready=True.

### careline_identity.PatientSessions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| TokenHash | text | NO |  |
| PatientAccountId | character varying(64) | NO |  |
| ExpiresAt | timestamp with time zone | NO |  |

Constraints:

- `PatientSessions_PatientAccountId_fkey`: `FOREIGN KEY ("PatientAccountId") REFERENCES careline_identity."PatientAccounts"("Id") ON DELETE CASCADE`; validated=True.
- `PatientSessions_pkey`: `PRIMARY KEY ("TokenHash")`; validated=True.

Indexes:

- `PatientSessions_pkey`: `CREATE UNIQUE INDEX "PatientSessions_pkey" ON careline_identity."PatientSessions" USING btree ("TokenHash")`; valid=True; ready=True.
- `ix_patient_sessions_account`: `CREATE INDEX ix_patient_sessions_account ON careline_identity."PatientSessions" USING btree ("PatientAccountId")`; valid=True; ready=True.

### careline_identity.accounts

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| email | text | NO |  |
| clinic_id | text | NO |  |
| account_id | text | NO |  |
| is_demo | boolean | NO |  |

Constraints:

- `accounts_pkey`: `PRIMARY KEY (clinic_id, account_id)`; validated=True.

Indexes:

- `accounts_pkey`: `CREATE UNIQUE INDEX accounts_pkey ON careline_identity.accounts USING btree (clinic_id, account_id)`; valid=True; ready=True.
- `ix_identity_email`: `CREATE INDEX ix_identity_email ON careline_identity.accounts USING btree (email)`; valid=True; ready=True.

### careline_identity.clinics

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| clinic_id | text | NO |  |
| schema_name | text | NO |  |

Constraints:

- `clinics_pkey`: `PRIMARY KEY (clinic_id)`; validated=True.
- `clinics_schema_name_key`: `UNIQUE (schema_name)`; validated=True.

Indexes:

- `clinics_pkey`: `CREATE UNIQUE INDEX clinics_pkey ON careline_identity.clinics USING btree (clinic_id)`; valid=True; ready=True.
- `clinics_schema_name_key`: `CREATE UNIQUE INDEX clinics_schema_name_key ON careline_identity.clinics USING btree (schema_name)`; valid=True; ready=True.

### clinic_closed.Accounts

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Email | character varying(120) | NO |  |
| NormalizedEmail | character varying(120) | NO |  |
| Name | character varying(80) | NO |  |
| PasswordHash | text | NO |  |
| Role | character varying(20) | NO |  |
| DoctorId | character varying(64) | YES |  |
| PatientId | character varying(64) | YES |  |
| Enabled | boolean | NO |  |
| IsDemo | boolean | NO |  |
| FailedAttempts | integer | NO |  |
| LockedUntil | timestamp with time zone | YES |  |
| CreatedAt | timestamp with time zone | NO |  |
| GlobalPatientId | character varying(64) | YES |  |

Constraints:

- `CK_Account_GlobalPatient`: `CHECK ((("GlobalPatientId" IS NULL) OR ((("Role")::text = 'Patient'::text) AND (NOT "IsDemo") AND ("PasswordHash" = ''::text))))`; validated=True.
- `CK_Account_RoleLink`: `CHECK ((((("Role")::text = 'Patient'::text) AND ("PatientId" IS NOT NULL) AND ("DoctorId" IS NULL)) OR ((("Role")::text = 'Doctor'::text) AND ("DoctorId" IS NOT NULL) AND ("PatientId" IS NULL)) OR ((("Role")::text = 'Administrator'::text) AND ("DoctorId" IS NULL) AND ("PatientId" IS NULL))))`; validated=True.
- `FK_Accounts_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_closed."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Accounts_PatientAccounts_GlobalPatientId`: `FOREIGN KEY ("GlobalPatientId") REFERENCES careline_identity."PatientAccounts"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Accounts_Patients_PatientId`: `FOREIGN KEY ("PatientId") REFERENCES clinic_closed."Patients"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Accounts`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Accounts_DoctorId`: `CREATE UNIQUE INDEX "IX_Accounts_DoctorId" ON clinic_closed."Accounts" USING btree ("DoctorId")`; valid=True; ready=True.
- `IX_Accounts_GlobalPatientId`: `CREATE UNIQUE INDEX "IX_Accounts_GlobalPatientId" ON clinic_closed."Accounts" USING btree ("GlobalPatientId")`; valid=True; ready=True.
- `IX_Accounts_NormalizedEmail`: `CREATE UNIQUE INDEX "IX_Accounts_NormalizedEmail" ON clinic_closed."Accounts" USING btree ("NormalizedEmail")`; valid=True; ready=True.
- `IX_Accounts_PatientId`: `CREATE UNIQUE INDEX "IX_Accounts_PatientId" ON clinic_closed."Accounts" USING btree ("PatientId")`; valid=True; ready=True.
- `PK_Accounts`: `CREATE UNIQUE INDEX "PK_Accounts" ON clinic_closed."Accounts" USING btree ("Id")`; valid=True; ready=True.
- Trigger `careline_identity_sync` (O): `CREATE TRIGGER careline_identity_sync AFTER INSERT OR DELETE OR UPDATE ON clinic_closed."Accounts" FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_account('closed')`.

### clinic_closed.AppointmentHistory

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| AppointmentId | character varying(64) | NO |  |
| AppointmentVersion | integer | NO |  |
| Kind | character varying(20) | NO |  |
| ActorId | character varying(64) | NO |  |
| ActorName | character varying(200) | NO |  |
| ActorRole | character varying(20) | NO |  |
| OccurredAt | timestamp with time zone | NO |  |
| BeforeStart | timestamp with time zone | YES |  |
| BeforeEnd | timestamp with time zone | YES |  |
| BeforeStatus | character varying(20) | YES |  |
| AfterStart | timestamp with time zone | NO |  |
| AfterEnd | timestamp with time zone | NO |  |
| AfterStatus | character varying(20) | NO |  |

Constraints:

- `CK_History_AfterRange`: `CHECK (("AfterStart" < "AfterEnd"))`; validated=True.
- `CK_History_Before`: `CHECK ((((("Kind")::text = 'Created'::text) AND ("BeforeStart" IS NULL) AND ("BeforeEnd" IS NULL) AND ("BeforeStatus" IS NULL)) OR ((("Kind")::text <> 'Created'::text) AND ("BeforeStart" IS NOT NULL) AND ("BeforeEnd" IS NOT NULL) AND ("BeforeStart" < "BeforeEnd") AND ("BeforeStatus" IS NOT NULL))))`; validated=True.
- `CK_History_Version`: `CHECK (("AppointmentVersion" > 0))`; validated=True.
- `FK_AppointmentHistory_Appointments_AppointmentId`: `FOREIGN KEY ("AppointmentId") REFERENCES clinic_closed."Appointments"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_AppointmentHistory`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AppointmentHistory_AppointmentId_AppointmentVersion`: `CREATE UNIQUE INDEX "IX_AppointmentHistory_AppointmentId_AppointmentVersion" ON clinic_closed."AppointmentHistory" USING btree ("AppointmentId", "AppointmentVersion")`; valid=True; ready=True.
- `PK_AppointmentHistory`: `CREATE UNIQUE INDEX "PK_AppointmentHistory" ON clinic_closed."AppointmentHistory" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.Appointments

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| DoctorId | character varying(64) | NO |  |
| PatientId | character varying(64) | NO |  |
| Start | timestamp with time zone | NO |  |
| End | timestamp with time zone | NO |  |
| Status | character varying(20) | NO |  |
| Version | integer | NO |  |
| CreatedBy | text | NO |  |
| UpdatedAt | timestamp with time zone | NO |  |
| RequestId | text | NO |  |
| ServiceId | text | YES |  |
| ServiceName | character varying(200) | YES |  |

Constraints:

- `CK_Appointment_Range`: `CHECK (("Start" < "End"))`; validated=True.
- `CK_Appointment_Status`: `CHECK ((("Status")::text = ANY ((ARRAY['Scheduled'::character varying, 'Confirmed'::character varying, 'Completed'::character varying, 'Cancelled'::character varying, 'NoShow'::character varying])::text[])))`; validated=True.
- `CK_Appointment_Version`: `CHECK (("Version" > 0))`; validated=True.
- `EX_Appointments_Doctor`: `EXCLUDE USING gist ("DoctorId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&) WHERE ((("Status")::text <> 'Cancelled'::text))`; validated=True.
- `EX_Appointments_Patient`: `EXCLUDE USING gist ("PatientId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&) WHERE ((("Status")::text <> 'Cancelled'::text))`; validated=True.
- `FK_Appointments_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_closed."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Appointments_Patients_PatientId`: `FOREIGN KEY ("PatientId") REFERENCES clinic_closed."Patients"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Appointments_Services_ServiceId`: `FOREIGN KEY ("ServiceId") REFERENCES clinic_closed."Services"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Appointments`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `EX_Appointments_Doctor`: `CREATE INDEX "EX_Appointments_Doctor" ON clinic_closed."Appointments" USING gist ("DoctorId", tstzrange("Start", "End", '[)'::text)) WHERE (("Status")::text <> 'Cancelled'::text)`; valid=True; ready=True.
- `EX_Appointments_Patient`: `CREATE INDEX "EX_Appointments_Patient" ON clinic_closed."Appointments" USING gist ("PatientId", tstzrange("Start", "End", '[)'::text)) WHERE (("Status")::text <> 'Cancelled'::text)`; valid=True; ready=True.
- `IX_Appointments_CreatedBy_RequestId`: `CREATE UNIQUE INDEX "IX_Appointments_CreatedBy_RequestId" ON clinic_closed."Appointments" USING btree ("CreatedBy", "RequestId")`; valid=True; ready=True.
- `IX_Appointments_DoctorId_Start`: `CREATE INDEX "IX_Appointments_DoctorId_Start" ON clinic_closed."Appointments" USING btree ("DoctorId", "Start")`; valid=True; ready=True.
- `IX_Appointments_PatientId_Start`: `CREATE INDEX "IX_Appointments_PatientId_Start" ON clinic_closed."Appointments" USING btree ("PatientId", "Start")`; valid=True; ready=True.
- `IX_Appointments_ServiceId`: `CREATE INDEX "IX_Appointments_ServiceId" ON clinic_closed."Appointments" USING btree ("ServiceId")`; valid=True; ready=True.
- `PK_Appointments`: `CREATE UNIQUE INDEX "PK_Appointments" ON clinic_closed."Appointments" USING btree ("Id")`; valid=True; ready=True.
- Trigger `careline_patient_booking_sync` (O): `CREATE TRIGGER careline_patient_booking_sync AFTER INSERT OR DELETE OR UPDATE ON clinic_closed."Appointments" FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_patient_booking('closed')`.

### clinic_closed.AuditEvents

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| ActorId | text | NO |  |
| Action | character varying(80) | NO |  |
| TargetId | text | NO |  |
| OccurredAt | timestamp with time zone | NO |  |

Constraints:

- `PK_AuditEvents`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AuditEvents_OccurredAt`: `CREATE INDEX "IX_AuditEvents_OccurredAt" ON clinic_closed."AuditEvents" USING btree ("OccurredAt")`; valid=True; ready=True.
- `PK_AuditEvents`: `CREATE UNIQUE INDEX "PK_AuditEvents" ON clinic_closed."AuditEvents" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.AvailabilityExceptions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| DoctorId | character varying(64) | NO |  |
| Date | date | NO |  |
| Start | time without time zone | NO |  |
| End | time without time zone | NO |  |
| IsAvailable | boolean | NO |  |
| Reason | character varying(120) | NO |  |

Constraints:

- `CK_Exception_Range`: `CHECK (("Start" < "End"))`; validated=True.
- `FK_AvailabilityExceptions_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_closed."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_AvailabilityExceptions`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AvailabilityExceptions_DoctorId_Date`: `CREATE INDEX "IX_AvailabilityExceptions_DoctorId_Date" ON clinic_closed."AvailabilityExceptions" USING btree ("DoctorId", "Date")`; valid=True; ready=True.
- `PK_AvailabilityExceptions`: `CREATE UNIQUE INDEX "PK_AvailabilityExceptions" ON clinic_closed."AvailabilityExceptions" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.DoctorServices

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| DoctorId | character varying(64) | NO |  |
| ServiceId | text | NO |  |

Constraints:

- `FK_DoctorServices_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_closed."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_DoctorServices_Services_ServiceId`: `FOREIGN KEY ("ServiceId") REFERENCES clinic_closed."Services"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_DoctorServices`: `PRIMARY KEY ("DoctorId", "ServiceId")`; validated=True.

Indexes:

- `IX_DoctorServices_ServiceId`: `CREATE INDEX "IX_DoctorServices_ServiceId" ON clinic_closed."DoctorServices" USING btree ("ServiceId")`; valid=True; ready=True.
- `PK_DoctorServices`: `CREATE UNIQUE INDEX "PK_DoctorServices" ON clinic_closed."DoctorServices" USING btree ("DoctorId", "ServiceId")`; valid=True; ready=True.

### clinic_closed.Doctors

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Name | character varying(200) | NO |  |
| Specialty | character varying(200) | NO |  |
| BookingMethod | text | NO |  |
| Funding | text | NO |  |
| IsService | boolean | NO |  |
| RequiresConfirmation | boolean | NO |  |
| StaffOnly | boolean | NO |  |
| TuesdayFirst | boolean | NO |  |
| DurationMinutes | integer | NO |  |
| DemoScheduleEdited | boolean | NO |  |
| ScheduleVersion | integer | NO | 1 |
| CatalogVersion | integer | NO | 1 |
| Enabled | boolean | NO | true |
| SpecialtyId | text | YES |  |
| Subspecialty | character varying(200) | NO | ''::character varying |

Constraints:

- `CK_Doctor_Duration`: `CHECK (((("DurationMinutes" >= 10) AND ("DurationMinutes" <= 120)) AND (("DurationMinutes" % 5) = 0)))`; validated=True.
- `FK_Doctors_Specialties_SpecialtyId`: `FOREIGN KEY ("SpecialtyId") REFERENCES clinic_closed."Specialties"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Doctors`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Doctors_SpecialtyId`: `CREATE INDEX "IX_Doctors_SpecialtyId" ON clinic_closed."Doctors" USING btree ("SpecialtyId")`; valid=True; ready=True.
- `PK_Doctors`: `CREATE UNIQUE INDEX "PK_Doctors" ON clinic_closed."Doctors" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.IdempotencyRequests

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| AccountId | text | NO |  |
| RequestId | text | NO |  |
| Fingerprint | character varying(64) | NO |  |
| ResponseJson | jsonb | NO |  |
| CreatedAt | timestamp with time zone | NO |  |

Constraints:

- `FK_IdempotencyRequests_Accounts_AccountId`: `FOREIGN KEY ("AccountId") REFERENCES clinic_closed."Accounts"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_IdempotencyRequests`: `PRIMARY KEY ("AccountId", "RequestId")`; validated=True.

Indexes:

- `PK_IdempotencyRequests`: `CREATE UNIQUE INDEX "PK_IdempotencyRequests" ON clinic_closed."IdempotencyRequests" USING btree ("AccountId", "RequestId")`; valid=True; ready=True.

### clinic_closed.Patients

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Name | character varying(80) | NO |  |
| Email | character varying(120) | NO |  |
| Phone | character varying(30) | NO |  |
| IsDemonstration | boolean | NO |  |
| Version | integer | NO | 1 |
| Number | bigint | NO |  IDENTITY BY DEFAULT |

Constraints:

- `CK_Patient_Number`: `CHECK (("Number" > 0))`; validated=True.
- `CK_Patient_Version`: `CHECK (("Version" > 0))`; validated=True.
- `PK_Patients`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Patients_Email`: `CREATE UNIQUE INDEX "IX_Patients_Email" ON clinic_closed."Patients" USING btree ("Email") WHERE (("Email")::text <> ''::text)`; valid=True; ready=True.
- `IX_Patients_Number`: `CREATE UNIQUE INDEX "IX_Patients_Number" ON clinic_closed."Patients" USING btree ("Number")`; valid=True; ready=True.
- `PK_Patients`: `CREATE UNIQUE INDEX "PK_Patients" ON clinic_closed."Patients" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.Services

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Name | character varying(200) | NO |  |
| SpecialtyId | text | NO |  |
| DurationMinutes | integer | NO |  |
| Enabled | boolean | NO |  |
| Version | integer | NO |  |

Constraints:

- `CK_Service_Duration`: `CHECK (((("DurationMinutes" >= 10) AND ("DurationMinutes" <= 120)) AND (("DurationMinutes" % 5) = 0)))`; validated=True.
- `FK_Services_Specialties_SpecialtyId`: `FOREIGN KEY ("SpecialtyId") REFERENCES clinic_closed."Specialties"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Services`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Services_SpecialtyId_Name`: `CREATE UNIQUE INDEX "IX_Services_SpecialtyId_Name" ON clinic_closed."Services" USING btree ("SpecialtyId", "Name")`; valid=True; ready=True.
- `PK_Services`: `CREATE UNIQUE INDEX "PK_Services" ON clinic_closed."Services" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.Sessions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| TokenHash | character varying(64) | NO |  |
| AccountId | text | NO |  |
| ExpiresAt | timestamp with time zone | NO |  |
| IsDemo | boolean | NO |  |

Constraints:

- `FK_Sessions_Accounts_AccountId`: `FOREIGN KEY ("AccountId") REFERENCES clinic_closed."Accounts"("Id") ON DELETE CASCADE`; validated=True.
- `PK_Sessions`: `PRIMARY KEY ("TokenHash")`; validated=True.

Indexes:

- `IX_Sessions_AccountId`: `CREATE INDEX "IX_Sessions_AccountId" ON clinic_closed."Sessions" USING btree ("AccountId")`; valid=True; ready=True.
- `IX_Sessions_ExpiresAt`: `CREATE INDEX "IX_Sessions_ExpiresAt" ON clinic_closed."Sessions" USING btree ("ExpiresAt")`; valid=True; ready=True.
- `PK_Sessions`: `CREATE UNIQUE INDEX "PK_Sessions" ON clinic_closed."Sessions" USING btree ("TokenHash")`; valid=True; ready=True.

### clinic_closed.Settings

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Key | text | NO |  |
| Value | text | NO |  |

Constraints:

- `PK_Settings`: `PRIMARY KEY ("Key")`; validated=True.

Indexes:

- `PK_Settings`: `CREATE UNIQUE INDEX "PK_Settings" ON clinic_closed."Settings" USING btree ("Key")`; valid=True; ready=True.

### clinic_closed.SourceSchedules

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| Row | integer | NO |  |
| Days | text | NO |  |
| Start | text | NO |  |
| End | text | NO |  |
| Type | text | NO |  |
| Note | text | NO |  |
| DoctorId | character varying(64) | NO |  |

Constraints:

- `FK_SourceSchedules_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_closed."Doctors"("Id") ON DELETE CASCADE`; validated=True.
- `PK_SourceSchedules`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_SourceSchedules_DoctorId`: `CREATE INDEX "IX_SourceSchedules_DoctorId" ON clinic_closed."SourceSchedules" USING btree ("DoctorId")`; valid=True; ready=True.
- `PK_SourceSchedules`: `CREATE UNIQUE INDEX "PK_SourceSchedules" ON clinic_closed."SourceSchedules" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.Specialties

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Name | character varying(200) | NO |  |
| Version | integer | NO |  |

Constraints:

- `PK_Specialties`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Specialties_Name`: `CREATE UNIQUE INDEX "IX_Specialties_Name" ON clinic_closed."Specialties" USING btree ("Name")`; valid=True; ready=True.
- `PK_Specialties`: `CREATE UNIQUE INDEX "PK_Specialties" ON clinic_closed."Specialties" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.WorkingPeriods

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| Day | integer | NO |  |
| Start | time without time zone | NO |  |
| End | time without time zone | NO |  |
| DoctorId | character varying(64) | NO |  |
| ValidFrom | date | YES |  |
| ValidTo | date | YES |  |

Constraints:

- `CK_WorkingPeriod_Dates`: `CHECK (((("ValidFrom" IS NULL) AND ("ValidTo" IS NULL)) OR (("ValidFrom" IS NOT NULL) AND ("ValidTo" IS NOT NULL) AND ("ValidFrom" <= "ValidTo"))))`; validated=True.
- `CK_WorkingPeriod_Range`: `CHECK ((("Start" < "End") AND (("Day" >= 0) AND ("Day" <= 6))))`; validated=True.
- `FK_WorkingPeriods_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_closed."Doctors"("Id") ON DELETE CASCADE`; validated=True.
- `PK_WorkingPeriods`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_WorkingPeriods_DoctorId_Day`: `CREATE INDEX "IX_WorkingPeriods_DoctorId_Day" ON clinic_closed."WorkingPeriods" USING btree ("DoctorId", "Day")`; valid=True; ready=True.
- `PK_WorkingPeriods`: `CREATE UNIQUE INDEX "PK_WorkingPeriods" ON clinic_closed."WorkingPeriods" USING btree ("Id")`; valid=True; ready=True.

### clinic_closed.__EFMigrationsHistory

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| MigrationId | character varying(150) | NO |  |
| ProductVersion | character varying(32) | NO |  |

Constraints:

- `PK___EFMigrationsHistory`: `PRIMARY KEY ("MigrationId")`; validated=True.

Indexes:

- `PK___EFMigrationsHistory`: `CREATE UNIQUE INDEX "PK___EFMigrationsHistory" ON clinic_closed."__EFMigrationsHistory" USING btree ("MigrationId")`; valid=True; ready=True.

### clinic_east.Accounts

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Email | character varying(120) | NO |  |
| NormalizedEmail | character varying(120) | NO |  |
| Name | character varying(80) | NO |  |
| PasswordHash | text | NO |  |
| Role | character varying(20) | NO |  |
| DoctorId | character varying(64) | YES |  |
| PatientId | character varying(64) | YES |  |
| Enabled | boolean | NO |  |
| IsDemo | boolean | NO |  |
| FailedAttempts | integer | NO |  |
| LockedUntil | timestamp with time zone | YES |  |
| CreatedAt | timestamp with time zone | NO |  |
| GlobalPatientId | character varying(64) | YES |  |

Constraints:

- `CK_Account_GlobalPatient`: `CHECK ((("GlobalPatientId" IS NULL) OR ((("Role")::text = 'Patient'::text) AND (NOT "IsDemo") AND ("PasswordHash" = ''::text))))`; validated=True.
- `CK_Account_RoleLink`: `CHECK ((((("Role")::text = 'Patient'::text) AND ("PatientId" IS NOT NULL) AND ("DoctorId" IS NULL)) OR ((("Role")::text = 'Doctor'::text) AND ("DoctorId" IS NOT NULL) AND ("PatientId" IS NULL)) OR ((("Role")::text = 'Administrator'::text) AND ("DoctorId" IS NULL) AND ("PatientId" IS NULL))))`; validated=True.
- `FK_Accounts_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_east."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Accounts_PatientAccounts_GlobalPatientId`: `FOREIGN KEY ("GlobalPatientId") REFERENCES careline_identity."PatientAccounts"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Accounts_Patients_PatientId`: `FOREIGN KEY ("PatientId") REFERENCES clinic_east."Patients"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Accounts`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Accounts_DoctorId`: `CREATE UNIQUE INDEX "IX_Accounts_DoctorId" ON clinic_east."Accounts" USING btree ("DoctorId")`; valid=True; ready=True.
- `IX_Accounts_GlobalPatientId`: `CREATE UNIQUE INDEX "IX_Accounts_GlobalPatientId" ON clinic_east."Accounts" USING btree ("GlobalPatientId")`; valid=True; ready=True.
- `IX_Accounts_NormalizedEmail`: `CREATE UNIQUE INDEX "IX_Accounts_NormalizedEmail" ON clinic_east."Accounts" USING btree ("NormalizedEmail")`; valid=True; ready=True.
- `IX_Accounts_PatientId`: `CREATE UNIQUE INDEX "IX_Accounts_PatientId" ON clinic_east."Accounts" USING btree ("PatientId")`; valid=True; ready=True.
- `PK_Accounts`: `CREATE UNIQUE INDEX "PK_Accounts" ON clinic_east."Accounts" USING btree ("Id")`; valid=True; ready=True.
- Trigger `careline_identity_sync` (O): `CREATE TRIGGER careline_identity_sync AFTER INSERT OR DELETE OR UPDATE ON clinic_east."Accounts" FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_account('east')`.

### clinic_east.AppointmentHistory

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| AppointmentId | character varying(64) | NO |  |
| AppointmentVersion | integer | NO |  |
| Kind | character varying(20) | NO |  |
| ActorId | character varying(64) | NO |  |
| ActorName | character varying(200) | NO |  |
| ActorRole | character varying(20) | NO |  |
| OccurredAt | timestamp with time zone | NO |  |
| BeforeStart | timestamp with time zone | YES |  |
| BeforeEnd | timestamp with time zone | YES |  |
| BeforeStatus | character varying(20) | YES |  |
| AfterStart | timestamp with time zone | NO |  |
| AfterEnd | timestamp with time zone | NO |  |
| AfterStatus | character varying(20) | NO |  |

Constraints:

- `CK_History_AfterRange`: `CHECK (("AfterStart" < "AfterEnd"))`; validated=True.
- `CK_History_Before`: `CHECK ((((("Kind")::text = 'Created'::text) AND ("BeforeStart" IS NULL) AND ("BeforeEnd" IS NULL) AND ("BeforeStatus" IS NULL)) OR ((("Kind")::text <> 'Created'::text) AND ("BeforeStart" IS NOT NULL) AND ("BeforeEnd" IS NOT NULL) AND ("BeforeStart" < "BeforeEnd") AND ("BeforeStatus" IS NOT NULL))))`; validated=True.
- `CK_History_Version`: `CHECK (("AppointmentVersion" > 0))`; validated=True.
- `FK_AppointmentHistory_Appointments_AppointmentId`: `FOREIGN KEY ("AppointmentId") REFERENCES clinic_east."Appointments"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_AppointmentHistory`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AppointmentHistory_AppointmentId_AppointmentVersion`: `CREATE UNIQUE INDEX "IX_AppointmentHistory_AppointmentId_AppointmentVersion" ON clinic_east."AppointmentHistory" USING btree ("AppointmentId", "AppointmentVersion")`; valid=True; ready=True.
- `PK_AppointmentHistory`: `CREATE UNIQUE INDEX "PK_AppointmentHistory" ON clinic_east."AppointmentHistory" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.Appointments

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| DoctorId | character varying(64) | NO |  |
| PatientId | character varying(64) | NO |  |
| Start | timestamp with time zone | NO |  |
| End | timestamp with time zone | NO |  |
| Status | character varying(20) | NO |  |
| Version | integer | NO |  |
| CreatedBy | text | NO |  |
| UpdatedAt | timestamp with time zone | NO |  |
| RequestId | text | NO |  |
| ServiceId | text | YES |  |
| ServiceName | character varying(200) | YES |  |

Constraints:

- `CK_Appointment_Range`: `CHECK (("Start" < "End"))`; validated=True.
- `CK_Appointment_Status`: `CHECK ((("Status")::text = ANY ((ARRAY['Scheduled'::character varying, 'Confirmed'::character varying, 'Completed'::character varying, 'Cancelled'::character varying, 'NoShow'::character varying])::text[])))`; validated=True.
- `CK_Appointment_Version`: `CHECK (("Version" > 0))`; validated=True.
- `EX_Appointments_Doctor`: `EXCLUDE USING gist ("DoctorId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&) WHERE ((("Status")::text <> 'Cancelled'::text))`; validated=True.
- `EX_Appointments_Patient`: `EXCLUDE USING gist ("PatientId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&) WHERE ((("Status")::text <> 'Cancelled'::text))`; validated=True.
- `FK_Appointments_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_east."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Appointments_Patients_PatientId`: `FOREIGN KEY ("PatientId") REFERENCES clinic_east."Patients"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Appointments_Services_ServiceId`: `FOREIGN KEY ("ServiceId") REFERENCES clinic_east."Services"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Appointments`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `EX_Appointments_Doctor`: `CREATE INDEX "EX_Appointments_Doctor" ON clinic_east."Appointments" USING gist ("DoctorId", tstzrange("Start", "End", '[)'::text)) WHERE (("Status")::text <> 'Cancelled'::text)`; valid=True; ready=True.
- `EX_Appointments_Patient`: `CREATE INDEX "EX_Appointments_Patient" ON clinic_east."Appointments" USING gist ("PatientId", tstzrange("Start", "End", '[)'::text)) WHERE (("Status")::text <> 'Cancelled'::text)`; valid=True; ready=True.
- `IX_Appointments_CreatedBy_RequestId`: `CREATE UNIQUE INDEX "IX_Appointments_CreatedBy_RequestId" ON clinic_east."Appointments" USING btree ("CreatedBy", "RequestId")`; valid=True; ready=True.
- `IX_Appointments_DoctorId_Start`: `CREATE INDEX "IX_Appointments_DoctorId_Start" ON clinic_east."Appointments" USING btree ("DoctorId", "Start")`; valid=True; ready=True.
- `IX_Appointments_PatientId_Start`: `CREATE INDEX "IX_Appointments_PatientId_Start" ON clinic_east."Appointments" USING btree ("PatientId", "Start")`; valid=True; ready=True.
- `IX_Appointments_ServiceId`: `CREATE INDEX "IX_Appointments_ServiceId" ON clinic_east."Appointments" USING btree ("ServiceId")`; valid=True; ready=True.
- `PK_Appointments`: `CREATE UNIQUE INDEX "PK_Appointments" ON clinic_east."Appointments" USING btree ("Id")`; valid=True; ready=True.
- Trigger `careline_patient_booking_sync` (O): `CREATE TRIGGER careline_patient_booking_sync AFTER INSERT OR DELETE OR UPDATE ON clinic_east."Appointments" FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_patient_booking('east')`.

### clinic_east.AuditEvents

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| ActorId | text | NO |  |
| Action | character varying(80) | NO |  |
| TargetId | text | NO |  |
| OccurredAt | timestamp with time zone | NO |  |

Constraints:

- `PK_AuditEvents`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AuditEvents_OccurredAt`: `CREATE INDEX "IX_AuditEvents_OccurredAt" ON clinic_east."AuditEvents" USING btree ("OccurredAt")`; valid=True; ready=True.
- `PK_AuditEvents`: `CREATE UNIQUE INDEX "PK_AuditEvents" ON clinic_east."AuditEvents" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.AvailabilityExceptions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| DoctorId | character varying(64) | NO |  |
| Date | date | NO |  |
| Start | time without time zone | NO |  |
| End | time without time zone | NO |  |
| IsAvailable | boolean | NO |  |
| Reason | character varying(120) | NO |  |

Constraints:

- `CK_Exception_Range`: `CHECK (("Start" < "End"))`; validated=True.
- `FK_AvailabilityExceptions_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_east."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_AvailabilityExceptions`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AvailabilityExceptions_DoctorId_Date`: `CREATE INDEX "IX_AvailabilityExceptions_DoctorId_Date" ON clinic_east."AvailabilityExceptions" USING btree ("DoctorId", "Date")`; valid=True; ready=True.
- `PK_AvailabilityExceptions`: `CREATE UNIQUE INDEX "PK_AvailabilityExceptions" ON clinic_east."AvailabilityExceptions" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.DoctorServices

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| DoctorId | character varying(64) | NO |  |
| ServiceId | text | NO |  |

Constraints:

- `FK_DoctorServices_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_east."Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_DoctorServices_Services_ServiceId`: `FOREIGN KEY ("ServiceId") REFERENCES clinic_east."Services"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_DoctorServices`: `PRIMARY KEY ("DoctorId", "ServiceId")`; validated=True.

Indexes:

- `IX_DoctorServices_ServiceId`: `CREATE INDEX "IX_DoctorServices_ServiceId" ON clinic_east."DoctorServices" USING btree ("ServiceId")`; valid=True; ready=True.
- `PK_DoctorServices`: `CREATE UNIQUE INDEX "PK_DoctorServices" ON clinic_east."DoctorServices" USING btree ("DoctorId", "ServiceId")`; valid=True; ready=True.

### clinic_east.Doctors

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Name | character varying(200) | NO |  |
| Specialty | character varying(200) | NO |  |
| BookingMethod | text | NO |  |
| Funding | text | NO |  |
| IsService | boolean | NO |  |
| RequiresConfirmation | boolean | NO |  |
| StaffOnly | boolean | NO |  |
| TuesdayFirst | boolean | NO |  |
| DurationMinutes | integer | NO |  |
| DemoScheduleEdited | boolean | NO |  |
| ScheduleVersion | integer | NO | 1 |
| CatalogVersion | integer | NO | 1 |
| Enabled | boolean | NO | true |
| SpecialtyId | text | YES |  |
| Subspecialty | character varying(200) | NO | ''::character varying |

Constraints:

- `CK_Doctor_Duration`: `CHECK (((("DurationMinutes" >= 10) AND ("DurationMinutes" <= 120)) AND (("DurationMinutes" % 5) = 0)))`; validated=True.
- `FK_Doctors_Specialties_SpecialtyId`: `FOREIGN KEY ("SpecialtyId") REFERENCES clinic_east."Specialties"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Doctors`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Doctors_SpecialtyId`: `CREATE INDEX "IX_Doctors_SpecialtyId" ON clinic_east."Doctors" USING btree ("SpecialtyId")`; valid=True; ready=True.
- `PK_Doctors`: `CREATE UNIQUE INDEX "PK_Doctors" ON clinic_east."Doctors" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.IdempotencyRequests

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| AccountId | text | NO |  |
| RequestId | text | NO |  |
| Fingerprint | character varying(64) | NO |  |
| ResponseJson | jsonb | NO |  |
| CreatedAt | timestamp with time zone | NO |  |

Constraints:

- `FK_IdempotencyRequests_Accounts_AccountId`: `FOREIGN KEY ("AccountId") REFERENCES clinic_east."Accounts"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_IdempotencyRequests`: `PRIMARY KEY ("AccountId", "RequestId")`; validated=True.

Indexes:

- `PK_IdempotencyRequests`: `CREATE UNIQUE INDEX "PK_IdempotencyRequests" ON clinic_east."IdempotencyRequests" USING btree ("AccountId", "RequestId")`; valid=True; ready=True.

### clinic_east.Patients

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Name | character varying(80) | NO |  |
| Email | character varying(120) | NO |  |
| Phone | character varying(30) | NO |  |
| IsDemonstration | boolean | NO |  |
| Version | integer | NO | 1 |
| Number | bigint | NO |  IDENTITY BY DEFAULT |

Constraints:

- `CK_Patient_Number`: `CHECK (("Number" > 0))`; validated=True.
- `CK_Patient_Version`: `CHECK (("Version" > 0))`; validated=True.
- `PK_Patients`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Patients_Email`: `CREATE UNIQUE INDEX "IX_Patients_Email" ON clinic_east."Patients" USING btree ("Email") WHERE (("Email")::text <> ''::text)`; valid=True; ready=True.
- `IX_Patients_Number`: `CREATE UNIQUE INDEX "IX_Patients_Number" ON clinic_east."Patients" USING btree ("Number")`; valid=True; ready=True.
- `PK_Patients`: `CREATE UNIQUE INDEX "PK_Patients" ON clinic_east."Patients" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.Services

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Name | character varying(200) | NO |  |
| SpecialtyId | text | NO |  |
| DurationMinutes | integer | NO |  |
| Enabled | boolean | NO |  |
| Version | integer | NO |  |

Constraints:

- `CK_Service_Duration`: `CHECK (((("DurationMinutes" >= 10) AND ("DurationMinutes" <= 120)) AND (("DurationMinutes" % 5) = 0)))`; validated=True.
- `FK_Services_Specialties_SpecialtyId`: `FOREIGN KEY ("SpecialtyId") REFERENCES clinic_east."Specialties"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Services`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Services_SpecialtyId_Name`: `CREATE UNIQUE INDEX "IX_Services_SpecialtyId_Name" ON clinic_east."Services" USING btree ("SpecialtyId", "Name")`; valid=True; ready=True.
- `PK_Services`: `CREATE UNIQUE INDEX "PK_Services" ON clinic_east."Services" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.Sessions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| TokenHash | character varying(64) | NO |  |
| AccountId | text | NO |  |
| ExpiresAt | timestamp with time zone | NO |  |
| IsDemo | boolean | NO |  |

Constraints:

- `FK_Sessions_Accounts_AccountId`: `FOREIGN KEY ("AccountId") REFERENCES clinic_east."Accounts"("Id") ON DELETE CASCADE`; validated=True.
- `PK_Sessions`: `PRIMARY KEY ("TokenHash")`; validated=True.

Indexes:

- `IX_Sessions_AccountId`: `CREATE INDEX "IX_Sessions_AccountId" ON clinic_east."Sessions" USING btree ("AccountId")`; valid=True; ready=True.
- `IX_Sessions_ExpiresAt`: `CREATE INDEX "IX_Sessions_ExpiresAt" ON clinic_east."Sessions" USING btree ("ExpiresAt")`; valid=True; ready=True.
- `PK_Sessions`: `CREATE UNIQUE INDEX "PK_Sessions" ON clinic_east."Sessions" USING btree ("TokenHash")`; valid=True; ready=True.

### clinic_east.Settings

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Key | text | NO |  |
| Value | text | NO |  |

Constraints:

- `PK_Settings`: `PRIMARY KEY ("Key")`; validated=True.

Indexes:

- `PK_Settings`: `CREATE UNIQUE INDEX "PK_Settings" ON clinic_east."Settings" USING btree ("Key")`; valid=True; ready=True.

### clinic_east.SourceSchedules

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| Row | integer | NO |  |
| Days | text | NO |  |
| Start | text | NO |  |
| End | text | NO |  |
| Type | text | NO |  |
| Note | text | NO |  |
| DoctorId | character varying(64) | NO |  |

Constraints:

- `FK_SourceSchedules_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_east."Doctors"("Id") ON DELETE CASCADE`; validated=True.
- `PK_SourceSchedules`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_SourceSchedules_DoctorId`: `CREATE INDEX "IX_SourceSchedules_DoctorId" ON clinic_east."SourceSchedules" USING btree ("DoctorId")`; valid=True; ready=True.
- `PK_SourceSchedules`: `CREATE UNIQUE INDEX "PK_SourceSchedules" ON clinic_east."SourceSchedules" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.Specialties

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Name | character varying(200) | NO |  |
| Version | integer | NO |  |

Constraints:

- `PK_Specialties`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Specialties_Name`: `CREATE UNIQUE INDEX "IX_Specialties_Name" ON clinic_east."Specialties" USING btree ("Name")`; valid=True; ready=True.
- `PK_Specialties`: `CREATE UNIQUE INDEX "PK_Specialties" ON clinic_east."Specialties" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.WorkingPeriods

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| Day | integer | NO |  |
| Start | time without time zone | NO |  |
| End | time without time zone | NO |  |
| DoctorId | character varying(64) | NO |  |
| ValidFrom | date | YES |  |
| ValidTo | date | YES |  |

Constraints:

- `CK_WorkingPeriod_Dates`: `CHECK (((("ValidFrom" IS NULL) AND ("ValidTo" IS NULL)) OR (("ValidFrom" IS NOT NULL) AND ("ValidTo" IS NOT NULL) AND ("ValidFrom" <= "ValidTo"))))`; validated=True.
- `CK_WorkingPeriod_Range`: `CHECK ((("Start" < "End") AND (("Day" >= 0) AND ("Day" <= 6))))`; validated=True.
- `FK_WorkingPeriods_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES clinic_east."Doctors"("Id") ON DELETE CASCADE`; validated=True.
- `PK_WorkingPeriods`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_WorkingPeriods_DoctorId_Day`: `CREATE INDEX "IX_WorkingPeriods_DoctorId_Day" ON clinic_east."WorkingPeriods" USING btree ("DoctorId", "Day")`; valid=True; ready=True.
- `PK_WorkingPeriods`: `CREATE UNIQUE INDEX "PK_WorkingPeriods" ON clinic_east."WorkingPeriods" USING btree ("Id")`; valid=True; ready=True.

### clinic_east.__EFMigrationsHistory

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| MigrationId | character varying(150) | NO |  |
| ProductVersion | character varying(32) | NO |  |

Constraints:

- `PK___EFMigrationsHistory`: `PRIMARY KEY ("MigrationId")`; validated=True.

Indexes:

- `PK___EFMigrationsHistory`: `CREATE UNIQUE INDEX "PK___EFMigrationsHistory" ON clinic_east."__EFMigrationsHistory" USING btree ("MigrationId")`; valid=True; ready=True.

### public.Accounts

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Email | character varying(120) | NO |  |
| NormalizedEmail | character varying(120) | NO |  |
| Name | character varying(80) | NO |  |
| PasswordHash | text | NO |  |
| Role | character varying(20) | NO |  |
| DoctorId | character varying(64) | YES |  |
| PatientId | character varying(64) | YES |  |
| Enabled | boolean | NO |  |
| IsDemo | boolean | NO |  |
| FailedAttempts | integer | NO |  |
| LockedUntil | timestamp with time zone | YES |  |
| CreatedAt | timestamp with time zone | NO |  |
| GlobalPatientId | character varying(64) | YES |  |

Constraints:

- `CK_Account_GlobalPatient`: `CHECK ((("GlobalPatientId" IS NULL) OR ((("Role")::text = 'Patient'::text) AND (NOT "IsDemo") AND ("PasswordHash" = ''::text))))`; validated=True.
- `CK_Account_RoleLink`: `CHECK ((((("Role")::text = 'Patient'::text) AND ("PatientId" IS NOT NULL) AND ("DoctorId" IS NULL)) OR ((("Role")::text = 'Doctor'::text) AND ("DoctorId" IS NOT NULL) AND ("PatientId" IS NULL)) OR ((("Role")::text = 'Administrator'::text) AND ("DoctorId" IS NULL) AND ("PatientId" IS NULL))))`; validated=True.
- `FK_Accounts_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES "Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Accounts_PatientAccounts_GlobalPatientId`: `FOREIGN KEY ("GlobalPatientId") REFERENCES careline_identity."PatientAccounts"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Accounts_Patients_PatientId`: `FOREIGN KEY ("PatientId") REFERENCES "Patients"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Accounts`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Accounts_DoctorId`: `CREATE UNIQUE INDEX "IX_Accounts_DoctorId" ON public."Accounts" USING btree ("DoctorId")`; valid=True; ready=True.
- `IX_Accounts_GlobalPatientId`: `CREATE UNIQUE INDEX "IX_Accounts_GlobalPatientId" ON public."Accounts" USING btree ("GlobalPatientId")`; valid=True; ready=True.
- `IX_Accounts_NormalizedEmail`: `CREATE UNIQUE INDEX "IX_Accounts_NormalizedEmail" ON public."Accounts" USING btree ("NormalizedEmail")`; valid=True; ready=True.
- `IX_Accounts_PatientId`: `CREATE UNIQUE INDEX "IX_Accounts_PatientId" ON public."Accounts" USING btree ("PatientId")`; valid=True; ready=True.
- `PK_Accounts`: `CREATE UNIQUE INDEX "PK_Accounts" ON public."Accounts" USING btree ("Id")`; valid=True; ready=True.
- Trigger `careline_identity_sync` (O): `CREATE TRIGGER careline_identity_sync AFTER INSERT OR DELETE OR UPDATE ON public."Accounts" FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_account('main')`.

### public.AppointmentHistory

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| AppointmentId | character varying(64) | NO |  |
| AppointmentVersion | integer | NO |  |
| Kind | character varying(20) | NO |  |
| ActorId | character varying(64) | NO |  |
| ActorName | character varying(200) | NO |  |
| ActorRole | character varying(20) | NO |  |
| OccurredAt | timestamp with time zone | NO |  |
| BeforeStart | timestamp with time zone | YES |  |
| BeforeEnd | timestamp with time zone | YES |  |
| BeforeStatus | character varying(20) | YES |  |
| AfterStart | timestamp with time zone | NO |  |
| AfterEnd | timestamp with time zone | NO |  |
| AfterStatus | character varying(20) | NO |  |

Constraints:

- `CK_History_AfterRange`: `CHECK (("AfterStart" < "AfterEnd"))`; validated=True.
- `CK_History_Before`: `CHECK ((((("Kind")::text = 'Created'::text) AND ("BeforeStart" IS NULL) AND ("BeforeEnd" IS NULL) AND ("BeforeStatus" IS NULL)) OR ((("Kind")::text <> 'Created'::text) AND ("BeforeStart" IS NOT NULL) AND ("BeforeEnd" IS NOT NULL) AND ("BeforeStart" < "BeforeEnd") AND ("BeforeStatus" IS NOT NULL))))`; validated=True.
- `CK_History_Version`: `CHECK (("AppointmentVersion" > 0))`; validated=True.
- `FK_AppointmentHistory_Appointments_AppointmentId`: `FOREIGN KEY ("AppointmentId") REFERENCES "Appointments"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_AppointmentHistory`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AppointmentHistory_AppointmentId_AppointmentVersion`: `CREATE UNIQUE INDEX "IX_AppointmentHistory_AppointmentId_AppointmentVersion" ON public."AppointmentHistory" USING btree ("AppointmentId", "AppointmentVersion")`; valid=True; ready=True.
- `PK_AppointmentHistory`: `CREATE UNIQUE INDEX "PK_AppointmentHistory" ON public."AppointmentHistory" USING btree ("Id")`; valid=True; ready=True.

### public.Appointments

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| DoctorId | character varying(64) | NO |  |
| PatientId | character varying(64) | NO |  |
| Start | timestamp with time zone | NO |  |
| End | timestamp with time zone | NO |  |
| Status | character varying(20) | NO |  |
| Version | integer | NO |  |
| CreatedBy | text | NO |  |
| UpdatedAt | timestamp with time zone | NO |  |
| RequestId | text | NO |  |
| ServiceId | text | YES |  |
| ServiceName | character varying(200) | YES |  |

Constraints:

- `CK_Appointment_Range`: `CHECK (("Start" < "End"))`; validated=True.
- `CK_Appointment_Status`: `CHECK ((("Status")::text = ANY ((ARRAY['Scheduled'::character varying, 'Confirmed'::character varying, 'Completed'::character varying, 'Cancelled'::character varying, 'NoShow'::character varying])::text[])))`; validated=True.
- `CK_Appointment_Version`: `CHECK (("Version" > 0))`; validated=True.
- `EX_Appointments_Doctor`: `EXCLUDE USING gist ("DoctorId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&) WHERE ((("Status")::text <> 'Cancelled'::text))`; validated=True.
- `EX_Appointments_Patient`: `EXCLUDE USING gist ("PatientId" WITH =, tstzrange("Start", "End", '[)'::text) WITH &&) WHERE ((("Status")::text <> 'Cancelled'::text))`; validated=True.
- `FK_Appointments_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES "Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Appointments_Patients_PatientId`: `FOREIGN KEY ("PatientId") REFERENCES "Patients"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_Appointments_Services_ServiceId`: `FOREIGN KEY ("ServiceId") REFERENCES "Services"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Appointments`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `EX_Appointments_Doctor`: `CREATE INDEX "EX_Appointments_Doctor" ON public."Appointments" USING gist ("DoctorId", tstzrange("Start", "End", '[)'::text)) WHERE (("Status")::text <> 'Cancelled'::text)`; valid=True; ready=True.
- `EX_Appointments_Patient`: `CREATE INDEX "EX_Appointments_Patient" ON public."Appointments" USING gist ("PatientId", tstzrange("Start", "End", '[)'::text)) WHERE (("Status")::text <> 'Cancelled'::text)`; valid=True; ready=True.
- `IX_Appointments_CreatedBy_RequestId`: `CREATE UNIQUE INDEX "IX_Appointments_CreatedBy_RequestId" ON public."Appointments" USING btree ("CreatedBy", "RequestId")`; valid=True; ready=True.
- `IX_Appointments_DoctorId_Start`: `CREATE INDEX "IX_Appointments_DoctorId_Start" ON public."Appointments" USING btree ("DoctorId", "Start")`; valid=True; ready=True.
- `IX_Appointments_PatientId_Start`: `CREATE INDEX "IX_Appointments_PatientId_Start" ON public."Appointments" USING btree ("PatientId", "Start")`; valid=True; ready=True.
- `IX_Appointments_ServiceId`: `CREATE INDEX "IX_Appointments_ServiceId" ON public."Appointments" USING btree ("ServiceId")`; valid=True; ready=True.
- `PK_Appointments`: `CREATE UNIQUE INDEX "PK_Appointments" ON public."Appointments" USING btree ("Id")`; valid=True; ready=True.
- Trigger `careline_patient_booking_sync` (O): `CREATE TRIGGER careline_patient_booking_sync AFTER INSERT OR DELETE OR UPDATE ON public."Appointments" FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_patient_booking('main')`.

### public.AuditEvents

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| ActorId | text | NO |  |
| Action | character varying(80) | NO |  |
| TargetId | text | NO |  |
| OccurredAt | timestamp with time zone | NO |  |

Constraints:

- `PK_AuditEvents`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AuditEvents_OccurredAt`: `CREATE INDEX "IX_AuditEvents_OccurredAt" ON public."AuditEvents" USING btree ("OccurredAt")`; valid=True; ready=True.
- `PK_AuditEvents`: `CREATE UNIQUE INDEX "PK_AuditEvents" ON public."AuditEvents" USING btree ("Id")`; valid=True; ready=True.

### public.AvailabilityExceptions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| DoctorId | character varying(64) | NO |  |
| Date | date | NO |  |
| Start | time without time zone | NO |  |
| End | time without time zone | NO |  |
| IsAvailable | boolean | NO |  |
| Reason | character varying(120) | NO |  |

Constraints:

- `CK_Exception_Range`: `CHECK (("Start" < "End"))`; validated=True.
- `FK_AvailabilityExceptions_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES "Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_AvailabilityExceptions`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_AvailabilityExceptions_DoctorId_Date`: `CREATE INDEX "IX_AvailabilityExceptions_DoctorId_Date" ON public."AvailabilityExceptions" USING btree ("DoctorId", "Date")`; valid=True; ready=True.
- `PK_AvailabilityExceptions`: `CREATE UNIQUE INDEX "PK_AvailabilityExceptions" ON public."AvailabilityExceptions" USING btree ("Id")`; valid=True; ready=True.

### public.DoctorServices

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| DoctorId | character varying(64) | NO |  |
| ServiceId | text | NO |  |

Constraints:

- `FK_DoctorServices_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES "Doctors"("Id") ON DELETE RESTRICT`; validated=True.
- `FK_DoctorServices_Services_ServiceId`: `FOREIGN KEY ("ServiceId") REFERENCES "Services"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_DoctorServices`: `PRIMARY KEY ("DoctorId", "ServiceId")`; validated=True.

Indexes:

- `IX_DoctorServices_ServiceId`: `CREATE INDEX "IX_DoctorServices_ServiceId" ON public."DoctorServices" USING btree ("ServiceId")`; valid=True; ready=True.
- `PK_DoctorServices`: `CREATE UNIQUE INDEX "PK_DoctorServices" ON public."DoctorServices" USING btree ("DoctorId", "ServiceId")`; valid=True; ready=True.

### public.Doctors

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Name | character varying(200) | NO |  |
| Specialty | character varying(200) | NO |  |
| BookingMethod | text | NO |  |
| Funding | text | NO |  |
| IsService | boolean | NO |  |
| RequiresConfirmation | boolean | NO |  |
| StaffOnly | boolean | NO |  |
| TuesdayFirst | boolean | NO |  |
| DurationMinutes | integer | NO |  |
| DemoScheduleEdited | boolean | NO |  |
| ScheduleVersion | integer | NO | 1 |
| CatalogVersion | integer | NO | 1 |
| Enabled | boolean | NO | true |
| SpecialtyId | text | YES |  |
| Subspecialty | character varying(200) | NO | ''::character varying |

Constraints:

- `CK_Doctor_Duration`: `CHECK (((("DurationMinutes" >= 10) AND ("DurationMinutes" <= 120)) AND (("DurationMinutes" % 5) = 0)))`; validated=True.
- `FK_Doctors_Specialties_SpecialtyId`: `FOREIGN KEY ("SpecialtyId") REFERENCES "Specialties"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Doctors`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Doctors_SpecialtyId`: `CREATE INDEX "IX_Doctors_SpecialtyId" ON public."Doctors" USING btree ("SpecialtyId")`; valid=True; ready=True.
- `PK_Doctors`: `CREATE UNIQUE INDEX "PK_Doctors" ON public."Doctors" USING btree ("Id")`; valid=True; ready=True.

### public.IdempotencyRequests

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| AccountId | text | NO |  |
| RequestId | text | NO |  |
| Fingerprint | character varying(64) | NO |  |
| ResponseJson | jsonb | NO |  |
| CreatedAt | timestamp with time zone | NO |  |

Constraints:

- `FK_IdempotencyRequests_Accounts_AccountId`: `FOREIGN KEY ("AccountId") REFERENCES "Accounts"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_IdempotencyRequests`: `PRIMARY KEY ("AccountId", "RequestId")`; validated=True.

Indexes:

- `PK_IdempotencyRequests`: `CREATE UNIQUE INDEX "PK_IdempotencyRequests" ON public."IdempotencyRequests" USING btree ("AccountId", "RequestId")`; valid=True; ready=True.

### public.Patients

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(64) | NO |  |
| Name | character varying(80) | NO |  |
| Email | character varying(120) | NO |  |
| Phone | character varying(30) | NO |  |
| IsDemonstration | boolean | NO |  |
| Version | integer | NO | 1 |
| Number | bigint | NO |  IDENTITY BY DEFAULT |

Constraints:

- `CK_Patient_Number`: `CHECK (("Number" > 0))`; validated=True.
- `CK_Patient_Version`: `CHECK (("Version" > 0))`; validated=True.
- `PK_Patients`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Patients_Email`: `CREATE UNIQUE INDEX "IX_Patients_Email" ON public."Patients" USING btree ("Email") WHERE (("Email")::text <> ''::text)`; valid=True; ready=True.
- `IX_Patients_Number`: `CREATE UNIQUE INDEX "IX_Patients_Number" ON public."Patients" USING btree ("Number")`; valid=True; ready=True.
- `PK_Patients`: `CREATE UNIQUE INDEX "PK_Patients" ON public."Patients" USING btree ("Id")`; valid=True; ready=True.

### public.Services

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Name | character varying(200) | NO |  |
| SpecialtyId | text | NO |  |
| DurationMinutes | integer | NO |  |
| Enabled | boolean | NO |  |
| Version | integer | NO |  |

Constraints:

- `CK_Service_Duration`: `CHECK (((("DurationMinutes" >= 10) AND ("DurationMinutes" <= 120)) AND (("DurationMinutes" % 5) = 0)))`; validated=True.
- `FK_Services_Specialties_SpecialtyId`: `FOREIGN KEY ("SpecialtyId") REFERENCES "Specialties"("Id") ON DELETE RESTRICT`; validated=True.
- `PK_Services`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Services_SpecialtyId_Name`: `CREATE UNIQUE INDEX "IX_Services_SpecialtyId_Name" ON public."Services" USING btree ("SpecialtyId", "Name")`; valid=True; ready=True.
- `PK_Services`: `CREATE UNIQUE INDEX "PK_Services" ON public."Services" USING btree ("Id")`; valid=True; ready=True.

### public.Sessions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| TokenHash | character varying(64) | NO |  |
| AccountId | text | NO |  |
| ExpiresAt | timestamp with time zone | NO |  |
| IsDemo | boolean | NO |  |

Constraints:

- `FK_Sessions_Accounts_AccountId`: `FOREIGN KEY ("AccountId") REFERENCES "Accounts"("Id") ON DELETE CASCADE`; validated=True.
- `PK_Sessions`: `PRIMARY KEY ("TokenHash")`; validated=True.

Indexes:

- `IX_Sessions_AccountId`: `CREATE INDEX "IX_Sessions_AccountId" ON public."Sessions" USING btree ("AccountId")`; valid=True; ready=True.
- `IX_Sessions_ExpiresAt`: `CREATE INDEX "IX_Sessions_ExpiresAt" ON public."Sessions" USING btree ("ExpiresAt")`; valid=True; ready=True.
- `PK_Sessions`: `CREATE UNIQUE INDEX "PK_Sessions" ON public."Sessions" USING btree ("TokenHash")`; valid=True; ready=True.

### public.Settings

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Key | text | NO |  |
| Value | text | NO |  |

Constraints:

- `PK_Settings`: `PRIMARY KEY ("Key")`; validated=True.

Indexes:

- `PK_Settings`: `CREATE UNIQUE INDEX "PK_Settings" ON public."Settings" USING btree ("Key")`; valid=True; ready=True.

### public.SourceSchedules

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| Row | integer | NO |  |
| Days | text | NO |  |
| Start | text | NO |  |
| End | text | NO |  |
| Type | text | NO |  |
| Note | text | NO |  |
| DoctorId | character varying(64) | NO |  |

Constraints:

- `FK_SourceSchedules_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES "Doctors"("Id") ON DELETE CASCADE`; validated=True.
- `PK_SourceSchedules`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_SourceSchedules_DoctorId`: `CREATE INDEX "IX_SourceSchedules_DoctorId" ON public."SourceSchedules" USING btree ("DoctorId")`; valid=True; ready=True.
- `PK_SourceSchedules`: `CREATE UNIQUE INDEX "PK_SourceSchedules" ON public."SourceSchedules" USING btree ("Id")`; valid=True; ready=True.

### public.Specialties

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Name | character varying(200) | NO |  |
| Version | integer | NO |  |

Constraints:

- `PK_Specialties`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_Specialties_Name`: `CREATE UNIQUE INDEX "IX_Specialties_Name" ON public."Specialties" USING btree ("Name")`; valid=True; ready=True.
- `PK_Specialties`: `CREATE UNIQUE INDEX "PK_Specialties" ON public."Specialties" USING btree ("Id")`; valid=True; ready=True.

### public.WorkingPeriods

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | bigint | NO |  IDENTITY BY DEFAULT |
| Day | integer | NO |  |
| Start | time without time zone | NO |  |
| End | time without time zone | NO |  |
| DoctorId | character varying(64) | NO |  |
| ValidFrom | date | YES |  |
| ValidTo | date | YES |  |

Constraints:

- `CK_WorkingPeriod_Dates`: `CHECK (((("ValidFrom" IS NULL) AND ("ValidTo" IS NULL)) OR (("ValidFrom" IS NOT NULL) AND ("ValidTo" IS NOT NULL) AND ("ValidFrom" <= "ValidTo"))))`; validated=True.
- `CK_WorkingPeriod_Range`: `CHECK ((("Start" < "End") AND (("Day" >= 0) AND ("Day" <= 6))))`; validated=True.
- `FK_WorkingPeriods_Doctors_DoctorId`: `FOREIGN KEY ("DoctorId") REFERENCES "Doctors"("Id") ON DELETE CASCADE`; validated=True.
- `PK_WorkingPeriods`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `IX_WorkingPeriods_DoctorId_Day`: `CREATE INDEX "IX_WorkingPeriods_DoctorId_Day" ON public."WorkingPeriods" USING btree ("DoctorId", "Day")`; valid=True; ready=True.
- `PK_WorkingPeriods`: `CREATE UNIQUE INDEX "PK_WorkingPeriods" ON public."WorkingPeriods" USING btree ("Id")`; valid=True; ready=True.

### public.__EFMigrationsHistory

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| MigrationId | character varying(150) | NO |  |
| ProductVersion | character varying(32) | NO |  |

Constraints:

- `PK___EFMigrationsHistory`: `PRIMARY KEY ("MigrationId")`; validated=True.

Indexes:

- `PK___EFMigrationsHistory`: `CREATE UNIQUE INDEX "PK___EFMigrationsHistory" ON public."__EFMigrationsHistory" USING btree ("MigrationId")`; valid=True; ready=True.

## Platform database

### public.PlatformClinics

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | character varying(40) | NO |  |
| Name | character varying(100) | NO |  |
| ConnectionName | text | NO |  |
| TimeZone | character varying(100) | NO |  |
| State | text | NO |  |
| AdminEmail | character varying(120) | NO |  |
| AdminName | character varying(80) | NO |  |
| Description | character varying(1000) | YES |  |
| Address | character varying(200) | YES |  |
| Phone | character varying(30) | YES |  |
| Discoverable | boolean | NO |  |
| AllowRegistration | boolean | NO |  |
| CreatedBy | text | NO |  |
| CreatedAt | timestamp with time zone | NO |  |
| Adopted | boolean | NO | false |
| Version | integer | NO | 1 |

Constraints:

- `PlatformClinics_State_check`: `CHECK (("State" = ANY (ARRAY['Provisioning'::text, 'Ready'::text, 'Failed'::text])))`; validated=True.
- `PlatformClinics_pkey`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `PlatformClinics_pkey`: `CREATE UNIQUE INDEX "PlatformClinics_pkey" ON public."PlatformClinics" USING btree ("Id")`; valid=True; ready=True.

### public.PlatformOperators

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Id | text | NO |  |
| Email | character varying(120) | NO |  |
| Name | character varying(80) | NO |  |
| PasswordHash | text | NO |  |
| Enabled | boolean | NO |  |
| FailedAttempts | integer | NO |  |
| LockedUntil | timestamp with time zone | YES |  |

Constraints:

- `PlatformOperators_Email_key`: `UNIQUE ("Email")`; validated=True.
- `PlatformOperators_pkey`: `PRIMARY KEY ("Id")`; validated=True.

Indexes:

- `PlatformOperators_Email_key`: `CREATE UNIQUE INDEX "PlatformOperators_Email_key" ON public."PlatformOperators" USING btree ("Email")`; valid=True; ready=True.
- `PlatformOperators_pkey`: `CREATE UNIQUE INDEX "PlatformOperators_pkey" ON public."PlatformOperators" USING btree ("Id")`; valid=True; ready=True.

### public.PlatformSchemaVersions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| Version | integer | NO |  |
| AppliedAt | timestamp with time zone | NO | now() |

Constraints:

- `PlatformSchemaVersions_pkey`: `PRIMARY KEY ("Version")`; validated=True.

Indexes:

- `PlatformSchemaVersions_pkey`: `CREATE UNIQUE INDEX "PlatformSchemaVersions_pkey" ON public."PlatformSchemaVersions" USING btree ("Version")`; valid=True; ready=True.

### public.PlatformSessions

| Column | Actual type | Nullable | Default / generated |
|---|---|---|---|
| TokenHash | character varying(64) | NO |  |
| OperatorId | text | NO |  |
| ExpiresAt | timestamp with time zone | NO |  |

Constraints:

- `PlatformSessions_OperatorId_fkey`: `FOREIGN KEY ("OperatorId") REFERENCES "PlatformOperators"("Id") ON DELETE CASCADE`; validated=True.
- `PlatformSessions_pkey`: `PRIMARY KEY ("TokenHash")`; validated=True.

Indexes:

- `IX_PlatformSessions_ExpiresAt`: `CREATE INDEX "IX_PlatformSessions_ExpiresAt" ON public."PlatformSessions" USING btree ("ExpiresAt")`; valid=True; ready=True.
- `PlatformSessions_pkey`: `CREATE UNIQUE INDEX "PlatformSessions_pkey" ON public."PlatformSessions" USING btree ("TokenHash")`; valid=True; ready=True.

## Integrity results

46 checks/FK/catalogue assertions and 266 column/key/exclusion/cascade assertions passed on the final runs. Full individual cases are in `database-probe-results.json`, `database-column-key-results.json`, `constraint-probes.json` and `column-key-probes.json`.

Model comparison: 156 mapped columns exist with matching nullability, seven EF clinical migrations applied, zero pending migrations and no pending model changes. Manually installed identity/control tables and exact store types are retained in JSON. EF metadata alone is not used as proof of SQL trigger/exclusion behavior.
