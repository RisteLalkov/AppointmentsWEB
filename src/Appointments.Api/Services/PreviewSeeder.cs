using System.Text.Json;
using Appointments.Core;
using Appointments.Data;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

// Explicit maintenance operation only. Never runs on startup or during --migrate.
public sealed class PreviewSeeder(AppointmentsDbContext db, SchedulingClock clock, IConfiguration configuration,
    PostgresAppointments operations, ILogger<PreviewSeeder> logger)
{
    public async Task SeedAsync(CancellationToken ct)
    {
        if (!configuration.GetValue<bool>("Preview:AllowSeed"))
            throw new InvalidOperationException("Preview seeding is disabled. Enable Preview:AllowSeed only for a test-data clinic, then remove it after use.");
        await operations.TransactionAsync(async () => {
            await operations.LockAsync("catalogue", ct);
            var doctors = await db.Doctors.AsSplitQuery().Where(d => d.Enabled && !d.IsService).ToListAsync(ct);
            if (doctors.Count == 0) throw new InvalidOperationException("Add doctors and their reviewed working hours before seeding a preview clinic.");
            var seed = DemoSeed.Create(JsonSerializer.Serialize(doctors, JsonDemoStore.JsonOptions), clock);
            var existingPatients = await db.Patients.ToListAsync(ct);
            foreach (var sample in seed.Patients)
            {
                var id = "preview-" + sample.Id;
                if (existingPatients.Any(p => p.Id == id)) continue;
                // Reserved addresses cannot send mail to an unrelated real person.
                var patient = sample with { Id = id, Email = id + "@example.test" };
                db.Patients.Add(patient);
            }
            // Remove old demo suffixes only from the known original synthetic profiles.
            foreach (var old in existingPatients.Where(p => p.IsDemonstration && (p.Name.EndsWith("(демо)", StringComparison.OrdinalIgnoreCase) || p.Name.EndsWith("(Demo)", StringComparison.OrdinalIgnoreCase))))
            {
                var name = seed.Patients.FirstOrDefault(p => p.Id == old.Id)?.Name ?? old.Name[..^6].Trim();
                db.Entry(old).CurrentValues.SetValues(old with { Name = name });
                foreach (var account in await db.Accounts.Where(a => a.IsDemo && a.PatientId == old.Id).ToListAsync(ct)) account.Name = name;
            }
            var existing = await db.Appointments.Where(a => a.Start >= clock.UtcNow.AddDays(-30) && a.Start <= clock.UtcNow.AddDays(23)).ToListAsync(ct);
            var services = await db.Services.AsNoTracking().Where(s => s.Enabled).ToListAsync(ct);
            var assignments = await db.DoctorServices.AsNoTracking().ToListAsync(ct);
            var exceptions = await db.Exceptions.AsNoTracking().ToListAsync(ct);
            var added = 0;
            foreach (var candidate in seed.Appointments)
            {
                var doctor = doctors.Single(d => d.Id == candidate.DoctorId);
                var service = services.FirstOrDefault(s => assignments.Any(a => a.DoctorId == doctor.Id && a.ServiceId == s.Id));
                var id = "preview-" + doctor.Id + "-" + candidate.Start.ToUnixTimeSeconds();
                if (await db.Appointments.AnyAsync(a => a.Id == id, ct)) continue;
                var appointment = candidate with { Id = id, PatientId = "preview-" + candidate.PatientId,
                    ServiceId = service?.Id, ServiceName = service?.Name, End = candidate.Start.AddMinutes(service?.DurationMinutes ?? doctor.DurationMinutes),
                    CreatedBy = "preview-seed" };
                if (!SchedulingRules.FitsSchedule(new DemoState { Exceptions = exceptions }, doctor, appointment, clock)) continue;
                if (existing.Any(a => SchedulingRules.Active(a) && (a.DoctorId == doctor.Id || a.PatientId == appointment.PatientId) &&
                    SchedulingRules.Overlaps(a.Start, a.End, appointment.Start, appointment.End))) continue;
                var reception = new DemoActor("preview-seed", "Рецепција", DemoRole.Administrator);
                var createdAt = appointment.Start < clock.UtcNow ? appointment.Start.AddDays(-2) : clock.UtcNow.AddMinutes(-10);
                var closed = appointment.Status is AppointmentStatus.Completed or AppointmentStatus.Cancelled or AppointmentStatus.NoShow;
                var current = appointment with { Status = doctor.RequiresConfirmation ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed,
                    Version = 1, UpdatedAt = createdAt };
                db.AppointmentHistory.Add(AppointmentHistoryEntry.Capture(reception, current, null, AppointmentChangeKind.Created, createdAt));
                if (doctor.RequiresConfirmation && appointment.Status is not (AppointmentStatus.Scheduled or AppointmentStatus.Cancelled))
                {
                    var confirmed = current with { Status = AppointmentStatus.Confirmed, Version = current.Version + 1, UpdatedAt = createdAt.AddMinutes(5) };
                    db.AppointmentHistory.Add(AppointmentHistoryEntry.Capture(reception, confirmed, current, AppointmentChangeKind.StatusChanged, confirmed.UpdatedAt));
                    current = confirmed;
                }
                if (closed)
                {
                    var ended = appointment with { Version = current.Version + 1,
                        UpdatedAt = appointment.Status == AppointmentStatus.Cancelled ? appointment.Start.AddHours(-1) : appointment.End };
                    db.AppointmentHistory.Add(AppointmentHistoryEntry.Capture(reception, ended, current, AppointmentChangeKind.StatusChanged, ended.UpdatedAt));
                    current = ended;
                }
                appointment.Version = current.Version; appointment.UpdatedAt = current.UpdatedAt;
                existing.Add(appointment); db.Appointments.Add(appointment); added++;
            }
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Preview seed added {Appointments} synthetic appointments. Existing appointments and accounts were preserved; no login credentials were created.", added);
            return true;
        }, ct);
    }
}
