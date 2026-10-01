using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Appointments.Contracts;
using Appointments.Core;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Appointments.Data;

public sealed class PostgresAppointments(AppointmentsDbContext db, SchedulingClock clock)
{
    public async Task<BootstrapResponse> BootstrapAsync(DemoActor actor, bool demo, CancellationToken ct)
    {
        var doctors = await db.Doctors.AsNoTracking().AsSplitQuery().OrderBy(d => d.Id).ToListAsync(ct);
        var patients = await db.Patients.AsNoTracking().Where(p => actor.Role != DemoRole.Patient || p.Id == actor.PatientId).OrderBy(p => p.Name).ToListAsync(ct);
        var appointments = await Visible(actor).AsNoTracking().OrderBy(a => a.Start).ToListAsync(ct);
        return new(actor, doctors, patients, appointments, clock.Today.ToString("yyyy-MM-dd"), clock.LocalNow.ToString("yyyy-MM-ddTHH:mm:ss"), clock.Zone.Id, clock.UtcNow, demo, false, "Api", await db.Specialties.AsNoTracking().ToListAsync(ct), await db.Services.AsNoTracking().ToListAsync(ct), await db.DoctorServices.AsNoTracking().ToListAsync(ct));
    }
    public async Task<ReportResult> ReportAsync(DemoActor actor, ReportQuery query, CancellationToken ct)
    {
        if (actor.Role != DemoRole.Administrator) throw new RuleException("Извештаите се достапни само за администратори.", 403);
        ReportBuilder.Validate(query);
        var start = clock.ToInstant(query.From, TimeOnly.MinValue) ?? throw new RuleException("Невалиден почетен датум во временската зона.");
        var end = clock.ToInstant(query.To.AddDays(1), TimeOnly.MinValue) ?? throw new RuleException("Невалиден краен датум во временската зона.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        var state = new DemoState
        {
            Doctors = await db.Doctors.AsNoTracking().AsSplitQuery().ToListAsync(ct),
            Services = await db.Services.AsNoTracking().ToListAsync(ct),
            DoctorServices = await db.DoctorServices.AsNoTracking().ToListAsync(ct),
            Patients = await db.Patients.AsNoTracking().ToListAsync(ct),
            Appointments = await db.Appointments.AsNoTracking().Where(a => a.Start >= start && a.Start < end).ToListAsync(ct),
            Exceptions = await db.Exceptions.AsNoTracking().Where(e => e.Date >= query.From && e.Date <= query.To).ToListAsync(ct)
        };
        var result = ReportBuilder.Build(actor, query, state, clock);
        await tx.CommitAsync(ct); return result;
    }
    public IQueryable<Appointment> Visible(DemoActor actor) => db.Appointments.Where(a => actor.Role == DemoRole.Administrator ||
        (actor.Role == DemoRole.Patient && a.PatientId == actor.PatientId) || (actor.Role == DemoRole.Doctor && a.DoctorId == actor.DoctorId));
    public async Task<IReadOnlyList<Slot>> SlotsAsync(DemoActor actor, string doctorId, DateOnly date, string? excludeId, CancellationToken ct, string? serviceId = null)
    {
        var state = await LoadAsync(doctorId, actor.PatientId, ct);
        if (excludeId != null && state.Appointments.All(a => a.Id != excludeId))
        {
            var appointment = await db.Appointments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == excludeId, ct);
            if (appointment != null) state.Appointments.Add(appointment);
        }
        return Rules(state).Availability(actor, doctorId, date, excludeId, serviceId);
    }
    public async Task<IReadOnlyList<AvailabilityException>> ExceptionsAsync(DemoActor actor, string doctorId, CancellationToken ct)
    {
        Staff(actor, doctorId);
        return await db.Exceptions.AsNoTracking().Where(e => e.DoctorId == doctorId).OrderBy(e => e.Date).ToListAsync(ct);
    }
    public async Task<Appointment> BookAsync(DemoActor actor, BookingCommand command, CancellationToken ct)
    {
        if (!Guid.TryParse(command.RequestId, out var key)) throw new RuleException("Потребен е важечки идентификатор на барањето. Повторно отворете го формуларот за закажување.");
        command = command with { RequestId = key.ToString("N") };
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(command, JsonDemoStore.JsonOptions))));
        return await TransactionAsync(async () =>
        {
            await LockAsync("request:" + actor.Id + ":" + command.RequestId, ct);
            var replay = await db.IdempotencyRequests.FindAsync([actor.Id, command.RequestId], ct);
            if (replay != null)
            {
                if (replay.Fingerprint != fingerprint) throw new RuleException("Ова барање веќе е употребено за друг термин. Повторно отворете го формуларот.", 409);
                return JsonSerializer.Deserialize<Appointment>(replay.ResponseJson, JsonDemoStore.JsonOptions)!;
            }
            await LockCatalogueSharedAsync(ct);
            await LockAsync("doctor:" + command.DoctorId, ct);
            var state = await LoadAsync(command.DoctorId, command.PatientId, ct);
            var result = Rules(state).Book(actor, command);
            db.Appointments.Add(result);
            db.IdempotencyRequests.Add(new() { AccountId = actor.Id, RequestId = command.RequestId, Fingerprint = fingerprint, ResponseJson = JsonSerializer.Serialize(result, JsonDemoStore.JsonOptions), CreatedAt = clock.UtcNow });
            Audit(actor, "appointment.created", result.Id);
            await db.SaveChangesAsync(ct); return result;
        }, ct);
    }
    public Task<Appointment> MoveAsync(DemoActor actor, string id, MoveCommand input, CancellationToken ct) => ChangeAppointmentAsync(actor, id, "appointment.rescheduled", (rules) => rules.Move(actor, id, input), ct);
    public Task<Appointment> StatusAsync(DemoActor actor, string id, StatusInput input, CancellationToken ct) => ChangeAppointmentAsync(actor, id, "appointment.status." + input.Status, rules => rules.ChangeStatus(actor, id, input.Status, input.Version), ct);
    private async Task<Appointment> ChangeAppointmentAsync(DemoActor actor, string id, string action, Func<AppointmentService, Appointment> change, CancellationToken ct)
    {
        var reference = await Visible(actor).AsNoTracking().Where(a => a.Id == id).Select(a => new { a.DoctorId, a.PatientId }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException("Терминот не е пронајден или немате пристап до него.", 404);
        return await TransactionAsync(async () =>
        {
            await LockCatalogueSharedAsync(ct);
            await LockAsync("doctor:" + reference.DoctorId, ct);
            var state = await LoadAsync(reference.DoctorId, reference.PatientId, ct);
            if (state.Appointments.All(a => a.Id != id)) state.Appointments.Add(await db.Appointments.SingleAsync(a => a.Id == id, ct));
            var result = change(Rules(state)); Audit(actor, action, id); await db.SaveChangesAsync(ct); return result;
        }, ct);
    }
    public async Task<Patient> PatientAsync(DemoActor actor, PatientInput input, bool demo, CancellationToken ct)
    {
        Staff(actor);
        return await TransactionAsync(async () =>
        {
            // Normalizing addresses makes the unique index case-insensitive by construction.
            var email = (input.Email ?? "").Trim().ToLowerInvariant();
            var patient = Rules(new()).AddPatient(actor, input.Name, email, input.Phone ?? "") with { IsDemonstration = demo };
            db.Patients.Add(patient);
            if (demo) db.Accounts.Add(new() { Id = patient.Id, Email = patient.Id + "@demo.example.test", NormalizedEmail = patient.Id + "@demo.example.test", Name = patient.Name, Role = DemoRole.Patient, PatientId = patient.Id, IsDemo = true });
            Audit(actor, "patient.created", patient.Id); await db.SaveChangesAsync(ct); return patient;
        }, ct);
    }
    public async Task ScheduleAsync(DemoActor actor, string doctorId, ScheduleInput input, CancellationToken ct)
    {
        Staff(actor, doctorId);
        await TransactionAsync(async () =>
        {
            await LockAsync("doctor:" + doctorId, ct); var state = await LoadAsync(doctorId, null, ct);
            if (input.Version is null || input.Version != state.Doctors.Single().ScheduleVersion) throw new RuleException("Распоредот е променет. Освежете ја страницата пред зачувување.", 409);
            Rules(state).ReplaceSchedule(actor, doctorId, input.Periods, input.DurationMinutes);
            Audit(actor, "schedule.updated", doctorId); await db.SaveChangesAsync(ct); return true;
        }, ct);
    }
    public Task<AvailabilityException> AddExceptionAsync(DemoActor actor, string doctorId, ExceptionInput input, CancellationToken ct)
    {
        Staff(actor, doctorId);
        return TransactionAsync(async () =>
        {
            await LockAsync("doctor:" + doctorId, ct); var state = await LoadAsync(doctorId, null, ct);
            var e = Rules(state).AddException(actor, doctorId, input.Date, input.Start, input.End, input.IsAvailable, input.Reason);
            db.Exceptions.Add(e); Audit(actor, "availability.added", e.Id); await db.SaveChangesAsync(ct); return e;
        }, ct);
    }
    public async Task RemoveExceptionAsync(DemoActor actor, string id, CancellationToken ct)
    {
        var doctorId = await db.Exceptions.AsNoTracking().Where(e => e.Id == id).Select(e => e.DoctorId).SingleOrDefaultAsync(ct) ?? throw new RuleException("Исклучокот не е пронајден.", 404);
        Staff(actor, doctorId);
        await TransactionAsync(async () =>
        {
            await LockAsync("doctor:" + doctorId, ct); var state = await LoadAsync(doctorId, null, ct);
            var e = await db.Exceptions.SingleOrDefaultAsync(e => e.Id == id, ct) ?? throw new RuleException("Исклучокот веќе е отстранет.", 409);
            if (state.Exceptions.All(x => x.Id != id)) state.Exceptions.Add(e);
            Rules(state).RemoveException(actor, id); db.Exceptions.Remove(e); Audit(actor, "availability.removed", id); await db.SaveChangesAsync(ct); return true;
        }, ct);
    }
    private async Task<DemoState> LoadAsync(string doctorId, string? patientId, CancellationToken ct)
    {
        var doctor = await db.Doctors.AsSplitQuery().SingleOrDefaultAsync(d => d.Id == doctorId, ct) ?? throw new RuleException("Лекарот не е пронајден.", 404);
        var now = clock.UtcNow; var today = clock.Today;
        return new DemoState
        {
            Doctors = [doctor],
            Services = await db.Services.AsNoTracking().ToListAsync(ct),
            DoctorServices = await db.DoctorServices.AsNoTracking().Where(x => x.DoctorId == doctorId).ToListAsync(ct),
            Patients = patientId == null ? [] : await db.Patients.Where(p => p.Id == patientId).ToListAsync(ct),
            Appointments = await db.Appointments.Where(a => a.End >= now && (a.DoctorId == doctorId || (patientId != null && a.PatientId == patientId))).ToListAsync(ct),
            Exceptions = await db.Exceptions.Where(e => e.DoctorId == doctorId && e.Date >= today).ToListAsync(ct)
        };
    }
    private Task<int> LockCatalogueSharedAsync(CancellationToken ct) => db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock_shared(hashtextextended('careline:catalogue', 0))", ct);
    public async Task<object> SaveCatalogueAsync(DemoActor actor, string kind, object input, CancellationToken ct)
    {
        if (actor.Role != DemoRole.Administrator) throw new RuleException("Немате пристап до каталогот.", 403);
        return await TransactionAsync(async () => {
            await LockAsync("catalogue", ct);
            var state = new DemoState { Doctors = await db.Doctors.AsSplitQuery().ToListAsync(ct), Specialties = await db.Specialties.ToListAsync(ct), Services = await db.Services.ToListAsync(ct), DoctorServices = await db.DoctorServices.ToListAsync(ct) };
            var rules = new CatalogueService(new OperationState(state));
            object result;
            if (kind == "doctors") { var data = (DoctorInput)input; var doctor = rules.SaveDoctor(actor, data); if (data.Id == null) db.Doctors.Add(doctor); result = doctor; }
            else if (kind == "specialties") { var data = (SpecialtyInput)input; var item = rules.SaveSpecialty(actor, data); if (data.Id == null) db.Specialties.Add(item); result = item; }
            else {
                var data = (ServiceInput)input; var before = state.DoctorServices.ToList(); var item = rules.SaveService(actor, data);
                if (data.Id == null) db.Services.Add(item);
                db.DoctorServices.RemoveRange(before.Where(x => x.ServiceId == item.Id && !state.DoctorServices.Contains(x)));
                db.DoctorServices.AddRange(state.DoctorServices.Where(x => x.ServiceId == item.Id && !before.Contains(x)));
                result = item;
            }
            Audit(actor, "catalogue." + kind + ".saved", kind == "doctors" ? ((Doctor)result).Id : kind == "specialties" ? ((Specialty)result).Id : ((MedicalService)result).Id);
            await db.SaveChangesAsync(ct); return result;
        }, ct);
    }
    private AppointmentService Rules(DemoState state) => new(new OperationState(state), clock);
    public async Task LockAsync(string resource, CancellationToken ct) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"careline:" + resource}, 0))", ct);
    public void Audit(DemoActor actor, string action, string target) => db.AuditEvents.Add(new() { ActorId = actor.Id, Action = action, TargetId = target, OccurredAt = clock.UtcNow });
    public static void Staff(DemoActor actor, string? doctorId = null)
    {
        if (actor.Role == DemoRole.Patient || (actor.Role == DemoRole.Doctor && doctorId != null && actor.DoctorId != doctorId)) throw new RuleException("Вашата сметка нема дозвола за оваа постапка.", 403);
    }
    public async Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try { var result = await operation(); await tx.CommitAsync(ct); return result; }
        catch (DbUpdateConcurrencyException) { throw new RuleException("Овој запис е променет во друга сесија. Освежете и обидете се повторно.", 409); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23P01" }) { throw new RuleException("Лекарот или пациентот веќе има термин што се преклопува. Изберете друго време.", 409); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" }) { throw new RuleException("Веќе постои запис со тие податоци.", 409); }
    }
}
