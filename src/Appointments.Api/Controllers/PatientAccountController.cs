using Appointments.Api.Services;
using Appointments.Contracts;
using Appointments.Core;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Api.Controllers;

[ApiController, Authorize(Roles = "Patient"), Route("api/patient"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PatientAccountController(GlobalPatients patients) : ControllerBase
{
    private string Token => HttpContext.Items["GlobalPatientToken"] as string
        ?? throw new RuleException("Потребна е лична пациентска сметка.", 403);
    [HttpGet("home")] public Task<PatientHome> Home(CancellationToken ct) => patients.HomeAsync(Token, ct);
    [HttpPost("clinics/{clinicId}")] public Task<SessionResponse> Join(string clinicId, CancellationToken ct) => patients.JoinAsync(Token, clinicId, ct);
}
