using Appointments.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

internal static class CatalogueUpgrade
{
    public static async Task Verify(string connectionString)
    {
        // Isolated schema in the already-guarded disposable integration database.
        var schema = "catalogue_upgrade_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(connectionString);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE SCHEMA {schema}", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            var settings = new NpgsqlConnectionStringBuilder(connectionString) { SearchPath = schema + ",public" };
            var options = new DbContextOptionsBuilder<AppointmentsDbContext>().UseNpgsql(settings.ConnectionString,
                o => o.MigrationsHistoryTable("__EFMigrationsHistory", schema)).Options;
            await using var db = new AppointmentsDbContext(options);
            await db.GetService<IMigrator>().MigrateAsync("20260922194435_InitialPostgres");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO "Doctors" ("Id","Name","Specialty","BookingMethod","Funding","IsService","RequiresConfirmation","StaffOnly","TuesdayFirst","DurationMinutes","DemoScheduleEdited")
                VALUES ('upgrade-doctor','Existing doctor','Постоечка специјалност','','',false,false,false,false,30,false);
                INSERT INTO "Patients" ("Id","Name","Email","Phone","IsDemonstration") VALUES ('upgrade-patient','Existing patient','','',true);
                INSERT INTO "Appointments" ("Id","DoctorId","PatientId","Start","End","Status","Version","CreatedBy","UpdatedAt","RequestId")
                VALUES ('upgrade-visit','upgrade-doctor','upgrade-patient','2026-09-01 08:00Z','2026-09-01 08:30Z','Completed',1,'admin',now(),'old-request');
                """);
            await db.Database.MigrateAsync();
            var doctor = await db.Doctors.SingleAsync(); var visit = await db.Appointments.SingleAsync();
            var specialty = await db.Specialties.SingleAsync();
            if (!doctor.Enabled || doctor.SpecialtyId != specialty.Id || specialty.Name != "Постоечка специјалност" ||
                visit.Id != "upgrade-visit" || visit.ServiceId != null || visit.ServiceName != null ||
                (visit.End - visit.Start).TotalMinutes != 30 || await db.Services.AnyAsync())
                throw new Exception("Catalogue upgrade did not preserve legacy data.");
            Console.WriteLine("PASS PostgreSQL migration preserves legacy appointment and normalizes exact specialty without inventing services");
        }
        finally { await using var drop = new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", admin); await drop.ExecuteNonQueryAsync(); }
    }
}
