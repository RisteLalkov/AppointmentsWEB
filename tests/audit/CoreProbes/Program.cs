using Appointments.Core;
using System.Text.Json;
// Audit observations, intentionally no application fixes. One case is expected to expose a defect.
var results = new List<object>();
var directory = Path.Combine(Path.GetTempPath(), "qa-core-" + Guid.NewGuid().ToString("N"));
try
{
    var clock = new SchedulingClock(new FixedTime(), "Europe/Skopje");
    using var store = new JsonDemoStore(Path.Combine(directory, "state.json"), () => new()
    {
        Doctors = [new() { Id = "doctor", Name = "QA Doctor", Specialty = "QA", RequiresConfirmation = true, TuesdayFirst = true,
            WorkingPeriods = [new(DayOfWeek.Monday, new(8,0), new(17,0)),new(DayOfWeek.Tuesday,new(8,0),new(17,0)),new(DayOfWeek.Wednesday,new(8,0),new(17,0))] }],
        Patients = [new("patient", "QA Patient", "qa@example.test", "070123456")]
    });
    var service = new AppointmentService(store, clock); var actor = new DemoActor("staff", "QA Reception", DemoRole.Administrator);
    var request = new BookingCommand("doctor", "patient", new(2026,9,21), new(9,0), 30, Guid.NewGuid().ToString("N"));
    var initial = service.Book(actor, request); bool conflict = false;
    try { service.Book(actor, request with { AgreedTime = true }); } catch (RuleException e) when(e.StatusCode == 409) { conflict = true; }
    results.Add(new { id="C001",name="JSON demo rejects replay when AgreedTime changes",status=conflict?"PASS":"FAIL",observed=conflict?"409":"Original Scheduled response replayed",scope="Development-only JSON backend; PostgreSQL fingerprints whole command" });
    var slots = service.Availability(actor,"doctor",new(2026,9,23));
    results.Add(new { id="C002",name="Legacy TuesdayFirst metadata does not suppress Wednesday availability",status=slots.Count>0?"PASS":"FAIL",slots=slots.Count });
    Console.WriteLine(JsonSerializer.Serialize(results,new JsonSerializerOptions { WriteIndented=true }));
    if (!conflict) Environment.ExitCode = 1;
}
finally { if(Directory.Exists(directory)) Directory.Delete(directory,true); }
sealed class FixedTime : TimeProvider { public override DateTimeOffset GetUtcNow()=>new(2026,9,20,0,0,0,TimeSpan.Zero); }
