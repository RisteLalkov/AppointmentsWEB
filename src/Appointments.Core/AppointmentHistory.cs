namespace Appointments.Core;

public enum AppointmentChangeKind { Created, Rescheduled, StatusChanged }

// Immutable snapshots, written by application rules in the appointment's transaction.
public sealed record AppointmentHistoryEntry
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public required string AppointmentId { get; init; }
    public int AppointmentVersion { get; init; }
    public AppointmentChangeKind Kind { get; init; }
    public required string ActorId { get; init; }
    public required string ActorName { get; init; }
    public DemoRole ActorRole { get; init; }
    public DateTimeOffset OccurredAt { get; init; }
    public DateTimeOffset? BeforeStart { get; init; }
    public DateTimeOffset? BeforeEnd { get; init; }
    public AppointmentStatus? BeforeStatus { get; init; }
    public DateTimeOffset AfterStart { get; init; }
    public DateTimeOffset AfterEnd { get; init; }
    public AppointmentStatus AfterStatus { get; init; }

    public static AppointmentHistoryEntry Capture(DemoActor actor, Appointment after, Appointment? before,
        AppointmentChangeKind kind, DateTimeOffset now) => new()
    {
        AppointmentId = after.Id, AppointmentVersion = after.Version, Kind = kind,
        ActorId = actor.Id, ActorName = actor.Name, ActorRole = actor.Role, OccurredAt = now,
        BeforeStart = before?.Start, BeforeEnd = before?.End, BeforeStatus = before?.Status,
        AfterStart = after.Start, AfterEnd = after.End, AfterStatus = after.Status
    };
}
public record AppointmentHistoryResult(int CurrentVersion, bool HasCreationRecord, IReadOnlyList<AppointmentHistoryEntry> Entries);
