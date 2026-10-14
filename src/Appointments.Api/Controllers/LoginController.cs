using Appointments.Api.Services;
using Appointments.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Appointments.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/auth/login")]
public sealed class LoginController(AutomaticLogin login) : ControllerBase
{
    // X-Clinic is intentionally ignored. Credentials resolve the account on the server.
    [HttpPost, EnableRateLimiting("auth")]
    public Task<SessionResponse> Login(LoginInput input, CancellationToken ct) => login.LoginAsync(input, ct);
}
