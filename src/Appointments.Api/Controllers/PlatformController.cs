using System.Security.Claims;
using Appointments.Api.Services;
using Appointments.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Controllers;

[ApiController, Route("api/platform"), Authorize(Policy = "Platform")]
public sealed class PlatformController(PlatformService service, ClinicRegistry registry) : ControllerBase
{
    [AllowAnonymous, HttpPost("login"), EnableRateLimiting("auth")] public Task<PlatformSession> Login(LoginInput input, CancellationToken ct) => service.LoginAsync(input, ct);
    [HttpGet("clinics")] public Task<IReadOnlyList<PlatformClinicSummary>> List(CancellationToken ct) => service.ListAsync(ct);
    [HttpPost("clinics")] public Task<PlatformClinicSummary> Create(ProvisionClinicInput input, CancellationToken ct) => service.ProvisionAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input, ct);
    [HttpPost("clinics/{id}/adopt")] public Task<PlatformClinicSummary> Adopt(string id, CancellationToken ct) => service.AdoptAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, id, ct);
    [HttpPost("clinics/{id}/details")] public Task<PlatformClinicSummary> Update(string id, UpdateClinicInput input, CancellationToken ct) => service.UpdateAsync(id, input, ct);
    [HttpPost("password"), EnableRateLimiting("auth")] public async Task<object> Password(ChangePasswordInput input, CancellationToken ct) { await service.PasswordAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!, input, ct); return new { saved = true }; }
    [HttpPost("logout")] public async Task<object> Logout(CancellationToken ct) { await using var db = registry.PlatformDb(); var hash = HttpContext.Items["PlatformSessionHash"] as string; await db.Sessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct); return new { signedOut = true }; }
}
