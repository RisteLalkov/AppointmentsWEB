namespace Appointments.Core;

public sealed class BookingPolicy
{
    public int MaxFutureAppointments { get; init; } = 3;
    public int MaxPendingPerDoctorPerDay { get; init; } = 1;
    public void Check(DemoActor actor, IEnumerable<Appointment> appointments, string patientId, string doctorId,
        DateTimeOffset start, AppointmentStatus status, SchedulingClock clock, string? excludeId = null)
    {
        if (actor.Role != DemoRole.Patient) return; // Staff can authorize legitimate additional visits.
        var future = appointments.Where(a => a.Id != excludeId && a.PatientId == patientId &&
            a.End > clock.UtcNow && a.Status is AppointmentStatus.Scheduled or AppointmentStatus.Confirmed).ToList();
        if (future.Count >= MaxFutureAppointments)
            throw new RuleException("Го достигнавте лимитот за претстојни термини. За дополнителен преглед контактирајте ја рецепцијата.", 409);
        if (status == AppointmentStatus.Scheduled && future.Count(a => a.DoctorId == doctorId &&
            a.Status == AppointmentStatus.Scheduled && clock.Local(a.Start).Date == clock.Local(start).Date) >= MaxPendingPerDoctorPerDay)
            throw new RuleException("Веќе имате барање што чека потврда кај овој лекар на избраниот ден. За дополнителен термин контактирајте ја рецепцијата.", 409);
    }
}
