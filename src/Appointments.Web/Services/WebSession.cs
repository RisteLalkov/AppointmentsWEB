using System.Security.Claims;
using Appointments.Contracts;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Appointments.Web.Services;

public static class WebSession
{
    public static Task SignInAsync(HttpContext context, SessionResponse session)
    {
        var actor = session.Actor;
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, actor.Id), new(ClaimTypes.Name, actor.Name), new(ClaimTypes.Role, actor.Role.ToString()), new("demo", session.DemoMode.ToString()) };
        if (actor.DoctorId != null) claims.Add(new("doctorId", actor.DoctorId)); if (actor.PatientId != null) claims.Add(new("patientId", actor.PatientId));
        var properties = new AuthenticationProperties { ExpiresUtc = session.ExpiresAt, IsPersistent = false, AllowRefresh = false };
        properties.StoreTokens([new() { Name = "api_token", Value = session.AccessToken }]);
        return context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)), properties);
    }
}
