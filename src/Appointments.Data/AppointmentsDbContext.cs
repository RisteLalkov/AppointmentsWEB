using Appointments.Core;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Data;

public sealed class AppointmentsDbContext(DbContextOptions<AppointmentsDbContext> options) : DbContext(options)
{
    public DbSet<Doctor> Doctors => Set<Doctor>();
    public DbSet<Patient> Patients => Set<Patient>();
    public DbSet<Appointment> Appointments => Set<Appointment>();
    public DbSet<AvailabilityException> Exceptions => Set<AvailabilityException>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<AccessSession> Sessions => Set<AccessSession>();
    public DbSet<IdempotencyRequest> IdempotencyRequests => Set<IdempotencyRequest>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<ClinicSetting> Settings => Set<ClinicSetting>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasPostgresExtension("btree_gist");
        var doctor = b.Entity<Doctor>();
        doctor.ToTable("Doctors", t => t.HasCheckConstraint("CK_Doctor_Duration", "\"DurationMinutes\" BETWEEN 10 AND 120 AND \"DurationMinutes\" % 5 = 0"));
        doctor.HasKey(d => d.Id); doctor.Property(d => d.Id).HasMaxLength(64); doctor.Property(d => d.Name).HasMaxLength(200);
        doctor.Property(d => d.Specialty).HasMaxLength(200); doctor.Property(d => d.ScheduleVersion).IsConcurrencyToken().HasDefaultValue(1);
        doctor.OwnsMany(d => d.WorkingPeriods, p =>
        {
            p.ToTable("WorkingPeriods", t => t.HasCheckConstraint("CK_WorkingPeriod_Range", "\"Start\" < \"End\" AND \"Day\" BETWEEN 0 AND 6"));
            p.WithOwner().HasForeignKey("DoctorId"); p.Property<long>("Id").ValueGeneratedOnAdd(); p.HasKey("Id");
            p.HasIndex("DoctorId", nameof(WorkingPeriod.Day));
        });
        doctor.OwnsMany(d => d.SourceSchedules, p =>
        { p.ToTable("SourceSchedules"); p.WithOwner().HasForeignKey("DoctorId"); p.Property<long>("Id").ValueGeneratedOnAdd(); p.HasKey("Id"); });

        var patient = b.Entity<Patient>(); patient.ToTable("Patients"); patient.HasKey(p => p.Id);
        patient.Property(p => p.Id).HasMaxLength(64); patient.Property(p => p.Name).HasMaxLength(80);
        patient.Property(p => p.Email).HasMaxLength(120); patient.Property(p => p.Phone).HasMaxLength(30);
        patient.HasIndex(p => p.Email).IsUnique().HasFilter("\"Email\" <> ''");

        var appointment = b.Entity<Appointment>();
        appointment.ToTable("Appointments", t =>
        {
            t.HasCheckConstraint("CK_Appointment_Range", "\"Start\" < \"End\"");
            t.HasCheckConstraint("CK_Appointment_Status", "\"Status\" IN ('Scheduled','Confirmed','Completed','Cancelled','NoShow')");
            t.HasCheckConstraint("CK_Appointment_Version", "\"Version\" > 0");
        });
        appointment.HasKey(a => a.Id); appointment.Property(a => a.Id).HasMaxLength(64);
        appointment.Property(a => a.Status).HasConversion<string>().HasMaxLength(20);
        appointment.Property(a => a.Version).IsConcurrencyToken();
        appointment.HasOne<Doctor>().WithMany().HasForeignKey(a => a.DoctorId).OnDelete(DeleteBehavior.Restrict);
        appointment.HasOne<Patient>().WithMany().HasForeignKey(a => a.PatientId).OnDelete(DeleteBehavior.Restrict);
        appointment.HasIndex(a => new { a.DoctorId, a.Start }); appointment.HasIndex(a => new { a.PatientId, a.Start });
        appointment.HasIndex(a => new { a.CreatedBy, a.RequestId }).IsUnique();

        var exception = b.Entity<AvailabilityException>(); exception.ToTable("AvailabilityExceptions", t => t.HasCheckConstraint("CK_Exception_Range", "\"Start\" < \"End\""));
        exception.HasKey(e => e.Id); exception.Property(e => e.Reason).HasMaxLength(120);
        exception.HasOne<Doctor>().WithMany().HasForeignKey(e => e.DoctorId).OnDelete(DeleteBehavior.Restrict);
        exception.HasIndex(e => new { e.DoctorId, e.Date });

        var account = b.Entity<Account>(); account.ToTable("Accounts", t => t.HasCheckConstraint("CK_Account_RoleLink",
            "(\"Role\" = 'Patient' AND \"PatientId\" IS NOT NULL AND \"DoctorId\" IS NULL) OR (\"Role\" = 'Doctor' AND \"DoctorId\" IS NOT NULL AND \"PatientId\" IS NULL) OR (\"Role\" = 'Administrator' AND \"DoctorId\" IS NULL AND \"PatientId\" IS NULL)"));
        account.HasKey(a => a.Id); account.Property(a => a.Email).HasMaxLength(120); account.Property(a => a.NormalizedEmail).HasMaxLength(120);
        account.Property(a => a.Name).HasMaxLength(80); account.Property(a => a.Role).HasConversion<string>().HasMaxLength(20);
        account.HasIndex(a => a.NormalizedEmail).IsUnique(); account.HasIndex(a => a.PatientId).IsUnique(); account.HasIndex(a => a.DoctorId).IsUnique();
        account.HasOne<Patient>().WithMany().HasForeignKey(a => a.PatientId).OnDelete(DeleteBehavior.Restrict);
        account.HasOne<Doctor>().WithMany().HasForeignKey(a => a.DoctorId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<AccessSession>(s => { s.HasKey(s => s.TokenHash); s.Property(s => s.TokenHash).HasMaxLength(64); s.HasOne(s => s.Account).WithMany().HasForeignKey(s => s.AccountId).OnDelete(DeleteBehavior.Cascade); s.HasIndex(s => s.ExpiresAt); });
        b.Entity<IdempotencyRequest>(r => { r.HasKey(r => new { r.AccountId, r.RequestId }); r.Property(r => r.Fingerprint).HasMaxLength(64); r.Property(r => r.ResponseJson).HasColumnType("jsonb"); r.HasOne<Account>().WithMany().HasForeignKey(r => r.AccountId).OnDelete(DeleteBehavior.Restrict); });
        b.Entity<AuditEvent>(a => { a.HasKey(a => a.Id); a.HasIndex(a => a.OccurredAt); a.Property(a => a.Action).HasMaxLength(80); });
        b.Entity<ClinicSetting>().HasKey(s => s.Key);
    }
}
