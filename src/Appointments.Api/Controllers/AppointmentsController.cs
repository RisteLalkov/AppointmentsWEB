using Appointments.Contracts;
using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Controllers;

[ApiController, Authorize, Route("api"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AppointmentsController(PostgresAppointments service) : ApiControllerBase
{
    [Authorize(Roles = "Administrator"), HttpGet("reports")] public Task<ReportResult> Reports([FromQuery] ReportQuery query, CancellationToken ct) => service.ReportAsync(Actor, query, ct);
    [Authorize(Roles = "Administrator"), HttpPost("catalogue/doctors")] public Task<object> Doctor(DoctorInput input, CancellationToken ct) => service.SaveCatalogueAsync(Actor, "doctors", input, ct);
    [Authorize(Roles = "Administrator"), HttpPost("catalogue/specialties")] public Task<object> Specialty(SpecialtyInput input, CancellationToken ct) => service.SaveCatalogueAsync(Actor, "specialties", input, ct);
    [Authorize(Roles = "Administrator"), HttpPost("catalogue/services")] public Task<object> MedicalService(ServiceInput input, CancellationToken ct) => service.SaveCatalogueAsync(Actor, "services", input, ct);
    [HttpGet("bootstrap")] public Task<BootstrapResponse> Bootstrap(CancellationToken ct) => service.BootstrapAsync(Actor, IsDemo, ct);
    [HttpGet("appointments")] public async Task<IActionResult> List([FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to, int skip = 0, int take = 100, CancellationToken ct = default, string? doctorId = null, string? patientId = null, string? serviceId = null, AppointmentStatus? status = null)
    {
        if (skip < 0 || take is < 1 or > 500) return BadRequest(new { error = "Use skip >= 0 and take between 1 and 500." });
        if (from.HasValue && to.HasValue && from >= to) return BadRequest(new { error = "Почетокот мора да биде пред крајот на периодот." });
        if (status.HasValue && !Enum.IsDefined(status.Value)) return BadRequest(new { error = "Невалиден статус." });
        var query = service.Visible(Actor).AsNoTracking();
        if (!string.IsNullOrEmpty(doctorId)) query = query.Where(a => a.DoctorId == doctorId);
        if (!string.IsNullOrEmpty(patientId)) query = query.Where(a => a.PatientId == patientId);
        if (!string.IsNullOrEmpty(serviceId)) query = service.FilterService(query, serviceId);
        if (status.HasValue) query = query.Where(a => a.Status == status.Value);
        if (from.HasValue) query = query.Where(a => a.End > from.Value.ToUniversalTime());
        if (to.HasValue) query = query.Where(a => a.Start < to.Value.ToUniversalTime());
        return Ok(new { total = await query.CountAsync(ct), items = await query.OrderBy(a => a.Start).ThenBy(a => a.Id).Skip(skip).Take(take).ToListAsync(ct) });
    }
    [HttpGet("appointments/{id}/history")] public Task<AppointmentHistoryResult> History(string id, CancellationToken ct) => service.HistoryAsync(Actor, id, ct);
    [HttpGet("slots")] public Task<IReadOnlyList<Slot>> Slots(string doctorId, DateOnly date, string? excludeId, CancellationToken ct, string? serviceId = null) => service.SlotsAsync(Actor, doctorId, date, excludeId, ct, serviceId);
    [HttpGet("exceptions")] public Task<IReadOnlyList<AvailabilityException>> Exceptions(string doctorId, CancellationToken ct) => service.ExceptionsAsync(Actor, doctorId, ct);
    [HttpPost("appointments")] public Task<Appointment> Book(BookingCommand input, CancellationToken ct) => service.BookAsync(Actor, input, ct);
    [HttpPost("appointments/{id}/move")] public Task<Appointment> Move(string id, MoveCommand input, CancellationToken ct) => service.MoveAsync(Actor, id, input, ct);
    [HttpPost("appointments/{id}/status")] public Task<Appointment> Status(string id, StatusInput input, CancellationToken ct) => service.StatusAsync(Actor, id, input, ct);
    [HttpPost("patients")] public Task<Patient> Patient(PatientInput input, CancellationToken ct) => service.PatientAsync(Actor, input, IsDemo, ct);
    [HttpPost("schedule/{doctorId}")] public async Task<object> Schedule(string doctorId, ScheduleInput input, CancellationToken ct) { await service.ScheduleAsync(Actor, doctorId, input, ct); return new { saved = true }; }
    [HttpPost("exceptions/{doctorId}")] public Task<AvailabilityException> Exception(string doctorId, ExceptionInput input, CancellationToken ct) => service.AddExceptionAsync(Actor, doctorId, input, ct);
    [HttpPost("exceptions/{id}/remove")] public async Task<object> Remove(string id, CancellationToken ct) { await service.RemoveExceptionAsync(Actor, id, ct); return new { saved = true }; }
}
