using Appointments.Api.Services;
using Appointments.Contracts;
using Appointments.Core;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Appointments.Api.Controllers;

[ApiController, AllowAnonymous, Route("api/public"), EnableRateLimiting("discovery")]
public sealed class DiscoveryController(PublicDiscovery discovery) : ControllerBase
{
    [HttpGet("clinics")] public PublicPage<PublicClinic> Clinics([FromQuery] DiscoveryQuery query) => discovery.Clinics(query);
    [HttpGet("clinics/{id}")] public PublicClinic Clinic(string id) => PublicDiscovery.Describe(discovery.Clinic(id));
    [HttpGet("doctors")] public Task<PublicPage<PublicDoctor>> Doctors([FromQuery] DiscoveryQuery query, CancellationToken ct) => discovery.DoctorsAsync(query, ct);
    [HttpGet("clinics/{clinicId}/doctors/{doctorId}/availability"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public Task<PublicAvailability> Availability(string clinicId, string doctorId, DateOnly? date, string? serviceId, CancellationToken ct)
        => discovery.AvailabilityAsync(clinicId, doctorId, date, serviceId, ct);
    [HttpGet("clinics/{clinicId}/doctors/{doctorId}")] public async Task<PublicDoctor> Doctor(string clinicId, string doctorId, CancellationToken ct)
        => (await discovery.DoctorsAsync(new() { ClinicId = clinicId, PageSize = 1 }, ct, doctorId)).Items.SingleOrDefault() ?? throw new RuleException("Лекарот не е пронајден.", 404);
}
