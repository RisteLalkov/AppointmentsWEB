using System.Net.Mail;

namespace Appointments.Core;

public sealed class AppointmentService(IDemoStore store, SchedulingClock clock) : IAppointmentService
{
    private static Doctor FindDoctor(DemoState s, string id) => s.Doctors.FirstOrDefault(d => d.Id == id) ?? throw new RuleException("Лекарот не е пронајден.", 404);
    private static Appointment FindAppointment(DemoState s, string id) => s.Appointments.FirstOrDefault(a => a.Id == id) ?? throw new RuleException("Терминот не е пронајден.", 404);
    private static bool CanSee(DemoActor actor, Appointment a) => actor.Role == DemoRole.Administrator ||
        (actor.Role == DemoRole.Doctor && actor.DoctorId == a.DoctorId) || (actor.Role == DemoRole.Patient && actor.PatientId == a.PatientId);
    private static void CheckAccess(DemoActor actor, Appointment a) { if (!CanSee(actor, a)) throw new RuleException("Вашата сметка нема пристап до овој термин.", 403); }
    private static void Staff(DemoActor actor, string? doctorId = null)
    {
        if (actor.Role == DemoRole.Patient || (actor.Role == DemoRole.Doctor && doctorId != null && actor.DoctorId != doctorId))
            throw new RuleException("Оваа постапка не е достапна за вашата улога.", 403);
    }
    private static void Version(Appointment a, int version) { if (a.Version != version) throw new RuleException("Терминот е променет во друг прозорец. Освежете и обидете се повторно.", 409); }
    private void Editable(Appointment a)
    {
        if (a.Status is not (AppointmentStatus.Scheduled or AppointmentStatus.Confirmed)) throw new RuleException("Овој термин е затворен и не може да се менува.");
        if (a.Start <= clock.UtcNow) throw new RuleException("Изминати термини не може да се презакажат или откажат.");
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
            if (existing.DoctorId != doctorId) throw new RuleException("За презакажување изберете го првично избраниот лекар.");
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
        if (actor.Role == DemoRole.Patient && (actor.PatientId != command.PatientId || doctor.StaffOnly)) throw new RuleException("Овој термин се закажува преку рецепција или му припаѓа на друг пациент.", 403);
        if (!s.Patients.Any(p => p.Id == command.PatientId)) throw new RuleException("Изберете важечки пациент.");
        if (!Guid.TryParse(command.RequestId, out _)) throw new RuleException("Потребен е важечки идентификатор на барањето. Повторно отворете го формуларот за закажување.");
        var duplicate = s.Appointments.FirstOrDefault(a => a.RequestId == command.RequestId && a.CreatedBy == actor.Id);
        if (duplicate != null)
        {
            if (duplicate.DoctorId != command.DoctorId || duplicate.PatientId != command.PatientId || clock.Local(duplicate.Start) != command.Date.ToDateTime(command.Time))
                throw new RuleException("Ова барање веќе е употребено. Повторно отворете го формуларот за закажување.", 409);
            return duplicate;
        }
        if (command.DurationMinutes != doctor.DurationMinutes) throw new RuleException("Времетраењето на прегледот е променето. Освежете ги слободните термини.", 409);
        var slot = SchedulingRules.Slots(s, doctor, command.Date, clock).FirstOrDefault(x => x.Time == command.Time)
            ?? throw new RuleException("Тој термин повеќе не е достапен. Изберете друг термин во следните 180 дена.", 409);
        CheckPatientConflict(s, command.PatientId, slot);
        var appointment = new Appointment { DoctorId = doctor.Id, PatientId = command.PatientId, Start = slot.Start, End = slot.End,
            Status = doctor.RequiresConfirmation ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed,
            CreatedBy = actor.Id, RequestId = command.RequestId, UpdatedAt = clock.UtcNow };
        s.Appointments.Add(appointment); return appointment;
    });
    private static void CheckPatientConflict(DemoState s, string patientId, Slot slot, string? excludeId = null)
    {
        if (s.Appointments.Any(a => a.Id != excludeId && a.PatientId == patientId && SchedulingRules.Active(a) && SchedulingRules.Overlaps(a.Start, a.End, slot.Start, slot.End)))
            throw new RuleException("Овој пациент веќе има закажан преглед во тоа време.", 409);
    }
    public Appointment Move(DemoActor actor, string id, MoveCommand command) => store.Write(s =>
    {
        var a = FindAppointment(s, id); CheckAccess(actor, a); Version(a, command.Version); Editable(a);
        var doctor = FindDoctor(s, a.DoctorId);
        if (actor.Role == DemoRole.Patient && doctor.StaffOnly) throw new RuleException("Контактирајте ја рецепцијата за презакажување на овој термин.", 403);
        var slot = SchedulingRules.Slots(s, doctor, command.Date, clock, id).FirstOrDefault(x => x.Time == command.Time)
            ?? throw new RuleException("Тој термин е недостапен. Вашиот првичен термин е задржан.", 409);
        CheckPatientConflict(s, a.PatientId, slot, id);
        a.Start = slot.Start; a.End = slot.End; a.Status = doctor.RequiresConfirmation ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed;
        a.Version++; a.UpdatedAt = clock.UtcNow; return a;
    });
    public Appointment ChangeStatus(DemoActor actor, string id, AppointmentStatus status, int version) => store.Write(s =>
    {
        var a = FindAppointment(s, id); CheckAccess(actor, a); Version(a, version);
        if (actor.Role == DemoRole.Patient && status != AppointmentStatus.Cancelled) throw new RuleException("Пациентите може да ги откажат само сопствените претстојни термини.", 403);
        if (status == AppointmentStatus.Cancelled) Editable(a);
        else
        {
            Staff(actor, a.DoctorId);
            var valid = (a.Status == AppointmentStatus.Scheduled && status == AppointmentStatus.Confirmed && a.Start > clock.UtcNow)
                || (a.Status == AppointmentStatus.Confirmed && status is AppointmentStatus.Completed or AppointmentStatus.NoShow && a.End <= clock.UtcNow);
            if (!valid) throw new RuleException("Невалидна промена на статус. Потврдете претстојно барање; означете завршен преглед или недоаѓање само по крајот на потврдениот термин.");
        }
        a.Status = status; a.Version++; a.UpdatedAt = clock.UtcNow; return a;
    });
    public Patient AddPatient(DemoActor actor, string name, string email, string phone)
    {
        Staff(actor); name = name.Trim(); email = email.Trim(); phone = phone.Trim();
        if (name.Length is < 2 or > 80) throw new RuleException("Внесете име со должина од 2 до 80 знаци.");
        if (email.Length > 120 || (email.Length > 0 && (!MailAddress.TryCreate(email, out var address) || address.Address != email))) throw new RuleException("Внесете важечка е-пошта или оставете го полето празно.");
        if (phone.Length > 30 || phone.Any(c => !char.IsAsciiDigit(c) && !"+ -()".Contains(c))) throw new RuleException("Внесете важечки телефонски број или оставете го полето празно.");
        return store.Write(s =>
        {
            if (email.Length > 0 && s.Patients.Any(p => p.Email.Equals(email, StringComparison.OrdinalIgnoreCase))) throw new RuleException("Веќе постои пациент со оваа е-пошта.", 409);
            var patient = new Patient(Guid.NewGuid().ToString("N"), name, email, phone); s.Patients.Add(patient); return patient;
        });
    }
    public void ReplaceSchedule(DemoActor actor, string doctorId, List<WorkingPeriod> periods, int durationMinutes)
    {
        Staff(actor, doctorId);
        if (durationMinutes is < 10 or > 120 || durationMinutes % 5 != 0) throw new RuleException("Изберете времетраење од 10 до 120 минути, во чекори од 5 минути.");
        if (periods.Count > 21 || periods.Any(p => p == null || !Enum.IsDefined(p.Day) || p.Start >= p.End || p.Start.Second != 0 || p.End.Second != 0 || (p.End - p.Start).TotalMinutes < durationMinutes)) throw new RuleException("Секој работен период мора да овозможува цел преглед и да завршува истиот ден.");
        if (periods.Any(p => periods.Any(q => !ReferenceEquals(p, q) && p.Day == q.Day && p.Start < q.End && q.Start < p.End))) throw new RuleException("Работните периоди не смеат да се преклопуваат.");
        store.Write(s =>
        {
            var doctor = FindDoctor(s, doctorId); doctor.WorkingPeriods = periods; doctor.DurationMinutes = durationMinutes;
            ProtectBookings(s, doctor); doctor.DemoScheduleEdited = true; doctor.ScheduleVersion++; return true;
        });
    }
    private void ProtectBookings(DemoState s, Doctor doctor)
    {
        if (s.Appointments.Any(a => a.DoctorId == doctor.Id && SchedulingRules.Active(a) && a.End > clock.UtcNow && !SchedulingRules.FitsSchedule(s, doctor, a, clock)))
            throw new RuleException("Оваа промена на достапноста се преклопува со постоечки термин. Прво презакажете го или откажете го.", 409);
    }
    public AvailabilityException AddException(DemoActor actor, string doctorId, DateOnly date, TimeOnly start, TimeOnly end, bool isAvailable, string reason)
    {
        Staff(actor, doctorId); reason = reason.Trim();
        if (date < clock.Today || date > clock.Today.AddDays(180) || start >= end) throw new RuleException("Изберете датум од денес до следните 180 дена и важечки временски период во истиот ден.");
        if (reason.Length is < 2 or > 120) throw new RuleException("Внесете причина со должина од 2 до 120 знаци. Не внесувајте медицински податоци.");
        return store.Write(s =>
        {
            var doctor = FindDoctor(s, doctorId);
            var exception = new AvailabilityException(Guid.NewGuid().ToString("N"), doctorId, date, start, end, isAvailable, reason);
            s.Exceptions.Add(exception); ProtectBookings(s, doctor); return exception;
        });
    }
    public void RemoveException(DemoActor actor, string id) => store.Write(s =>
    {
        var e = s.Exceptions.FirstOrDefault(e => e.Id == id) ?? throw new RuleException("Исклучокот не е пронајден.", 404);
        Staff(actor, e.DoctorId); s.Exceptions.Remove(e); ProtectBookings(s, FindDoctor(s, e.DoctorId)); return true;
    });
    public void Reset(DemoActor actor)
    { if (actor.Role != DemoRole.Administrator) throw new RuleException("Само демо-администраторот може да ги ресетира податоците.", 403); store.Reset(); }
}
