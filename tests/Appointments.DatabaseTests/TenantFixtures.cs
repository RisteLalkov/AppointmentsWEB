using System.Text.Json;
using Npgsql;

internal static class TenantFixtures
{
    // Called only by the tenancy/platform suites with a guarded disposable parent DB.
    public static async Task Run(string operation, string file, string parent)
    {
        await using var admin = new NpgsqlConnection(parent);
        await admin.OpenAsync();
        if (operation == "--tenant-create")
        {
            var prefix = "careline_test_" + Guid.NewGuid().ToString("N")[..12];
            var fixtures = Enumerable.Range(0, 2).Select(i => new NpgsqlConnectionStringBuilder(parent) {
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
                if (c.Database == null || !System.Text.RegularExpressions.Regex.IsMatch(c.Database, "^careline_test_[a-f0-9]{12}_[0-1]$") || c.Database != c.Username)
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
            else if (operation == "--tenant-legacy-extension")
            {
                // Simulate the old deployment's extension location using the fixture administrator.
                // Trusted extension types are owned by the bootstrap superuser, not the API role.
                var target = new NpgsqlConnectionStringBuilder(parent) { Database = new NpgsqlConnectionStringBuilder(fixtures[0]).Database };
                await using var legacy = new NpgsqlConnection(target.ConnectionString); await legacy.OpenAsync();
                await new NpgsqlCommand("ALTER EXTENSION btree_gist SET SCHEMA public", legacy).ExecuteNonQueryAsync();
                var prepare = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "prepare-shared-clinic-database.sql"));
                await new NpgsqlCommand(prepare, legacy).ExecuteNonQueryAsync();
                await new NpgsqlCommand(prepare, legacy).ExecuteNonQueryAsync();
                Console.WriteLine("PASS Administrator extension preparation is repeatable on existing clinic data");
            }
            else if (operation == "--tenant-platform-check")
            {
                await using var platform = new NpgsqlConnection(fixtures[1]); await platform.OpenAsync();
                var count = await new NpgsqlCommand("SELECT count(*) FROM \"PlatformClinics\" WHERE \"ConnectionName\"='Appointments' AND \"State\"='Ready'", platform).ExecuteScalarAsync();
                if ((long)count! != 2) throw new Exception("Expected two ready clinics using the same connection name.");
                Console.WriteLine("PASS Two platform registrations use the same Appointments connection");
                await using var shared = new NpgsqlConnection(fixtures[0]); await shared.OpenAsync();
                var clinics = await new NpgsqlCommand("SELECT count(*) FROM pg_namespace WHERE nspname IN ('clinic_new_clinic','clinic_third_clinic')", shared).ExecuteScalarAsync();
                if ((long)clinics! != 2) throw new Exception("Provisioning did not create both clinic schemas in the shared database.");
                var canCreate = await new NpgsqlCommand("SELECT rolcreatedb OR rolcreaterole OR rolsuper FROM pg_roles WHERE rolname=current_user", shared).ExecuteScalarAsync();
                if ((bool)canCreate!) throw new Exception("API fixture must not have cluster-level creation privileges.");
                Console.WriteLine("PASS Provisioning creates schemas in one database without CREATEDB, CREATEROLE or superuser privileges");
            }
            else if (operation == "--tenant-misbind")
            {
                await using var shared = new NpgsqlConnection(fixtures[0]); await shared.OpenAsync();
                await new NpgsqlCommand("UPDATE clinic_east.\"Settings\" SET \"Value\"='wrong-clinic' WHERE \"Key\"='ClinicId'", shared).ExecuteNonQueryAsync();
            }
            else if (operation == "--tenant-check")
            {
                await using var shared = new NpgsqlConnection(fixtures[0]); await shared.OpenAsync();
                var names = new NpgsqlCommand("SELECT count(DISTINCT \"Value\") FROM (SELECT \"Value\" FROM public.\"Settings\" WHERE \"Key\"='ClinicId' UNION ALL SELECT \"Value\" FROM clinic_east.\"Settings\" WHERE \"Key\"='ClinicId' UNION ALL SELECT \"Value\" FROM clinic_empty.\"Settings\" WHERE \"Key\"='ClinicId') c", shared);
                if ((long)(await names.ExecuteScalarAsync())! != 3) throw new Exception("Expected three clinics in one database.");
                Console.WriteLine("PASS Three clinic schemas are bound inside the same PostgreSQL database");
                var extensionSchema = await new NpgsqlCommand("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist'", shared).ExecuteScalarAsync();
                if ((string?)extensionSchema != "careline_extensions") throw new Exception("Legacy extension did not relocate.");
                Console.WriteLine("PASS Existing extension relocates while original appointments and constraints remain usable");
                await using (var fk = await shared.BeginTransactionAsync())
                {
                    // The empty clinic's new doctor does not exist in the main catalogue.
                    try
                    {
                        await new NpgsqlCommand("UPDATE public.\"Accounts\" SET \"Role\"='Doctor', \"PatientId\"=NULL, \"DoctorId\"=(SELECT \"Id\" FROM clinic_empty.\"Doctors\" LIMIT 1) WHERE \"NormalizedEmail\"='owner@tenancy.test'", shared, fk).ExecuteNonQueryAsync();
                        throw new Exception("Foreign-clinic profile link was accepted.");
                    }
                    catch (PostgresException e) when (e.SqlState == "23503") { Console.WriteLine("PASS SQL foreign key cannot link a main-clinic account to another clinic's doctor"); }
                    await fk.RollbackAsync();
                }
                await using var tx = await shared.BeginTransactionAsync();
                await new NpgsqlCommand("SET LOCAL search_path TO clinic_empty,careline_extensions; ALTER TABLE clinic_empty.\"Patients\" RENAME TO \"Patients_missing_test\"", shared, tx).ExecuteNonQueryAsync();
                try { await new NpgsqlCommand("SELECT * FROM \"Patients\"", shared, tx).ExecuteNonQueryAsync(); throw new Exception("Missing tenant table fell back to main clinic."); }
                catch (PostgresException e) when (e.SqlState == "42P01") { Console.WriteLine("PASS Missing tenant table cannot fall back to the main clinic schema"); }
                await tx.RollbackAsync();
            }
            else if (operation is "--tenant-contaminate" or "--tenant-clean" or "--tenant-duplicate" or "--tenant-restore-identity")
            {
                // Only generated, strictly validated disposable fixture databases above.
                await using var shared = new NpgsqlConnection(fixtures[0]); await shared.OpenAsync();
                var sql = operation switch {
                    "--tenant-contaminate" => "CREATE SCHEMA IF NOT EXISTS clinic_new_clinic; CREATE TABLE clinic_new_clinic.\"UnrelatedFixture\" (\"Id\" integer PRIMARY KEY)",
                    "--tenant-clean" => "DROP TABLE clinic_new_clinic.\"UnrelatedFixture\"",
                    "--tenant-duplicate" => "UPDATE clinic_new_clinic.\"Accounts\" SET \"Email\"='owner@platform.test', \"NormalizedEmail\"='owner@platform.test' WHERE \"NormalizedEmail\"='new-owner@platform.test'",
                    _ => "UPDATE clinic_new_clinic.\"Accounts\" SET \"Email\"='new-owner@platform.test', \"NormalizedEmail\"='new-owner@platform.test' WHERE \"NormalizedEmail\"='owner@platform.test'"
                };
                await new NpgsqlCommand(sql, shared).ExecuteNonQueryAsync();
            }
            else throw new Exception("Unknown fixture operation.");
        }
    }
}
