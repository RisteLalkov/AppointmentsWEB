using System.Text.Json;
using Appointments.Contracts;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

[Authorize, Route("data"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DataController(IServiceProvider services, DemoIdentity identity, SchedulingClock clock, BackendSettings settings, ApiClient api) : Controller
{
    private static string Escape(string? value) => Uri.EscapeDataString(value ?? "");
    private IAppointmentService Demo => services.GetRequiredService<IAppointmentService>();
    private async Task<IActionResult> Execute(string path, object? body, Func<object> demo)
    {
        if (!ModelState.IsValid) return BadRequest(new { error = "Некои полиња се невалидни. Проверете ги датумите, времињата и задолжителните вредности." });
        try { return Ok(settings.UseApi ? await api.SendAsync<JsonElement>("api/" + path, body, ct: HttpContext.RequestAborted) : demo()); }
        catch (RuleException e) { return StatusCode(e.StatusCode, new { error = e.Message }); }
    }
    [HttpGet("bootstrap")] public Task<IActionResult> Bootstrap() => Execute("bootstrap", null, () => new BootstrapResponse(identity.Actor, Demo.Doctors(), Demo.Patients(identity.Actor), Demo.Appointments(identity.Actor), clock.Today.ToString("yyyy-MM-dd"), clock.LocalNow.ToString("yyyy-MM-ddTHH:mm:ss"), clock.Zone.Id, clock.UtcNow, true, true, "Demo"));
    [HttpGet("slots")] public Task<IActionResult> Slots(string doctorId, DateOnly date, string? excludeId) => Execute($"slots?doctorId={Escape(doctorId)}&date={date:yyyy-MM-dd}&excludeId={Uri.EscapeDataString(excludeId ?? "")}", null, () => Demo.Availability(identity.Actor, doctorId, date, excludeId));
    [HttpGet("exceptions")] public Task<IActionResult> Exceptions(string doctorId) => Execute("exceptions?doctorId=" + Escape(doctorId), null, () => Demo.Exceptions(identity.Actor, doctorId));
    [HttpPost("appointments")] public Task<IActionResult> Book([FromBody] BookingCommand command) => Execute("appointments", command, () => Demo.Book(identity.Actor, command));
    [HttpPost("appointments/{id}/move")] public Task<IActionResult> Move(string id, [FromBody] MoveCommand command) => Execute($"appointments/{Uri.EscapeDataString(id)}/move", command, () => Demo.Move(identity.Actor, id, command));
    [HttpPost("appointments/{id}/status")] public Task<IActionResult> Status(string id, [FromBody] StatusInput input) => Execute($"appointments/{Uri.EscapeDataString(id)}/status", input, () => Demo.ChangeStatus(identity.Actor, id, input.Status, input.Version));
    [HttpPost("patients")] public Task<IActionResult> AddPatient([FromBody] PatientInput input) => Execute("patients", input, () => Demo.AddPatient(identity.Actor, input.Name, input.Email ?? "", input.Phone ?? ""));
    [HttpPost("schedule/{doctorId}")] public Task<IActionResult> Schedule(string doctorId, [FromBody] ScheduleInput input) => Execute("schedule/" + Escape(doctorId), input, () => { Demo.ReplaceSchedule(identity.Actor, doctorId, input.Periods, input.DurationMinutes); return new { saved = true }; });
    [HttpPost("exceptions/{doctorId}")] public Task<IActionResult> Exception(string doctorId, [FromBody] ExceptionInput input) => Execute("exceptions/" + Escape(doctorId), input, () => Demo.AddException(identity.Actor, doctorId, input.Date, input.Start, input.End, input.IsAvailable, input.Reason));
    [HttpPost("exceptions/{id}/remove")] public Task<IActionResult> RemoveException(string id) => Execute($"exceptions/{Uri.EscapeDataString(id)}/remove", new { }, () => { Demo.RemoveException(identity.Actor, id); return new { saved = true }; });
    [HttpPost("reset")] public IActionResult Reset()
    {
        if (settings.UseApi) return BadRequest(new { error = "Database reset is unavailable from the website. Use the documented development database reset procedure." });
        try { Demo.Reset(identity.Actor); return Ok(new { saved = true }); } catch (RuleException e) { return StatusCode(e.StatusCode, new { error = e.Message }); }
    }
}
