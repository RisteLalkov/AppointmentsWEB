using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Appointments.Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize(Roles = "Administrator"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AccountsController(ApiClient api, BackendSettings settings) : Controller
{
    [HttpGet] public async Task<IActionResult> Index(string? search, string? role, string? status, int page = 1, CancellationToken ct = default)
    {
        if (!settings.UseApi) return NotFound();
        try
        {
            ViewData["Workspace"] = await api.SendAsync<BootstrapResponse>("api/bootstrap", ct: ct);
            var all = await api.SendAsync<List<AccountSummary>>("api/accounts", ct: ct);
            search = (search ?? "").Trim();
            if (search.Length > 120) search = search[..120];
            role = Enum.TryParse<DemoRole>(role, out var parsedRole) && Enum.IsDefined(parsedRole) ? parsedRole.ToString() : "";
            status = status is "enabled" or "disabled" ? status : "";
            var matches = all.Where(a => (search == "" || a.Name.Contains(search, StringComparison.OrdinalIgnoreCase) || a.Email.Contains(search, StringComparison.OrdinalIgnoreCase))
                && (role == "" || a.Role == parsedRole) && (status == "" || a.Enabled == (status == "enabled"))).ToList();
            var pages = Math.Max(1, (int)Math.Ceiling(matches.Count / 20d));
            page = Math.Clamp(page, 1, pages);
            return View(new AccountManagementViewModel { AllAccounts = all, Accounts = matches.Skip((page - 1) * 20).Take(20).ToList(),
                Search = search, Role = role, Status = status, Matches = matches.Count, Page = page, Pages = pages });
        }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(new AccountManagementViewModel()); }
    }
    [HttpPost] public Task<IActionResult> Create(AccountInput input, CancellationToken ct) => Save("api/accounts", input, UiText.T("Сметката за {0} ({1}) е успешно создадена.", input.Name, input.Email), ct);
    [HttpPost] public Task<IActionResult> Access(string id, bool enabled, CancellationToken ct) => Save($"api/accounts/{Uri.EscapeDataString(id ?? "")}/access", new AccountAccessInput(enabled), enabled ? UiText.T("Пристапот до оваа клиника е овозможен.") : UiText.T("Пристапот до оваа клиника е оневозможен."), ct);
    [HttpPost] public Task<IActionResult> Credentials(string id, LoginInput input, CancellationToken ct) => Save($"api/accounts/{Uri.EscapeDataString(id ?? "")}/credentials", input, UiText.T("Податоците за најава се ажурирани. Постоечките сесии се одјавени."), ct);
    private async Task<IActionResult> Save(string path, object input, string notice, CancellationToken ct)
    {
        if (!settings.UseApi) return NotFound();
        if (!ModelState.IsValid) { TempData["Error"] = UiText.T("Проверете ги задолжителните полиња, е-поштата и лозинката."); return ReturnToList(); }
        try { await api.SendAsync<object>(path, input, ct: ct); TempData["Notice"] = notice; }
        catch (RuleException e) { TempData["Error"] = e.Message; }
        return ReturnToList();
    }
    private IActionResult ReturnToList()
    {
        var returnUrl = Request.HasFormContentType ? Request.Form["returnUrl"].FirstOrDefault() : null;
        return Url.IsLocalUrl(returnUrl) ? LocalRedirect(returnUrl!) : RedirectToAction(nameof(Index));
    }
}
