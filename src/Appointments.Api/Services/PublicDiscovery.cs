using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

public sealed class PublicDiscovery(ClinicRegistry registry, ClinicConnections connections, TimeProvider timeProvider)
{
    public static PublicClinic Describe(ClinicDefinition c) => new(c.Id, c.Name, c.TimeZone, c.AllowRegistration, c.Description, c.Address, c.Phone);
    public IEnumerable<ClinicDefinition> Visible => registry.Clinics.Where(c => c.Enabled && c.Discoverable).OrderBy(c => c.Id, StringComparer.Ordinal);
    public ClinicDefinition Clinic(string id) => Visible.SingleOrDefault(c => c.Id == id) ?? throw new RuleException("Клиниката не е пронајдена.", 404);
    public PublicPage<PublicClinic> Clinics(DiscoveryQuery q)
    {
        var all = Visible.Where(c => string.IsNullOrWhiteSpace(q.Search) || c.Name.Contains(q.Search.Trim(), StringComparison.OrdinalIgnoreCase)).ToArray();
        return new(all.Skip((q.Page - 1) * q.PageSize).Take(q.PageSize).Select(Describe).ToArray(), all.Length, q.Page, q.PageSize);
    }
    public async Task<PublicAvailability> AvailabilityAsync(string clinicId, string doctorId, DateOnly? date, string? serviceId, CancellationToken ct)
    {
        var clinic = Clinic(clinicId);
        var clock = new SchedulingClock(timeProvider, clinic.TimeZone);
        var day = date ?? clock.Today;
        if (day < clock.Today || day > clock.Today.AddDays(180))
            throw new RuleException("Изберете датум од денес до следните 180 дена.");
        await using var db = await connections.OpenAsync(clinic, ct);
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        var doctor = await db.Doctors.AsNoTracking().SingleOrDefaultAsync(d => d.Id == doctorId && d.Enabled && !d.IsService, ct)
            ?? throw new RuleException("Лекарот не е пронајден.", 404);
        var state = new DemoState
        {
            DoctorServices = await db.DoctorServices.AsNoTracking().Where(a => a.DoctorId == doctorId).ToListAsync(ct),
            Services = await (from a in db.DoctorServices join s in db.Services on a.ServiceId equals s.Id
                where a.DoctorId == doctorId && s.Enabled orderby s.Name, s.Id select s).AsNoTracking().ToListAsync(ct)
        };
        serviceId = string.IsNullOrEmpty(serviceId) ? state.Services.FirstOrDefault()?.Id : serviceId;
        if (serviceId != null && !state.Services.Any(s => s.Id == serviceId))
            throw new RuleException("Услугата не е достапна за избраниот лекар.", 409);
        PublicAvailability Result(string? message, IReadOnlyList<PublicFreeSlot>? slots = null)
            => new(day, clock.Today, clock.Today.AddDays(180), serviceId, message, slots ?? []);
        if (doctor.StaffOnly) return Result("За овој лекар закажувањето е по договор со рецепцијата. Контактирајте ја клиниката за достапност.");
        if (doctor.WorkingPeriods.Count == 0 && !await db.Exceptions.AnyAsync(e => e.DoctorId == doctorId && e.IsAvailable && e.Date >= clock.Today && e.Date <= clock.Today.AddDays(180), ct))
            return Result("Лекарот нема објавено работно време. Контактирајте ја клиниката за да договорите термин.");
        if (state.DoctorServices.Count > 0 && state.Services.Count == 0)
            return Result("Во моментов нема услуги достапни за онлајн закажување. Контактирајте ја клиниката.");
        doctor = CatalogueService.ForBooking(state, doctor, serviceId);
        // Include Tuesday when calculating Wednesday's Tuesday-first preference.
        var from = clock.ToInstant(day.AddDays(-1), TimeOnly.MinValue)!.Value;
        var to = clock.ToInstant(day.AddDays(1), TimeOnly.MinValue)!.Value;
        state.Exceptions = await db.Exceptions.AsNoTracking().Where(e => e.DoctorId == doctorId && e.Date >= day.AddDays(-1) && e.Date <= day).ToListAsync(ct);
        state.Appointments = await db.Appointments.AsNoTracking()
            .Where(a => a.DoctorId == doctorId && a.Status != AppointmentStatus.Cancelled && a.Start < to && a.End > from)
            .Select(a => new Appointment { Id = a.Id, DoctorId = a.DoctorId, PatientId = "", Start = a.Start, End = a.End, Status = a.Status }).ToListAsync(ct);
        var slots = SchedulingRules.Slots(state, doctor, day, clock)
            .Select(s => new PublicFreeSlot(s.Time, s.Start, s.End)).ToArray();
        return Result(slots.Length == 0 ? "Нема слободни термини за избраниот датум. Проверете друг ден или контактирајте ја клиниката." : null, slots);
    }
    public async Task<PublicPage<PublicDoctor>> DoctorsAsync(DiscoveryQuery q, CancellationToken ct, string? doctorId = null)
    {
        var rows = new List<PublicDoctor>(); var skip = (q.Page - 1) * q.PageSize; var total = 0;
        var selected = string.IsNullOrEmpty(q.ClinicId) ? Visible : new[] { Clinic(q.ClinicId) };
        foreach (var c in selected.Where(c => string.IsNullOrWhiteSpace(q.Clinic) || c.Name.Contains(q.Clinic.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            await using var db = await connections.OpenAsync(c, ct);
            var doctors = db.Doctors.AsNoTracking().Where(d => d.Enabled && !d.IsService);
            if (doctorId != null) doctors = doctors.Where(d => d.Id == doctorId);
            // Fold Cyrillic explicitly before PostgreSQL lower(): C/POSIX databases do
            // not lowercase these letters. Keep filtering/pagination on the server.
            // One broad search across public fields. Explicit refinements combine with AND.
            if (!string.IsNullOrWhiteSpace(q.Search))
            {
                var term = q.Search.Trim().ToLowerInvariant();
                var clinicMatches = c.Name.Contains(q.Search.Trim(), StringComparison.OrdinalIgnoreCase);
                doctors = doctors.Where(d => clinicMatches || PostgresText.Translate(d.Name, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term)
                    || PostgresText.Translate(d.Specialty, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term) || PostgresText.Translate(d.Subspecialty, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term)
                    || db.DoctorServices.Any(a => a.DoctorId == d.Id && db.Services.Any(s => s.Id == a.ServiceId && s.Enabled && PostgresText.Translate(s.Name, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term))));
            }
            if (!string.IsNullOrWhiteSpace(q.Specialty)) { var term = q.Specialty.Trim().ToLowerInvariant(); doctors = doctors.Where(d => PostgresText.Translate(d.Specialty, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term) || PostgresText.Translate(d.Subspecialty, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term)); }
            if (!string.IsNullOrWhiteSpace(q.Service)) { var term = q.Service.Trim().ToLowerInvariant(); doctors = doctors.Where(d => db.DoctorServices.Any(a => a.DoctorId == d.Id && db.Services.Any(s => s.Id == a.ServiceId && s.Enabled && PostgresText.Translate(s.Name, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term)))); }
            var count = await doctors.CountAsync(ct); total += count;
            if (skip >= count) { skip -= count; continue; }
            if (rows.Count == q.PageSize) continue;
            var page = await doctors.OrderBy(d => d.Name).ThenBy(d => d.Id).Skip(skip).Take(q.PageSize - rows.Count)
                .Select(d => new { d.Id, d.Name, d.Specialty, d.Subspecialty, d.StaffOnly }).ToListAsync(ct);
            skip = 0;
            var ids = page.Select(d => d.Id).ToArray();
            var services = await (from a in db.DoctorServices join s in db.Services on a.ServiceId equals s.Id where ids.Contains(a.DoctorId) && s.Enabled orderby s.Name select new { a.DoctorId, s.Id, s.Name, s.DurationMinutes }).ToListAsync(ct);
            rows.AddRange(page.Select(d => new PublicDoctor(d.Id, d.Name, d.Specialty, d.Subspecialty, Describe(c), services.Where(s => s.DoctorId == d.Id).Select(s => new PublicService(s.Id, s.Name, s.DurationMinutes)).ToArray(), d.StaffOnly)));
        }
        return new(rows, total, q.Page, q.PageSize);
    }
}
