using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize(Roles = "Administrator"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AccountsController(ApiClient api, BackendSettings settings) : Controller
{
    [HttpGet] public async Task<IActionResult> Index(CancellationToken ct)
    {
        if (!settings.UseApi) return NotFound();
        try
        {
            ViewData["Workspace"] = await api.SendAsync<BootstrapResponse>("api/bootstrap", ct: ct);
            return View(await api.SendAsync<List<AccountSummary>>("api/accounts", ct: ct));
        }
        catch (RuleException e) { ViewData["Error"] = e.Message; return View(new List<AccountSummary>()); }
    }
    [HttpPost] public Task<IActionResult> Create(AccountInput input, CancellationToken ct) => Save("api/accounts", input, "Account created.", ct);
    [HttpPost] public Task<IActionResult> Access(string id, bool enabled, CancellationToken ct) => Save($"api/accounts/{Uri.EscapeDataString(id ?? "")}/access", new AccountAccessInput(enabled), enabled ? "Account enabled." : "Account disabled and sessions revoked.", ct);
    [HttpPost] public Task<IActionResult> Credentials(string id, LoginInput input, CancellationToken ct) => Save($"api/accounts/{Uri.EscapeDataString(id ?? "")}/credentials", input, "Credentials updated. Existing sessions were revoked.", ct);
    private async Task<IActionResult> Save(string path, object input, string notice, CancellationToken ct)
    {
        if (!settings.UseApi) return NotFound();
        if (!ModelState.IsValid) { TempData["Error"] = "Check required fields, email and password."; return RedirectToAction(nameof(Index)); }
        try { await api.SendAsync<object>(path, input, ct: ct); TempData["Notice"] = notice; }
        catch (RuleException e) { TempData["Error"] = e.Message; }
        return RedirectToAction(nameof(Index));
    }
}
