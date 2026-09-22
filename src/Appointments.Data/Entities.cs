using Appointments.Core;

namespace Appointments.Data;

public sealed class Account
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DemoRole Role { get; set; }
    public string? DoctorId { get; set; }
    public string? PatientId { get; set; }
    public bool Enabled { get; set; } = true;
    public bool IsDemo { get; set; }
    public int FailedAttempts { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DemoActor Actor() => new(Id, Name, Role, DoctorId, PatientId);
}
public sealed class AccessSession
{
    public string TokenHash { get; set; } = "";
    public string AccountId { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public bool IsDemo { get; set; }
    public Account Account { get; set; } = null!;
}
public sealed class IdempotencyRequest
{
    public string AccountId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string ResponseJson { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class AuditEvent
{
    public long Id { get; set; }
    public string ActorId { get; set; } = "";
    public string Action { get; set; } = "";
    public string TargetId { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
}
public sealed class ClinicSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
