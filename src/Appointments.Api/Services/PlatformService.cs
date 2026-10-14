using System.Security.Cryptography;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Appointments.Api.Services;

public sealed class PlatformService(ClinicRegistry registry, ClinicConnections connections, IConfiguration configuration,
    IPasswordHasher<Account> hasher)
{
    private static string DatabaseKey(string connection)
    { var b = new NpgsqlConnectionStringBuilder(connection); return $"{b.Host}:{b.Port}/{b.Database}".ToLowerInvariant(); }
    public async Task InitializeAsync(bool migrate, CancellationToken ct)
    {
        if (!registry.HasPlatform) return;
        var names = configuration.GetSection("Platform:ClinicPool").Get<string[]>() ?? [];
        var all = registry.Configured.Select(c => DatabaseKey(c.ConnectionString)).ToList();
        all.Add(DatabaseKey(configuration.GetConnectionString("Platform")!));
        foreach (var name in names)
        {
            var value = configuration.GetConnectionString(name) ?? throw new InvalidOperationException("A clinic pool connection is missing.");
            var b = new NpgsqlConnectionStringBuilder(value);
            if (string.IsNullOrWhiteSpace(b.Database) || string.IsNullOrWhiteSpace(b.Host) || !string.IsNullOrEmpty(b.SearchPath) && b.SearchPath != "public") throw new InvalidOperationException("Pool entries need a named database and public schema.");
            all.Add(DatabaseKey(value));
        }
        if (all.Distinct().Count() != all.Count) throw new InvalidOperationException("Platform, configured clinics and pool entries must use separate databases.");
        await using var db = registry.PlatformDb();
        if (migrate)
        {
            await using var c = new NpgsqlConnection(configuration.GetConnectionString("Platform"));
            await c.OpenAsync(ct);
            await using var command = new NpgsqlCommand(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "database", "005-platform-registry.sql"), ct), c);
            await command.ExecuteNonQueryAsync(ct);
        }
        // Explicit bootstrap only; never reset an existing operator's credentials on restart.
        var email = configuration["Platform:Bootstrap:Email"]; var password = configuration["Platform:Bootstrap:Password"];
        if (!string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(password))
        {
            AccountService.ValidatePassword(password); email = AccountService.Email(email);
            if (!new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(email)) throw new InvalidOperationException("Invalid platform bootstrap email.");
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(734251898)", ct);
            if (!await db.Operators.AnyAsync(ct))
                db.Operators.Add(new() { Email = email, Name = "Администратор на платформата", PasswordHash = hasher.HashPassword(new Account(), password) });
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        }
        await registry.RefreshAsync(ct);
    }
    public async Task<PlatformSession> LoginAsync(LoginInput input, CancellationToken ct)
    {
        await using var db = registry.PlatformDb();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(734251898)", ct);
        var user = await db.Operators.SingleOrDefaultAsync(a => a.Email == AccountService.Email(input.Email), ct);
        var now = DateTimeOffset.UtcNow;
        if (user == null || !user.Enabled || user.LockedUntil > now) throw Failure();
        var verified = hasher.VerifyHashedPassword(new Account(), user.PasswordHash, input.Password);
        if (verified == PasswordVerificationResult.Failed)
        {
            if (++user.FailedAttempts >= 5) { user.LockedUntil = now.AddMinutes(15); user.FailedAttempts = 0; }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); throw Failure();
        }
        if (verified == PasswordVerificationResult.SuccessRehashNeeded) user.PasswordHash = hasher.HashPassword(new Account(), input.Password);
        user.FailedAttempts = 0; user.LockedUntil = null;
        var token = "p1." + WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(48)); var expires = now.AddHours(2);
        db.Sessions.Add(new() { TokenHash = AccountService.HashToken(token), OperatorId = user.Id, ExpiresAt = expires });
        await db.Sessions.Where(s => s.ExpiresAt < now).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(token, expires, user.Id, user.Name);
    }
    private static RuleException Failure() => new("Е-поштата или лозинката е неточна, или сметката е недостапна.", 401);
    public async Task PasswordAsync(string id, ChangePasswordInput input, CancellationToken ct)
    {
        AccountService.ValidatePassword(input.NewPassword);
        await using var db = registry.PlatformDb(); await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(734251898)", ct);
        var user = await db.Operators.SingleAsync(x => x.Id == id, ct);
        if (hasher.VerifyHashedPassword(new Account(), user.PasswordHash, input.CurrentPassword) == PasswordVerificationResult.Failed) throw Failure();
        user.PasswordHash = hasher.HashPassword(new Account(), input.NewPassword);
        await db.Sessions.Where(x => x.OperatorId == id).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<IReadOnlyList<PlatformClinicSummary>> ListAsync(CancellationToken ct)
    {
        await using var db = registry.PlatformDb();
        var managed = await db.Clinics.AsNoTracking().OrderBy(x => x.CreatedAt).ToListAsync(ct);
        return registry.Configured.Select(c => new PlatformClinicSummary(c.Id, c.Name, c.Enabled ? "Ready" : "Disabled", c.Discoverable, c.Address, c.Phone, c.Description, false)).Concat(managed.Select(Summary)).ToArray();
    }
    public static PlatformClinicSummary Summary(PlatformClinic c) => new(c.Id, c.Name, c.State, c.Discoverable, c.Address, c.Phone, c.Description, true);
    public async Task<PlatformClinicSummary> ProvisionAsync(string actor, ProvisionClinicInput input, CancellationToken ct)
    {
        AccountService.ValidatePassword(input.AdminPassword);
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(input.TimeZone); }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { throw new RuleException("Невалидна временска зона."); }
        if (input.Name.Trim().Length < 2 || input.AdminName.Trim().Length < 2) throw new RuleException("Внесете име на клиниката и администраторот.");
        await using var lease = await connections.IdentityLockAsync(ct);
        await registry.RefreshAsync(ct);
        await using var db = registry.PlatformDb();
        var row = await db.Clinics.SingleOrDefaultAsync(c => c.Id == input.Id, ct);
        var email = AccountService.Email(input.AdminEmail);
        if (row != null)
        {
            // A repeated ID is a resume, never a credential or routing replacement.
            if (row.Name != input.Name.Trim() || row.AdminEmail != email || row.AdminName != input.AdminName.Trim() || row.TimeZone != input.TimeZone
                || row.Description != input.Description?.Trim() || row.Address != input.Address?.Trim() || row.Phone != input.Phone?.Trim()
                || row.Discoverable != input.Discoverable || row.AllowRegistration != input.AllowRegistration)
                throw new RuleException("Овој идентификатор веќе има друга постапка. За повторување користете ги истите податоци.", 409);
            if (row.State == "Ready") return Summary(row);
        }
        else
        {
            if (registry.Configured.Any(c => c.Id == input.Id)) throw new RuleException("Идентификаторот е веќе зафатен.", 409);
            await connections.RequireUniqueAsync(email, input.Id, null, ct);
            if (await db.Clinics.AnyAsync(c => c.AdminEmail == email && c.State != "Ready", ct)) throw new RuleException("Оваа е-пошта не може да се користи за нов пристап.", 409);
            var pool = configuration.GetSection("Platform:ClinicPool").Get<string[]>() ?? [];
            var used = await db.Clinics.Select(c => c.ConnectionName).ToListAsync(ct);
            var available = pool.FirstOrDefault(x => !used.Contains(x)) ?? throw new RuleException("Нема подготвена база за нова клиника. Контактирајте го техничкиот администратор.", 409);
            row = new() { Id = input.Id, Name = input.Name.Trim(), ConnectionName = available, TimeZone = input.TimeZone, AdminName = input.AdminName.Trim(), AdminEmail = email,
                Discoverable = input.Discoverable, AllowRegistration = input.AllowRegistration, Description = input.Description?.Trim(), Address = input.Address?.Trim(), Phone = input.Phone?.Trim(), CreatedBy = actor, CreatedAt = DateTimeOffset.UtcNow };
            db.Clinics.Add(row); await db.SaveChangesAsync(ct); // Durable reservation before touching the clinic DB.
        }
        try
        {
            var clinic = registry.Definition(row);
            await using var clinicDb = connections.Create(clinic);
            // A fresh pool entry must be empty. Resume only a database explicitly bound by this provisioning attempt.
            await using (var raw = new NpgsqlConnection(clinic.ConnectionString))
            {
                await raw.OpenAsync(ct);
                await using var tables = new NpgsqlCommand("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'", raw);
                var count = (long)(await tables.ExecuteScalarAsync(ct))!;
                if (count > 0)
                {
                    await using var bound = new NpgsqlCommand("SELECT to_regclass('public.\"CarelineProvisioning\"') IS NOT NULL", raw);
                    if (!(bool)(await bound.ExecuteScalarAsync(ct))!) throw new RuleException("Подготвената база не е празна. Потребна е техничка проверка; податоците не се променети.", 409);
                    await using var marker = new NpgsqlCommand("SELECT \"ClinicId\" FROM \"CarelineProvisioning\"", raw);
                    if ((string?)(await marker.ExecuteScalarAsync(ct)) != clinic.Id) throw new RuleException("Базата е доделена на друга клиника.", 409);
                }
                else
                {
                    await using var marker = new NpgsqlCommand("CREATE TABLE \"CarelineProvisioning\" (\"ClinicId\" text PRIMARY KEY); INSERT INTO \"CarelineProvisioning\" VALUES (@id)", raw);
                    marker.Parameters.AddWithValue("id", clinic.Id); await marker.ExecuteNonQueryAsync(ct);
                }
            }
            await clinicDb.Database.MigrateAsync(ct);
            await using var tx = await clinicDb.Database.BeginTransactionAsync(ct);
            await clinicDb.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(734251894)", ct);
            var binding = await clinicDb.Settings.FindAsync(["ClinicId"], ct);
            if (binding != null && binding.Value != clinic.Id) throw new RuleException("Базата е доделена на друга клиника.", 409);
            if (binding == null) { clinicDb.Settings.Add(new() { Key = "ClinicId", Value = clinic.Id }); clinicDb.Settings.Add(new() { Key = "TimeZone", Value = clinic.TimeZone }); }
            var admin = await clinicDb.Accounts.SingleOrDefaultAsync(a => a.NormalizedEmail == email, ct);
            if (admin == null)
            {
                if (await clinicDb.Accounts.AnyAsync(ct)) throw new RuleException("Базата веќе содржи сметки.", 409);
                admin = new() { Email = email, NormalizedEmail = email, Name = row.AdminName, Role = DemoRole.Administrator };
                admin.PasswordHash = hasher.HashPassword(admin, input.AdminPassword); clinicDb.Accounts.Add(admin);
                clinicDb.AuditEvents.Add(new() { ActorId = "platform:" + actor, Action = "clinic.provisioned", TargetId = clinic.Id, OccurredAt = DateTimeOffset.UtcNow });
            }
            else if (admin.Role != DemoRole.Administrator || hasher.VerifyHashedPassword(admin, admin.PasswordHash, input.AdminPassword) == PasswordVerificationResult.Failed)
                throw new RuleException("Податоците за повторување не се совпаѓаат. Контактирајте го техничкиот администратор.", 409);
            await clinicDb.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            row.State = "Ready"; await db.SaveChangesAsync(ct); await registry.RefreshAsync(ct);
            return Summary(row);
        }
        catch
        {
            // Never delete or reset a database on failure. Retry this clinic ID to resume safely.
            row.State = "Failed";
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await db.SaveChangesAsync(cleanup.Token);
            throw;
        }
    }
}
