using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[AllowAnonymous]
public sealed class DiscoverController(ApiClient api, BackendSettings backend) : Controller
{
    private static string E(string? value) => Uri.EscapeDataString(value ?? "");
    public async Task<IActionResult> Index(DiscoveryQuery query, string view = "doctors", CancellationToken ct = default)
    {
        view = view == "clinics" ? "clinics" : "doctors";
        // Do not carry invisible doctor refinements into the clinic directory.
        if (view == "clinics") query = query with { ClinicId = null, Clinic = null, Specialty = null, Service = null };
        ViewData["Query"] = query; ViewData["DirectoryView"] = view == "clinics" ? "clinics" : "doctors";
        if (!TryValidateModel(query) || !ModelState.IsValid) { Response.StatusCode = 400; ViewData["Error"] = "Проверете ги филтрите и бројот на страницата."; return View("Index"); }
        if (!backend.UseApi) { ViewData["Error"] = "Јавниот именик е достапен со API. За локалното демо отворете Демо-режим."; return View("Index"); }
        try
        {
            var path = $"api/public/{(view == "clinics" ? "clinics" : "doctors")}?page={query.Page}&pageSize={query.PageSize}&search={E(query.Search)}&clinic={E(query.Clinic)}&clinicId={E(query.ClinicId)}&specialty={E(query.Specialty)}&service={E(query.Service)}";
            if (view == "clinics") ViewData["Clinics"] = await api.SendAsync<PublicPage<PublicClinic>>(path, authenticated: false, ct: ct);
            else ViewData["Doctors"] = await api.SendAsync<PublicPage<PublicDoctor>>(path, authenticated: false, ct: ct);
            if (!string.IsNullOrEmpty(query.ClinicId)) ViewData["Clinic"] = await api.SendAsync<PublicClinic>($"api/public/clinics/{E(query.ClinicId)}", authenticated: false, ct: ct);
        }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; }
        return View("Index");
    }
    public Task<IActionResult> Clinic(string id, int page = 1, CancellationToken ct = default)
        => Index(new() { ClinicId = id, Page = page }, "doctors", ct);
    public async Task<IActionResult> Doctor(string clinicId, string id, CancellationToken ct)
    {
        try { return View(await api.SendAsync<PublicDoctor>($"api/public/clinics/{E(clinicId)}/doctors/{E(id)}", authenticated: false, ct: ct)); }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; return View("Index"); }
    }
    public async Task<IActionResult> Book(string clinicId, string doctorId, CancellationToken ct)
    {
        try
        {
            var doctor = await api.SendAsync<PublicDoctor>($"api/public/clinics/{E(clinicId)}/doctors/{E(doctorId)}", authenticated: false, ct: ct);
            if (User.Identity?.IsAuthenticated != true)
                return RedirectToAction("Login", "Account", new { clinicId, returnUrl = Url.Action(nameof(Book), new { clinicId, doctorId }) });
            if (User.FindFirst("clinicId")?.Value != clinicId)
            {
                Response.StatusCode = 403; ViewData["Error"] = "Вашата сметка припаѓа на друга клиника. За пристап до оваа клиника контактирајте ја нејзината рецепција. Не е променет вашиот работен простор.";
                return View("Doctor", doctor);
            }
            return LocalRedirect("/Workspace?book=" + E(doctorId) + "#doctors");
        }
        catch (RuleException e) { Response.StatusCode = e.StatusCode; ViewData["Error"] = e.Message; return View("Doctor"); }
    }
}
