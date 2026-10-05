using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

public sealed class DemoController(DemoIdentity identity, ApiClient api, BackendSettings settings) : Controller
{
    [HttpGet] public async Task<IActionResult> Index(string? clinicId, CancellationToken ct)
    {
        if (!settings.DemoEnabled) return NotFound();
        try {
            if (!settings.UseApi) return View(identity.Users);
            var clinics = await api.SendAsync<List<ClinicSummary>>("api/clinics", authenticated: false, ct: ct);
            ViewData["Clinics"] = clinics;
            clinicId ??= clinics.Count == 1 ? clinics[0].Id : null;
            ViewData["SelectedClinic"] = clinicId;
            if (clinicId == null) return View(Array.Empty<DemoActor>());
            return View(await api.SendAsync<List<DemoActor>>("api/auth/demo-users", authenticated: false, ct: ct, clinicId: clinicId));
        }
        catch (RuleException e) { ViewData["ConnectionError"] = e.Message; return View(Array.Empty<DemoActor>()); }
    }
    [HttpPost] public async Task<IActionResult> Enter(string userId, string? clinicId, CancellationToken ct)
    {
        if (!settings.DemoEnabled) return NotFound();
        try
        {
            SessionResponse session;
            if (settings.UseApi) session = await api.SendAsync<SessionResponse>("api/auth/demo-login", new { userId }, false, ct, clinicId);
            else
            {
                var actor = identity.Users.FirstOrDefault(a => a.Id == userId) ?? throw new RuleException("Изберете постоечки демо-корисник.");
                session = new("", DateTimeOffset.UtcNow.AddHours(2), actor, true);
            }
            await WebSession.SignInAsync(HttpContext, session); return RedirectToAction("Index", "Home");
        }
        catch (RuleException e) { TempData["Error"] = e.Message; return RedirectToAction(nameof(Index), new { clinicId }); }
    }
}
