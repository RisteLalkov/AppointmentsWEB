using System.Text.RegularExpressions;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

// Operator-owned routing configuration. Never accept a connection string from a request.
public sealed class ClinicDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string ConnectionString { get; init; }
    public string Schema => SharedClinicDatabase.Schema(Id);
    public required string TimeZone { get; init; }
    public bool Enabled { get; init; } = true;
    public bool Discoverable { get; init; } = true;
    public string? Description { get; init; }
    public string? Address { get; init; }
    public string? Phone { get; init; }
    public bool AllowRegistration { get; init; } = true;
    public bool ImportSourceDoctors { get; init; }
    public bool SeedDemoData { get; init; }
    public string? BootstrapEmail { get; init; }
    public string? BootstrapPassword { get; init; }
    public ClinicSummary Summary() => new(Id, Name, TimeZone, AllowRegistration);
}

public sealed class ClinicRegistry
{
    private readonly IConfiguration configuration;
    private ClinicDefinition[] managed = [];
    private readonly SemaphoreSlim refresh = new(1, 1);
    public IReadOnlyList<ClinicDefinition> Configured { get; }
    public IReadOnlyList<ClinicDefinition> Clinics
    {
        get
        {
            var current = Volatile.Read(ref managed);
            return Configured.Where(c => !current.Any(m => m.Id == c.Id)).Concat(current).ToArray();
        }
    }
    public ClinicRegistry(IConfiguration configuration)
    {
        this.configuration = configuration;
        var sections = configuration.GetSection("Tenancy:Clinics").GetChildren().ToArray();
        Configured = sections.Length == 0
            ? [CreateLegacy(configuration)]
            : sections.Select(s => new ClinicDefinition {
                Id = s["Id"] ?? "", Name = s["Name"] ?? "",
                ConnectionString = SharedClinicDatabase.Connection(configuration, s["Id"] ?? "", s["ConnectionStringName"]),
                TimeZone = s["TimeZone"] ?? "Europe/Skopje",
                Discoverable = s.GetValue("Discoverable", true), Description = s["Description"], Address = s["Address"], Phone = s["Phone"],
                Enabled = s.GetValue("Enabled", true), AllowRegistration = s.GetValue("AllowRegistration", true),
                ImportSourceDoctors = s.GetValue<bool>("ImportSourceDoctors"), SeedDemoData = s.GetValue<bool>("SeedDemoData"),
                BootstrapEmail = s["BootstrapEmail"], BootstrapPassword = s["BootstrapPassword"]
            }).ToArray();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var clinic in Clinics)
        {
            if (!Regex.IsMatch(clinic.Id, "^[a-z0-9][a-z0-9-]{0,39}$") || !ids.Add(clinic.Id))
                throw new InvalidOperationException("Clinic IDs must be unique lowercase slugs (1–40 characters).");
            if (string.IsNullOrWhiteSpace(clinic.Name) || clinic.Name.Length > 100)
                throw new InvalidOperationException($"Clinic '{clinic.Id}' needs a name of 1–100 characters.");
            _ = TimeZoneInfo.FindSystemTimeZoneById(clinic.TimeZone);
            if (string.IsNullOrWhiteSpace(clinic.ConnectionString))
                throw new InvalidOperationException($"Clinic '{clinic.Id}' needs a PostgreSQL connection string.");
        }
    }
    public PlatformDbContext PlatformDb() => new(new DbContextOptionsBuilder<PlatformDbContext>().UseNpgsql(configuration.GetConnectionString("Platform") ?? throw new RuleException("Платформата не е конфигурирана.", 503)).Options);
    public bool HasPlatform => !string.IsNullOrWhiteSpace(configuration.GetConnectionString("Platform"));
    public async Task RefreshAsync(CancellationToken ct)
    {
        if (!HasPlatform) return;
        await refresh.WaitAsync(ct);
        try
        {
            await using var db = PlatformDb();
            var rows = await db.Clinics.AsNoTracking().Where(c => c.State == "Ready").ToListAsync(ct);
            var all = rows.Select(Definition).ToArray();
            foreach (var row in rows)
            {
                var configured = Configured.SingleOrDefault(c => c.Id == row.Id);
                if (configured != null && (!row.Adopted || !configured.Enabled || configured.TimeZone != row.TimeZone))
                    throw new InvalidOperationException("Configured clinic overlap requires deliberate platform adoption with the original time zone.");
            }
            Volatile.Write(ref managed, all);
        }
        finally { refresh.Release(); }
    }
    public ClinicDefinition Definition(PlatformClinic c) => new() {
        Id = c.Id, Name = c.Name, TimeZone = c.TimeZone, Discoverable = c.Discoverable,
        Description = c.Description, Address = c.Address, Phone = c.Phone, AllowRegistration = c.AllowRegistration,
        ConnectionString = c.ConnectionName == "Appointments" ? SharedClinicDatabase.Connection(configuration, c.Id)
            : throw new InvalidOperationException("A managed clinic still uses a separate database. Consolidate its data and update its platform ConnectionName to Appointments; see docs/SHARED_DATABASE.md.")
    };
    private static ClinicDefinition CreateLegacy(IConfiguration c) => new() {
        Id = "main", Name = c["Tenancy:ClinicName"] ?? "Мојата клиника",
        ConnectionString = SharedClinicDatabase.Connection(c, "main"),
        TimeZone = c["Scheduling:TimeZone"] ?? "Europe/Skopje",
        Discoverable = c.GetValue("Tenancy:Discoverable", true), Description = c["Tenancy:Description"], Address = c["Tenancy:Address"], Phone = c["Tenancy:Phone"],
        ImportSourceDoctors = true, SeedDemoData = true,
        BootstrapEmail = c["Bootstrap:Email"], BootstrapPassword = c["Bootstrap:Password"]
    };
    public ClinicDefinition Resolve(string? id)
    {
        // Compatibility for existing single-clinic clients. Multiple clinics require explicit selection.
        if (string.IsNullOrEmpty(id))
        {
            if (Clinics.Count == 1 && Clinics[0].Enabled) return Clinics[0];
            throw new RuleException("Изберете клиника.", 400);
        }
        return Clinics.SingleOrDefault(c => c.Id == id && c.Enabled)
            ?? throw new RuleException("Клиниката не е достапна.", 404);
    }
}

// One immutable selection per DI scope, set before DbContext/authentication resolution.
public sealed class ClinicContext
{
    private ClinicDefinition? clinic;
    public bool IsSelected => clinic != null;
    public ClinicDefinition Current => clinic ?? throw new InvalidOperationException("Clinic context has not been selected.");
    public void Select(ClinicDefinition value)
    {
        if (clinic != null) throw new InvalidOperationException("Cannot switch clinics within a request.");
        clinic = value;
    }
}
