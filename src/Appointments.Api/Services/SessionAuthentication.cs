using System.Security.Claims;
using System.Text.Encodings.Web;
using Appointments.Core;
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
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return AuthenticateResult.NoResult();
        var token = header[7..]; if (token.Length is < 32 or > 256) return AuthenticateResult.Fail("Invalid session.");
        var hash = AccountService.HashToken(token);
        DemoActor actor; bool demo = false; string? globalId = null;
        if (token.StartsWith("u1.", StringComparison.Ordinal))
        {
            var session = await services.GetRequiredService<GlobalPatients>().SessionAsync(token, Context.RequestAborted);
            if (session == null) return AuthenticateResult.Fail("Session expired or revoked.");
            globalId = session.PatientAccountId;
            actor = new(globalId, session.PatientAccount.Name, DemoRole.Patient);
            if (clinicContext.IsSelected)
            {
                var db = services.GetRequiredService<AppointmentsDbContext>();
                var member = await (from account in db.Accounts.AsNoTracking()
                    join membership in db.PatientMemberships.AsNoTracking() on account.Id equals membership.AccountId
                    where membership.ClinicId == clinicContext.Current.Id && membership.PatientAccountId == globalId
                        && account.GlobalPatientId == globalId && account.PatientId == membership.PatientId && account.Role == DemoRole.Patient
                    select account).SingleOrDefaultAsync(Context.RequestAborted);
                if (member == null || !member.Enabled)
                    throw new RuleException("Немате овозможен пациентски пристап до оваа клиника.", 403);
                actor = member.Actor();
            }
            Context.Items["GlobalPatientToken"] = token;
        }
        else
        {
            if (!clinicContext.IsSelected) return AuthenticateResult.NoResult();
            if (!token.StartsWith("c1." + clinicContext.Current.Id + ".", StringComparison.Ordinal)) return AuthenticateResult.Fail("Wrong clinic session.");
            var db = services.GetRequiredService<AppointmentsDbContext>();
            var session = await db.Sessions.AsNoTracking().Include(s => s.Account).SingleOrDefaultAsync(s => s.TokenHash == hash, Context.RequestAborted);
            if (session == null || session.ExpiresAt <= DateTimeOffset.UtcNow || !session.Account.Enabled || session.Account.GlobalPatientId != null)
                return AuthenticateResult.Fail("Session expired or revoked.");
            if (session.IsDemo && (!environment.IsDevelopment() || !configuration.GetValue<bool>("Demo:Enabled"))) return AuthenticateResult.Fail("Demo sessions are disabled.");
            actor = session.Account.Actor(); demo = session.IsDemo;
        }
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, actor.Id), new(ClaimTypes.Name, actor.Name), new(ClaimTypes.Role, actor.Role.ToString()), new("demo", demo.ToString()) };
        if (clinicContext.IsSelected) claims.Add(new("clinicId", clinicContext.Current.Id));
        if (actor.DoctorId != null) claims.Add(new("doctorId", actor.DoctorId)); if (actor.PatientId != null) claims.Add(new("patientId", actor.PatientId));
        if (globalId != null) { claims.Add(new("globalPatient", "true")); claims.Add(new("globalPatientId", globalId)); }
        Context.Items["SessionHash"] = hash;
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name));
    }
}
