using Appointments.Data;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

// Actor "anonymous" is deliberate: a failed password never establishes who acted.
// Structured action/target IDs only. Do not add passwords, emails, tokens or form bodies.
public static class SecurityAudit
{
    public static Task PatientAsync(AppointmentsDbContext db, string action, string? target, DateTimeOffset now, CancellationToken ct, string scope = "Patient") =>
        db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO careline_identity.\"SecurityEvents\" (\"Scope\",\"ActorId\",\"Action\",\"TargetId\",\"OccurredAt\") VALUES ({scope},{"anonymous"},{action},{target},{now})", ct);
    public static void Staff(AppointmentsDbContext db, string action, string target, DateTimeOffset now) =>
        db.AuditEvents.Add(new() { ActorId = "anonymous", Action = action, TargetId = target, OccurredAt = now });
    public static void Platform(PlatformDbContext db, string actor, string action, string? target = null) =>
        db.AuditEvents.Add(new() { ActorId = actor, Action = action, TargetId = target, OccurredAt = DateTimeOffset.UtcNow });
}
