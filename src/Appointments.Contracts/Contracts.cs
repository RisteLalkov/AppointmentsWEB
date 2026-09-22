using System.ComponentModel.DataAnnotations;
using Appointments.Core;

namespace Appointments.Contracts;

public record BootstrapResponse(DemoActor Actor, IReadOnlyList<Doctor> Doctors, IReadOnlyList<Patient> Patients,
    IReadOnlyList<Appointment> Appointments, string Today, string LocalNow, string TimeZone, DateTimeOffset UtcNow,
    bool DemoMode = false, bool CanReset = false, string Backend = "Api");
public record StatusInput(AppointmentStatus Status, int Version);
public record PatientInput([Required, StringLength(80, MinimumLength = 2)] string Name, string? Email, string? Phone);
public record ScheduleInput([Required] List<WorkingPeriod> Periods, int DurationMinutes, int? Version = null);
public record ExceptionInput(DateOnly Date, TimeOnly Start, TimeOnly End, bool IsAvailable, [Required, StringLength(120, MinimumLength = 2)] string Reason);
public record LoginInput([Required, EmailAddress, StringLength(120)] string Email, [Required, StringLength(128)] string Password);
public record RegisterInput([Required, StringLength(80, MinimumLength = 2)] string Name, [Required, EmailAddress, StringLength(120)] string Email, [Required, StringLength(128)] string Password);
public record ChangePasswordInput([Required] string CurrentPassword, [Required] string NewPassword);
public record SessionResponse(string AccessToken, DateTimeOffset ExpiresAt, DemoActor Actor, bool DemoMode);
public record AccountInput([Required, EmailAddress, StringLength(120)] string Email, [Required, StringLength(80, MinimumLength = 2)] string Name, DemoRole Role,
    string? DoctorId, string? PatientId, [Required, StringLength(128)] string Password);
public record AccountSummary(string Id, string Email, string Name, DemoRole Role, string? DoctorId, string? PatientId, bool Enabled);
public record AccountAccessInput(bool Enabled);
