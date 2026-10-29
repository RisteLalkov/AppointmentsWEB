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
    private string SafeReturn(string? returnUrl)
    {
        if (!Url.IsLocalUrl(returnUrl)) return "/Workspace";
        // Authentication pages cannot be their own continuation (including encoded paths).
        var path = Uri.UnescapeDataString(returnUrl!.Split('?', '#')[0]);
        if (path.StartsWith("~/")) path = path[1..];
        path = new Uri("https://local.invalid" + path).AbsolutePath.TrimEnd('/');
        return new[] { "/Account/Login", "/Account/Register", "/Platform/Login", "/Account/AccessDenied" }
            .Contains(path, StringComparer.OrdinalIgnoreCase) ? "/Workspace" : returnUrl;
    }
    private async Task<IActionResult?> SignedInRedirect(string? returnUrl, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated != true) return null;
        try
        {
            if (settings.UseApi) await api.SendAsync<System.Text.Json.JsonElement>("api/auth/me", ct: ct);
            return LocalRedirect(SafeReturn(returnUrl));
        }
        catch (RuleException e) when (e.StatusCode == 401)
        {
            await HttpContext.SignOutAsync();
            HttpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity());
            return null;
        }
        catch (RuleException e) { ViewData["Error"] = e.Message; Response.StatusCode = e.StatusCode; return View("Login"); }
    }
    [HttpGet] public async Task<IActionResult> Login(string? clinicId, string? returnUrl, CancellationToken ct)
    {
        if (!settings.UseApi) return RedirectToAction("Index", "Demo");
        ViewData["SelectedClinic"] = clinicId; ViewData["ReturnUrl"] = SafeReturn(returnUrl);
        return await SignedInRedirect(returnUrl, ct) ?? View();
    }
    [HttpPost] public async Task<IActionResult> Login(LoginInput input, string? clinicId, string? returnUrl, CancellationToken ct)
    {
        ViewData["SelectedClinic"] = clinicId; ViewData["ReturnUrl"] = SafeReturn(returnUrl);
        if (await SignedInRedirect(returnUrl, ct) is { } signedIn) return signedIn;
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете е-пошта и лозинка."; return View(); }
        try { var session = await api.SendAsync<SessionResponse>("api/auth/login", input, false, ct); await WebSession.SignInAsync(HttpContext, session); return LocalRedirect(SafeReturn(returnUrl)); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
    [HttpGet] public async Task<IActionResult> Register(string? clinicId, string? returnUrl, CancellationToken ct)
    {
        ViewData["ReturnUrl"] = SafeReturn(returnUrl);
        if (await SignedInRedirect(returnUrl, ct) is { } signedIn) return signedIn;
        await Clinics(clinicId, ct); return View();
    }
    [HttpPost] public async Task<IActionResult> Register(RegisterInput input, string? clinicId, string? returnUrl, CancellationToken ct)
    {
        ViewData["ReturnUrl"] = SafeReturn(returnUrl);
        if (await SignedInRedirect(returnUrl, ct) is { } signedIn) return signedIn;
        await Clinics(clinicId, ct);
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете име, важечка е-пошта и лозинка."; return View(); }
        try
        {
            await api.SendAsync<AccountSummary>("api/auth/register", input, false, ct, clinicId);
            TempData["Notice"] = "Вашата пациентска сметка е подготвена. Најавете се за да продолжите.";
            return RedirectToAction(nameof(Login), new { clinicId, returnUrl = SafeReturn(returnUrl) });
        }
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
    [HttpGet] public IActionResult AccessDenied()
    {
        Response.StatusCode = 403;
        return View();
    }
    [Authorize, HttpGet] public IActionResult Password() => View();
    [Authorize, HttpPost] public async Task<IActionResult> Password(ChangePasswordInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете ги двете лозинки."; return View(); }
        try { await api.SendAsync<object>("api/auth/password", input, ct: ct); await HttpContext.SignOutAsync(); TempData["Notice"] = "Лозинката е променета. Сите претходни сесии се одјавени."; return RedirectToAction(nameof(Login)); }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
}
