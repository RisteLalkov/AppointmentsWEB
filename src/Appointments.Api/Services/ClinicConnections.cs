using Appointments.Core;
using Appointments.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Appointments.Api.Services;

public sealed class ClinicConnections(ClinicRegistry clinics, IConfiguration configuration)
{
    public AppointmentsDbContext Create(ClinicDefinition clinic) => new(new DbContextOptionsBuilder<AppointmentsDbContext>().UseNpgsql(clinic.ConnectionString).Options);
    public async Task<AppointmentsDbContext> OpenAsync(ClinicDefinition clinic, CancellationToken ct)
    {
        var db = Create(clinic);
        try
        {
            var binding = await BindingAsync(db, clinic, ct);
            if (binding?.Value != clinic.Id) throw new RuleException("Клиниката е привремено недостапна.", 503);
            return db;
        }
        catch { await db.DisposeAsync(); throw; }
    }
    // Fully qualify this check: a missing tenant schema must never resolve a table elsewhere.
    public static Task<ClinicSetting?> BindingAsync(AppointmentsDbContext db, ClinicDefinition clinic, CancellationToken ct)
    {
        // Schema() validates a slug and generates the identifier; identifiers cannot be SQL parameters.
        var schema = new NpgsqlCommandBuilder().QuoteIdentifier(clinic.Schema);
        var sql = "SELECT * FROM " + schema + ".\"Settings\"";
        return db.Settings.FromSqlRaw(sql).AsNoTracking().SingleOrDefaultAsync(x => x.Key == "ClinicId", ct);
    }
    // Distributed lock shared by registration, credentials, provisioning and login.
    // When the platform DB is added, stop all hosts together before changing this coordinator.
    public async Task<IAsyncDisposable> IdentityLockAsync(CancellationToken ct)
    {
        var connection = new NpgsqlConnection(configuration.GetConnectionString("Platform") ?? clinics.Configured.OrderBy(c => c.Id, StringComparer.Ordinal).First().ConnectionString);
        try
        {
            await connection.OpenAsync(ct);
            var tx = await connection.BeginTransactionAsync(ct);
            await using var cmd = new NpgsqlCommand("SELECT pg_advisory_xact_lock(734251897)", connection, tx);
            await cmd.ExecuteNonQueryAsync(ct);
            return new LockLease(connection, tx);
        }
        catch { await connection.DisposeAsync(); throw; }
    }
    private sealed class LockLease(NpgsqlConnection connection, NpgsqlTransaction tx) : IAsyncDisposable
    { public async ValueTask DisposeAsync() { await tx.DisposeAsync(); await connection.DisposeAsync(); } }
    public async Task<List<(ClinicDefinition Clinic, string AccountId)>> FindEmailAsync(string email, CancellationToken ct)
    {
        var result = new List<(ClinicDefinition, string)>();
        // Include disabled clinics/accounts when reserving an identity. Re-enabling must not make a login ambiguous.
        foreach (var clinic in clinics.Clinics)
        {
            await using var db = await OpenAsync(clinic, ct);
            foreach (var id in await db.Accounts.AsNoTracking().Where(a => a.NormalizedEmail == email).Select(a => a.Id).ToListAsync(ct)) result.Add((clinic, id));
        }
        return result;
    }
    public async Task RequireUniqueAsync(string email, string clinicId, string? accountId, CancellationToken ct)
    {
        if (clinics.HasPlatform)
        {
            await using var platform = clinics.PlatformDb();
            if (await platform.Clinics.AnyAsync(c => c.State != "Ready" && c.AdminEmail == email && c.Id != clinicId, ct))
                throw new RuleException("Оваа е-пошта не може да се користи за нов пристап.", 409);
        }
        if ((await FindEmailAsync(email, ct)).Any(x => x.Clinic.Id != clinicId || x.AccountId != accountId))
            throw new RuleException("Оваа е-пошта не може да се користи за нов пристап. Контактирајте го администраторот.", 409);
    }
}
