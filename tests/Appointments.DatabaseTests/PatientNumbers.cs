using Appointments.Core;
using Appointments.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

internal static class PatientNumbers
{
    public static async Task Verify(string connectionString)
    {
        await using var admin = new NpgsqlConnection(connectionString);
        await admin.OpenAsync();
        // Two independently upgraded clinic schemas must allocate their own numbers.
        foreach (var suffix in new[] { "first", "second" })
        {
            var schema = "patient_numbers_" + Guid.NewGuid().ToString("N") + "_" + suffix;
            await new NpgsqlCommand($"CREATE SCHEMA {schema}", admin).ExecuteNonQueryAsync();
            try
            {
                var settings = new NpgsqlConnectionStringBuilder(connectionString) { SearchPath = schema + ",careline_extensions,public" };
                var options = new DbContextOptionsBuilder<AppointmentsDbContext>().UseNpgsql(settings.ConnectionString,
                    o => o.MigrationsHistoryTable("__EFMigrationsHistory", schema)).Options;
                await using var db = new AppointmentsDbContext(options);
                await db.GetService<IMigrator>().MigrateAsync("20261005225240_PatientProfiles");
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO "Patients" ("Id","Name","Email","Phone","IsDemonstration")
                    VALUES ('same-name-a','Ана Петрова','','',false),('same-name-b','Ана Петрова','','',false);
                    """);
                await db.Database.MigrateAsync();
                var before = await db.Patients.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Number);
                if (before.Count != 2 || before.Values.Any(n => n <= 0) || before.Values.Distinct().Count() != 2)
                    throw new Exception("Legacy same-name patients were merged or not numbered uniquely.");
                await db.Database.MigrateAsync();
                var after = await db.Patients.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Number);
                if (before.Any(p => after[p.Key] != p.Value)) throw new Exception("Repeated migration changed patient numbers.");
                async Task<long> Insert(int i)
                {
                    await using var writer = new AppointmentsDbContext(options);
                    var patient = new Patient("concurrent-" + i, "Ана Петрова", "", "", false);
                    writer.Patients.Add(patient); await writer.SaveChangesAsync(); return patient.Number;
                }
                var numbers = await Task.WhenAll(Enumerable.Range(0, 12).Select(Insert));
                if (numbers.Any(n => n <= 0 || before.Values.Contains(n)) || numbers.Distinct().Count() != 12)
                    throw new Exception("Concurrent inserts did not allocate unique patient numbers.");
                await using var connection = new NpgsqlConnection(settings.ConnectionString);
                await connection.OpenAsync();
                foreach (var number in new[] { 0L, before.Values.First() })
                {
                    await using var tx = await connection.BeginTransactionAsync();
                    try
                    {
                        var command = new NpgsqlCommand("""
                            INSERT INTO "Patients" ("Id","Name","Email","Phone","IsDemonstration","Number")
                            VALUES ('bad-number','Test','','',false,@number)
                            """, connection, tx);
                        command.Parameters.AddWithValue("number", number);
                        await command.ExecuteNonQueryAsync();
                        throw new Exception("Invalid or duplicate patient number was accepted.");
                    }
                    catch (PostgresException e) when (e.SqlState == (number == 0 ? "23514" : "23505")) { }
                    finally { await tx.RollbackAsync(); }
                }
                Console.WriteLine("PASS PostgreSQL " + suffix + " clinic: preserved same-name patients, repeatable number backfill, 12 concurrent allocations, positive/unique constraints");
            }
            finally { await new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", admin).ExecuteNonQueryAsync(); }
        }
    }
}
