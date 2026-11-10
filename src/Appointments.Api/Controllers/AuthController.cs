using Appointments.Api.Services;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Controllers;

[ApiController, Route("api/auth"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AuthController(IServiceProvider services, GlobalPatients patients, IWebHostEnvironment environment, IConfiguration configuration, ClinicContext clinicContext) : ApiControllerBase
{
    private AccountService Service => services.GetRequiredService<AccountService>();
    private AppointmentsDbContext Db => services.GetRequiredService<AppointmentsDbContext>();
    private bool Global => User.HasClaim("globalPatient", "true");
    private string PatientToken => HttpContext.Items["GlobalPatientToken"] as string ?? "";
    [HttpPost("register"), EnableRateLimiting("auth")] public Task<AccountSummary> Register(RegisterInput input, CancellationToken ct) => Service.RegisterAsync(input, ct);
    [Authorize, HttpGet("me")] public object Me() => new { actor = Actor, demoMode = IsDemo, clinic = clinicContext.IsSelected ? clinicContext.Current.Summary() : null, globalPatient = Global };
    [Authorize, HttpPost("logout")] public async Task<object> Logout(CancellationToken ct) { var hash = HttpContext.Items["SessionHash"] as string; if (Global) await patients.LogoutAsync(PatientToken, ct); else await Db.Sessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct); return new { signedOut = true }; }
    [Authorize, HttpPost("password"), EnableRateLimiting("auth")] public async Task<object> Password(ChangePasswordInput input, CancellationToken ct) { if (Global) await patients.PasswordAsync(PatientToken, input, ct); else await Service.ChangePasswordAsync(Actor, input, ct); return new { signInAgain = true }; }
    [HttpGet("demo-users")] public async Task<IReadOnlyList<DemoActor>> DemoUsers(CancellationToken ct)
    {
        DemoAllowed(); var accounts = await Db.Accounts.AsNoTracking().Where(a => a.IsDemo && a.Enabled).OrderBy(a => a.Id).ToListAsync(ct); return accounts.Select(a => a.Actor()).ToList();
    }
    [HttpPost("demo-login"), EnableRateLimiting("auth")] public Task<SessionResponse> DemoLogin(DemoLoginInput input, CancellationToken ct) { DemoAllowed(); return Service.DemoAsync(input.UserId, ct); }
    private void DemoAllowed() { if (!clinicContext.Current.SeedDemoData || !environment.IsDevelopment() || !configuration.GetValue<bool>("Demo:Enabled")) throw new RuleException("Демо-режимот е оневозможен.", 404); }
}
public record DemoLoginInput(string UserId);
