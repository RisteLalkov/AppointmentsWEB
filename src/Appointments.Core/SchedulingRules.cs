namespace Appointments.Core;

public static class SchedulingRules
{
    public static bool Active(Appointment a) => a.Status != AppointmentStatus.Cancelled;
    public static bool Overlaps(DateTimeOffset a, DateTimeOffset b, DateTimeOffset c, DateTimeOffset d) => a < d && c < b;
    public static List<Slot> Slots(DemoState state, Doctor doctor, DateOnly date, SchedulingClock clock, string? excludeId = null, bool includePast = false, bool applyPreference = true)
    {
        if (!includePast && (date < clock.Today || date > clock.Today.AddDays(180))) return [];
        var periods = doctor.WorkingPeriods.Where(p => p.Day == date.DayOfWeek).Select(p => (p.Start, p.End)).ToList();
        periods.AddRange(state.Exceptions.Where(e => e.DoctorId == doctor.Id && e.Date == date && e.IsAvailable).Select(e => (e.Start, e.End)));
        var blocked = state.Exceptions.Where(e => e.DoctorId == doctor.Id && e.Date == date && !e.IsAvailable).ToList();
        var results = new List<Slot>();
        foreach (var (start, end) in periods)
        {
            for (var minute = start.Hour * 60 + start.Minute; minute + doctor.DurationMinutes <= end.Hour * 60 + end.Minute; minute += doctor.DurationMinutes)
            {
                var time = new TimeOnly(minute / 60, minute % 60);
                var endTime = time.AddMinutes(doctor.DurationMinutes);
                var from = clock.ToInstant(date, time); var to = clock.ToInstant(date, endTime);
                if (from is null || to is null || (to - from)?.TotalMinutes != doctor.DurationMinutes) continue;
                if (!includePast && from <= clock.UtcNow) continue;
                if (blocked.Any(e => time < e.End && e.Start < endTime)) continue;
                if (state.Appointments.Any(a => a.Id != excludeId && Active(a) && a.DoctorId == doctor.Id && Overlaps(from.Value, to.Value, a.Start, a.End))) continue;
                results.Add(new Slot(date, time, from.Value, to.Value));
            }
        }
        // Workbook: fill Tuesday before Wednesday (same Monday-based week).
        if (applyPreference && doctor.TuesdayFirst && date.DayOfWeek == DayOfWeek.Wednesday &&
            Slots(state, doctor, date.AddDays(-1), clock, excludeId, includePast, false).Count > 0) return [];
        return results.DistinctBy(s => s.Start).OrderBy(s => s.Start).ToList();
    }
    public static bool FitsSchedule(DemoState state, Doctor doctor, Appointment a, SchedulingClock clock)
    {
        var localStart = clock.Local(a.Start); var localEnd = clock.Local(a.End);
        if (localStart.Date != localEnd.Date) return false;
        var day = DateOnly.FromDateTime(localStart); var start = TimeOnly.FromDateTime(localStart); var end = TimeOnly.FromDateTime(localEnd);
        var fits = doctor.WorkingPeriods.Any(p => p.Day == day.DayOfWeek && p.Start <= start && p.End >= end)
            || state.Exceptions.Any(e => e.DoctorId == doctor.Id && e.Date == day && e.IsAvailable && e.Start <= start && e.End >= end);
        return fits && !state.Exceptions.Any(e => e.DoctorId == doctor.Id && e.Date == day && !e.IsAvailable && start < e.End && e.Start < end);
    }
}
