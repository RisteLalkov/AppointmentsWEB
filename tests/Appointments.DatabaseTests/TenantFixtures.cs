using System.Text.Json;
using Npgsql;

internal static class TenantFixtures
{
    // This helper is called only by tenancy_integration.py with a guarded disposable parent DB.
    public static async Task Run(string operation, string file, string parent)
    {
        await using var admin = new NpgsqlConnection(parent);
        await admin.OpenAsync();
        if (operation == "--tenant-create")
        {
            var prefix = "careline_test_" + Guid.NewGuid().ToString("N")[..12];
            var fixtures = Enumerable.Range(0, 3).Select(i => new NpgsqlConnectionStringBuilder(parent) {
                Database = prefix + "_" + i, Username = prefix + "_" + i,
                Password = Guid.NewGuid().ToString("N"), Pooling = false
            }).Select(c => c.ConnectionString).ToArray();
            await File.WriteAllTextAsync(file, JsonSerializer.Serialize(fixtures));
            foreach (var value in fixtures)
            {
                var c = new NpgsqlConnectionStringBuilder(value);
                await new NpgsqlCommand($"CREATE ROLE {c.Username} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '{c.Password}'", admin).ExecuteNonQueryAsync();
                await new NpgsqlCommand($"CREATE DATABASE {c.Database} OWNER {c.Username}", admin).ExecuteNonQueryAsync();
                await new NpgsqlCommand($"REVOKE ALL ON DATABASE {c.Database} FROM PUBLIC", admin).ExecuteNonQueryAsync();
            }
        }
        else
        {
            var fixtures = JsonSerializer.Deserialize<string[]>(await File.ReadAllTextAsync(file))!;
            foreach (var value in fixtures)
            {
                var c = new NpgsqlConnectionStringBuilder(value);
                if (c.Database == null || !System.Text.RegularExpressions.Regex.IsMatch(c.Database, "^careline_test_[a-f0-9]{12}_[0-2]$") || c.Database != c.Username)
                    throw new Exception("Invalid fixture identity.");
            }
            if (operation == "--tenant-drop")
            {
                foreach (var value in fixtures)
                {
                    var c = new NpgsqlConnectionStringBuilder(value);
                    await new NpgsqlCommand($"DROP DATABASE IF EXISTS {c.Database} WITH (FORCE)", admin).ExecuteNonQueryAsync();
                    await new NpgsqlCommand($"DROP ROLE IF EXISTS {c.Username}", admin).ExecuteNonQueryAsync();
                }
            }
            else if (operation == "--tenant-check")
            {
                var a = new NpgsqlConnectionStringBuilder(fixtures[0]);
                a.Database = new NpgsqlConnectionStringBuilder(fixtures[1]).Database;
                try { await using var wrong = new NpgsqlConnection(a.ConnectionString); await wrong.OpenAsync(); throw new Exception("Cross-clinic database connection accepted."); }
                catch (PostgresException e) when (e.SqlState == "42501") { Console.WriteLine("PASS PostgreSQL clinic role cannot connect to another clinic database"); }
            }
            else throw new Exception("Unknown fixture operation.");
        }
    }
}
