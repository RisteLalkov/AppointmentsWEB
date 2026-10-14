using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize]
public sealed class HomeController(DemoIdentity identity, BackendSettings settings) : Controller
{
    [AllowAnonymous] public IActionResult Index() => User.Identity?.IsAuthenticated == true ? View("Workspace", identity.Actor) : Redirect(settings.UseApi ? "/Discover" : "/Demo");
    [HttpGet("/Workspace")] public IActionResult Workspace() => View("Workspace", identity.Actor);
    [AllowAnonymous] public IActionResult Error() { Response.StatusCode = 500; return View(); }
}
