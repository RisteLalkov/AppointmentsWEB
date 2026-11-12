using System.Security.Claims;
using Appointments.Api.Services;
using Appointments.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Controllers;

[ApiController, Route("api/platform"), Authorize(Policy = "Platform")]
public sealed class PlatformController(PlatformService service, ClinicRegistry registry, GlobalPatients patients) : ControllerBase
{
    [AllowAnonymous, HttpPost("login"), EnableRateLimiting("auth")] public Task<PlatformSession> Login(LoginInput input, CancellationToken ct) => service.LoginAsync(input, ct);
    [HttpGet("clinics")] public Task<IReadOnlyList<PlatformClinicSummary>> List(CancellationToken ct) => service.ListAsync(ct);
    [HttpPost("clinics")] public Task<PlatformClinicSummary> Create(ProvisionClinicInput input, CancellationToken ct) => service.ProvisionAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input, ct);
    [HttpPost("clinics/{id}/adopt")] public Task<PlatformClinicSummary> Adopt(string id, CancellationToken ct) => service.AdoptAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, id, ct);
    [HttpPost("clinics/{id}/details")] public Task<PlatformClinicSummary> Update(string id, UpdateClinicInput input, CancellationToken ct) => service.UpdateAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, id, input, ct);
    [HttpGet("audit")] public async Task<List<Appointments.Data.PlatformAuditEvent>> Audit(int take = 100, CancellationToken ct = default)
    { await using var db = registry.PlatformDb(); return await db.AuditEvents.AsNoTracking().OrderByDescending(e => e.Id).Take(Math.Clamp(take, 1, 500)).ToListAsync(ct); }
    [HttpGet("patients")] public Task<IReadOnlyList<PatientIdentitySummary>> Patients(string? email, CancellationToken ct) => patients.FindForSupportAsync(email, ct);
    [HttpPost("patients/{id}/password"), EnableRateLimiting("auth")] public async Task<object> PatientPassword(string id, PatientPasswordReset input, CancellationToken ct) { await patients.SupportPasswordAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, id, input, ct); return new { saved = true }; }
    [HttpPost("password"), EnableRateLimiting("auth")] public async Task<object> Password(ChangePasswordInput input, CancellationToken ct) { await service.PasswordAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input, ct); return new { saved = true }; }
    [HttpPost("logout")] public async Task<object> Logout(CancellationToken ct) {
        await using var db = registry.PlatformDb(); await using var tx = await db.Database.BeginTransactionAsync(ct);
        var hash = HttpContext.Items["PlatformSessionHash"] as string;
        await db.Sessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct);
        SecurityAudit.Platform(db, User.FindFirstValue(ClaimTypes.NameIdentifier)!, "session.revoked");
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new { signedOut = true };
    }
}
