using Microsoft.AspNetCore.Antiforgery;

namespace Appointments.Web.Services;

// Forms from a previous clinic cannot be replayed after switching, even when account IDs coincide.
public sealed class ClinicAntiforgery : IAntiforgeryAdditionalDataProvider
{
    public string GetAdditionalData(HttpContext context)
    {
        // Personal account actions do not depend on whichever clinic another tab selected.
        // Clinical mutations retain the strict clinic binding below.
        if (context.User.HasClaim("globalPatient", "true") && (context.Request.Path.StartsWithSegments("/PatientClinics")
            || context.Request.Path.Equals("/Account/Password") || context.Request.Path.Equals("/Account/Logout") || context.Request.Path.Equals("/Preferences/Language")))
            return "patient:" + context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return context.User.FindFirst("clinicId")?.Value ?? "";
    }
    public bool ValidateAdditionalData(HttpContext context, string additionalData)
    {
        if (additionalData == GetAdditionalData(context)) return true;
        // These shared account controls are also rendered inside clinic workspaces,
        // where all forms receive the current clinic's token. Never accept this
        // alternative for clinical writes or clinic-selection forms.
        return context.User.HasClaim("globalPatient", "true")
            && (context.Request.Path.Equals("/Account/Logout") || context.Request.Path.Equals("/Preferences/Language"))
            && additionalData == (context.User.FindFirst("clinicId")?.Value ?? "");
    }
}
