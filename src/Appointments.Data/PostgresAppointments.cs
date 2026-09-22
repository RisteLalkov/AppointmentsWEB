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
        return new(actor, doctors, patients, appointments, clock.Today.ToString("yyyy-MM-dd"), clock.LocalNow.ToString("yyyy-MM-ddTHH:mm:ss"), clock.Zone.Id, clock.UtcNow, demo, false);
    }
    public IQueryable<Appointment> Visible(DemoActor actor) => db.Appointments.Where(a => actor.Role == DemoRole.Administrator ||
        (actor.Role == DemoRole.Patient && a.PatientId == actor.PatientId) || (actor.Role == DemoRole.Doctor && a.DoctorId == actor.DoctorId));
    public async Task<IReadOnlyList<Slot>> SlotsAsync(DemoActor actor, string doctorId, DateOnly date, string? excludeId, CancellationToken ct)
    {
        var state = await LoadAsync(doctorId, actor.PatientId, ct);
        if (excludeId != null && state.Appointments.All(a => a.Id != excludeId))
        {
            var appointment = await db.Appointments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == excludeId, ct);
            if (appointment != null) state.Appointments.Add(appointment);
        }
        return Rules(state).Availability(actor, doctorId, date, excludeId);
    }
    public async Task<IReadOnlyList<AvailabilityException>> ExceptionsAsync(DemoActor actor, string doctorId, CancellationToken ct)
    {
        Staff(actor, doctorId);
        return await db.Exceptions.AsNoTracking().Where(e => e.DoctorId == doctorId).OrderBy(e => e.Date).ToListAsync(ct);
    }
    public async Task<Appointment> BookAsync(DemoActor actor, BookingCommand command, CancellationToken ct)
    {
        if (!Guid.TryParse(command.RequestId, out var key)) throw new RuleException("A valid booking request identifier is required.");
        command = command with { RequestId = key.ToString("N") };
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(command, JsonDemoStore.JsonOptions))));
        return await TransactionAsync(async () =>
        {
            await LockAsync("request:" + actor.Id + ":" + command.RequestId, ct);
            var replay = await db.IdempotencyRequests.FindAsync([actor.Id, command.RequestId], ct);
            if (replay != null)
            {
                if (replay.Fingerprint != fingerprint) throw new RuleException("This request identifier was already used for a different booking.", 409);
                return JsonSerializer.Deserialize<Appointment>(replay.ResponseJson, JsonDemoStore.JsonOptions)!;
            }
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
            ?? throw new RuleException("Appointment not found or not accessible.", 404);
        return await TransactionAsync(async () =>
        {
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
            if (input.Version is null || input.Version != state.Doctors.Single().ScheduleVersion) throw new RuleException("The schedule changed. Refresh this page before saving.", 409);
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
        var doctorId = await db.Exceptions.AsNoTracking().Where(e => e.Id == id).Select(e => e.DoctorId).SingleOrDefaultAsync(ct) ?? throw new RuleException("Exception not found.", 404);
        Staff(actor, doctorId);
        await TransactionAsync(async () =>
        {
            await LockAsync("doctor:" + doctorId, ct); var state = await LoadAsync(doctorId, null, ct);
            var e = await db.Exceptions.SingleOrDefaultAsync(e => e.Id == id, ct) ?? throw new RuleException("Exception already removed.", 409);
            if (state.Exceptions.All(x => x.Id != id)) state.Exceptions.Add(e);
            Rules(state).RemoveException(actor, id); db.Exceptions.Remove(e); Audit(actor, "availability.removed", id); await db.SaveChangesAsync(ct); return true;
        }, ct);
    }
    private async Task<DemoState> LoadAsync(string doctorId, string? patientId, CancellationToken ct)
    {
        var doctor = await db.Doctors.AsSplitQuery().SingleOrDefaultAsync(d => d.Id == doctorId, ct) ?? throw new RuleException("Doctor not found.", 404);
        var now = clock.UtcNow; var today = clock.Today;
        return new DemoState
        {
            Doctors = [doctor],
            Patients = patientId == null ? [] : await db.Patients.Where(p => p.Id == patientId).ToListAsync(ct),
            Appointments = await db.Appointments.Where(a => a.End >= now && (a.DoctorId == doctorId || (patientId != null && a.PatientId == patientId))).ToListAsync(ct),
            Exceptions = await db.Exceptions.Where(e => e.DoctorId == doctorId && e.Date >= today).ToListAsync(ct)
        };
    }
    private AppointmentService Rules(DemoState state) => new(new OperationState(state), clock);
    public async Task LockAsync(string resource, CancellationToken ct) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"careline:" + resource}, 0))", ct);
    public void Audit(DemoActor actor, string action, string target) => db.AuditEvents.Add(new() { ActorId = actor.Id, Action = action, TargetId = target, OccurredAt = clock.UtcNow });
    public static void Staff(DemoActor actor, string? doctorId = null)
    {
        if (actor.Role == DemoRole.Patient || (actor.Role == DemoRole.Doctor && doctorId != null && actor.DoctorId != doctorId)) throw new RuleException("Your account cannot perform this operation.", 403);
    }
    public async Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try { var result = await operation(); await tx.CommitAsync(ct); return result; }
        catch (DbUpdateConcurrencyException) { throw new RuleException("This record changed in another session. Refresh and try again.", 409); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23P01" }) { throw new RuleException("The doctor or patient already has an overlapping appointment. Select another time.", 409); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" }) { throw new RuleException("A record with those details already exists.", 409); }
    }
}
