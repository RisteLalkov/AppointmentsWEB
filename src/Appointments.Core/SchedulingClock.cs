namespace Appointments.Core;

public sealed class SchedulingClock(TimeProvider timeProvider, string timeZoneId)
{
    public TimeZoneInfo Zone { get; } = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
    public DateTimeOffset UtcNow => timeProvider.GetUtcNow();
    public DateTime LocalNow => TimeZoneInfo.ConvertTime(UtcNow, Zone).DateTime;
    public DateOnly Today => DateOnly.FromDateTime(LocalNow);
    public DateTime Local(DateTimeOffset value) => TimeZoneInfo.ConvertTime(value, Zone).DateTime;
    // Date-query boundaries differ from bookable wall times: choose the earliest
    // real instant, including a midnight gap/repetition or an entirely skipped date.
    public DateTimeOffset StartOfDay(DateOnly date)
    {
        try
        {
            var local = DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified);
            for (var minute = 0; minute <= 1440; minute++)
            {
                var candidate = local.AddMinutes(minute);
                if (Zone.IsInvalidTime(candidate)) continue;
                var offset = Zone.IsAmbiguousTime(candidate) ? Zone.GetAmbiguousTimeOffsets(candidate).Max() : Zone.GetUtcOffset(candidate);
                return new DateTimeOffset(candidate, offset).ToUniversalTime();
            }
        }
        catch (ArgumentException) { }
        throw new RuleException("Датумот не може да се претстави во избраната временска зона.");
    }
    public DateTimeOffset? ToInstant(DateOnly date, TimeOnly time)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        // Neither silently move a nonexistent hour nor choose one of two repeated hours.
        if (Zone.IsInvalidTime(local) || Zone.IsAmbiguousTime(local)) return null;
        return new DateTimeOffset(local, Zone.GetUtcOffset(local)).ToUniversalTime();
    }
}
