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
    [HttpGet] public async Task<IActionResult> Switcher(CancellationToken ct)
    {
        if (!Global) return Forbid();
        try
        {
            var clinics = await api.SendAsync<List<PatientClinicOption>>("api/patient/clinics", ct: ct, patientIdentity: true);
            return PartialView("_ClinicSwitcher", clinics);
        }
        catch (RuleException e) { return StatusCode(e.StatusCode, new { error = e.Message }); }
    }
    private string Return(string? value)
    {
        if (!Url.IsLocalUrl(value)) return "/Workspace";
        var path = Uri.UnescapeDataString(value!.Split('?', '#')[0]);
        return path.Equals("/Workspace", StringComparison.OrdinalIgnoreCase) || path.Equals("/Discover/Book", StringComparison.OrdinalIgnoreCase) ? value : "/Workspace";
    }
    [HttpGet] public async Task<IActionResult> Index(CancellationToken ct, string? clinicId = null, string period = "upcoming")
    {
        if (!Global) return Forbid();
        try
        {
            var home = await api.SendAsync<PatientHome>("api/patient/home" + (string.IsNullOrEmpty(clinicId) ? "" : "?clinicId=" + Uri.EscapeDataString(clinicId)), ct: ct, patientIdentity: true);
            if (!string.IsNullOrEmpty(clinicId) && home.Clinics.All(c => c.Clinic.Id != clinicId)) return NotFound();
            ViewData["ClinicFilter"] = clinicId; ViewData["Period"] = period == "history" ? "history" : "upcoming";
            if (!string.IsNullOrEmpty(clinicId)) home = home with { Appointments = home.Appointments.Where(v => v.ClinicId == clinicId).ToList(), History = home.History?.Where(v => v.ClinicId == clinicId).ToList() };
            return View(home);
        }
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
            ViewData["Phone"] = home.Phone;
            return View(clinic);
        }
        catch (RuleException e) when (e.StatusCode == 401) { return RedirectToAction("Login", "Account", new { returnUrl = "/PatientClinics" }); }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; return View(); }
    }
    [HttpPost] public async Task<IActionResult> Select(string clinicId, string? returnUrl, string? phone, CancellationToken ct)
    {
        if (!Global) return Forbid();
        try
        {
            var session = await api.SendAsync<SessionResponse>("api/patient/clinics/" + Uri.EscapeDataString(clinicId ?? ""), new PatientJoinInput(phone), ct: ct, patientIdentity: true);
            await WebSession.SignInAsync(HttpContext, session);
            return LocalRedirect(Return(returnUrl));
        }
        catch (RuleException e) when (e.StatusCode == 401) { return RedirectToAction("Login", "Account"); }
        catch (RuleException e) { TempData["Error"] = e.Message; return RedirectToAction(nameof(Index)); }
    }
}
