using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize]
public sealed class HomeController(DemoIdentity identity, BackendSettings settings) : Controller
{
    [AllowAnonymous] public IActionResult Index()
    {
        // Relative redirects keep each host's cookies and local booking returns intact.
        var host = Request.Host.Host;
        if (host.Equals("admin.medtermin.mk", StringComparison.OrdinalIgnoreCase)) return Redirect("/Platform");
        if (host.Equals("app.medtermin.mk", StringComparison.OrdinalIgnoreCase)) return Redirect("/Workspace");
        if (host.Equals("medtermin.mk", StringComparison.OrdinalIgnoreCase)) return Redirect("/Discover");
        if (User.HasClaim("globalPatient", "true") && !User.HasClaim(c => c.Type == "clinicId")) return Redirect("/PatientClinics");
        return User.Identity?.IsAuthenticated == true ? View("Workspace", identity.Actor) : Redirect(settings.UseApi ? "/Discover" : "/Demo");
    }
    [HttpGet("/Workspace")] public IActionResult Workspace() => User.HasClaim("globalPatient", "true") && !User.HasClaim(c => c.Type == "clinicId")
        ? Redirect("/PatientClinics") : View("Workspace", identity.Actor);
    [AllowAnonymous] public IActionResult Error() { Response.StatusCode = 500; return View(); }
}
