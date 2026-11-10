using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize(Policy = "Platform"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PatientSupportController(ApiClient api) : Controller
{
    [HttpGet] public async Task<IActionResult> Index(string? email, CancellationToken ct)
    {
        email = (email ?? "").Trim(); if (email.Length > 120) email = email[..120];
        ViewData["Email"] = email;
        try { return View(await api.SendAsync<List<PatientIdentitySummary>>("api/platform/patients?email=" + Uri.EscapeDataString(email), ct: ct, platform: true)); }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; return View(new List<PatientIdentitySummary>()); }
    }
    [HttpPost] public async Task<IActionResult> Password(string id, string? email, PatientPasswordReset input, bool confirmed, CancellationToken ct)
    {
        if (!ModelState.IsValid || !confirmed) { TempData["Error"] = UiText.T("Потврдете го идентитетот и внесете лозинка од 12–128 знаци."); return RedirectToAction(nameof(Index), new { email }); }
        try
        {
            await api.SendAsync<object>("api/platform/patients/" + Uri.EscapeDataString(id ?? "") + "/password", input, ct: ct, platform: true);
            TempData["Notice"] = UiText.T("Личната лозинка е променета. Сите пациентски сесии во сите клиники се одјавени.");
        }
        catch (RuleException e) { TempData["Error"] = e.Message; }
        return RedirectToAction(nameof(Index), new { email });
    }
}
