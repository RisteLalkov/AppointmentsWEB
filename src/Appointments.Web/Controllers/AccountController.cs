using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AccountController(ApiClient api, BackendSettings settings) : Controller
{
    [HttpGet] public IActionResult Login() => settings.UseApi ? View() : RedirectToAction("Index", "Demo");
    [HttpPost] public async Task<IActionResult> Login(LoginInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { ViewData["Error"] = "Enter your email and password."; return View(); }
        try { var session = await api.SendAsync<SessionResponse>("api/auth/login", input, false, ct); await WebSession.SignInAsync(HttpContext, session); return RedirectToAction("Index", "Home"); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
    [HttpGet] public IActionResult Register() => View();
    [HttpPost] public async Task<IActionResult> Register(RegisterInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { ViewData["Error"] = "Enter a name, valid email and password."; return View(); }
        try { await api.SendAsync<AccountSummary>("api/auth/register", input, false, ct); TempData["Notice"] = "Your patient account is ready. Sign in to book an appointment."; return RedirectToAction(nameof(Login)); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
    [Authorize, HttpPost] public async Task<IActionResult> Logout(CancellationToken ct)
    {
        try { if (settings.UseApi) await api.SendAsync<object>("api/auth/logout", new { }, ct: ct); }
        catch (RuleException) { TempData["Notice"] = "Signed out of this browser. The API was unreachable; its session expires automatically within two hours."; }
        await HttpContext.SignOutAsync(); return RedirectToAction(nameof(Login));
    }
    [Authorize, HttpGet] public IActionResult Password() => View();
    [Authorize, HttpPost] public async Task<IActionResult> Password(ChangePasswordInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { ViewData["Error"] = "Enter both passwords."; return View(); }
        try { await api.SendAsync<object>("api/auth/password", input, ct: ct); await HttpContext.SignOutAsync(); TempData["Notice"] = "Password changed. All previous sessions were signed out."; return RedirectToAction(nameof(Login)); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
}
