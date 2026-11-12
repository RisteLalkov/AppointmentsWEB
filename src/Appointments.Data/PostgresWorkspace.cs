using System.Data;
using Appointments.Contracts;
using Appointments.Core;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Data;

public sealed partial class PostgresAppointments
{
    private async Task<BootstrapResponse> WorkspaceBootstrapAsync(DemoActor actor, bool demo, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var now = clock.UtcNow;
        var visible = Visible(actor).AsNoTracking();
        var upcoming = visible.Where(a => a.Start > now && (a.Status == AppointmentStatus.Scheduled || a.Status == AppointmentStatus.Confirmed));
        var recent = visible.Where(a => a.Start <= now || a.Status != AppointmentStatus.Scheduled && a.Status != AppointmentStatus.Confirmed);
        var appointments = (await upcoming.OrderBy(a => a.Start).ThenBy(a => a.Id).Take(50).ToListAsync(ct))
            .Concat(await recent.OrderByDescending(a => a.Start).ThenBy(a => a.Id).Take(50).ToListAsync(ct)).OrderBy(a => a.Start).ToList();
        var initialPatients = await db.Patients.AsNoTracking().Where(p => actor.Role != DemoRole.Patient || p.Id == actor.PatientId)
            .OrderBy(p => p.Name).ThenBy(p => p.Id).Take(50).ToListAsync(ct);
        var needed = appointments.Select(a => a.PatientId).Except(initialPatients.Select(p => p.Id)).ToArray();
        initialPatients.AddRange(await db.Patients.AsNoTracking().Where(p => needed.Contains(p.Id)).ToListAsync(ct));
        var week = clock.Today.AddDays(-(((int)clock.Today.DayOfWeek + 6) % 7));
        var weekStart = clock.StartOfDay(week); var weekEnd = clock.StartOfDay(week.AddDays(7));
        var weekVisits = await visible.Where(a => a.Start >= weekStart && a.Start < weekEnd && a.Status != AppointmentStatus.Cancelled)
            .Select(a => a.Start).ToListAsync(ct);
        var weekCounts = new int[7];
        foreach (var start in weekVisits) weekCounts[DateOnly.FromDateTime(clock.Local(start)).DayNumber - week.DayNumber]++;
        var dayStart = clock.StartOfDay(clock.Today); var dayEnd = clock.StartOfDay(clock.Today.AddDays(1));
        var overview = new WorkspaceOverview(
            await visible.CountAsync(a => a.Start >= dayStart && a.Start < dayEnd && a.Status != AppointmentStatus.Cancelled, ct),
            await upcoming.CountAsync(ct), await visible.CountAsync(a => a.Status == AppointmentStatus.Scheduled, ct),
            await visible.CountAsync(a => a.Status == AppointmentStatus.Completed || a.Status == AppointmentStatus.NoShow, ct), weekCounts);
        var historicalServices = await visible.Where(a => a.ServiceId != null).Select(a => new { a.DoctorId, a.ServiceId }).Distinct().ToListAsync(ct);
        var result = new BootstrapResponse(actor,
            await db.Doctors.AsNoTracking().AsSplitQuery().OrderBy(d => d.Id).ToListAsync(ct), initialPatients, appointments,
            clock.Today.ToString("yyyy-MM-dd"), clock.LocalNow.ToString("yyyy-MM-ddTHH:mm:ss"), clock.Zone.Id, now, demo, false, "Api",
            await db.Specialties.AsNoTracking().ToListAsync(ct), await db.Services.AsNoTracking().ToListAsync(ct),
            await db.DoctorServices.AsNoTracking().ToListAsync(ct), true, overview,
            historicalServices.Select(a => new DoctorService(a.DoctorId, a.ServiceId!)).ToList());
        await tx.CommitAsync(ct); return result;
    }
    private static void ValidateWorkspace(WorkspaceQuery query)
    {
        if (query.Skip < 0 || query.Take is < 1 or > 500 || query.Search?.Length > 200 || query.LocateId?.Length > 64
            || query.Period is not (null or "" or "all" or "upcoming" or "previous" or "past")
            || query.Status.HasValue && !Enum.IsDefined(query.Status.Value)
            || query.From.HasValue && query.To.HasValue && query.From > query.To
            || query.To == DateOnly.MaxValue)
            throw new RuleException("Невалидни податоци. Проверете ги задолжителните полиња, е-поштата, датумите, времињата и должината на текстот.");
    }
    private IQueryable<Patient> PatientSearch(IQueryable<Patient> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return query;
        var term = search.Trim().ToLowerInvariant();
        var numberText = term.StartsWith("pt-", StringComparison.Ordinal) ? term[3..] : term;
        var number = long.TryParse(numberText, out var parsed) ? parsed : -1;
        return query.Where(p => p.Number == number
            || PostgresText.Translate(p.Name, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term)
            || p.Email.ToLower().Contains(term) || p.Phone.Contains(term));
    }
    private IQueryable<Appointment> WorkspaceAppointments(DemoActor actor, WorkspaceQuery input)
    {
        ValidateWorkspace(input);
        var query = Visible(actor).AsNoTracking(); var now = clock.UtcNow;
        if (input.Period == "upcoming") query = query.Where(a => a.Start > now && (a.Status == AppointmentStatus.Scheduled || a.Status == AppointmentStatus.Confirmed));
        if (input.Period == "previous") query = query.Where(a => a.Start <= now || a.Status != AppointmentStatus.Scheduled && a.Status != AppointmentStatus.Confirmed);
        if (input.Period == "past") query = query.Where(a => a.End <= now);
        if (!string.IsNullOrEmpty(input.DoctorId)) query = query.Where(a => a.DoctorId == input.DoctorId);
        if (!string.IsNullOrEmpty(input.PatientId)) query = query.Where(a => a.PatientId == input.PatientId);
        if (!string.IsNullOrEmpty(input.ServiceId)) query = FilterService(query, input.ServiceId);
        if (input.Status.HasValue) query = query.Where(a => a.Status == input.Status);
        if (input.From.HasValue) { var from = clock.StartOfDay(input.From.Value); query = input.Overlap ? query.Where(a => a.End > from) : query.Where(a => a.Start >= from); }
        if (input.To.HasValue) { var to = clock.StartOfDay(input.To.Value.AddDays(1)); query = query.Where(a => a.Start < to); }
        if (!string.IsNullOrWhiteSpace(input.Search))
        {
            var term = input.Search.Trim().ToLowerInvariant(); var people = PatientSearch(db.Patients, input.Search).Select(p => p.Id);
            var doctors = db.Doctors.Where(d => PostgresText.Translate(d.Name, PostgresText.CyrillicUpper, PostgresText.CyrillicLower).ToLower().Contains(term)).Select(d => d.Id);
            query = query.Where(a => people.Contains(a.PatientId) || doctors.Contains(a.DoctorId));
        }
        return query;
    }
    private static IOrderedQueryable<Appointment> OrderWorkspace(IQueryable<Appointment> query, WorkspaceQuery input) => input.Period is "previous" or "past"
        ? query.OrderByDescending(a => a.Start).ThenBy(a => a.Id) : query.OrderBy(a => a.Start).ThenBy(a => a.Id);
    public async Task<WorkspacePatientPage> WorkspacePatientsAsync(DemoActor actor, WorkspaceQuery input, CancellationToken ct)
    {
        ValidateWorkspace(input);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var query = PatientSearch(db.Patients.AsNoTracking().Where(p => actor.Role != DemoRole.Patient || p.Id == actor.PatientId), input.Search);
        if (!string.IsNullOrEmpty(input.DoctorId))
        {
            var linked = Visible(actor).Where(a => a.DoctorId == input.DoctorId).Select(a => a.PatientId);
            query = query.Where(p => linked.Contains(p.Id));
        }
        var total = await query.CountAsync(ct);
        int? locatedSkip = null;
        if (!string.IsNullOrEmpty(input.LocateId))
        {
            var target = await query.SingleOrDefaultAsync(p => p.Id == input.LocateId, ct);
            if (target != null)
            {
                var position = await query.CountAsync(p => p.Name.CompareTo(target.Name) < 0 || p.Name == target.Name && p.Id.CompareTo(target.Id) < 0, ct);
                locatedSkip = position / input.Take * input.Take;
            }
        }
        var items = await query.OrderBy(p => p.Name).ThenBy(p => p.Id).Skip(locatedSkip ?? input.Skip).Take(input.Take).ToListAsync(ct);
        await tx.CommitAsync(ct); return new(items, total, locatedSkip);
    }
    public async Task<WorkspaceAppointmentPage> WorkspaceAppointmentsAsync(DemoActor actor, WorkspaceQuery input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var query = WorkspaceAppointments(actor, input); var total = await query.CountAsync(ct);
        var items = await OrderWorkspace(query, input).Skip(input.Skip).Take(input.Take).ToListAsync(ct);
        var ids = items.Select(a => a.PatientId).Distinct().ToArray();
        var patients = await db.Patients.AsNoTracking().Where(p => ids.Contains(p.Id)).ToListAsync(ct);
        await tx.CommitAsync(ct); return new(items, patients, total);
    }
    public async Task<WorkspaceAppointmentDetails> WorkspaceAppointmentAsync(DemoActor actor, string id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var appointment = await Visible(actor).AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, ct)
            ?? throw new RuleException("Терминот не е пронајден или немате пристап до него.", 404);
        var patient = await db.Patients.AsNoTracking().SingleAsync(p => p.Id == appointment.PatientId, ct);
        Audit(actor, "appointment.viewed", id); await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct); return new(appointment, patient);
    }
    public async Task<WorkspacePatientDetails> WorkspacePatientAsync(DemoActor actor, string id, WorkspaceQuery input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var patient = await db.Patients.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id && (actor.Role != DemoRole.Patient || p.Id == actor.PatientId), ct)
            ?? throw new RuleException("Пациентот не е пронајден или немате пристап до него.", 404);
        input.PatientId = id;
        var query = WorkspaceAppointments(actor, input); var total = await query.CountAsync(ct);
        var ordered = input.Period is "upcoming" ? query.OrderBy(a => a.Start).ThenBy(a => a.Id) : query.OrderByDescending(a => a.Start).ThenBy(a => a.Id);
        var items = await ordered.Skip(input.Skip).Take(input.Take).ToListAsync(ct);
        var all = Visible(actor).AsNoTracking().Where(a => a.PatientId == id); var now = clock.UtcNow;
        var counts = new PatientHistoryCounts(await all.CountAsync(a => a.Start > now && (a.Status == AppointmentStatus.Scheduled || a.Status == AppointmentStatus.Confirmed), ct),
            await all.CountAsync(a => a.Status == AppointmentStatus.Completed, ct), await all.CountAsync(a => a.Status == AppointmentStatus.Cancelled, ct),
            await all.CountAsync(a => a.Status == AppointmentStatus.NoShow, ct));
        Audit(actor, "patient.history.viewed", id); await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct); return new(patient, items, total, actor.Role != DemoRole.Patient, counts);
    }
}
