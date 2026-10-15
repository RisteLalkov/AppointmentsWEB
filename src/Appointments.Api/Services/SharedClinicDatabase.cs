using System.Text.RegularExpressions;
using Npgsql;

namespace Appointments.Api.Services;

// Tenant routing is entirely server-owned. No public fallback for tenant tables.
public static class SharedClinicDatabase
{
    public const string Extensions = "careline_extensions";
    public static string Schema(string id)
    {
        if (!Regex.IsMatch(id, "^[a-z0-9][a-z0-9-]{0,39}$"))
            throw new InvalidOperationException("Clinic IDs must be unique lowercase slugs (1–40 characters).");
        return id == "main" ? "public" : "clinic_" + id.Replace('-', '_');
    }
    public static string DatabaseKey(string value)
    {
        var b = new NpgsqlConnectionStringBuilder(value);
        return $"{b.Host}:{b.Port}/{b.Database}".ToLowerInvariant();
    }
    public static string Connection(IConfiguration configuration, string id, string? legacyName = null)
    {
        var schema = Schema(id);
        var value = configuration.GetConnectionString("Appointments");
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("ConnectionStrings:Appointments must name the shared clinic database.");
        var b = new NpgsqlConnectionStringBuilder(value);
        if (string.IsNullOrWhiteSpace(b.Host) || string.IsNullOrWhiteSpace(b.Database)
            || !string.IsNullOrEmpty(b.SearchPath) && b.SearchPath != "public")
            throw new InvalidOperationException("The shared clinic connection needs a named PostgreSQL database and no custom SearchPath.");
        if (!string.IsNullOrEmpty(legacyName) && legacyName != "Appointments")
        {
            var legacy = configuration.GetConnectionString(legacyName);
            if (string.IsNullOrWhiteSpace(legacy) || DatabaseKey(legacy) != DatabaseKey(value))
                throw new InvalidOperationException("All clinics must use ConnectionStrings:Appointments. Consolidate separate clinic databases first; see docs/SHARED_DATABASE.md.");
        }
        b.SearchPath = schema + "," + Extensions;
        return b.ConnectionString;
    }
    public static async Task PrepareAsync(ClinicDefinition clinic, CancellationToken ct)
    {
        await using var connection = new NpgsqlConnection(clinic.ConnectionString);
        await connection.OpenAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await using var command = new NpgsqlCommand($"""
            SELECT pg_advisory_xact_lock(734251895);
            CREATE SCHEMA IF NOT EXISTS {Extensions};
            CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA {Extensions};
            DO $$ BEGIN
              IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist') <> '{Extensions}' THEN
                RAISE EXCEPTION 'Prepare the existing extension with database/prepare-shared-clinic-database.sql as PostgreSQL administrator before migration';
              END IF;
            END $$;
            CREATE SCHEMA IF NOT EXISTS "{clinic.Schema}";
            """, connection, tx);
        await command.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }
}
