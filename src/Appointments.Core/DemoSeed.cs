using System.Text.Json;

namespace Appointments.Core;

public static class DemoSeed
{
    private static readonly string[] Names = ["Ана Петрова", "Марко Николов", "Елена Стојанова", "Давид Иванов", "Сара Димитрова", "Никола Петров", "Марија Трајкова", "Стефан Ангелов", "Ивана Поповска", "Александар Костов", "Теодора Наумова", "Мартин Ристов", "Катерина Јовановска", "Филип Стојанов", "Симона Митревска", "Бојан Спасов", "Јована Георгиева", "Андреј Николовски", "Анастасија Димова", "Петар Велков", "Леона Тасевска", "Даниел Илиев", "Мила Крстевска", "Дејан Павлов", "Викторија Здравкова", "Горан Трајчев", "Билјана Младеновска", "Зоран Колев", "Наташа Дамјановска", "Дарко Соколов", "Софија Јовевска", "Кристијан Попов"];
    public static DemoState Create(string doctorJson, SchedulingClock clock)
    {
        var state = new DemoState
        {
            TimeZoneId = clock.Zone.Id,
            Doctors = JsonSerializer.Deserialize<List<Doctor>>(doctorJson, JsonDemoStore.JsonOptions)!,
            Patients = Names.Select((name, i) => new Patient($"p{i+1:00}", name, $"patient{i+1:00}@example.test", "") { Number = i + 1 }).ToList()
        };
        var totals = state.Patients.ToDictionary(p => p.Id, _ => 0);
        var futureCounts = state.Patients.ToDictionary(p => p.Id, _ => 0);
        var patientVisits = state.Patients.ToDictionary(p => p.Id, _ => new List<Appointment>());
        // Relative dates keep a fresh demo useful. No clinical records or notes are seeded.
        for (var offset = -28; offset <= 21; offset++)
        {
            var date = clock.Today.AddDays(offset);
            foreach (var doctor in state.Doctors.Where(d => d.WorkingPeriods.Count > 0))
            {
                var slots = SchedulingRules.Slots(state, doctor, date, clock, includePast: true);
                if (slots.Count == 0) continue;
                // A varied, partially occupied diary: preserve free capacity for trying bookings.
                foreach (var slot in slots.Where((slot, i) => (i + Math.Abs(offset)) % 3 == 1).Take(6))
                {
                    var patient = state.Patients.OrderBy(p => totals[p.Id]).FirstOrDefault(p =>
                        (slot.End <= clock.UtcNow || futureCounts[p.Id] < 2) &&
                        !patientVisits[p.Id].Any(a => SchedulingRules.Active(a) && SchedulingRules.Overlaps(a.Start, a.End, slot.Start, slot.End)));
                    if (patient is null) continue;
                    var ended = slot.End <= clock.UtcNow;
                    var appointment = new Appointment { DoctorId = doctor.Id, PatientId = patient.Id, Start = slot.Start, End = slot.End,
                        Status = ended ? (Math.Abs(offset) % 9 == 2 ? AppointmentStatus.NoShow : Math.Abs(offset) % 7 == 3 ? AppointmentStatus.Cancelled : AppointmentStatus.Completed)
                            : doctor.RequiresConfirmation && Math.Abs(offset) % 3 == 0 ? AppointmentStatus.Scheduled : AppointmentStatus.Confirmed,
                        UpdatedAt = clock.UtcNow };
                    state.Appointments.Add(appointment); patientVisits[patient.Id].Add(appointment); totals[patient.Id]++;
                    if (!ended) futureCounts[patient.Id]++;
                }
            }
        }
        CatalogueService.Initialize(state);
        return state;
    }
    public static List<DemoActor> Actors(IEnumerable<Doctor> doctors, IEnumerable<Patient> patients) =>
        [new("admin", "Алекс • Рецепција", DemoRole.Administrator),
         ..patients.Select(p => new DemoActor(p.Id, p.Name, DemoRole.Patient, PatientId: p.Id)),
         ..doctors.Where(d => !d.IsService).Select(d => new DemoActor("user-" + d.Id, d.Name, DemoRole.Doctor, d.Id))];
}
