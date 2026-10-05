using System.Text.RegularExpressions;
using Appointments.Contracts;
using Appointments.Core;
using Npgsql;

namespace Appointments.Api.Services;

// Operator-owned routing configuration. Never accept a connection string from a request.
public sealed class ClinicDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string ConnectionString { get; init; }
    public required string TimeZone { get; init; }
    public bool Enabled { get; init; } = true;
    public bool AllowRegistration { get; init; } = true;
    public bool ImportSourceDoctors { get; init; }
    public bool SeedDemoData { get; init; }
    public string? BootstrapEmail { get; init; }
    public string? BootstrapPassword { get; init; }
    public ClinicSummary Summary() => new(Id, Name, TimeZone, AllowRegistration);
}

public sealed class ClinicRegistry
{
    public IReadOnlyList<ClinicDefinition> Clinics { get; }
    public ClinicRegistry(IConfiguration configuration)
    {
        var sections = configuration.GetSection("Tenancy:Clinics").GetChildren().ToArray();
        Clinics = sections.Length == 0
            ? [CreateLegacy(configuration)]
            : sections.Select(s => new ClinicDefinition {
                Id = s["Id"] ?? "", Name = s["Name"] ?? "",
                ConnectionString = configuration.GetConnectionString(s["ConnectionStringName"] ?? "") ?? "",
                TimeZone = s["TimeZone"] ?? "Europe/Skopje",
                Enabled = s.GetValue("Enabled", true), AllowRegistration = s.GetValue("AllowRegistration", true),
                ImportSourceDoctors = s.GetValue<bool>("ImportSourceDoctors"), SeedDemoData = s.GetValue<bool>("SeedDemoData"),
                BootstrapEmail = s["BootstrapEmail"], BootstrapPassword = s["BootstrapPassword"]
            }).ToArray();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var databases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var clinic in Clinics)
        {
            if (!Regex.IsMatch(clinic.Id, "^[a-z0-9][a-z0-9-]{0,39}$") || !ids.Add(clinic.Id))
                throw new InvalidOperationException("Clinic IDs must be unique lowercase slugs (1–40 characters).");
            if (string.IsNullOrWhiteSpace(clinic.Name) || clinic.Name.Length > 100)
                throw new InvalidOperationException($"Clinic '{clinic.Id}' needs a name of 1–100 characters.");
            _ = TimeZoneInfo.FindSystemTimeZoneById(clinic.TimeZone);
            if (string.IsNullOrWhiteSpace(clinic.ConnectionString))
                throw new InvalidOperationException($"Clinic '{clinic.Id}' needs a PostgreSQL connection string.");
            var connection = new NpgsqlConnectionStringBuilder(clinic.ConnectionString);
            if (string.IsNullOrWhiteSpace(connection.Host) || string.IsNullOrWhiteSpace(connection.Database)
                || !string.IsNullOrEmpty(connection.SearchPath) && connection.SearchPath != "public")
                throw new InvalidOperationException($"Clinic '{clinic.Id}' must use a named database with the public schema.");
            if (!databases.Add($"{connection.Host}:{connection.Port}/{connection.Database}"))
                throw new InvalidOperationException("Each clinic must use a different PostgreSQL database.");
        }
    }
    private static ClinicDefinition CreateLegacy(IConfiguration c) => new() {
        Id = "main", Name = c["Tenancy:ClinicName"] ?? "Мојата клиника",
        ConnectionString = c.GetConnectionString("Appointments") ?? "",
        TimeZone = c["Scheduling:TimeZone"] ?? "Europe/Skopje",
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
