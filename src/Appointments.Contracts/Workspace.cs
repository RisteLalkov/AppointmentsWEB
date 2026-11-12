using Appointments.Core;

namespace Appointments.Contracts;

// Workspace collections are pages, never an implicit export of the clinic's history.
public sealed class WorkspaceQuery
{
    public int Skip { get; set; }
    public int Take { get; set; } = 12;
    public string? Search { get; set; }
    public string? LocateId { get; set; }
    public string? Period { get; set; }
    public string? DoctorId { get; set; }
    public string? PatientId { get; set; }
    public string? ServiceId { get; set; }
    public AppointmentStatus? Status { get; set; }
    public bool Overlap { get; set; }
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
}
public record WorkspaceOverview(int TodayCount, int UpcomingCount, int PendingCount, int ClosedCount, IReadOnlyList<int> WeekCounts);
public record WorkspacePatientPage(IReadOnlyList<Patient> Items, int Total, int? LocatedSkip = null);
public record WorkspaceAppointmentPage(IReadOnlyList<Appointment> Items, IReadOnlyList<Patient> Patients, int Total);
public record WorkspaceAppointmentDetails(Appointment Appointment, Patient Patient);
public record PatientHistoryCounts(int Upcoming, int Completed, int Cancelled, int NoShow);
public record WorkspacePatientDetails(Patient Patient, IReadOnlyList<Appointment> Appointments, int Total, bool CanEdit, PatientHistoryCounts Counts);
