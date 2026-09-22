using System.Net.Mail;

namespace Appointments.Core;

public sealed class AppointmentService(IDemoStore store, SchedulingClock clock) : IAppointmentService
{
    private static Doctor FindDoctor(DemoState s, string id) => s.Doctors.FirstOrDefault(d => d.Id == id) ?? throw new RuleException("Doctor not found.", 404);
    private static Appointment FindAppointment(DemoState s, string id) => s.Appointments.FirstOrDefault(a => a.Id == id) ?? throw new RuleException("Appointment not found.", 404);
    private static bool CanSee(DemoActor actor, Appointment a) => actor.Role == DemoRole.Administrator ||
        (actor.Role == DemoRole.Doctor && actor.DoctorId == a.DoctorId) || (actor.Role == DemoRole.Patient && actor.PatientId == a.PatientId);
    private static void CheckAccess(DemoActor actor, Appointment a) { if (!CanSee(actor, a)) throw new RuleException("This appointment is not accessible to your account.", 403); }
    private static void Staff(DemoActor actor, string? doctorId = null)
    {
        if (actor.Role == DemoRole.Patient || (actor.Role == DemoRole.Doctor && doctorId != null && actor.DoctorId != doctorId))
            throw new RuleException("This action is not available for your role.", 403);
    }
    private static void Version(Appointment a, int version) { if (a.Version != version) throw new RuleException("This appointment changed in another window. Refresh and try again.", 409); }
    private void Editable(Appointment a)
    {
        if (a.Status is not (AppointmentStatus.Scheduled or AppointmentStatus.Confirmed)) throw new RuleException("This appointment is closed and cannot be changed.");
        if (a.Start <= clock.UtcNow) throw new RuleException("Past appointments cannot be rescheduled or cancelled.");
    }
    public IReadOnlyList<Doctor> Doctors() => store.Read(s => s.Doctors);
    public IReadOnlyList<Patient> Patients(DemoActor actor) => store.Read(s => s.Patients.Where(p => actor.Role != DemoRole.Patient || actor.PatientId == p.Id).ToList());
    public IReadOnlyList<Appointment> Appointments(DemoActor actor) => store.Read(s => s.Appointments.Where(a => CanSee(actor, a)).OrderBy(a => a.Start).ToList());
    public IReadOnlyList<AvailabilityException> Exceptions(DemoActor actor, string doctorId)
    { Staff(actor, doctorId); return store.Read(s => s.Exceptions.Where(e => e.DoctorId == doctorId).ToList()); }
    public IReadOnlyList<Slot> Availability(DemoActor actor, string doctorId, DateOnly date, string? excludeId = null) => store.Read(s =>
    {
        var doctor = FindDoctor(s, doctorId);
        if (actor.Role == DemoRole.Doctor) Staff(actor, doctorId);
        if (actor.Role == DemoRole.Patient && doctor.StaffOnly) return [];
        if (excludeId != null)
        {
            var existing = FindAppointment(s, excludeId); CheckAccess(actor, existing); Editable(existing);
            if (existing.DoctorId != doctorId) throw new RuleException("Select the original doctor for rescheduling.");
        }
        var slots = SchedulingRules.Slots(s, doctor, date, clock, excludeId);
        if (actor.Role == DemoRole.Patient)
            slots = slots.Where(slot => !s.Appointments.Any(a => a.Id != excludeId && a.PatientId == actor.PatientId && SchedulingRules.Active(a) && SchedulingRules.Overlaps(a.Start, a.End, slot.Start, slot.End))).ToList();
        return slots;
    });
    public Appointment Book(DemoActor actor, BookingCommand command) => store.Write(s =>
    {
        var doctor = FindDoctor(s, command.DoctorId);
        if (actor.Role == DemoRole.Doctor) Staff(actor, doctor.Id);
        if (actor.Role == DemoRole.Patient && (actor.PatientId != command.PatientId || doctor.StaffOnly)) throw new RuleException("This booking requires reception, or belongs to a different patient.", 403);
        if (!s.Patients.Any(p => p.Id == command.PatientId)) throw new RuleException("Select a valid patient.");
        if (!Guid.TryParse(command.RequestId, out _)) throw new RuleException("A valid booking request identifier is required.");
        var duplicate = s.Appointments.FirstOrDefault(a => a.RequestId == command.RequestId && a.CreatedBy == actor.Id);
        if (duplicate != null)
        {
            if (duplicate.DoctorId != command.DoctorId || duplicate.PatientId != command.PatientId || clock.Local(duplicate.Start) != command.Date.ToDateTime(command.Time))
                throw new RuleException("This request identifier was already used. Reopen the booking form.", 409);
            return duplicate;
        }
        if (command.DurationMinutes != doctor.DurationMinutes) throw new RuleException("Appointment duration changed. Refresh the available times.", 409);
        var slot = SchedulingRules.Slots(s, doctor, command.Date, clock).FirstOrDefault(x => x.Time == command.Time)
            ?? throw new RuleException("That time is no longer available. Choose another slot within the next 180 days.", 409);
        CheckPatientConflict(s, command.PatientId, slot);
        var appointment = new Appointment { DoctorId = doctor.Id, PatientId = command.PatientId, Start = slot.Start, End = slot.End,
            Status = doctor.RequiresConfirmation ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed,
            CreatedBy = actor.Id, RequestId = command.RequestId, UpdatedAt = clock.UtcNow };
        s.Appointments.Add(appointment); return appointment;
    });
    private static void CheckPatientConflict(DemoState s, string patientId, Slot slot, string? excludeId = null)
    {
        if (s.Appointments.Any(a => a.Id != excludeId && a.PatientId == patientId && SchedulingRules.Active(a) && SchedulingRules.Overlaps(a.Start, a.End, slot.Start, slot.End)))
            throw new RuleException("This patient already has an appointment at that time.", 409);
    }
    public Appointment Move(DemoActor actor, string id, MoveCommand command) => store.Write(s =>
    {
        var a = FindAppointment(s, id); CheckAccess(actor, a); Version(a, command.Version); Editable(a);
        var doctor = FindDoctor(s, a.DoctorId);
        if (actor.Role == DemoRole.Patient && doctor.StaffOnly) throw new RuleException("Please contact reception to reschedule this appointment.", 403);
        var slot = SchedulingRules.Slots(s, doctor, command.Date, clock, id).FirstOrDefault(x => x.Time == command.Time)
            ?? throw new RuleException("That time is unavailable. Your original appointment has been kept.", 409);
        CheckPatientConflict(s, a.PatientId, slot, id);
        a.Start = slot.Start; a.End = slot.End; a.Status = doctor.RequiresConfirmation ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed;
        a.Version++; a.UpdatedAt = clock.UtcNow; return a;
    });
    public Appointment ChangeStatus(DemoActor actor, string id, AppointmentStatus status, int version) => store.Write(s =>
    {
        var a = FindAppointment(s, id); CheckAccess(actor, a); Version(a, version);
        if (actor.Role == DemoRole.Patient && status != AppointmentStatus.Cancelled) throw new RuleException("Patients can only cancel their own upcoming appointments.", 403);
        if (status == AppointmentStatus.Cancelled) Editable(a);
        else
        {
            Staff(actor, a.DoctorId);
            var valid = (a.Status == AppointmentStatus.Scheduled && status == AppointmentStatus.Confirmed && a.Start > clock.UtcNow)
                || (a.Status == AppointmentStatus.Confirmed && status is AppointmentStatus.Completed or AppointmentStatus.NoShow && a.End <= clock.UtcNow);
            if (!valid) throw new RuleException("Invalid status change. Confirm upcoming requests; complete or mark no-show only after a confirmed visit ends.");
        }
        a.Status = status; a.Version++; a.UpdatedAt = clock.UtcNow; return a;
    });
    public Patient AddPatient(DemoActor actor, string name, string email, string phone)
    {
        Staff(actor); name = name.Trim(); email = email.Trim(); phone = phone.Trim();
        if (name.Length is < 2 or > 80) throw new RuleException("Enter a name between 2 and 80 characters.");
        if (email.Length > 120 || (email.Length > 0 && (!MailAddress.TryCreate(email, out var address) || address.Address != email))) throw new RuleException("Enter a valid email, or leave it empty.");
        if (phone.Length > 30 || phone.Any(c => !char.IsAsciiDigit(c) && !"+ -()".Contains(c))) throw new RuleException("Enter a valid phone number, or leave it empty.");
        return store.Write(s =>
        {
            if (email.Length > 0 && s.Patients.Any(p => p.Email.Equals(email, StringComparison.OrdinalIgnoreCase))) throw new RuleException("A patient with this email already exists.", 409);
            var patient = new Patient(Guid.NewGuid().ToString("N"), name, email, phone); s.Patients.Add(patient); return patient;
        });
    }
    public void ReplaceSchedule(DemoActor actor, string doctorId, List<WorkingPeriod> periods, int durationMinutes)
    {
        Staff(actor, doctorId);
        if (durationMinutes is < 10 or > 120 || durationMinutes % 5 != 0) throw new RuleException("Use a duration of 10–120 minutes in 5-minute increments.");
        if (periods.Count > 21 || periods.Any(p => p == null || !Enum.IsDefined(p.Day) || p.Start >= p.End || p.Start.Second != 0 || p.End.Second != 0 || (p.End - p.Start).TotalMinutes < durationMinutes)) throw new RuleException("Each working period must fit a full appointment and end on the same day.");
        if (periods.Any(p => periods.Any(q => !ReferenceEquals(p, q) && p.Day == q.Day && p.Start < q.End && q.Start < p.End))) throw new RuleException("Working periods must not overlap.");
        store.Write(s =>
        {
            var doctor = FindDoctor(s, doctorId); doctor.WorkingPeriods = periods; doctor.DurationMinutes = durationMinutes;
            ProtectBookings(s, doctor); doctor.DemoScheduleEdited = true; doctor.ScheduleVersion++; return true;
        });
    }
    private void ProtectBookings(DemoState s, Doctor doctor)
    {
        if (s.Appointments.Any(a => a.DoctorId == doctor.Id && SchedulingRules.Active(a) && a.End > clock.UtcNow && !SchedulingRules.FitsSchedule(s, doctor, a, clock)))
            throw new RuleException("This availability change conflicts with an existing appointment. Reschedule or cancel it first.", 409);
    }
    public AvailabilityException AddException(DemoActor actor, string doctorId, DateOnly date, TimeOnly start, TimeOnly end, bool isAvailable, string reason)
    {
        Staff(actor, doctorId); reason = reason.Trim();
        if (date < clock.Today || date > clock.Today.AddDays(180) || start >= end) throw new RuleException("Choose a future date within 180 days and a valid same-day time range.");
        if (reason.Length is < 2 or > 120) throw new RuleException("Enter a reason between 2 and 120 characters. Do not include medical details.");
        return store.Write(s =>
        {
            var doctor = FindDoctor(s, doctorId);
            var exception = new AvailabilityException(Guid.NewGuid().ToString("N"), doctorId, date, start, end, isAvailable, reason);
            s.Exceptions.Add(exception); ProtectBookings(s, doctor); return exception;
        });
    }
    public void RemoveException(DemoActor actor, string id) => store.Write(s =>
    {
        var e = s.Exceptions.FirstOrDefault(e => e.Id == id) ?? throw new RuleException("Exception not found.", 404);
        Staff(actor, e.DoctorId); s.Exceptions.Remove(e); ProtectBookings(s, FindDoctor(s, e.DoctorId)); return true;
    });
    public void Reset(DemoActor actor)
    { if (actor.Role != DemoRole.Administrator) throw new RuleException("Only the demo administrator can reset data.", 403); store.Reset(); }
}
