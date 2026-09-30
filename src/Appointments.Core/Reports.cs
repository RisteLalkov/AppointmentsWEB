namespace Appointments.Core;

public record ReportQuery(DateOnly From, DateOnly To, string GroupBy = "day", string? DoctorId = null, string? Specialty = null, string? ServiceId = null);
public record ReportMetrics(int Total, int Confirmed, int Completed, int Cancelled, int Pending, int NoShow, int Patients,
    double CapacityMinutes, double OccupiedMinutes, double OutsideCapacityMinutes)
{
    public double CancellationPercent => Total == 0 ? 0 : 100d * Cancelled / Total;
    public double? NoShowPercent => Completed + NoShow == 0 ? null : 100d * NoShow / (Completed + NoShow);
    public double? UtilizationPercent => CapacityMinutes == 0 ? null : 100d * OccupiedMinutes / CapacityMinutes;
}
public record ReportRow(string Key, string Label, ReportMetrics Metrics);
public record ReportResult(ReportQuery Query, string TimeZone, DateTimeOffset GeneratedAt, int RegisteredPatients,
    ReportMetrics Summary, IReadOnlyList<ReportRow> Periods, IReadOnlyList<ReportRow> Doctors,
    IReadOnlyList<ReportRow> Specialties, IReadOnlyList<ReportRow> Services);

// Counts are exact; capacity uses CURRENT weekly hours and saved dated exceptions.
public static class ReportBuilder
{
    public static void Validate(ReportQuery q)
    {
        if (q.From == default || q.To < q.From || q.To.DayNumber - q.From.DayNumber > 365 || q.To == DateOnly.MaxValue)
            throw new RuleException("Изберете важечки период од најмногу 366 дена.");
        if (q.GroupBy is not ("day" or "week" or "month")) throw new RuleException("Изберете групирање по ден, недела или месец.");
    }
    public static ReportResult Build(DemoActor actor, ReportQuery q, DemoState state, SchedulingClock clock)
    {
        if (actor.Role != DemoRole.Administrator) throw new RuleException("Извештаите се достапни само за администратори.", 403);
        Validate(q);
        if (!string.IsNullOrEmpty(q.DoctorId) && !state.Doctors.Any(d => d.Id == q.DoctorId)) throw new RuleException("Изберете важечки лекар.");
        if (!string.IsNullOrEmpty(q.Specialty) && !state.Doctors.Any(d => d.Specialty == q.Specialty)) throw new RuleException("Изберете важечка специјалност.");
        if (!string.IsNullOrEmpty(q.ServiceId) && q.ServiceId != "unassigned" && !state.Doctors.Any(d => d.IsService && d.Id == q.ServiceId)) throw new RuleException("Изберете важечка услуга.");
        var doctors = state.Doctors.Where(d => (string.IsNullOrEmpty(q.DoctorId) || d.Id == q.DoctorId)
            && (string.IsNullOrEmpty(q.Specialty) || d.Specialty == q.Specialty)
            && (string.IsNullOrEmpty(q.ServiceId) || (q.ServiceId == "unassigned" ? !d.IsService : d.IsService && d.Id == q.ServiceId))).ToList();
        var ids = doctors.Select(d => d.Id).ToHashSet();
        var appointments = state.Appointments.Where(a => ids.Contains(a.DoctorId))
            .Where(a => { var date = DateOnly.FromDateTime(clock.Local(a.Start)); return date >= q.From && date <= q.To; }).ToList();
        var daily = new List<(Doctor Doctor, DateOnly Date, List<Appointment> Visits, double Capacity, double Occupied, double Outside)>();
        var baseline = new DemoState { Exceptions = state.Exceptions };
        var byDay = appointments.ToLookup(a => (a.DoctorId, DateOnly.FromDateTime(clock.Local(a.Start))));
        foreach (var doctor in doctors)
        for (var date = q.From; date <= q.To; date = date.AddDays(1))
        {
            var visits = byDay[(doctor.Id, date)].ToList();
            // Physical capacity, independent of Tuesday-first release preference.
            var capacity = Merge(SchedulingRules.Slots(baseline, doctor, date, clock, includePast: true, applyPreference: false).Select(s => (s.Start, s.End)));
            var busy = Merge(visits.Where(a => a.Status != AppointmentStatus.Cancelled).Select(a => (a.Start, a.End)));
            var occupied = capacity.Sum(c => busy.Sum(b => Math.Max(0, (Min(c.End, b.End) - Max(c.Start, b.Start)).TotalMinutes)));
            daily.Add((doctor, date, visits, capacity.Sum(c => (c.End - c.Start).TotalMinutes), occupied,
                Math.Max(0, busy.Sum(b => (b.End - b.Start).TotalMinutes) - occupied)));
        }
        ReportMetrics Metrics(IEnumerable<(Doctor Doctor, DateOnly Date, List<Appointment> Visits, double Capacity, double Occupied, double Outside)> rows)
        {
            var items = rows.ToList(); var visits = items.SelectMany(r => r.Visits).ToList();
            return new(visits.Count, visits.Count(a => a.Status == AppointmentStatus.Confirmed), visits.Count(a => a.Status == AppointmentStatus.Completed),
                visits.Count(a => a.Status == AppointmentStatus.Cancelled), visits.Count(a => a.Status == AppointmentStatus.Scheduled), visits.Count(a => a.Status == AppointmentStatus.NoShow),
                visits.Select(a => a.PatientId).Distinct().Count(), items.Sum(r => r.Capacity), items.Sum(r => r.Occupied), items.Sum(r => r.Outside));
        }
        string Period(DateOnly date) => (q.GroupBy switch { "week" => date.AddDays(-(((int)date.DayOfWeek + 6) % 7)), "month" => new DateOnly(date.Year, date.Month, 1), _ => date }).ToString("yyyy-MM-dd");
        var periods = new List<ReportRow>(); var periodData = daily.ToLookup(r => Period(r.Date));
        for (var date = q.From; date <= q.To; date = date.AddDays(1))
        {
            var key = Period(date);
            if (periods.Count == 0 || periods[^1].Key != key) periods.Add(new(key, key, Metrics(periodData[key])));
        }
        return new(q, clock.Zone.Id, clock.UtcNow, state.Patients.Count, Metrics(daily), periods,
            daily.GroupBy(r => r.Doctor.Id).Select(g => new ReportRow(g.Key, g.First().Doctor.Name, Metrics(g))).OrderBy(r => r.Label).ToList(),
            daily.GroupBy(r => r.Doctor.Specialty).Select(g => new ReportRow(g.Key, g.Key, Metrics(g))).OrderBy(r => r.Label).ToList(),
            daily.GroupBy(r => r.Doctor.IsService ? r.Doctor.Id : "unassigned")
                .Select(g => new ReportRow(g.Key, g.Key == "unassigned" ? "Без заведена услуга (лекарски прегледи)" : g.First().Doctor.Name, Metrics(g))).OrderBy(r => r.Label).ToList());
    }
    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;
    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;
    private static List<(DateTimeOffset Start, DateTimeOffset End)> Merge(IEnumerable<(DateTimeOffset Start, DateTimeOffset End)> source)
    {
        var result = new List<(DateTimeOffset Start, DateTimeOffset End)>();
        foreach (var item in source.OrderBy(x => x.Start))
            if (result.Count > 0 && item.Start <= result[^1].End) result[^1] = (result[^1].Start, Max(result[^1].End, item.End));
            else result.Add(item);
        return result;
    }
}
