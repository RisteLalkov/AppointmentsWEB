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
    private async Task<IActionResult?> SignedInRedirect(CancellationToken ct)
    {
        var session = await HttpContext.AuthenticateAsync("PlatformCookie");
        if (!session.Succeeded) return null;
        try
        {
            await api.SendAsync<List<PlatformClinicSummary>>("api/platform/clinics", ct: ct, platform: true);
            return RedirectToAction(nameof(Index));
        }
        catch (RuleException e) when (e.StatusCode == 401) { await HttpContext.SignOutAsync("PlatformCookie"); return null; }
        catch (RuleException e) { ViewData["Error"] = e.Message; Response.StatusCode = e.StatusCode; return View("Login"); }
    }
    [AllowAnonymous, HttpGet] public async Task<IActionResult> Login(CancellationToken ct) => await SignedInRedirect(ct) ?? View();
    [AllowAnonymous, HttpPost] public async Task<IActionResult> Login(LoginInput input, CancellationToken ct)
    {
        if (await SignedInRedirect(ct) is { } signedIn) return signedIn;
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
    [HttpPost] public async Task<IActionResult> Adopt(string id, CancellationToken ct)
    {
        try
        {
            var clinic = await api.SendAsync<PlatformClinicSummary>($"api/platform/clinics/{Uri.EscapeDataString(id)}/adopt", new { }, ct: ct, platform: true);
            TempData["Notice"] = "Клиниката сега се управува преку платформата. Сметките, лозинките и термините се зачувани.";
            return RedirectToAction(nameof(Edit), new { id = clinic.Id });
        }
        catch (RuleException e) { TempData["Error"] = e.Message; return RedirectToAction(nameof(Index)); }
    }
    [HttpGet] public async Task<IActionResult> Edit(string id, CancellationToken ct)
    {
        try
        {
            var clinics = await api.SendAsync<List<PlatformClinicSummary>>("api/platform/clinics", ct: ct, platform: true);
            var clinic = clinics.SingleOrDefault(c => c.Id == id && c.Managed && c.State == "Ready");
            if (clinic == null) return NotFound();
            ViewData["ClinicId"] = clinic.Id;
            return View(new UpdateClinicInput(clinic.Name, clinic.Description, clinic.Address, clinic.Phone, clinic.Discoverable, clinic.AllowRegistration, clinic.Version));
        }
        catch (RuleException e) { TempData["Error"] = e.Message; return RedirectToAction(nameof(Index)); }
    }
    [HttpPost] public async Task<IActionResult> Edit(string id, UpdateClinicInput input, CancellationToken ct)
    {
        ViewData["ClinicId"] = id;
        if (!ModelState.IsValid) { ViewData["Error"] = "Проверете го името, должината на полињата и верзијата на податоците."; return View(input); }
        try
        {
            await api.SendAsync<PlatformClinicSummary>($"api/platform/clinics/{Uri.EscapeDataString(id)}/details", input, ct: ct, platform: true);
            TempData["Notice"] = "Податоците за клиниката се зачувани.";
            return RedirectToAction(nameof(Index));
        }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(input); }
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
                    "timezone" => "Неважечки поставки за датум и време на клиниката.",
                    "description" => "Јавен опис: дозволени се најмногу 1000 знаци.",
                    "address" => "Јавна адреса: дозволени се најмногу 200 знаци.",
                    "phone" => "Јавен телефон: дозволени се најмногу 30 знаци.",
                    "adminname" => "Име и презиме на администраторот: внесете од 2 до 80 знаци.",
                    "adminemail" => "Е-пошта на администраторот: внесете важечка адреса до 120 знаци.",
                    "adminpassword" => "Почетна лозинка на администраторот: внесете од 12 до 128 знаци.",
                    "discoverable" or "allowregistration" => "Повторно изберете ги опциите за јавно прикажување и пациентска регистрација.",
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
