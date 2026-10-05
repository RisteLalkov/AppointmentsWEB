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
    [HttpGet] public async Task<IActionResult> Login(string? clinicId, CancellationToken ct)
    {
        if (!settings.UseApi) return RedirectToAction("Index", "Demo");
        await Clinics(clinicId, ct); return View();
    }
    [HttpPost] public async Task<IActionResult> Login(LoginInput input, string? clinicId, CancellationToken ct)
    {
        await Clinics(clinicId, ct);
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете е-пошта и лозинка."; return View(); }
        try { var session = await api.SendAsync<SessionResponse>("api/auth/login", input, false, ct, clinicId); await WebSession.SignInAsync(HttpContext, session); return RedirectToAction("Index", "Home"); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
    [HttpGet] public async Task<IActionResult> Register(string? clinicId, CancellationToken ct) { await Clinics(clinicId, ct); return View(); }
    [HttpPost] public async Task<IActionResult> Register(RegisterInput input, string? clinicId, CancellationToken ct)
    {
        await Clinics(clinicId, ct);
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете име, важечка е-пошта и лозинка."; return View(); }
        try { await api.SendAsync<AccountSummary>("api/auth/register", input, false, ct, clinicId); TempData["Notice"] = "Вашата пациентска сметка е подготвена. Најавете се за да закажете термин."; return RedirectToAction(nameof(Login), new { clinicId }); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
    private async Task Clinics(string? clinicId, CancellationToken ct)
    {
        ViewData["SelectedClinic"] = clinicId;
        try { ViewData["Clinics"] = await api.SendAsync<List<ClinicSummary>>("api/clinics", authenticated: false, ct: ct); }
        catch (RuleException e) { ViewData["Clinics"] = new List<ClinicSummary>(); ViewData["Error"] = e.Message; }
    }
    [Authorize, HttpPost] public async Task<IActionResult> Logout(CancellationToken ct)
    {
        try { if (settings.UseApi) await api.SendAsync<object>("api/auth/logout", new { }, ct: ct); }
        catch (RuleException) { TempData["Notice"] = "Одјавени сте од овој прелистувач. Серверот беше недостапен; серверската сесија автоматски истекува во рок од два часа."; }
        await HttpContext.SignOutAsync(); return RedirectToAction(nameof(Login));
    }
    [Authorize, HttpGet] public IActionResult Password() => View();
    [Authorize, HttpPost] public async Task<IActionResult> Password(ChangePasswordInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете ги двете лозинки."; return View(); }
        try { await api.SendAsync<object>("api/auth/password", input, ct: ct); await HttpContext.SignOutAsync(); TempData["Notice"] = "Лозинката е променета. Сите претходни сесии се одјавени."; return RedirectToAction(nameof(Login)); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
}
