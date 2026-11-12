using Microsoft.AspNetCore.Antiforgery;

namespace Appointments.Web.Services;

// Forms from a previous clinic cannot be replayed after switching, even when account IDs coincide.
public sealed class ClinicAntiforgery : IAntiforgeryAdditionalDataProvider
{
    public string GetAdditionalData(HttpContext context)
    {
        // Personal account actions do not depend on whichever clinic another tab selected.
        // Clinical mutations retain the strict clinic binding below.
        if (context.User.HasClaim("globalPatient", "true"))
        {
            var identity = Patient(context);
            if (context.Request.Path.StartsWithSegments("/PatientClinics") || context.Request.Path.Equals("/Account/Password")
                || PersonalControl(context)) return identity;
            // Include both bindings. A clinical form remains clinic-specific, while
            // its personal controls can survive a different tab selecting a clinic.
            return identity + "|clinic:" + (context.User.FindFirst("clinicId")?.Value ?? "");
        }
        return context.User.FindFirst("clinicId")?.Value ?? "";
    }
    public bool ValidateAdditionalData(HttpContext context, string additionalData)
    {
        if (additionalData == GetAdditionalData(context)) return true;
        // The framework also validates the stable authenticated identity and token
        // signature. Only global personal controls may ignore the issuing clinic.
        // Never accept this alternative for clinical writes or membership forms.
        return context.User.HasClaim("globalPatient", "true")
            && PersonalControl(context)
            && additionalData.StartsWith(Patient(context) + "|clinic:", StringComparison.Ordinal);
    }
    private static bool PersonalControl(HttpContext context) => context.Request.Path.Equals("/Account/Logout")
        || context.Request.Path.Equals("/Preferences/Language");
    private static string Patient(HttpContext context) => "patient:" + context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
}
