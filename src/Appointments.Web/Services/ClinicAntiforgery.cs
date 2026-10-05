using Microsoft.AspNetCore.Antiforgery;

namespace Appointments.Web.Services;

// Forms from a previous clinic cannot be replayed after switching, even when account IDs coincide.
public sealed class ClinicAntiforgery : IAntiforgeryAdditionalDataProvider
{
    public string GetAdditionalData(HttpContext context) => context.User.FindFirst("clinicId")?.Value ?? "";
    public bool ValidateAdditionalData(HttpContext context, string additionalData) => additionalData == GetAdditionalData(context);
}
