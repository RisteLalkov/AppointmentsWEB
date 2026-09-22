using System.Security.Claims;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

public sealed class DemoController(DemoIdentity identity) : Controller
{
    [HttpGet] public IActionResult Index() => View(identity.Users);
    [HttpPost] public async Task<IActionResult> Enter(string userId)
    {
        var actor = identity.Users.FirstOrDefault(a => a.Id == userId);
        if (actor is null) return BadRequest("Select an existing demo user.");
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, actor.Id), new Claim(ClaimTypes.Name, actor.Name), new Claim(ClaimTypes.Role, actor.Role.ToString()) };
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
        return RedirectToAction("Index", "Home");
    }
}
