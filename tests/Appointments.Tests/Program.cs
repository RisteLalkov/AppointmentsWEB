using Appointments.Core;
using System.Collections.Concurrent;
using System.Text.Json;

// Dependency-free executable test suite: exits nonzero on any failed assertion.
// Run: dotnet run --project tests/Appointments.Tests -c Release
var tests = new List<(string Name, Action Run)>();
void Test(string name, Action run) => tests.Add((name, run));
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}; got {actual}"); }
void True(bool condition) { if (!condition) throw new Exception("Assertion failed."); }
void Reject(Action action, int? status = null)
{
    try { action(); } catch (RuleException e) { if (status.HasValue) Equal(status.Value, e.StatusCode); return; }
    throw new Exception("Expected a business-rule rejection.");
}
var admin = new DemoActor("admin", "Admin", DemoRole.Administrator);
var pat = new DemoActor("p1", "Patient", DemoRole.Patient, PatientId: "p1");
var other = new DemoActor("p2", "Other", DemoRole.Patient, PatientId: "p2");
var doc = new DemoActor("doc1", "Doctor", DemoRole.Doctor, DoctorId: "d1");
var otherDoc = new DemoActor("doc2", "Other doctor", DemoRole.Doctor, DoctorId: "d2");
var monday = new DateOnly(2026, 9, 21);
Fixture New() => new();
BookingCommand Cmd(string time = "09:00", string doctor = "d1", string patient = "p1", DateOnly? date = null, int duration = 30, string? key = null) => new(doctor, patient, date ?? monday, TimeOnly.Parse(time), duration, key ?? Guid.NewGuid().ToString());

Test("Seed preserves 40 profiles, 46 rows, 87 periods", () => {
    var seed = DemoSeed.Create(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"doctors.json")), new(new FakeTime(),"Europe/Skopje"));
    Equal(40,seed.Doctors.Count); Equal(46,seed.Doctors.Sum(d=>d.SourceSchedules.Count)); Equal(87,seed.Doctors.Sum(d=>d.WorkingPeriods.Count)); Equal(2,seed.Doctors.Count(d=>d.IsService));
    Equal(25,seed.Doctors.Count(d=>d.WorkingPeriods.Count>0));
    True(seed.Doctors.All(d=>d.DurationMinutes==30));
});
Test("Shared booking visible to patient, doctor and reception", () => {using var f=New(); var a=f.Service.Book(pat,Cmd());Equal(a.Id,f.Service.Appointments(doc).Single().Id);Equal(a.Id,f.Service.Appointments(admin).Single().Id);Equal(a.Id,f.Service.Appointments(pat).Single().Id);});
Test("Patient cannot see another patient's appointment", () => {using var f=New();f.Service.Book(pat,Cmd());Equal(0,f.Service.Appointments(other).Count);});
Test("Doctor cannot see another doctor's private appointments", () => {using var f=New();f.Service.Book(pat,Cmd());Equal(0,f.Service.Appointments(otherDoc).Count);});
Test("Patient cannot book for somebody else", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd(patient:"p2")),403);});
Test("Doctor cannot book another doctor's schedule", () => {using var f=New();Reject(()=>f.Service.Book(doc,Cmd(doctor:"d2")),403);});
Test("Doctor cannot query another doctor's availability", () => {using var f=New();Reject(()=>f.Service.Availability(doc,"d2",monday),403);});
Test("Reject occupied doctor slot", () => {using var f=New();f.Service.Book(pat,Cmd());Reject(()=>f.Service.Book(other,Cmd(patient:"p2")),409);});
Test("Reject patient overlap across doctors", () => {using var f=New();f.Service.Book(pat,Cmd());Reject(()=>f.Service.Book(pat,Cmd(doctor:"d2")),409);});
Test("Patient availability excludes their visits with other doctors", () => {using var f=New();f.Service.Book(pat,Cmd());True(f.Service.Availability(pat,"d2",monday).All(s=>s.Time!=new TimeOnly(9,0)));True(f.Service.Availability(other,"d2",monday).Any(s=>s.Time==new TimeOnly(9,0)));});
Test("Adjacent appointments are allowed", () => {using var f=New();f.Service.Book(pat,Cmd());f.Service.Book(other,Cmd("09:30",patient:"p2"));Equal(2,f.Service.Appointments(admin).Count);});
Test("Reject past date", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd(date:monday.AddDays(-7))),409);});
Test("Reject past time today", () => {using var f=New();f.Time.Now=new DateTimeOffset(2026,9,21,8,0,0,TimeSpan.Zero);Reject(()=>f.Service.Book(pat,Cmd()),409);});
Test("Reject weekend outside working days", () => {using var f=New();Equal(0,f.Service.Availability(pat,"d1",monday.AddDays(5)).Count);Reject(()=>f.Service.Book(pat,Cmd(date:monday.AddDays(5))),409);});
Test("Reject before opening and at closing", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd("07:30")),409);Reject(()=>f.Service.Book(pat,Cmd("17:00")),409);});
Test("Reject partial slot crossing closing boundary", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd("16:45")),409);});
Test("Reject time not on configured slot grid", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd("09:10")),409);});
Test("Reject wrong duration", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd(duration:45)),409);Reject(()=>f.Service.Book(pat,Cmd(duration:0)),409);});
Test("Duration is configurable per doctor", () => {using var f=New();f.Service.ReplaceSchedule(admin,"d1",[new(DayOfWeek.Monday,new(8,0),new(17,0))],45);var a=f.Service.Book(pat,Cmd("08:00",duration:45));Equal(45d,(a.End-a.Start).TotalMinutes);Equal(30,f.Service.Doctors().Single(d=>d.Id=="d2").DurationMinutes);});
Test("Recurring break using split shifts", () => {using var f=New();f.Service.ReplaceSchedule(admin,"d1",[new(DayOfWeek.Monday,new(8,0),new(12,0)),new(DayOfWeek.Monday,new(13,0),new(17,0))],30);Reject(()=>f.Service.Book(pat,Cmd("12:00")),409);f.Service.Book(pat,Cmd("13:00"));});
Test("Blocked exception removes overlapping slots", () => {using var f=New();f.Service.AddException(admin,"d1",monday,new(9,15),new(10,15),false,"Demo break");var slots=f.Service.Availability(pat,"d1",monday);True(slots.All(s=>s.Time<new TimeOnly(9,0)||s.Time>=new TimeOnly(10,30)));});
Test("Full-day holiday blocks all appointments", () => {using var f=New();f.Service.AddException(admin,"d1",monday,new(0,0),new(23,59),false,"Demo holiday");Equal(0,f.Service.Availability(pat,"d1",monday).Count);});
Test("One-off additional session enables Saturday", () => {using var f=New();var date=monday.AddDays(5);f.Service.AddException(doc,"d1",date,new(10,0),new(12,0),true,"Agreed demo session");f.Service.Book(pat,Cmd("10:00",date:date));});
Test("Blocked exception wins over added availability", () => {using var f=New();f.Service.AddException(admin,"d1",monday,new(9,0),new(11,0),true,"Additional");f.Service.AddException(admin,"d1",monday,new(9,0),new(11,0),false,"Unavailable");Reject(()=>f.Service.Book(pat,Cmd()),409);});
Test("Availability edits cannot invalidate appointments", () => {using var f=New();f.Service.Book(pat,Cmd());Reject(()=>f.Service.AddException(admin,"d1",monday,new(8,0),new(12,0),false,"Break"),409);Equal(0,f.Service.Exceptions(admin,"d1").Count);Reject(()=>f.Service.ReplaceSchedule(admin,"d1",[],30),409);True(f.Service.Doctors()[0].WorkingPeriods.Count>0);});
Test("Removing one-off availability protects existing booking", () => {using var f=New();var date=monday.AddDays(5);var e=f.Service.AddException(admin,"d1",date,new(9,0),new(12,0),true,"Demo session");f.Service.Book(pat,Cmd(date:date));Reject(()=>f.Service.RemoveException(admin,e.Id),409);Equal(1,f.Service.Exceptions(admin,"d1").Count);});
Test("Reject overlapping working periods and invalid duration", () => {using var f=New();Reject(()=>f.Service.ReplaceSchedule(admin,"d1",[new(DayOfWeek.Monday,new(8,0),new(12,0)),new(DayOfWeek.Monday,new(11,0),new(13,0))],30));Reject(()=>f.Service.ReplaceSchedule(admin,"d1",[],0));});
Test("Patient cannot change availability or see staff exceptions", () => {using var f=New();Reject(()=>f.Service.ReplaceSchedule(pat,"d1",[],30),403);Reject(()=>f.Service.Exceptions(pat,"d1"),403);Reject(()=>f.Service.AddException(pat,"d1",monday,new(9,0),new(10,0),false,"Time off"),403);});
Test("Doctor cannot edit another doctor's availability", () => {using var f=New();Reject(()=>f.Service.ReplaceSchedule(doc,"d2",[],30),403);});
Test("Cancellation releases slot and reaches all roles", () => {using var f=New();var a=f.Service.Book(pat,Cmd());f.Service.ChangeStatus(pat,a.Id,AppointmentStatus.Cancelled,a.Version);f.Service.Book(other,Cmd(patient:"p2"));Equal(AppointmentStatus.Cancelled,f.Service.Appointments(doc).Single(x=>x.Id==a.Id).Status);});
Test("Reschedule releases old slot and reserves new slot", () => {using var f=New();var a=f.Service.Book(pat,Cmd());var moved=f.Service.Move(pat,a.Id,new(monday,new(10,0),a.Version));Equal(new TimeOnly(10,0),TimeOnly.FromDateTime(f.Clock.Local(moved.Start)));f.Service.Book(other,Cmd(patient:"p2"));Reject(()=>f.Service.Book(other,Cmd("10:00",patient:"p2")),409);});
Test("Conflicting reschedule preserves original booking", () => {using var f=New();var a=f.Service.Book(pat,Cmd());f.Service.Book(other,Cmd("10:00",patient:"p2"));Reject(()=>f.Service.Move(pat,a.Id,new(monday,new(10,0),a.Version)),409);Equal(a.Start,f.Service.Appointments(pat).Single().Start);});
Test("Cannot reschedule or cancel someone else's appointment", () => {using var f=New();var a=f.Service.Book(pat,Cmd());Reject(()=>f.Service.Move(other,a.Id,new(monday,new(10,0),1)),403);Reject(()=>f.Service.ChangeStatus(otherDoc,a.Id,AppointmentStatus.Cancelled,1),403);Reject(()=>f.Service.Availability(other,"d1",monday,a.Id),403);});
Test("Stale appointment versions are rejected", () => {using var f=New();var a=f.Service.Book(pat,Cmd());f.Service.Move(pat,a.Id,new(monday,new(10,0),1));Reject(()=>f.Service.ChangeStatus(admin,a.Id,AppointmentStatus.Cancelled,1),409);});
Test("Confirmation-required booking starts scheduled", () => {using var f=New();f.Store.Write(s=>{s.Doctors[0]=s.Doctors[0] with{RequiresConfirmation=true};return true;});var a=f.Service.Book(pat,Cmd());Equal(AppointmentStatus.Scheduled,a.Status);Equal(AppointmentStatus.Confirmed,f.Service.ChangeStatus(doc,a.Id,AppointmentStatus.Confirmed,1).Status);});
Test("Rescheduling confirmation booking requires renewed confirmation", () => {using var f=New();f.Store.Write(s=>{s.Doctors[0]=s.Doctors[0] with{RequiresConfirmation=true};return true;});var a=f.Service.Book(pat,Cmd());f.Service.ChangeStatus(doc,a.Id,AppointmentStatus.Confirmed,1);Equal(AppointmentStatus.Scheduled,f.Service.Move(admin,a.Id,new(monday,new(10,0),2)).Status);});
Test("Reception-only provider rejects patient self-booking", () => {using var f=New();f.Store.Write(s=>{s.Doctors[0]=s.Doctors[0] with{StaffOnly=true,RequiresConfirmation=true};return true;});Equal(0,f.Service.Availability(pat,"d1",monday).Count);Reject(()=>f.Service.Book(pat,Cmd()),403);f.Service.Book(admin,Cmd());});
Test("Patient cannot confirm or complete a visit", () => {using var f=New();var a=f.Service.Book(pat,Cmd());Reject(()=>f.Service.ChangeStatus(pat,a.Id,AppointmentStatus.Completed,1),403);});
Test("Cannot complete or mark no-show before visit ends", () => {using var f=New();var a=f.Service.Book(pat,Cmd());Reject(()=>f.Service.ChangeStatus(doc,a.Id,AppointmentStatus.Completed,1));Reject(()=>f.Service.ChangeStatus(doc,a.Id,AppointmentStatus.NoShow,1));});
Test("Can complete a confirmed past visit; terminal status stays closed", () => {using var f=New();var a=f.Service.Book(pat,Cmd());f.Time.Now=new DateTimeOffset(2026,9,21,12,0,0,TimeSpan.Zero);Equal(AppointmentStatus.Completed,f.Service.ChangeStatus(doc,a.Id,AppointmentStatus.Completed,1).Status);Reject(()=>f.Service.ChangeStatus(admin,a.Id,AppointmentStatus.Confirmed,2));});
Test("Can mark a confirmed past visit no-show", () => {using var f=New();var a=f.Service.Book(pat,Cmd());f.Time.Now=new DateTimeOffset(2026,9,21,12,0,0,TimeSpan.Zero);Equal(AppointmentStatus.NoShow,f.Service.ChangeStatus(doc,a.Id,AppointmentStatus.NoShow,1).Status);});
Test("Cannot resurrect a cancelled appointment", () => {using var f=New();var a=f.Service.Book(pat,Cmd());f.Service.ChangeStatus(pat,a.Id,AppointmentStatus.Cancelled,1);Reject(()=>f.Service.Move(admin,a.Id,new(monday,new(10,0),2)));});
Test("Idempotency prevents duplicate submissions", () => {using var f=New();var command=Cmd();Equal(f.Service.Book(pat,command).Id,f.Service.Book(pat,command).Id);Equal(1,f.Service.Appointments(admin).Count);});
Test("Reusing request identifier with different data rejected", () => {using var f=New();var command=Cmd();f.Service.Book(pat,command);Reject(()=>f.Service.Book(pat,command with{Time=new(10,0)}),409);});
Test("Concurrent booking: exactly one succeeds", () => {using var f=New();var success=new ConcurrentBag<string>();Parallel.For(0,24,_=>{try{success.Add(f.Service.Book(admin,Cmd()).Id);}catch(RuleException e) when(e.StatusCode==409){}});Equal(1,success.Count);Equal(1,f.Service.Appointments(admin).Count);});
Test("JSON restart retains appointments", () => {var f=New();var a=f.Service.Book(pat,Cmd());f.Store.Dispose();using(var reopened=new JsonDemoStore(f.Path,f.Seed)){Equal(a.Id,reopened.Read(s=>s.Appointments.Single().Id));}f.Dispose();});
Test("Second process cannot open the same demo file", () => {using var f=New();try{using var second=new JsonDemoStore(f.Path,f.Seed);}catch(IOException){return;}throw new Exception("Expected exclusive lock.");});
Test("Reset is administrator-only and restores seed", () => {using var f=New();f.Service.Book(pat,Cmd());Reject(()=>f.Service.Reset(doc),403);f.Service.Reset(admin);Equal(0,f.Service.Appointments(admin).Count);});
Test("Patient validation and duplicate email", () => {using var f=New();Reject(()=>f.Service.AddPatient(pat,"Jane Demo","",""),403);Reject(()=>f.Service.AddPatient(admin,"","",""));Reject(()=>f.Service.AddPatient(admin,"Jane Demo","bad-email",""));f.Service.AddPatient(admin,"Jane Demo","jane@example.test","");Reject(()=>f.Service.AddPatient(admin,"Jane Two","jane@example.test",""),409);});
Test("Tuesday first policy blocks Wednesday until Tuesday full", () => {using var f=New();f.Store.Write(s=>{s.Doctors[0]=s.Doctors[0] with{TuesdayFirst=true,WorkingPeriods=[new(DayOfWeek.Tuesday,new(14,30),new(15,0)),new(DayOfWeek.Wednesday,new(16,0),new(17,0))]};return true;});Equal(0,f.Service.Availability(pat,"d1",monday.AddDays(2)).Count);f.Service.Book(pat,Cmd("14:30",date:monday.AddDays(1)));Equal(2,f.Service.Availability(pat,"d1",monday.AddDays(2)).Count);});
Test("Spring DST nonexistent times are excluded", () => {using var f=New();var date=new DateOnly(2027,3,28);f.Time.Now=new DateTimeOffset(2027,3,27,0,0,0,TimeSpan.Zero);Equal<DateTimeOffset?>(null,f.Clock.ToInstant(date,new(2,30)));f.Service.AddException(admin,"d1",date,new(1,0),new(4,0),true,"DST test");True(f.Service.Availability(pat,"d1",date).All(s=>s.Time.Hour!=2));});
Test("Autumn DST ambiguous times are excluded", () => {using var f=New();var date=new DateOnly(2026,10,25);Equal<DateTimeOffset?>(null,f.Clock.ToInstant(date,new(2,30)));f.Service.AddException(admin,"d1",date,new(1,0),new(4,0),true,"DST test");True(f.Service.Availability(pat,"d1",date).All(s=>s.Time.Hour!=2));});
Test("Skopje UTC offsets differ between winter and summer", () => {using var f=New();Equal(8,f.Clock.ToInstant(new(2026,1,15),new(9,0))!.Value.Hour);Equal(7,f.Clock.ToInstant(new(2026,7,15),new(9,0))!.Value.Hour);});
Test("Unknown or on-call doctor gets no invented hours", () => {using var f=New();f.Service.ReplaceSchedule(admin,"d1",[],30);Equal(0,f.Service.Availability(pat,"d1",monday).Count);});
Test("Booking horizon enforced", () => {using var f=New();Reject(()=>f.Service.Book(pat,Cmd(date:monday.AddDays(189))),409);});
Test("Returned data cannot mutate persisted state", () => {using var f=New();var d=f.Service.Doctors()[0];d.WorkingPeriods.Clear();Equal(5,f.Service.Doctors()[0].WorkingPeriods.Count);});

Test("Reports aggregate every status, distinct patients and cancellation/no-show denominators", () => {
    using var f=New(); var state=f.Seed();
    state.Doctors[0].WorkingPeriods=[new(DayOfWeek.Monday,new(8,0),new(12,0))];
    state.Doctors.RemoveAt(1);
    foreach(var status in Enum.GetValues<AppointmentStatus>()) {
        var start=f.Clock.ToInstant(monday,new TimeOnly(8,0))!.Value.AddMinutes(30*(int)status);
        state.Appointments.Add(new(){DoctorId="d1",PatientId=(int)status%2==0?"p1":"p2",Start=start,End=start.AddMinutes(30),Status=status});
    }
    var r=ReportBuilder.Build(admin,new(monday,monday),state,f.Clock);
    Equal(5,r.Summary.Total); Equal(1,r.Summary.Completed);Equal(1,r.Summary.Pending);Equal(1,r.Summary.Confirmed);Equal(1,r.Summary.Cancelled);Equal(1,r.Summary.NoShow);
    Equal(2,r.Summary.Patients);Equal(20d,r.Summary.CancellationPercent);Equal<double?>(50d,r.Summary.NoShowPercent);
    Equal(240d,r.Summary.CapacityMinutes);Equal(120d,r.Summary.OccupiedMinutes);Equal<double?>(50d,r.Summary.UtilizationPercent);
});
Test("Reports are administrator-only and validate range/group/filter", () => {
    using var f=New();var state=f.Seed();
    Reject(()=>ReportBuilder.Build(pat,new(monday,monday),state,f.Clock),403);Reject(()=>ReportBuilder.Build(doc,new(monday,monday),state,f.Clock),403);
    Reject(()=>ReportBuilder.Build(admin,new(monday,monday.AddDays(-1)),state,f.Clock));
    Reject(()=>ReportBuilder.Build(admin,new(monday,monday.AddDays(366)),state,f.Clock));
    Reject(()=>ReportBuilder.Build(admin,new(monday,monday,"invalid"),state,f.Clock));
    Reject(()=>ReportBuilder.Build(admin,new(monday,monday,ServiceId:"d1"),state,f.Clock));
});
Test("Reports distinguish actual service profiles, specialties and unknown services", () => {
    using var f=New();var state=f.Seed();state.Doctors[1]=state.Doctors[1] with { IsService=true,Specialty="Service specialty" };
    var r=ReportBuilder.Build(admin,new(monday,monday,ServiceId:"d2"),state,f.Clock);
    Equal(1,r.Doctors.Count);Equal("d2",r.Services.Single().Key);
    r=ReportBuilder.Build(admin,new(monday,monday,ServiceId:"unassigned"),state,f.Clock);Equal("d1",r.Doctors.Single().Key);
    r=ReportBuilder.Build(admin,new(monday,monday,DoctorId:"d1",Specialty:"Service specialty"),state,f.Clock);Equal(0,r.Doctors.Count);Equal<double?>(null,r.Summary.UtilizationPercent);
});
Test("Reports merge overlapping availability and honour blocks without double-counting capacity", () => {
    using var f=New();var state=f.Seed();state.Doctors.RemoveAt(1);state.Doctors[0].WorkingPeriods=[new(DayOfWeek.Monday,new(8,0),new(10,0))];
    state.Exceptions=[new("x","d1",monday,new(9,0),new(11,0),true,"Extra"),new("y","d1",monday,new(9,30),new(10,0),false,"Break")];
    var r=ReportBuilder.Build(admin,new(monday,monday),state,f.Clock);Equal(150d,r.Summary.CapacityMinutes);Equal<double?>(0d,r.Summary.UtilizationPercent);
});
Test("Reports use clinic dates, Monday weeks, month groups and include zero days", () => {
    using var f=New();var state=f.Seed();var date=new DateOnly(2026,10,1);
    state.Appointments.Add(new(){DoctorId="d1",PatientId="p1",Start=new(2026,9,30,22,30,0,TimeSpan.Zero),End=new(2026,9,30,23,0,0,TimeSpan.Zero),Status=AppointmentStatus.Confirmed});
    var r=ReportBuilder.Build(admin,new(date,date.AddDays(2)),state,f.Clock);Equal(1,r.Summary.Total);Equal(3,r.Periods.Count);Equal(1,r.Periods[0].Metrics.Total);
    r=ReportBuilder.Build(admin,new(date,date,"week"),state,f.Clock);Equal("2026-09-28",r.Periods.Single().Key);
    r=ReportBuilder.Build(admin,new(date.AddDays(-1),date,"month"),state,f.Clock);Equal(2,r.Periods.Count);Equal(1,r.Periods[1].Metrics.Total);
});
Test("Reports flag bookings outside current schedule and never divide by zero", () => {
    using var f=New();var state=f.Seed();state.Doctors.ForEach(d=>d.WorkingPeriods=[]);var start=f.Clock.ToInstant(monday,new(9,0))!.Value;
    state.Appointments.Add(new(){DoctorId="d1",PatientId="p1",Start=start,End=start.AddMinutes(30),Status=AppointmentStatus.Confirmed});
    var r=ReportBuilder.Build(admin,new(monday,monday),state,f.Clock);Equal(30d,r.Summary.OutsideCapacityMinutes);Equal<double?>(null,r.Summary.UtilizationPercent);Equal<double?>(null,r.Summary.NoShowPercent);
});
Test("Report capacity excludes DST invalid and ambiguous slots", () => {
    using var f=New();var state=f.Seed();state.Doctors.RemoveAt(1);state.Doctors[0].WorkingPeriods=[new(DayOfWeek.Sunday,new(1,0),new(4,0))];
    foreach(var date in new[]{new DateOnly(2027,3,28),new DateOnly(2026,10,25)}) {
        var r=ReportBuilder.Build(admin,new(date,date),state,f.Clock);Equal(90d,r.Summary.CapacityMinutes);
    }
});


Test("Catalogue is administrator-only and rejects stale edits", () => {
    using var f=New(); var catalog=new CatalogueService(f.Store);
    var sp=catalog.SaveSpecialty(admin,new(null,"Cardiology"));
    Reject(()=>catalog.SaveSpecialty(pat,new(null,"Forbidden")),403);
    var doc=catalog.SaveDoctor(admin,new(null,"New doctor",sp.Id,"Imaging",true));
    Equal(0,doc.WorkingPeriods.Count);
    catalog.SaveDoctor(admin,new(doc.Id,"Renamed",sp.Id,"",false,doc.CatalogVersion));
    Reject(()=>catalog.SaveDoctor(admin,new(doc.Id,"Stale",sp.Id,"",true,doc.CatalogVersion)),409);
});
Test("Service duration, assignment and active flags control booking", () => {
    using var f=New(); var catalog=new CatalogueService(f.Store); var sp=f.Store.Read(s=>s.Specialties.First());
    var svc=catalog.SaveService(admin,new(null,"Long examination",sp.Id,45,true,["d1"]));
    var slot=f.Service.Availability(admin,"d1",monday,serviceId:svc.Id).First(); Equal(45d,(slot.End-slot.Start).TotalMinutes);
    Reject(()=>f.Service.Book(admin,new("d1","p1",monday,slot.Time,30,Guid.NewGuid().ToString(),svc.Id)),409);
    Reject(()=>f.Service.Book(admin,new("d2","p1",monday,slot.Time,45,Guid.NewGuid().ToString(),svc.Id)),409);
    Reject(()=>f.Service.Book(admin,new("d1","p1",monday,slot.Time,30,Guid.NewGuid().ToString())),400);
    var a=f.Service.Book(admin,new("d1","p1",monday,slot.Time,45,Guid.NewGuid().ToString(),svc.Id)); Equal(svc.Id,a.ServiceId); Equal(svc.Name,a.ServiceName);
    Reject(()=>f.Service.Book(admin,new("d1","p2",monday,slot.Time,45,Guid.NewGuid().ToString(),svc.Id)),409);
    catalog.SaveService(admin,new(svc.Id,"Renamed service",sp.Id,60,false,[],svc.Version));
    Reject(()=>f.Service.Availability(admin,"d1",monday,serviceId:svc.Id),409);
    var next=f.Service.Availability(admin,"d1",monday.AddDays(1),a.Id).First();
    var moved=f.Service.Move(admin,a.Id,new(monday.AddDays(1),next.Time,a.Version)); Equal(45d,(moved.End-moved.Start).TotalMinutes); Equal("Long examination",moved.ServiceName);
    var d=f.Service.Doctors().First(x=>x.Id=="d1"); catalog.SaveDoctor(admin,new(d.Id,d.Name,sp.Id,"",false,d.CatalogVersion));
    Reject(()=>f.Service.Availability(admin,"d1",monday.AddDays(2),a.Id),409);
    Equal(AppointmentStatus.Cancelled,f.Service.ChangeStatus(admin,a.Id,AppointmentStatus.Cancelled,moved.Version).Status);
});
Test("Reports group actual services without assigning legacy appointments", () => {
    using var f=New(); var catalog=new CatalogueService(f.Store);var sp=f.Store.Read(s=>s.Specialties.First());
    f.Service.Book(admin,new("d1","p1",monday,new(8,0),30,Guid.NewGuid().ToString()));
    var svc=catalog.SaveService(admin,new(null,"Consultation",sp.Id,45,true,["d1"]));
    f.Service.Book(admin,new("d1","p2",monday,new(9,30),45,Guid.NewGuid().ToString(),svc.Id));
    var state=f.Store.Read(s=>s); var report=ReportBuilder.Build(admin,new(monday,monday),state,f.Clock);
    Equal(2,report.Summary.Total);Equal(1,report.Services.Single(x=>x.Key==svc.Id).Metrics.Total);Equal(1,report.Services.Single(x=>x.Key=="unassigned").Metrics.Total);
    Equal(1,ReportBuilder.Build(admin,new(monday,monday,ServiceId:svc.Id),state,f.Clock).Summary.Total);
});

Test("History creation is immutable and idempotent", () => {
    using var f=New(); var command=Cmd(); var a=f.Service.Book(pat,command); f.Service.Book(pat,command);
    var history=f.Service.History(pat,a.Id); Equal(true,history.HasCreationRecord); Equal(1,history.Entries.Count);
    var entry=history.Entries.Single(); Equal(AppointmentChangeKind.Created,entry.Kind); Equal(pat.Id,entry.ActorId); Equal(pat.Name,entry.ActorName);
    Equal(DemoRole.Patient,entry.ActorRole); Equal<DateTimeOffset?>(null,entry.BeforeStart); Equal(a.Start,entry.AfterStart); Equal(a.End,entry.AfterEnd);
    Equal(a.Status,entry.AfterStatus); Equal(f.Clock.UtcNow,entry.OccurredAt); Equal(1,entry.AppointmentVersion);
});
Test("Reschedule and cancellation history captures before after and responsible role", () => {
    using var f=New(); var a=f.Service.Book(admin,Cmd()); var moved=f.Service.Move(doc,a.Id,new(monday,new(11,0),a.Version));
    Reject(()=>f.Service.Move(doc,a.Id,new(monday,new(12,0),a.Version)),409);
    f.Service.ChangeStatus(pat,a.Id,AppointmentStatus.Cancelled,moved.Version);
    var history=f.Service.History(admin,a.Id); Equal(3,history.CurrentVersion); Equal(3,history.Entries.Count);
    var move=history.Entries[1]; Equal(AppointmentChangeKind.Rescheduled,move.Kind); Equal(DemoRole.Doctor,move.ActorRole); Equal<DateTimeOffset?>(a.Start,move.BeforeStart); Equal(moved.Start,move.AfterStart);
    var cancel=history.Entries[0]; Equal(DemoRole.Patient,cancel.ActorRole); Equal<AppointmentStatus?>(moved.Status,cancel.BeforeStatus); Equal(AppointmentStatus.Cancelled,cancel.AfterStatus);
    Equal(a.Start,history.Entries[2].AfterStart);
});
Test("History confirms completion and no-show transitions", () => {
    foreach(var outcome in new[]{AppointmentStatus.Completed,AppointmentStatus.NoShow}) {
        using var f=New(); f.Store.Write(s=> { s.Doctors[0]=s.Doctors[0] with {RequiresConfirmation=true}; return true; });
        var a=f.Service.Book(pat,Cmd()); var confirmed=f.Service.ChangeStatus(admin,a.Id,AppointmentStatus.Confirmed,1);
        f.Time.Now=a.End.AddMinutes(1); f.Service.ChangeStatus(doc,a.Id,outcome,confirmed.Version);
        var events=f.Service.History(doc,a.Id).Entries; Equal(3,events.Count); Equal(outcome,events[0].AfterStatus);
        Equal<AppointmentStatus?>(AppointmentStatus.Scheduled,events[1].BeforeStatus); Equal(AppointmentStatus.Confirmed,events[1].AfterStatus);
    }
});
Test("History follows appointment access and does not reveal other patients", () => {
    using var f=New();var a=f.Service.Book(pat,Cmd()); Reject(()=>f.Service.History(other,a.Id),404); Reject(()=>f.Service.History(otherDoc,a.Id),404); Reject(()=>f.Service.History(pat,"missing"),404);
    Equal(1,f.Service.History(doc,a.Id).Entries.Count);Equal(1,f.Service.History(admin,a.Id).Entries.Count);
});
Test("Failed conflicts add no history and saved history survives restart", () => {
    using var f=New();var a=f.Service.Book(pat,Cmd());f.Service.Book(other,Cmd("10:00",patient:"p2"));
    Reject(()=>f.Service.Move(pat,a.Id,new(monday,new(10,0),1)),409); Equal(1,f.Service.History(pat,a.Id).Entries.Count);
    f.Store.Dispose(); using var restored=new JsonDemoStore(f.Path,f.Seed); var service=new AppointmentService(restored,f.Clock);
    Equal(a.Start,service.History(pat,a.Id).Entries.Single().AfterStart);
});
Test("Legacy history is not fabricated when an old appointment is changed", () => {
    using var f=New();var a=f.Service.Book(pat,Cmd());f.Store.Write(s=>{s.AppointmentHistory.Clear();return true;});
    Equal(false,f.Service.History(pat,a.Id).HasCreationRecord);Equal(0,f.Service.History(pat,a.Id).Entries.Count);
    f.Service.Move(admin,a.Id,new(monday,new(11,0),1));var result=f.Service.History(pat,a.Id);
    Equal(false,result.HasCreationRecord);Equal(1,result.Entries.Count);Equal<DateTimeOffset?>(a.Start,result.Entries[0].BeforeStart);
});

Test("Patient profiles scope history by role and protect other patients", () => {
    using var f=New(); f.Service.Book(admin,Cmd()); f.Service.Book(admin,Cmd("11:00",doctor:"d2"));
    Equal(2,f.Service.PatientDetails(admin,"p1").Appointments.Count); Equal(1,f.Service.PatientDetails(doc,"p1").Appointments.Count);
    Equal(2,f.Service.PatientDetails(pat,"p1").Appointments.Count); Equal(false,f.Service.PatientDetails(pat,"p1").CanEdit);
    Equal(true,f.Service.PatientDetails(doc,"p2").CanEdit); Equal(0,f.Service.PatientDetails(doc,"p2").Appointments.Count);
    Reject(()=>f.Service.PatientDetails(other,"p1"),404); Reject(()=>f.Service.PatientDetails(admin,"missing"),404);
});
Test("Staff edit normalized patient contacts without changing identity or appointments", () => {
    using var f=New();var a=f.Service.Book(admin,Cmd());
    var updated=f.Service.UpdatePatient(doc,"p1",new(" Updated Name "," NEW@EXAMPLE.TEST "," +389 70 123 ",1));
    Equal("Updated Name",updated.Name);Equal("new@example.test",updated.Email);Equal("+389 70 123",updated.Phone);Equal(2,updated.Version);Equal(true,updated.IsDemonstration);
    Equal(a.Id,f.Service.PatientDetails(pat,"p1").Appointments.Single().Id);Equal("Patient",pat.Name);
    Reject(()=>f.Service.UpdatePatient(pat,"p1",new("Forbidden","","",2)),403);
    Reject(()=>f.Service.UpdatePatient(admin,"missing",new("Name","","",1)),404);
});
Test("Patient contact updates validate fields and prevent duplicates", () => {
    using var f=New();
    foreach(var command in new PatientUpdateCommand[]{new(" ","","",1),new(new string('x',81),"","",1),new("Name","bad email","",1),new("Name","", "phone!",1),new("Name","",new string('1',31),1)})
        Reject(()=>f.Service.UpdatePatient(admin,"p1",command));
    Reject(()=>f.Service.UpdatePatient(admin,"p1",new("Name","TWO@EXAMPLE.TEST","",1)),409);
    Equal(1,f.Service.PatientDetails(admin,"p1").Patient.Version);
    var a=f.Service.UpdatePatient(admin,"p1",new("Name",null,null,1));Equal("",a.Email);Equal("",a.Phone);
    var b=f.Service.UpdatePatient(admin,"p2",new("Name",null,null,1));Equal("",b.Email);
});
Test("Concurrent patient edits save exactly once and survive JSON restart", () => {
    using var f=New();var results=new ConcurrentBag<int>();
    Parallel.For(0,8,i=>{try{f.Service.UpdatePatient(admin,"p1",new("Editor "+i,"","",1));results.Add(200);}catch(RuleException e){results.Add(e.StatusCode);}});
    Equal(1,results.Count(x=>x==200));Equal(7,results.Count(x=>x==409));
    var saved=f.Service.PatientDetails(admin,"p1").Patient;
    f.Store.Dispose();using var restored=new JsonDemoStore(f.Path,f.Seed);var service=new AppointmentService(restored,f.Clock);
    Equal(saved,service.PatientDetails(admin,"p1").Patient);
    Reject(()=>service.UpdatePatient(admin,"p1",new("Stale","","",1)),409);
});

var failed=0;
foreach(var (name,run) in tests){try{run();Console.WriteLine("PASS "+name);}catch(Exception e){failed++;Console.WriteLine("FAIL "+name+" :: "+e.Message);}}
Console.WriteLine($"\n{tests.Count-failed}/{tests.Count} tests passed; {failed} failed.");
return failed==0?0:1;

sealed class FakeTime : TimeProvider
{
    public DateTimeOffset Now {get;set;}=new(2026,9,20,0,0,0,TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow()=>Now;
}
sealed class Fixture : IDisposable
{
    public string Path {get;}=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"careline-tests",Guid.NewGuid().ToString(),"demo-state.json");
    public FakeTime Time {get;}=new();
    public SchedulingClock Clock {get;}
    public JsonDemoStore Store {get;}
    public IAppointmentService Service {get;}
    public Fixture(){Clock=new(Time,"Europe/Skopje");Store=new(Path,Seed);Service=new AppointmentService(Store,Clock);}
    public DemoState Seed()=>new(){Doctors=[MakeDoctor("d1"),MakeDoctor("d2")],Patients=[new("p1","Demo One","one@example.test",""),new("p2","Demo Two","two@example.test","")]};
    private static Doctor MakeDoctor(string id)=>new(){Id=id,Name=id,Specialty="Demo specialty",WorkingPeriods=Enumerable.Range(1,5).Select(day=>new WorkingPeriod((DayOfWeek)day,new(8,0),new(17,0))).ToList()};
    public void Dispose(){Store.Dispose();var dir=System.IO.Path.GetDirectoryName(Path)!;if(Directory.Exists(dir))Directory.Delete(dir,true);}
}
