using System.Security.Cryptography;
using System.Text;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

public sealed class AccountService(AppointmentsDbContext db, PostgresAppointments operations, IPasswordHasher<Account> hasher, SchedulingClock clock)
{
    public static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public static string Email(string email) => email.Trim().ToLowerInvariant();
    public static void ValidatePassword(string password)
    { if (password.Length is < 12 or > 128) throw new RuleException("Користете лозинка со должина од 12 до 128 знаци."); }

    public async Task<SessionResponse> LoginAsync(LoginInput input, CancellationToken ct)
    {
        var normalized = Email(input.Email);
        var id = await db.Accounts.AsNoTracking().Where(a => a.NormalizedEmail == normalized).Select(a => a.Id).SingleOrDefaultAsync(ct);
        if (id == null) throw new RuleException("Е-поштата или лозинката е неточна, или сметката е недостапна.", 401);
        // Commit failures as well: lockout counters must survive rejected sign-ins.
        var result = await operations.TransactionAsync<SessionResponse?>(async () =>
        {
            await operations.LockAsync("account:" + id, ct);
            var account = await db.Accounts.SingleAsync(a => a.Id == id, ct);
            if (!account.Enabled || account.PasswordHash.Length == 0 || account.LockedUntil > clock.UtcNow) return null;
            var verified = hasher.VerifyHashedPassword(account, account.PasswordHash, input.Password);
            if (verified == PasswordVerificationResult.Failed)
            {
                account.FailedAttempts++;
                if (account.FailedAttempts >= 5) { account.LockedUntil = clock.UtcNow.AddMinutes(15); account.FailedAttempts = 0; }
                await db.SaveChangesAsync(ct); return null;
            }
            if (verified == PasswordVerificationResult.SuccessRehashNeeded) account.PasswordHash = hasher.HashPassword(account, input.Password);
            account.FailedAttempts = 0; account.LockedUntil = null;
            return await IssueAsync(account, false, ct);
        }, ct);
        return result ?? throw new RuleException("Е-поштата или лозинката е неточна, или сметката е недостапна.", 401);
    }
    public Task<SessionResponse> DemoAsync(string id, CancellationToken ct) => operations.TransactionAsync(async () =>
    {
        await operations.LockAsync("account:" + id, ct);
        var account = await db.Accounts.SingleOrDefaultAsync(a => a.Id == id && a.IsDemo && a.Enabled, ct)
            ?? throw new RuleException("Демо-корисникот не е пронајден.", 404);
        return await IssueAsync(account, true, ct);
    }, ct);
    private async Task<SessionResponse> IssueAsync(Account account, bool demo, CancellationToken ct)
    {
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(48));
        var expires = clock.UtcNow.AddHours(2);
        db.Sessions.Add(new() { TokenHash = HashToken(token), AccountId = account.Id, ExpiresAt = expires, IsDemo = demo });
        // Opportunistic expiry cleanup; no session token or password is written to audit logs.
        await db.Sessions.Where(s => s.AccountId == account.Id && s.ExpiresAt < clock.UtcNow).ExecuteDeleteAsync(ct);
        operations.Audit(account.Actor(), demo ? "session.demo.created" : "session.created", account.Id);
        await db.SaveChangesAsync(ct); return new(token, expires, account.Actor(), demo);
    }
    public async Task<AccountSummary> RegisterAsync(RegisterInput input, CancellationToken ct)
    {
        ValidatePassword(input.Password);
        if (input.Name.Trim().Length < 2) throw new RuleException("Внесете име со најмалку два знака.");
        return await operations.TransactionAsync(async () =>
        {
            var email = Email(input.Email);
            if (await db.Patients.AnyAsync(p => p.Email == email, ct)) throw new RuleException("Не може да се создаде сметка со овие податоци. Проверете со рецепцијата дали веќе имате пациентски профил.", 409);
            var patient = new Patient(Guid.NewGuid().ToString("N"), input.Name.Trim(), email, "", false);
            var account = new Account { Email = email, NormalizedEmail = email, Name = patient.Name, Role = DemoRole.Patient, PatientId = patient.Id };
            account.PasswordHash = hasher.HashPassword(account, input.Password); db.Patients.Add(patient); db.Accounts.Add(account);
            operations.Audit(account.Actor(), "account.registered", account.Id); await db.SaveChangesAsync(ct); return Summary(account);
        }, ct);
    }
    public async Task<AccountSummary> CreateAsync(DemoActor actor, AccountInput input, CancellationToken ct)
    {
        Admin(actor); ValidatePassword(input.Password);
        if (!Enum.IsDefined(input.Role) || input.Name.Trim().Length is < 2 or > 80 || input.Email.Length > 120) throw new RuleException("Внесете важечко име, е-пошта и улога.");
        if (input.Role == DemoRole.Doctor && (input.DoctorId == null || input.PatientId != null || !await db.Doctors.AnyAsync(d => d.Id == input.DoctorId && !d.IsService, ct))) throw new RuleException("Изберете конкретен лекар за лекарската сметка.");
        if (input.Role == DemoRole.Patient && (input.PatientId == null || input.DoctorId != null || !await db.Patients.AnyAsync(p => p.Id == input.PatientId, ct))) throw new RuleException("Изберете еден пациент за пациентската сметка.");
        if (input.Role == DemoRole.Administrator && (input.PatientId != null || input.DoctorId != null)) throw new RuleException("Сметките на рецепцијата не може да се поврзат со лекарски или пациентски профил.");
        return await operations.TransactionAsync(async () =>
        {
            var email = Email(input.Email);
            var account = new Account { Email = email, NormalizedEmail = email, Name = input.Name.Trim(), Role = input.Role, DoctorId = input.DoctorId, PatientId = input.PatientId };
            account.PasswordHash = hasher.HashPassword(account, input.Password); db.Accounts.Add(account);
            operations.Audit(actor, "account.created", account.Id); await db.SaveChangesAsync(ct); return Summary(account);
        }, ct);
    }
    public async Task ChangePasswordAsync(DemoActor actor, ChangePasswordInput input, CancellationToken ct)
    {
        ValidatePassword(input.NewPassword);
        await operations.TransactionAsync(async () =>
        {
            await operations.LockAsync("account:" + actor.Id, ct);
            var account = await db.Accounts.SingleAsync(a => a.Id == actor.Id, ct);
            if (account.PasswordHash.Length == 0 || hasher.VerifyHashedPassword(account, account.PasswordHash, input.CurrentPassword) == PasswordVerificationResult.Failed) throw new RuleException("Тековната лозинка е неточна.");
            account.PasswordHash = hasher.HashPassword(account, input.NewPassword); account.FailedAttempts = 0; account.LockedUntil = null;
            await db.Sessions.Where(s => s.AccountId == actor.Id).ExecuteDeleteAsync(ct);
            operations.Audit(actor, "account.password.changed", actor.Id); await db.SaveChangesAsync(ct); return true;
        }, ct);
    }
    public async Task AccessAsync(DemoActor actor, string id, bool enabled, CancellationToken ct)
    {
        Admin(actor); if (id == actor.Id) throw new RuleException("Не може да ја оневозможите сопствената сметка.");
        await operations.TransactionAsync(async () =>
        {
            await operations.LockAsync("account:" + id, ct);
            var account = await db.Accounts.SingleOrDefaultAsync(a => a.Id == id, ct) ?? throw new RuleException("Сметката не е пронајдена.", 404);
            account.Enabled = enabled; await db.Sessions.Where(s => s.AccountId == id).ExecuteDeleteAsync(ct);
            operations.Audit(actor, enabled ? "account.enabled" : "account.disabled", id); await db.SaveChangesAsync(ct); return true;
        }, ct);
    }
    public static void Admin(DemoActor actor) { if (actor.Role != DemoRole.Administrator) throw new RuleException("Потребен е администраторски пристап.", 403); }
    public Task<bool> CredentialsAsync(DemoActor actor, string id, LoginInput input, CancellationToken ct)
    {
        Admin(actor); ValidatePassword(input.Password);
        return operations.TransactionAsync(async () =>
        {
            await operations.LockAsync("account:" + id, ct);
            var account = await db.Accounts.SingleOrDefaultAsync(a => a.Id == id, ct) ?? throw new RuleException("Сметката не е пронајдена.", 404);
            account.Email = Email(input.Email); account.NormalizedEmail = account.Email;
            account.PasswordHash = hasher.HashPassword(account, input.Password); account.IsDemo = false;
            account.FailedAttempts = 0; account.LockedUntil = null;
            await db.Sessions.Where(s => s.AccountId == id).ExecuteDeleteAsync(ct);
            operations.Audit(actor, "account.credentials.provisioned", id); await db.SaveChangesAsync(ct); return true;
        }, ct);
    }
    public static AccountSummary Summary(Account a) => new(a.Id, a.Email, a.Name, a.Role, a.DoctorId, a.PatientId, a.Enabled);
}
