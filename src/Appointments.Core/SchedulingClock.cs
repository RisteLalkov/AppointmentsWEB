namespace Appointments.Core;

public sealed class SchedulingClock(TimeProvider timeProvider, string timeZoneId)
{
    public TimeZoneInfo Zone { get; } = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
    public DateTimeOffset UtcNow => timeProvider.GetUtcNow();
    public DateTime LocalNow => TimeZoneInfo.ConvertTime(UtcNow, Zone).DateTime;
    public DateOnly Today => DateOnly.FromDateTime(LocalNow);
    public DateTime Local(DateTimeOffset value) => TimeZoneInfo.ConvertTime(value, Zone).DateTime;
    public DateTimeOffset? ToInstant(DateOnly date, TimeOnly time)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        // Neither silently move a nonexistent hour nor choose one of two repeated hours.
        if (Zone.IsInvalidTime(local) || Zone.IsAmbiguousTime(local)) return null;
        return new DateTimeOffset(local, Zone.GetUtcOffset(local)).ToUniversalTime();
    }
}
