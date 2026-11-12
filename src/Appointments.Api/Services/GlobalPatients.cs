using System.Security.Cryptography;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Appointments.Api.Services;

// Shared login, clinic-local patient profiles. Every join is one cross-schema database transaction.
public sealed class GlobalPatients(ClinicConnections connections, ClinicRegistry registry, IConfiguration configuration,
    IPasswordHasher<PatientAccount> hasher, TimeProvider time)
{
    public AppointmentsDbContext Open() => new(new DbContextOptionsBuilder<AppointmentsDbContext>()
        .UseNpgsql(SharedClinicDatabase.Connection(configuration, "main")).Options);
    private DateTimeOffset Now => time.GetUtcNow();
    private static RuleException Failure() => new("Е-поштата или лозинката е неточна, или сметката е недостапна.", 401);
    private static Task LockAsync(AppointmentsDbContext db, string id, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"global-patient:" + id}, 0))", ct);
    private Task AuditAsync(AppointmentsDbContext db, string patientId, string actorId, string actorType, string action, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO careline_identity.\"PatientEvents\" (\"PatientAccountId\",\"ActorId\",\"ActorType\",\"Action\",\"OccurredAt\") VALUES ({patientId},{actorId},{actorType},{action},{Now})", ct);
    public async Task<bool> ExistsAsync(string email, CancellationToken ct)
    {
        await using var db = Open(); return await db.PatientAccounts.AnyAsync(a => a.Email == email, ct);
    }
    public async Task<PatientAccountSession?> SessionAsync(string token, CancellationToken ct)
    {
        if (!token.StartsWith("u1.", StringComparison.Ordinal) || token.Length is < 32 or > 256) return null;
        await using var db = Open();
        return await db.PatientAccountSessions.AsNoTracking().Include(s => s.PatientAccount)
            .SingleOrDefaultAsync(s => s.TokenHash == AccountService.HashToken(token) && s.ExpiresAt > Now && s.PatientAccount.Enabled, ct);
    }
    public async Task<SessionResponse> LoginAsync(LoginInput input, CancellationToken ct)
    {
        await using var db = Open();
        var email = AccountService.Email(input.Email);
        var id = await db.PatientAccounts.Where(a => a.Email == email).Select(a => a.Id).SingleOrDefaultAsync(ct);
        if (id == null) throw Failure();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, id, ct);
        var account = await db.PatientAccounts.SingleAsync(a => a.Id == id, ct);
        if (!account.Enabled || account.LockedUntil > Now)
        {
            await SecurityAudit.PatientAsync(db, "auth.login.blocked", id, Now, ct);
            await tx.CommitAsync(ct); throw Failure();
        }
        var verification = hasher.VerifyHashedPassword(account, account.PasswordHash, input.Password);
        if (verification == PasswordVerificationResult.Failed)
        {
            await SecurityAudit.PatientAsync(db, "auth.login.failed", id, Now, ct);
            if (++account.FailedAttempts >= 5) {
                account.FailedAttempts = 0; account.LockedUntil = Now.AddMinutes(15);
                await SecurityAudit.PatientAsync(db, "auth.account.locked", id, Now, ct);
            }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); throw Failure();
        }
        if (verification == PasswordVerificationResult.SuccessRehashNeeded) account.PasswordHash = hasher.HashPassword(account, input.Password);
        account.FailedAttempts = 0; account.LockedUntil = null;
        var token = "u1." + WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(48));
        var expires = Now.AddHours(2);
        db.PatientAccountSessions.Add(new() { TokenHash = AccountService.HashToken(token), PatientAccountId = id, ExpiresAt = expires });
        await db.PatientAccountSessions.Where(s => s.PatientAccountId == id && s.ExpiresAt < Now).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);
        await AuditAsync(db, id, id, "Patient", "session.created", ct); await tx.CommitAsync(ct);
        // Login never creates a profile in another clinic. Joining requires an explicit authenticated POST.
        var selected = input.ClinicId;
        var clinic = registry.Clinics.FirstOrDefault(c => c.Id == selected && c.Enabled);
        var membership = await db.PatientMemberships.AsNoTracking().SingleOrDefaultAsync(m => m.PatientAccountId == id && m.ClinicId == selected, ct);
        if (clinic != null && membership != null)
        {
            try
            {
                await using var local = await connections.OpenAsync(registry.Resolve(clinic.Id), ct);
                var member = await local.Accounts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == membership.AccountId && a.GlobalPatientId == id && a.PatientId == membership.PatientId && a.Enabled, ct);
                if (member != null) return new(token, expires, member.Actor(), false, clinic.Summary(), true, account.Id);
            }
            // A damaged default clinic must not lock a shared identity out of healthy clinics.
            catch (RuleException e) when (e.StatusCode == 503) { }
            catch (NpgsqlException) { }
        }
        return new(token, expires, new(id, account.Name, DemoRole.Patient), false, null, true, account.Id);
    }
    public async Task UnknownLoginAsync(CancellationToken ct)
    {
        await using var db = Open();
        await SecurityAudit.PatientAsync(db, "auth.login.failed", null, Now, ct, "Identity");
    }
    public async Task<AccountSummary> RegisterAsync(RegisterInput input, ClinicDefinition clinic, CancellationToken ct)
    {
        AccountService.ValidatePassword(input.Password);
        var phone = PatientContact.RequirePhone(input.Phone);
        if (input.Name.Trim().Length < 2) throw new RuleException("Внесете име со најмалку два знака.");
        await using var lease = await connections.IdentityLockAsync(ct);
        await registry.RefreshAsync(ct); clinic = registry.Resolve(clinic.Id);
        if (!clinic.AllowRegistration) throw new RuleException("Клиниката не прифаќа нови онлајн пациенти.", 403);
        await connections.RequireUniqueAsync(AccountService.Email(input.Email), clinic.Id, null, ct);
        await using var db = await connections.OpenAsync(clinic, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var identity = new PatientAccount { Name = input.Name.Trim(), Email = AccountService.Email(input.Email), HomeClinicId = clinic.Id, CreatedAt = Now, Phone = phone };
        identity.PasswordHash = hasher.HashPassword(identity, input.Password);
        db.PatientAccounts.Add(identity);
        var member = await CreateMembershipAsync(db, identity, clinic, ct);
        await AuditAsync(db, identity.Id, identity.Id, "Patient", "account.registered", ct);
        await tx.CommitAsync(ct);
        return AccountService.Summary(member);
    }
    private async Task<Account> CreateMembershipAsync(AppointmentsDbContext db, PatientAccount identity, ClinicDefinition clinic, CancellationToken ct)
    {
        // Never reveal an existing contact/history just because somebody registered its email.
        // A conflicting phone-created contact remains independent; no records are merged.
        var contactEmail = await db.Patients.AnyAsync(p => p.Email == identity.Email, ct) ? "" : identity.Email;
        var patient = new Patient(Guid.NewGuid().ToString("N"), identity.Name, contactEmail, PatientContact.RequirePhone(identity.Phone), false);
        var account = new Account { Name = identity.Name, Email = identity.Email, NormalizedEmail = identity.Email,
            Role = DemoRole.Patient, PatientId = patient.Id, GlobalPatientId = identity.Id };
        db.Patients.Add(patient); db.Accounts.Add(account);
        await db.SaveChangesAsync(ct); // Get the database-generated clinic patient number.
        db.PatientMemberships.Add(new() { PatientAccountId = identity.Id, ClinicId = clinic.Id, AccountId = account.Id,
            PatientId = patient.Id, PatientNumber = patient.Number });
        db.AuditEvents.Add(new() { ActorId = account.Id, Action = "patient.membership.created", TargetId = patient.Id, OccurredAt = Now });
        await db.SaveChangesAsync(ct); return account;
    }
    public async Task<SessionResponse> JoinAsync(string token, string clinicId, CancellationToken ct, string? phone = null)
    {
        var session = await SessionAsync(token, ct) ?? throw Failure();
        await registry.RefreshAsync(ct); var clinic = registry.Resolve(clinicId);
        await using var db = await connections.OpenAsync(clinic, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, session.PatientAccountId, ct);
        // Recheck under the same lock as password changes, login and session revocation.
        var current = await db.PatientAccountSessions.Include(s => s.PatientAccount).SingleOrDefaultAsync(s => s.TokenHash == session.TokenHash && s.ExpiresAt > Now && s.PatientAccount.Enabled, ct) ?? throw Failure();
        var membership = await db.PatientMemberships.SingleOrDefaultAsync(m => m.PatientAccountId == current.PatientAccountId && m.ClinicId == clinic.Id, ct);
        Account member;
        if (membership != null)
        {
            member = await db.Accounts.SingleOrDefaultAsync(a => a.Id == membership.AccountId && a.GlobalPatientId == current.PatientAccountId && a.PatientId == membership.PatientId, ct)
                ?? throw new RuleException("Пристапот до клиниката е привремено недостапен.", 503);
            if (!member.Enabled) throw new RuleException("Пристапот до оваа клиника е оневозможен. Контактирајте ја нејзината рецепција.", 403);
        }
        else
        {
            if (!clinic.AllowRegistration) throw new RuleException("Клиниката не прифаќа нови онлајн пациенти.", 403);
            current.PatientAccount.Phone = PatientContact.RequirePhone(phone ?? current.PatientAccount.Phone);
            member = await CreateMembershipAsync(db, current.PatientAccount, clinic, ct);
        }
        current.PatientAccount.HomeClinicId = clinic.Id;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(token, current.ExpiresAt, member.Actor(), false, clinic.Summary(), true, current.PatientAccountId);
    }
    public async Task PasswordAsync(string token, ChangePasswordInput input, CancellationToken ct)
    {
        AccountService.ValidatePassword(input.NewPassword);
        var session = await SessionAsync(token, ct) ?? throw Failure();
        await using var db = Open(); await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, session.PatientAccountId, ct);
        var current = await db.PatientAccountSessions.Include(s => s.PatientAccount).SingleOrDefaultAsync(s => s.TokenHash == session.TokenHash && s.ExpiresAt > Now && s.PatientAccount.Enabled, ct) ?? throw Failure();
        var identity = current.PatientAccount;
        if (hasher.VerifyHashedPassword(identity, identity.PasswordHash, input.CurrentPassword) == PasswordVerificationResult.Failed)
            throw new RuleException("Тековната лозинка е неточна.");
        identity.PasswordHash = hasher.HashPassword(identity, input.NewPassword); identity.FailedAttempts = 0; identity.LockedUntil = null;
        await db.PatientAccountSessions.Where(s => s.PatientAccountId == identity.Id).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct); await AuditAsync(db, identity.Id, identity.Id, "Patient", "password.changed", ct); await tx.CommitAsync(ct);
    }
    public async Task LogoutAsync(string token, CancellationToken ct)
    {
        var session = await SessionAsync(token, ct); if (session == null) return;
        await using var db = Open(); await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, session.PatientAccountId, ct);
        await db.PatientAccountSessions.Where(s => s.TokenHash == session.TokenHash).ExecuteDeleteAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<PatientHome> HomeAsync(string token, CancellationToken ct, string? clinicId = null, bool includeVisits = true)
    {
        var session = await SessionAsync(token, ct) ?? throw Failure();
        await using var db = Open();
        var memberships = await db.PatientMemberships.AsNoTracking().Where(m => m.PatientAccountId == session.PatientAccountId).ToListAsync(ct);
        var choices = new List<PatientClinicOption>(); var visits = new List<PatientVisit>(); var history = new List<PatientVisit>();
        foreach (var clinic in registry.Clinics.Where(c => c.Discoverable && c.Enabled || memberships.Any(m => m.ClinicId == c.Id)))
        {
            var membership = memberships.SingleOrDefault(m => m.ClinicId == clinic.Id);
            var available = clinic.Enabled;
            if (membership != null && available)
            {
                try
                {
                    await using var local = await connections.OpenAsync(registry.Resolve(clinic.Id), ct);
                    available = await local.Accounts.AnyAsync(a => a.Id == membership.AccountId && a.GlobalPatientId == session.PatientAccountId && a.PatientId == membership.PatientId && a.Enabled, ct);
                    if (available && includeVisits && (string.IsNullOrEmpty(clinicId) || clinic.Id == clinicId))
                    {
                        var appointments = await (from a in local.Appointments.AsNoTracking()
                            join doctor in local.Doctors.AsNoTracking() on a.DoctorId equals doctor.Id
                            where a.PatientId == membership.PatientId && a.End > Now && (a.Status == AppointmentStatus.Scheduled || a.Status == AppointmentStatus.Confirmed)
                            orderby a.Start select new { Appointment = a, DoctorName = doctor.Name }).Take(100).ToListAsync(ct);
                        var clock = new SchedulingClock(time, clinic.TimeZone);
                        PatientVisit Visit(Appointment a, string name) => new(clinic.Id, clinic.Name, a.Id, name, a.ServiceName, a.Start, a.End,
                            TimeZoneInfo.ConvertTime(a.Start, clock.Zone).ToString("dd.MM.yyyy HH:mm"), a.Status);
                        visits.AddRange(appointments.Select(v => Visit(v.Appointment, v.DoctorName)));
                        var previous = await (from a in local.Appointments.AsNoTracking()
                            join doctor in local.Doctors.AsNoTracking() on a.DoctorId equals doctor.Id
                            where a.PatientId == membership.PatientId && (a.End <= Now || a.Status == AppointmentStatus.Cancelled || a.Status == AppointmentStatus.Completed || a.Status == AppointmentStatus.NoShow)
                            orderby a.Start descending select new { Appointment = a, DoctorName = doctor.Name }).Take(100).ToListAsync(ct);
                        history.AddRange(previous.Select(v => Visit(v.Appointment, v.DoctorName)));
                    }
                }
                catch (RuleException e) when (e.StatusCode == 503) { available = false; }
                catch (NpgsqlException) { available = false; }
            }
            choices.Add(new(clinic.Summary(), membership != null, available, membership == null ? null : $"PT-{membership.PatientNumber:D6}"));
        }
        if (!string.IsNullOrEmpty(clinicId) && choices.All(c => c.Clinic.Id != clinicId)) throw new RuleException("Клиниката не е пронајдена.", 404);
        return new(session.PatientAccount.Name, session.PatientAccount.Email, choices.OrderByDescending(c => c.Joined).ThenBy(c => c.Clinic.Name).ToList(), visits.OrderBy(v => v.Start).Take(100).ToList(), session.PatientAccount.Phone, history.OrderByDescending(v => v.Start).Take(100).ToList());
    }
    public async Task AdoptAsync(ClinicDefinition clinic, CancellationToken ct)
    {
        await using var lease = await connections.IdentityLockAsync(ct);
        await using var db = await connections.OpenAsync(clinic, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var legacy = await db.Accounts.Where(a => a.Role == DemoRole.Patient && !a.IsDemo && a.GlobalPatientId == null && a.PasswordHash != "").ToListAsync(ct);
        foreach (var account in legacy)
        {
            if (await db.PatientAccounts.AnyAsync(a => a.Email == account.NormalizedEmail, ct))
                throw new InvalidOperationException("Conflicting legacy patient identities. Resolve the test accounts before rerunning --migrate; histories were not merged.");
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM careline_identity.accounts WHERE clinic_id={clinic.Id} AND account_id={account.Id}", ct);
            var identity = new PatientAccount { Email = account.NormalizedEmail, Name = account.Name, PasswordHash = account.PasswordHash,
                HomeClinicId = clinic.Id, Phone = await db.Patients.Where(p => p.Id == account.PatientId).Select(p => p.Phone).SingleAsync(ct), CreatedAt = account.CreatedAt, FailedAttempts = account.FailedAttempts, LockedUntil = account.LockedUntil };
            db.PatientAccounts.Add(identity); account.GlobalPatientId = identity.Id; account.PasswordHash = "";
            var number = await db.Patients.Where(p => p.Id == account.PatientId).Select(p => p.Number).SingleAsync(ct);
            db.PatientMemberships.Add(new() { PatientAccountId = identity.Id, ClinicId = clinic.Id, AccountId = account.Id, PatientId = account.PatientId!, PatientNumber = number });
            await db.Sessions.Where(s => s.AccountId == account.Id).ExecuteDeleteAsync(ct);
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<IReadOnlyList<PatientIdentitySummary>> FindForSupportAsync(string? email, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 120) return [];
        await using var db = Open(); var normalized = AccountService.Email(email);
        return await db.PatientAccounts.AsNoTracking().Where(a => a.Email == normalized)
            .Select(a => new PatientIdentitySummary(a.Id, a.Name, a.Email)).ToListAsync(ct);
    }
    public async Task SupportPasswordAsync(string operatorId, string id, PatientPasswordReset input, CancellationToken ct)
    {
        AccountService.ValidatePassword(input.NewPassword);
        await using var db = Open(); await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, id, ct);
        var account = await db.PatientAccounts.SingleOrDefaultAsync(a => a.Id == id, ct) ?? throw new RuleException("Сметката не е пронајдена.", 404);
        account.PasswordHash = hasher.HashPassword(account, input.NewPassword); account.FailedAttempts = 0; account.LockedUntil = null;
        await db.PatientAccountSessions.Where(s => s.PatientAccountId == id).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct); await AuditAsync(db, id, operatorId, "PlatformOperator", "password.reset", ct); await tx.CommitAsync(ct);
    }
}
