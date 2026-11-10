using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize(Roles = "Patient"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PatientClinicsController(ApiClient api) : Controller
{
    private bool Global => User.HasClaim("globalPatient", "true");
    private string Return(string? value)
    {
        if (!Url.IsLocalUrl(value)) return "/Workspace";
        var path = Uri.UnescapeDataString(value!.Split('?', '#')[0]);
        return path.Equals("/Workspace", StringComparison.OrdinalIgnoreCase) || path.Equals("/Discover/Book", StringComparison.OrdinalIgnoreCase) ? value : "/Workspace";
    }
    [HttpGet] public async Task<IActionResult> Index(CancellationToken ct)
    {
        if (!Global) return Forbid();
        try { return View(await api.SendAsync<PatientHome>("api/patient/home", ct: ct, patientIdentity: true)); }
        catch (RuleException e) when (e.StatusCode == 401) { return RedirectToAction("Login", "Account", new { returnUrl = "/PatientClinics" }); }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; return View(); }
    }
    [HttpGet] public async Task<IActionResult> Join(string clinicId, string? returnUrl, CancellationToken ct)
    {
        if (!Global) return Forbid();
        ViewData["ReturnUrl"] = Return(returnUrl);
        try
        {
            var home = await api.SendAsync<PatientHome>("api/patient/home", ct: ct, patientIdentity: true);
            var clinic = home.Clinics.SingleOrDefault(c => c.Clinic.Id == clinicId);
            if (clinic == null) return NotFound();
            return View(clinic);
        }
        catch (RuleException e) when (e.StatusCode == 401) { return RedirectToAction("Login", "Account", new { returnUrl = "/PatientClinics" }); }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; return View(); }
    }
    [HttpPost] public async Task<IActionResult> Select(string clinicId, string? returnUrl, CancellationToken ct)
    {
        if (!Global) return Forbid();
        try
        {
            var session = await api.SendAsync<SessionResponse>("api/patient/clinics/" + Uri.EscapeDataString(clinicId ?? ""), new { }, ct: ct, patientIdentity: true);
            await WebSession.SignInAsync(HttpContext, session);
            return LocalRedirect(Return(returnUrl));
        }
        catch (RuleException e) when (e.StatusCode == 401) { return RedirectToAction("Login", "Account"); }
        catch (RuleException e) { TempData["Error"] = e.Message; return RedirectToAction(nameof(Index)); }
    }
}
