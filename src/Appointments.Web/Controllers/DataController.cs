using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize, Route("data"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DataController(IAppointmentService service, DemoIdentity identity, SchedulingClock clock) : Controller
{
    private IActionResult Execute(Func<object> run)
    {
        if (!ModelState.IsValid) return BadRequest(new { error = "Some fields are invalid. Check dates, times and required values." });
        try { return Ok(run()); } catch (RuleException e) { return StatusCode(e.StatusCode, new { error = e.Message }); }
    }
    [HttpGet("bootstrap")] public IActionResult Bootstrap() => Execute(() => new
    {
        actor = identity.Actor, doctors = service.Doctors(), patients = service.Patients(identity.Actor), appointments = service.Appointments(identity.Actor),
        today = clock.Today.ToString("yyyy-MM-dd"), localNow = clock.LocalNow.ToString("yyyy-MM-ddTHH:mm:ss"), timeZone = clock.Zone.Id, utcNow = clock.UtcNow
    });
    [HttpGet("slots")] public IActionResult Slots(string doctorId, DateOnly date, string? excludeId) => Execute(() => service.Availability(identity.Actor, doctorId, date, excludeId));
    [HttpGet("exceptions")] public IActionResult Exceptions(string doctorId) => Execute(() => service.Exceptions(identity.Actor, doctorId));
    [HttpPost("appointments")] public IActionResult Book([FromBody] BookingCommand command) => Execute(() => service.Book(identity.Actor, command));
    [HttpPost("appointments/{id}/move")] public IActionResult Move(string id, [FromBody] MoveCommand command) => Execute(() => service.Move(identity.Actor, id, command));
    [HttpPost("appointments/{id}/status")] public IActionResult Status(string id, [FromBody] StatusInput input) => Execute(() => service.ChangeStatus(identity.Actor, id, input.Status, input.Version));
    [HttpPost("patients")] public IActionResult AddPatient([FromBody] PatientInput input) => Execute(() => service.AddPatient(identity.Actor, input.Name ?? "", input.Email ?? "", input.Phone ?? ""));
    [HttpPost("schedule/{doctorId}")] public IActionResult Schedule(string doctorId, [FromBody] ScheduleInput input) => Execute(() => { service.ReplaceSchedule(identity.Actor, doctorId, input.Periods ?? [], input.DurationMinutes); return new { saved = true }; });
    [HttpPost("exceptions/{doctorId}")] public IActionResult Exception(string doctorId, [FromBody] ExceptionInput input) => Execute(() => service.AddException(identity.Actor, doctorId, input.Date, input.Start, input.End, input.IsAvailable, input.Reason ?? ""));
    [HttpPost("exceptions/{id}/remove")] public IActionResult RemoveException(string id) => Execute(() => { service.RemoveException(identity.Actor, id); return new { saved = true }; });
    [HttpPost("reset")] public IActionResult Reset() => Execute(() => { service.Reset(identity.Actor); return new { saved = true }; });
}
public record StatusInput(AppointmentStatus Status, int Version);
public record PatientInput(string? Name, string? Email, string? Phone);
public record ScheduleInput(List<WorkingPeriod>? Periods, int DurationMinutes);
public record ExceptionInput(DateOnly Date, TimeOnly Start, TimeOnly End, bool IsAvailable, string? Reason);
