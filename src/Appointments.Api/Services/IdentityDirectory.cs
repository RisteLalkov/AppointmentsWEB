using Appointments.Core;
using Npgsql;

namespace Appointments.Api.Services;

// One indexed directory in the shared clinical database, updated atomically by account triggers.
// It contains routing identifiers only, never credentials or patient/contact records.
public sealed class IdentityDirectory(IConfiguration configuration)
{
    private string Connection => SharedClinicDatabase.Connection(configuration, "main");
    public async Task InitializeAsync(CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(Connection); await c.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,
            "database", "008-identity-directory.sql"), ct), c);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task AttachAsync(ClinicDefinition clinic, CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(clinic.ConnectionString); await c.OpenAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        // Serialize trigger installation/backfill with every other directory mutation.
        var schema = new NpgsqlCommandBuilder().QuoteIdentifier(clinic.Schema);
        await using var cmd = new NpgsqlCommand($"""
            LOCK TABLE {schema}."Accounts" IN SHARE ROW EXCLUSIVE MODE;
            SELECT pg_advisory_xact_lock(734251899);
            DROP TRIGGER IF EXISTS careline_identity_sync ON {schema}."Accounts";
            CREATE TRIGGER careline_identity_sync AFTER INSERT OR UPDATE OR DELETE ON {schema}."Accounts"
              FOR EACH ROW EXECUTE FUNCTION careline_identity.sync_account('{clinic.Id}');
            INSERT INTO careline_identity.clinics(clinic_id,schema_name) VALUES (@id,@schema)
              ON CONFLICT (clinic_id) DO UPDATE SET schema_name=EXCLUDED.schema_name;
            DELETE FROM careline_identity.accounts WHERE clinic_id=@id;
            INSERT INTO careline_identity.accounts (email,clinic_id,account_id,is_demo)
              SELECT "NormalizedEmail",@id,"Id","IsDemo" FROM {schema}."Accounts";
            DO $$ BEGIN
              IF EXISTS (SELECT email FROM careline_identity.accounts GROUP BY email
                HAVING count(*) > 1 AND bool_or(NOT is_demo)) THEN
                RAISE EXCEPTION 'Duplicate non-demo account identities: resolve before migration';
              END IF;
            END $$;
            """, c, tx);
        cmd.Parameters.AddWithValue("id", clinic.Id); cmd.Parameters.AddWithValue("schema", clinic.Schema); await cmd.ExecuteNonQueryAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<List<(string ClinicId, string AccountId)>> FindAsync(string email, CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(Connection); await c.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT clinic_id,account_id FROM careline_identity.accounts WHERE email=@email", c);
        cmd.Parameters.AddWithValue("email", email); await using var rows = await cmd.ExecuteReaderAsync(ct);
        var result = new List<(string, string)>();
        while (await rows.ReadAsync(ct)) result.Add((rows.GetString(0), rows.GetString(1)));
        return result;
    }
    public async Task RequireCoverageAsync(IEnumerable<ClinicDefinition> clinics, CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(Connection); await c.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT clinic_id FROM careline_identity.clinics", c);
        await using var rows = await cmd.ExecuteReaderAsync(ct);
        var installed = new HashSet<string>(StringComparer.Ordinal);
        while (await rows.ReadAsync(ct)) installed.Add(rows.GetString(0));
        if (clinics.Any(clinic => !installed.Contains(clinic.Id)))
            throw new InvalidOperationException("Incomplete identity directory upgrade. Stop all hosts and run --migrate without --clinic before serving traffic.");
    }
    public async Task RequireInstalledAsync(ClinicDefinition clinic, CancellationToken ct)
    {
        await using var c = new NpgsqlConnection(clinic.ConnectionString); await c.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
              JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=@schema AND c.relname='Accounts'
              AND t.tgname='careline_identity_sync' AND t.tgenabled='O')
            """, c);
        cmd.Parameters.AddWithValue("schema", clinic.Schema);
        if (!Equals(await cmd.ExecuteScalarAsync(ct), true))
            throw new InvalidOperationException("Identity directory upgrade required. Stop all hosts and run --migrate before starting this version.");
    }
}
