using System.Security.Claims;
using System.Text.Encodings.Web;
using Appointments.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Appointments.Api.Services;

public sealed class SessionAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, IServiceProvider services, ClinicContext clinicContext, IWebHostEnvironment environment, IConfiguration configuration)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!clinicContext.IsSelected) return AuthenticateResult.NoResult();
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return AuthenticateResult.NoResult();
        var token = header[7..]; if (token.Length is < 32 or > 256) return AuthenticateResult.Fail("Invalid session.");
        if (!token.StartsWith("c1." + clinicContext.Current.Id + ".", StringComparison.Ordinal)) return AuthenticateResult.Fail("Wrong clinic session.");
        var db = services.GetRequiredService<AppointmentsDbContext>();
        var hash = AccountService.HashToken(token);
        var session = await db.Sessions.AsNoTracking().Include(s => s.Account).SingleOrDefaultAsync(s => s.TokenHash == hash, Context.RequestAborted);
        if (session == null || session.ExpiresAt <= DateTimeOffset.UtcNow || !session.Account.Enabled) return AuthenticateResult.Fail("Session expired or revoked.");
        if (session.IsDemo && (!environment.IsDevelopment() || !configuration.GetValue<bool>("Demo:Enabled"))) return AuthenticateResult.Fail("Demo sessions are disabled.");
        var a = session.Account;
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, a.Id), new(ClaimTypes.Name, a.Name), new(ClaimTypes.Role, a.Role.ToString()), new("demo", session.IsDemo.ToString()), new("clinicId", clinicContext.Current.Id) };
        if (a.DoctorId != null) claims.Add(new("doctorId", a.DoctorId)); if (a.PatientId != null) claims.Add(new("patientId", a.PatientId));
        Context.Items["SessionHash"] = hash;
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name));
    }
}
