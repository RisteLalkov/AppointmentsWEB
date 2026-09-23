using System.Text.Json;

namespace Appointments.Core;

public static class DemoSeed
{
    public static DemoState Create(string doctorJson, SchedulingClock clock)
    {
        var state = new DemoState
        {
            TimeZoneId = clock.Zone.Id,
            Doctors = JsonSerializer.Deserialize<List<Doctor>>(doctorJson, JsonDemoStore.JsonOptions)!,
            Patients = [new("p01", "Ана Петрова (демо)", "ana@example.test", ""), new("p02", "Марко Николов (демо)", "marko@example.test", ""),
                new("p03", "Елена Стојанова (демо)", "elena@example.test", ""), new("p04", "Давид Иванов (демо)", "david@example.test", ""),
                new("p05", "Сара Димитрова (демо)", "sara@example.test", ""), new("p06", "Никола Петров (демо)", "nikola@example.test", "")]
        };
        // Relative dates keep a fresh demo useful. No clinical records or notes are seeded.
        for (var offset = -7; offset <= 10; offset++)
        {
            var date = clock.Today.AddDays(offset);
            foreach (var doctor in state.Doctors.Where(d => d.WorkingPeriods.Count > 0))
            {
                var slots = SchedulingRules.Slots(state, doctor, date, clock, includePast: offset < 0);
                if (slots.Count == 0) continue;
                var slot = slots[Math.Min(2, slots.Count - 1)];
                var patient = state.Patients.FirstOrDefault(p => !state.Appointments.Any(a => a.PatientId == p.Id && SchedulingRules.Overlaps(a.Start, a.End, slot.Start, slot.End)));
                if (patient is null) continue;
                state.Appointments.Add(new Appointment { DoctorId = doctor.Id, PatientId = patient.Id, Start = slot.Start, End = slot.End,
                    Status = offset < 0 ? (offset == -2 ? AppointmentStatus.NoShow : AppointmentStatus.Completed) : doctor.RequiresConfirmation ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed,
                    UpdatedAt = clock.UtcNow });
            }
        }
        return state;
    }
    public static List<DemoActor> Actors(IEnumerable<Doctor> doctors, IEnumerable<Patient> patients) =>
        [new("admin", "Алекс • Рецепција", DemoRole.Administrator),
         ..patients.Select(p => new DemoActor(p.Id, p.Name, DemoRole.Patient, PatientId: p.Id)),
         ..doctors.Where(d => !d.IsService).Select(d => new DemoActor("user-" + d.Id, d.Name, DemoRole.Doctor, d.Id))];
}
