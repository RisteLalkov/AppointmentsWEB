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
            await ExpandCatalogueAsync(ct);
            var doctors = await db.Doctors.AsSplitQuery().Where(d => d.Enabled && !d.IsService).ToListAsync(ct);
            if (doctors.Count == 0) throw new InvalidOperationException("Add doctors and their reviewed working hours before seeding a preview clinic.");
            var services = await db.Services.AsNoTracking().Where(s => s.Enabled).OrderBy(s => s.Id).ToListAsync(ct);
            var assignments = await db.DoctorServices.AsNoTracking().ToListAsync(ct);
            var reviewed = doctors.Where(d => !assignments.Any(a => a.DoctorId == d.Id) || services.Any(s => assignments.Any(a => a.DoctorId == d.Id && a.ServiceId == s.Id)))
                .Select(d => d with { DurationMinutes = services.FirstOrDefault(s => assignments.Any(a => a.DoctorId == d.Id && a.ServiceId == s.Id))?.DurationMinutes ?? d.DurationMinutes }).ToList();
            var seed = DemoSeed.Create(JsonSerializer.Serialize(reviewed, JsonDemoStore.JsonOptions), clock, 160);
            var existingPatients = await db.Patients.ToListAsync(ct);
            foreach (var sample in seed.Patients)
            {
                var id = "preview-" + sample.Id;
                if (existingPatients.Any(p => p.Id == id)) continue;
                // Reserved addresses cannot send mail to an unrelated real person.
                var patient = sample with { Id = id, Email = existingPatients.Any(p => p.Email == id + "@example.test") ? "" : id + "@example.test", Number = 0 };
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
            var existingIds = (await db.Appointments.Select(a => a.Id).ToListAsync(ct)).ToHashSet();
            var exceptions = await db.Exceptions.AsNoTracking().ToListAsync(ct);
            var added = 0;
            foreach (var candidate in seed.Appointments)
            {
                var doctor = doctors.Single(d => d.Id == candidate.DoctorId);
                var service = services.FirstOrDefault(s => assignments.Any(a => a.DoctorId == doctor.Id && a.ServiceId == s.Id));
                var id = "preview-" + doctor.Id + "-" + candidate.Start.ToUnixTimeSeconds();
                if (!existingIds.Add(id)) continue;
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
    private async Task ExpandCatalogueAsync(CancellationToken ct)
    {
        var specialtyNames = new[] { "Кардиологија", "Неврологија", "Ендокринологија", "Ортопедија", "Гинекологија", "Дерматологија", "Офталмологија", "Оториноларингологија", "Педијатрија", "Урологија", "Ревматологија", "Интерна медицина" };
        var names = new[] { "Д-р Мила Николовска", "Д-р Андреј Стојчевски", "Д-р Ева Трајковска", "Д-р Бојан Велјанов", "Д-р Ирина Костадиновска", "Д-р Дамјан Милевски", "Д-р Сара Павловска", "Д-р Виктор Цветанов", "Д-р Леона Ристевска", "Д-р Мартин Јованов", "Д-р Теа Ангеловска", "Д-р Филип Митревски" };
        var specialties = await db.Specialties.ToListAsync(ct);
        var doctors = await db.Doctors.AsSplitQuery().ToListAsync(ct);
        var services = await db.Services.ToListAsync(ct);
        var assignments = await db.DoctorServices.ToListAsync(ct);
        for (var i = 0; i < names.Length; i++)
        {
            var specialty = specialties.FirstOrDefault(s => s.Name.Equals(specialtyNames[i], StringComparison.OrdinalIgnoreCase));
            if (specialty == null) { specialty = new Specialty { Id = $"preview-specialty-{i+1:00}", Name = specialtyNames[i] }; specialties.Add(specialty); db.Specialties.Add(specialty); }
            var id = $"preview-doctor-{i+1:00}";
            if (doctors.Any(d => d.Id == id || d.Name.Equals(names[i], StringComparison.OrdinalIgnoreCase))) continue;
            var doctor = new Doctor { Id = id, Name = names[i], SpecialtyId = specialty.Id, Specialty = specialty.Name, DurationMinutes = i % 2 == 0 ? 30 : 20,
                Funding = "Приватно", RequiresConfirmation = i % 3 == 1, StaffOnly = i == 11 };
            if (!doctor.StaffOnly)
                doctor.WorkingPeriods = new[] { DayOfWeek.Monday,DayOfWeek.Tuesday,DayOfWeek.Wednesday,DayOfWeek.Thursday,DayOfWeek.Friday }
                    .Select((day,index) => new WorkingPeriod(day, new TimeOnly((index+i)%2 == 0 ? 9 : 13,0), new TimeOnly((index+i)%2 == 0 ? 15 : 19,0))).ToList();
            doctors.Add(doctor); db.Doctors.Add(doctor);
        }
        foreach (var doctor in doctors.Where(d => d.Enabled && !d.IsService && !assignments.Any(a => a.DoctorId == d.Id)))
        {
            for (var i = 0; i < 2; i++)
            {
                var name = (i == 0 ? "Специјалистички преглед · " : "Контролен преглед · ") + doctor.Specialty;
                if (name.Length > 200) name = name[..(char.IsHighSurrogate(name[199]) ? 199 : 200)];
                var service = services.FirstOrDefault(s => s.Name == name && s.SpecialtyId == doctor.SpecialtyId);
                if (service is { Enabled: false }) continue;
                if (service == null) { service = new MedicalService { Id = "preview-service-" + Guid.NewGuid().ToString("N"), Name = name, SpecialtyId = doctor.SpecialtyId!, DurationMinutes = i == 0 ? 30 : 20 }; services.Add(service); db.Services.Add(service); }
                var assignment = new DoctorService(doctor.Id, service.Id); assignments.Add(assignment); db.DoctorServices.Add(assignment);
            }
        }
        await db.SaveChangesAsync(ct);
        // Demonstrate an absence and a one-off available period without changing existing hours.
        foreach (var extra in new[] {
            new AvailabilityException("preview-break-"+clock.Today.ToString("yyyyMMdd"), "preview-doctor-02", clock.Today.AddDays(1),new(12,0),new(13,0),false,"Пауза"),
            new AvailabilityException("preview-extra-"+clock.Today.ToString("yyyyMMdd"), "preview-doctor-12", clock.Today.AddDays(2),new(14,0),new(17,0),true,"Договорен прием") })
            if (doctors.Any(d => d.Id == extra.DoctorId) && !await db.Exceptions.AnyAsync(e => e.Id == extra.Id || (e.DoctorId == extra.DoctorId && e.Date == extra.Date && e.Start == extra.Start && e.End == extra.End && e.IsAvailable == extra.IsAvailable), ct)) db.Exceptions.Add(extra);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Preview catalogue now contains {Doctors} doctors, {Specialties} specialties and {Services} services. Existing records were not replaced.", doctors.Count, specialties.Count, services.Count);
    }
}
