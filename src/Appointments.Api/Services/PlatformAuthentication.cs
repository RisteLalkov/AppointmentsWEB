using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Appointments.Api.Services;

public sealed class PlatformAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger,
    UrlEncoder encoder, ClinicRegistry registry) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!registry.HasPlatform || !header.StartsWith("Bearer p1.", StringComparison.Ordinal) || header.Length > 256) return AuthenticateResult.NoResult();
        await using var db = registry.PlatformDb();
        var hash = AccountService.HashToken(header[7..]);
        var s = await db.Sessions.AsNoTracking().Include(x => x.Operator).SingleOrDefaultAsync(x => x.TokenHash == hash, Context.RequestAborted);
        if (s == null || s.ExpiresAt <= DateTimeOffset.UtcNow || !s.Operator.Enabled) return AuthenticateResult.Fail("Invalid platform session.");
        Context.Items["PlatformSessionHash"] = hash;
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, s.OperatorId), new Claim(ClaimTypes.Name, s.Operator.Name), new Claim(ClaimTypes.Role, "PlatformAdministrator")], Scheme.Name)), Scheme.Name));
    }
}
