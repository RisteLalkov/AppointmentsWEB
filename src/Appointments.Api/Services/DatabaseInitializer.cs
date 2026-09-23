using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

public sealed class DatabaseInitializer(AppointmentsDbContext db, SchedulingClock clock, IPasswordHasher<Account> hasher, IConfiguration configuration, IWebHostEnvironment environment)
{
    public async Task InitializeAsync(bool migrate, CancellationToken ct)
    {
        if (migrate) await db.Database.MigrateAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(734251894)", ct);
        var zone = await db.Settings.FindAsync(["TimeZone"], ct);
        if (zone != null && zone.Value != clock.Zone.Id) throw new InvalidOperationException("Configured timezone differs from the database. Plan a data migration before changing it.");
        if (zone == null) db.Settings.Add(new() { Key = "TimeZone", Value = clock.Zone.Id });
        if (!await db.Doctors.AnyAsync(ct))
        {
            var file = Path.Combine(AppContext.BaseDirectory, "Seed", "doctors.json");
            var seed = DemoSeed.Create(await File.ReadAllTextAsync(file, ct), clock);
            db.Doctors.AddRange(seed.Doctors);
            if (environment.IsDevelopment() && configuration.GetValue<bool>("Demo:Enabled"))
            {
                db.Patients.AddRange(seed.Patients); db.Appointments.AddRange(seed.Appointments);
                foreach (var actor in DemoSeed.Actors(seed.Doctors, seed.Patients))
                    db.Accounts.Add(new() { Id = actor.Id, Name = actor.Name, Email = actor.Id + "@demo.example.test", NormalizedEmail = actor.Id + "@demo.example.test", Role = actor.Role, DoctorId = actor.DoctorId, PatientId = actor.PatientId, IsDemo = true });
            }
        }
        var email = configuration["Bootstrap:Email"]; var password = configuration["Bootstrap:Password"];
        if (!string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(password))
        {
            AccountService.ValidatePassword(password); email = AccountService.Email(email);
            if (!await db.Accounts.AnyAsync(a => a.NormalizedEmail == email, ct))
            {
                var admin = new Account { Email = email, NormalizedEmail = email, Name = "Администратор на Careline", Role = DemoRole.Administrator };
                admin.PasswordHash = hasher.HashPassword(admin, password); db.Accounts.Add(admin);
            }
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
