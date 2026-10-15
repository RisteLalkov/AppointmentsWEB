using System.Security.Claims;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize(Policy = "Platform")]
public sealed class PlatformController(ApiClient api) : Controller
{
    [AllowAnonymous, HttpGet] public IActionResult Login() => View();
    [AllowAnonymous, HttpPost] public async Task<IActionResult> Login(LoginInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { ViewData["Error"] = "Внесете важечка е-пошта и лозинка."; return View(); }
        try
        {
            var s = await api.SendAsync<PlatformSession>("api/platform/login", input, false, ct);
            var properties = new AuthenticationProperties { ExpiresUtc = s.ExpiresAt, AllowRefresh = false };
            properties.StoreTokens([new() { Name = "api_token", Value = s.AccessToken }]);
            await HttpContext.SignInAsync("PlatformCookie", new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, s.Id), new Claim(ClaimTypes.Name, s.Name), new Claim(ClaimTypes.Role, "PlatformAdministrator")], "PlatformCookie")), properties);
            return RedirectToAction(nameof(Index));
        }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(); }
    }
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        try { ViewData["Clinics"] = await api.SendAsync<List<PlatformClinicSummary>>("api/platform/clinics", ct: ct, platform: true); }
        catch (RuleException e) { if (e.StatusCode is 401 or 403) { await HttpContext.SignOutAsync("PlatformCookie"); return RedirectToAction(nameof(Login)); } ViewData["Error"] = e.Message; }
        return View();
    }
    [HttpPost] public async Task<IActionResult> Create(ProvisionClinicInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid)
        {
            // Do not echo attempted values or framework errors: they can contain passwords.
            ViewData["Error"] = string.Join(" ", ModelState.Where(x => x.Value?.Errors.Count > 0)
                .Select(x => x.Key.Split('.').Last().ToLowerInvariant() switch
                {
                    "id" => "Единствен идентификатор: внесете 1–40 мали латинични букви, броеви или цртички; првиот знак мора да биде буква или број (пример: moja-klinika-2).",
                    "name" => "Име на клиниката: внесете од 2 до 100 знаци.",
                    "timezone" => "Временска зона: внесете вредност до 100 знаци (пример: Europe/Skopje).",
                    "description" => "Јавен опис: дозволени се најмногу 1000 знаци.",
                    "address" => "Јавна адреса: дозволени се најмногу 200 знаци.",
                    "phone" => "Јавен телефон: дозволени се најмногу 30 знаци.",
                    "adminname" => "Име и презиме на администраторот: внесете од 2 до 80 знаци.",
                    "adminemail" => "Е-пошта на администраторот: внесете важечка адреса до 120 знаци.",
                    "adminpassword" => "Почетна лозинка на администраторот: внесете од 12 до 128 знаци.",
                    "discoverable" or "allowregistration" => "Повторно изберете ги опциите за јавен именик и пациентска регистрација.",
                    _ => "Проверете ги задолжителните полиња и обидете се повторно."
                }).Distinct());
        }
        else try
        {
            var c = await api.SendAsync<PlatformClinicSummary>("api/platform/clinics", input, ct: ct, platform: true);
            TempData["Notice"] = $"Клиниката {c.Name} е подготвена. Предадете ја почетната лозинка преку безбеден канал и побарајте промена при првата најава.";
            return RedirectToAction(nameof(Index));
        }
        catch (RuleException e) { ViewData["Error"] = e.Message + " При повторување користете го истиот идентификатор и податоци. Не е потребно бришење на база."; }
        // Never place a password in rendered HTML, TempData, query strings or logs.
        ViewData["Input"] = input with { AdminPassword = "" };
        ModelState.Remove(nameof(input.AdminPassword));
        try { ViewData["Clinics"] = await api.SendAsync<List<PlatformClinicSummary>>("api/platform/clinics", ct: ct, platform: true); } catch (RuleException) { }
        return View("Index");
    }
    [HttpPost] public async Task<IActionResult> Password(ChangePasswordInput input, CancellationToken ct)
    {
        if (!ModelState.IsValid) { TempData["Error"] = "Внесете ги двете лозинки."; return RedirectToAction(nameof(Index)); }
        try { await api.SendAsync<object>("api/platform/password", input, ct: ct, platform: true); await HttpContext.SignOutAsync("PlatformCookie"); return RedirectToAction(nameof(Login)); }
        catch (RuleException e) { TempData["Error"] = e.Message; return RedirectToAction(nameof(Index)); }
    }
    [HttpPost] public async Task<IActionResult> Logout(CancellationToken ct)
    {
        try { await api.SendAsync<object>("api/platform/logout", new { }, ct: ct, platform: true); } catch (RuleException) { }
        await HttpContext.SignOutAsync("PlatformCookie"); return RedirectToAction(nameof(Login));
    }
}
