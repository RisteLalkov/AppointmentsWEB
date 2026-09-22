using Npgsql;

var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Appointments") ?? throw new Exception("Disposable test connection required.");
var settings = new NpgsqlConnectionStringBuilder(connectionString);
if (!(settings.Database?.Contains("test", StringComparison.OrdinalIgnoreCase) == true || settings.Database?.Contains("integration", StringComparison.OrdinalIgnoreCase) == true)) throw new Exception("Refusing a non-test database.");
await using var connection = new NpgsqlConnection(connectionString);
await connection.OpenAsync();
var passed = 0;
// Each intentional constraint failure rolls back its own transaction, preserving the HTTP suite data.
async Task Reject(string label, string sql, string state, string? constraint = null)
{
    await using var tx = await connection.BeginTransactionAsync();
    try { await using var cmd = new NpgsqlCommand(sql, connection, tx); await cmd.ExecuteNonQueryAsync(); throw new Exception("Constraint did not reject: " + label); }
    catch (PostgresException e) when (e.SqlState == state && (constraint == null || e.ConstraintName == constraint)) { passed++; Console.WriteLine("PASS SQL " + label); }
    finally { await tx.RollbackAsync(); }
}
string Copy(string doctor, string patient, string start = "a.\"Start\"", string end = "a.\"End\"", string status = "'Confirmed'") => $"""
    INSERT INTO "Appointments" ("Id","DoctorId","PatientId","Start","End","Status","Version","CreatedBy","UpdatedAt","RequestId")
    SELECT 'sql-' || md5(random()::text), {doctor}, {patient}, {start}, {end}, {status}, 1, 'sql-test', now(), md5(random()::text)
    FROM "Appointments" a WHERE a."Status" <> 'Cancelled' AND a."Start" > now() ORDER BY a."Start" LIMIT 1;
    """;
await Reject("doctor exclusion constraint", Copy("a.\"DoctorId\"", "(SELECT p.\"Id\" FROM \"Patients\" p WHERE p.\"Id\" <> a.\"PatientId\" LIMIT 1)"), "23P01", "EX_Appointments_Doctor");
await Reject("patient exclusion across different doctors", Copy("'d02'", "a.\"PatientId\""), "23P01", "EX_Appointments_Patient");
await Reject("invalid appointment range", Copy("a.\"DoctorId\"", "a.\"PatientId\"", end: "a.\"Start\""), "23514");
await Reject("invalid status", Copy("a.\"DoctorId\"", "a.\"PatientId\"", status: "'Invented'"), "23514");
await Reject("nonexistent patient foreign key", Copy("a.\"DoctorId\"", "'missing-patient'", status: "'Cancelled'"), "23503");
await Reject("role requires matching profile link", "UPDATE \"Accounts\" SET \"Role\"='Administrator' WHERE \"PatientId\" IS NOT NULL;", "23514");
await using (var tx = await connection.BeginTransactionAsync())
{
    await using var cmd = new NpgsqlCommand(Copy("a.\"DoctorId\"", "a.\"PatientId\"", status: "'Cancelled'"), connection, tx);
    if (await cmd.ExecuteNonQueryAsync() != 1) throw new Exception("Expected one cancelled insert.");
    await tx.RollbackAsync(); passed++; Console.WriteLine("PASS SQL cancelled intervals do not reserve a slot");
}
Console.WriteLine($"{passed}/{passed} direct PostgreSQL constraint checks passed.");
