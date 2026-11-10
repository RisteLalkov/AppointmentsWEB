namespace Appointments.Core;

public record AvailabilityDay(DateOnly Date, int Count);
public record DoctorNextSlot(string DoctorId, string? ServiceId, Slot? Slot, DateOnly SearchedThrough, string? Reason);

// Summaries use the same booking rules, on one loaded snapshot, never one DB query per day.
public static class AvailabilityOverview
{
    private sealed class Snapshot(DemoState state) : IDemoStore
    {
        public T Read<T>(Func<DemoState, T> query) => query(state);
        public T Write<T>(Func<DemoState, T> change) => throw new InvalidOperationException("Read-only availability snapshot.");
        public void Reset() => throw new InvalidOperationException("Read-only availability snapshot.");
    }
    public static IAppointmentService ForSnapshot(DemoState state, SchedulingClock clock) => new AppointmentService(new Snapshot(state), clock);
    public static void ValidateRange(SchedulingClock clock, DateOnly from, DateOnly to, int maxDays)
    {
        if (from < clock.Today || to > clock.Today.AddDays(180) || to < from || to.DayNumber - from.DayNumber >= maxDays)
            throw new RuleException("Изберете важечки период во следните 180 дена.");
    }
    public static string? Patient(DemoState state, DemoActor actor, string? patientId)
    {
        if (actor.Role == DemoRole.Patient && !string.IsNullOrEmpty(patientId) && patientId != actor.PatientId)
            throw new RuleException("Немате пристап до друг пациент.", 403);
        var selected = actor.Role == DemoRole.Patient ? actor.PatientId : patientId;
        if (!string.IsNullOrEmpty(selected) && state.Patients.All(p => p.Id != selected)) throw new RuleException("Пациентот не е пронајден.", 404);
        return string.IsNullOrEmpty(selected) ? null : selected;
    }
    public static IReadOnlyList<Slot> Slots(IAppointmentService rules, DemoState state, DemoActor actor, string doctorId,
        DateOnly date, string? excludeId, string? serviceId, string? patientId)
    {
        var selected = Patient(state, actor, patientId);
        var slots = rules.Availability(actor, doctorId, date, excludeId, serviceId);
        return selected == null ? slots : slots.Where(s => !state.Appointments.Any(a => a.Id != excludeId && a.PatientId == selected
            && SchedulingRules.Active(a) && SchedulingRules.Overlaps(s.Start, s.End, a.Start, a.End))).ToList();
    }
    public static IReadOnlyList<AvailabilityDay> Days(IAppointmentService rules, DemoState state, DemoActor actor, SchedulingClock clock,
        string doctorId, DateOnly from, DateOnly to, string? excludeId, string? serviceId, string? patientId)
    {
        ValidateRange(clock, from, to, 31);
        return Enumerable.Range(0, to.DayNumber - from.DayNumber + 1).Select(i => {
            var date = from.AddDays(i);
            return new AvailabilityDay(date, Slots(rules, state, actor, doctorId, date, excludeId, serviceId, patientId).Count);
        }).ToList();
    }
    public static IReadOnlyList<DoctorNextSlot> Next(IAppointmentService rules, DemoState state, DemoActor actor, SchedulingClock clock,
        IReadOnlyList<string> doctorIds, DateOnly from, string? serviceId)
    {
        ValidateRange(clock, from, from, 181);
        if (doctorIds.Count is < 1 or > 100) throw new RuleException("Изберете од 1 до 100 лекари.");
        var end = clock.Today.AddDays(180);
        var result = new List<DoctorNextSlot>();
        foreach (var id in doctorIds.Distinct())
        {
            var doctor = state.Doctors.SingleOrDefault(d => d.Id == id) ?? throw new RuleException("Лекарот не е пронајден.", 404);
            if (actor.Role == DemoRole.Doctor && actor.DoctorId != id) throw new RuleException("Немате пристап до друг лекар.", 403);
            string? reason = !doctor.Enabled ? "Inactive" : actor.Role == DemoRole.Patient && doctor.StaffOnly ? "ReceptionOnly" : null;
            var assigned = state.DoctorServices.Where(a => a.DoctorId == id).Select(a => a.ServiceId).ToHashSet();
            var services = state.Services.Where(s => s.Enabled && assigned.Contains(s.Id) && (string.IsNullOrEmpty(serviceId) || s.Id == serviceId))
                .OrderBy(s => s.DurationMinutes).ThenBy(s => s.Name).Select(s => (string?)s.Id).ToList();
            if (services.Count == 0 && assigned.Count == 0 && string.IsNullOrEmpty(serviceId)) services.Add(null);
            if (services.Count == 0) reason ??= "NoActiveServices";
            Slot? first = null; string? selectedService = null;
            if (reason == null)
                for (var day = from; day <= end && first == null; day = day.AddDays(1))
                    foreach (var service in services)
                    {
                        var slot = Slots(rules, state, actor, id, day, null, service, null).FirstOrDefault();
                        if (slot != null && (first == null || slot.Start < first.Start)) { first = slot; selectedService = service; }
                    }
            result.Add(new(id, selectedService, first, end, first == null ? reason ?? "NoAvailability" : null));
        }
        return result;
    }
}
