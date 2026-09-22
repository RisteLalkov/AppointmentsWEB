namespace Appointments.Core;

public enum DemoRole { Patient, Administrator, Doctor }
public enum AppointmentStatus { Scheduled, Confirmed, Completed, Cancelled, NoShow }
public record DemoActor(string Id, string Name, DemoRole Role, string? DoctorId = null, string? PatientId = null);
public record WorkingPeriod(DayOfWeek Day, TimeOnly Start, TimeOnly End);
public record SourceSchedule(int Row, string Days, string Start, string End, string Type, string Note);
public record Doctor
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Specialty { get; init; }
    public string BookingMethod { get; init; } = "";
    public string Funding { get; init; } = "Not specified";
    public bool IsService { get; init; }
    public bool RequiresConfirmation { get; init; }
    public bool StaffOnly { get; init; }
    public bool TuesdayFirst { get; init; }
    public int DurationMinutes { get; set; } = 30;
    public List<WorkingPeriod> WorkingPeriods { get; set; } = [];
    public List<SourceSchedule> SourceSchedules { get; init; } = [];
    public bool DemoScheduleEdited { get; set; }
    public int ScheduleVersion { get; set; } = 1;
}
public record Patient(string Id, string Name, string Email, string Phone, bool IsDemonstration = true);
public record AvailabilityException(string Id, string DoctorId, DateOnly Date, TimeOnly Start, TimeOnly End, bool IsAvailable, string Reason);
public record Appointment
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public required string DoctorId { get; init; }
    public required string PatientId { get; init; }
    public required DateTimeOffset Start { get; set; }
    public required DateTimeOffset End { get; set; }
    public AppointmentStatus Status { get; set; }
    public int Version { get; set; } = 1;
    public string CreatedBy { get; init; } = "demo-seed";
    public DateTimeOffset UpdatedAt { get; set; }
    public string RequestId { get; init; } = Guid.NewGuid().ToString("N");
}
public record Slot(DateOnly Date, TimeOnly Time, DateTimeOffset Start, DateTimeOffset End);
public record BookingCommand(string DoctorId, string PatientId, DateOnly Date, TimeOnly Time, int DurationMinutes, string RequestId);
public record MoveCommand(DateOnly Date, TimeOnly Time, int Version);
public sealed class DemoState
{
    public int SchemaVersion { get; set; } = 1;
    public string TimeZoneId { get; set; } = "Europe/Skopje";
    public List<Doctor> Doctors { get; set; } = [];
    public List<Patient> Patients { get; set; } = [];
    public List<AvailabilityException> Exceptions { get; set; } = [];
    public List<Appointment> Appointments { get; set; } = [];
}
public sealed class RuleException(string message, int statusCode = 400) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
public interface IDemoStore
{
    T Read<T>(Func<DemoState, T> query);
    T Write<T>(Func<DemoState, T> change);
    void Reset();
}
public interface IAppointmentService
{
    IReadOnlyList<Doctor> Doctors();
    IReadOnlyList<Patient> Patients(DemoActor actor);
    IReadOnlyList<Appointment> Appointments(DemoActor actor);
    IReadOnlyList<AvailabilityException> Exceptions(DemoActor actor, string doctorId);
    IReadOnlyList<Slot> Availability(DemoActor actor, string doctorId, DateOnly date, string? excludeId = null);
    Appointment Book(DemoActor actor, BookingCommand command);
    Appointment Move(DemoActor actor, string id, MoveCommand command);
    Appointment ChangeStatus(DemoActor actor, string id, AppointmentStatus status, int version);
    Patient AddPatient(DemoActor actor, string name, string email, string phone);
    void ReplaceSchedule(DemoActor actor, string doctorId, List<WorkingPeriod> periods, int durationMinutes);
    AvailabilityException AddException(DemoActor actor, string doctorId, DateOnly date, TimeOnly start, TimeOnly end, bool isAvailable, string reason);
    void RemoveException(DemoActor actor, string id);
    void Reset(DemoActor actor);
}
