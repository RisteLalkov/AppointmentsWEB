using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize]
public sealed class HomeController(DemoIdentity identity) : Controller
{
    public IActionResult Index() => View("Workspace", identity.Actor);
    [AllowAnonymous] public IActionResult Error() { Response.StatusCode = 500; return View(); }
}
