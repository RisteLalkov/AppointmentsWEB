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
    [HttpGet("bootstrap")] public Task<BootstrapResponse> Bootstrap(CancellationToken ct) => service.BootstrapAsync(Actor, IsDemo, ct);
    [HttpGet("appointments")] public async Task<IActionResult> List([FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to, int skip = 0, int take = 100, CancellationToken ct = default)
    {
        if (skip < 0 || take is < 1 or > 500) return BadRequest(new { error = "Use skip >= 0 and take between 1 and 500." });
        var query = service.Visible(Actor).AsNoTracking();
        if (from.HasValue) query = query.Where(a => a.End > from.Value.ToUniversalTime());
        if (to.HasValue) query = query.Where(a => a.Start < to.Value.ToUniversalTime());
        return Ok(new { total = await query.CountAsync(ct), items = await query.OrderBy(a => a.Start).ThenBy(a => a.Id).Skip(skip).Take(take).ToListAsync(ct) });
    }
    [HttpGet("slots")] public Task<IReadOnlyList<Slot>> Slots(string doctorId, DateOnly date, string? excludeId, CancellationToken ct) => service.SlotsAsync(Actor, doctorId, date, excludeId, ct);
    [HttpGet("exceptions")] public Task<IReadOnlyList<AvailabilityException>> Exceptions(string doctorId, CancellationToken ct) => service.ExceptionsAsync(Actor, doctorId, ct);
    [HttpPost("appointments")] public Task<Appointment> Book(BookingCommand input, CancellationToken ct) => service.BookAsync(Actor, input, ct);
    [HttpPost("appointments/{id}/move")] public Task<Appointment> Move(string id, MoveCommand input, CancellationToken ct) => service.MoveAsync(Actor, id, input, ct);
    [HttpPost("appointments/{id}/status")] public Task<Appointment> Status(string id, StatusInput input, CancellationToken ct) => service.StatusAsync(Actor, id, input, ct);
    [HttpPost("patients")] public Task<Patient> Patient(PatientInput input, CancellationToken ct) => service.PatientAsync(Actor, input, IsDemo, ct);
    [HttpPost("schedule/{doctorId}")] public async Task<object> Schedule(string doctorId, ScheduleInput input, CancellationToken ct) { await service.ScheduleAsync(Actor, doctorId, input, ct); return new { saved = true }; }
    [HttpPost("exceptions/{doctorId}")] public Task<AvailabilityException> Exception(string doctorId, ExceptionInput input, CancellationToken ct) => service.AddExceptionAsync(Actor, doctorId, input, ct);
    [HttpPost("exceptions/{id}/remove")] public async Task<object> Remove(string id, CancellationToken ct) { await service.RemoveExceptionAsync(Actor, id, ct); return new { saved = true }; }
}
