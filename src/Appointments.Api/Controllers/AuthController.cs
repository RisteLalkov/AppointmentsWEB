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
public sealed class AuthController(AccountService service, AppointmentsDbContext db, IWebHostEnvironment environment, IConfiguration configuration) : ApiControllerBase
{
    [HttpPost("login"), EnableRateLimiting("auth")] public Task<SessionResponse> Login(LoginInput input, CancellationToken ct) => service.LoginAsync(input, ct);
    [HttpPost("register"), EnableRateLimiting("auth")] public Task<AccountSummary> Register(RegisterInput input, CancellationToken ct) => service.RegisterAsync(input, ct);
    [Authorize, HttpGet("me")] public object Me() => new { actor = Actor, demoMode = IsDemo };
    [Authorize, HttpPost("logout")] public async Task<object> Logout(CancellationToken ct) { var hash = HttpContext.Items["SessionHash"] as string; await db.Sessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct); return new { signedOut = true }; }
    [Authorize, HttpPost("password"), EnableRateLimiting("auth")] public async Task<object> Password(ChangePasswordInput input, CancellationToken ct) { await service.ChangePasswordAsync(Actor, input, ct); return new { signInAgain = true }; }
    [HttpGet("demo-users")] public async Task<IReadOnlyList<DemoActor>> DemoUsers(CancellationToken ct)
    {
        DemoAllowed(); var accounts = await db.Accounts.AsNoTracking().Where(a => a.IsDemo && a.Enabled).OrderBy(a => a.Id).ToListAsync(ct); return accounts.Select(a => a.Actor()).ToList();
    }
    [HttpPost("demo-login"), EnableRateLimiting("auth")] public Task<SessionResponse> DemoLogin(DemoLoginInput input, CancellationToken ct) { DemoAllowed(); return service.DemoAsync(input.UserId, ct); }
    private void DemoAllowed() { if (!environment.IsDevelopment() || !configuration.GetValue<bool>("Demo:Enabled")) throw new RuleException("Демо-режимот е оневозможен.", 404); }
}
public record DemoLoginInput(string UserId);
