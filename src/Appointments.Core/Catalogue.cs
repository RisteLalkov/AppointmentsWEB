using System.Security.Cryptography;
using System.Text;

namespace Appointments.Core;

public sealed class Specialty
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public int Version { get; set; } = 1;
}
public sealed class MedicalService
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string SpecialtyId { get; set; } = "";
    public int DurationMinutes { get; set; } = 30;
    public bool Enabled { get; set; } = true;
    public int Version { get; set; } = 1;
}
public sealed record DoctorService(string DoctorId, string ServiceId);
public record DoctorInput(string? Id, string Name, string SpecialtyId, string Subspecialty, bool Enabled, int Version = 0);
public record SpecialtyInput(string? Id, string Name, int Version = 0);
public record ServiceInput(string? Id, string Name, string SpecialtyId, int DurationMinutes, bool Enabled, List<string> DoctorIds, int Version = 0);

public sealed class CatalogueService(IDemoStore store)
{
    public static void Initialize(DemoState state)
    {
        foreach (var doctor in state.Doctors.Where(d => d.SpecialtyId == null))
        {
            var id = "sp-" + Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(doctor.Specialty))).ToLowerInvariant();
            if (!state.Specialties.Any(s => s.Id == id)) state.Specialties.Add(new() { Id = id, Name = doctor.Specialty });
            doctor.SpecialtyId = id;
        }
    }
    private static void Admin(DemoActor actor)
    { if (actor.Role != DemoRole.Administrator) throw new RuleException("Само администратор може да го менува каталогот.", 403); }
    private static string Name(string? value, int max = 200)
    { var name = value?.Trim() ?? ""; if (name.Length < 2 || name.Length > max) throw new RuleException($"Внесете од 2 до {max} знаци."); return name; }
    private static void Version(int current, int supplied)
    { if (current != supplied) throw new RuleException("Записот е променет. Освежете и обидете се повторно.", 409); }
    private static Specialty FindSpecialty(DemoState state, string id) => state.Specialties.Find(s => s.Id == id) ?? throw new RuleException("Изберете важечка специјалност.");
    public Specialty SaveSpecialty(DemoActor actor, SpecialtyInput input)
    {
        Admin(actor); return store.Write(s => {
            var name = Name(input.Name);
            if (s.Specialties.Any(x => x.Id != input.Id && x.Name.Equals(name, StringComparison.OrdinalIgnoreCase))) throw new RuleException("Специјалноста веќе постои.", 409);
            var item = input.Id == null ? new Specialty() : s.Specialties.Find(x => x.Id == input.Id) ?? throw new RuleException("Специјалноста не е пронајдена.", 404);
            if (input.Id != null) { Version(item.Version, input.Version); item.Version++; }
            item.Name = name;
            foreach (var d in s.Doctors.Where(d => d.SpecialtyId == item.Id)) { d.Specialty = name; d.CatalogVersion++; }
            if (input.Id == null) s.Specialties.Add(item);
            return item;
        });
    }
    public Doctor SaveDoctor(DemoActor actor, DoctorInput input)
    {
        Admin(actor); return store.Write(s => {
            var name = Name(input.Name); var specialty = FindSpecialty(s, input.SpecialtyId);
            var sub = (input.Subspecialty ?? "").Trim(); if (sub.Length > 200) throw new RuleException("Субспецијалноста е предолга.");
            var item = input.Id == null ? new Doctor { Id = Guid.NewGuid().ToString("N"), Name = name, Specialty = specialty.Name } : s.Doctors.Find(d => d.Id == input.Id) ?? throw new RuleException("Лекарот не е пронајден.", 404);
            if (input.Id != null) { Version(item.CatalogVersion, input.Version); item.CatalogVersion++; }
            item.Name = name; item.SpecialtyId = specialty.Id; item.Specialty = specialty.Name; item.Subspecialty = sub; item.Enabled = input.Enabled;
            if (input.Id == null) s.Doctors.Add(item);
            return item;
        });
    }
    public MedicalService SaveService(DemoActor actor, ServiceInput input)
    {
        Admin(actor); return store.Write(s => {
            var name = Name(input.Name); FindSpecialty(s, input.SpecialtyId);
            if (input.DurationMinutes is < 10 or > 120 || input.DurationMinutes % 5 != 0) throw new RuleException("Траењето мора да биде 10–120 минути во чекори од 5.");
            if (input.DoctorIds == null || input.DoctorIds.Count > 500 || input.DoctorIds.Any(id => !s.Doctors.Any(d => d.Id == id))) throw new RuleException("Изберете важечки лекари / профили.");
            if (s.Services.Any(x => x.Id != input.Id && x.SpecialtyId == input.SpecialtyId && x.Name.Equals(name, StringComparison.OrdinalIgnoreCase))) throw new RuleException("Услугата веќе постои во специјалноста.", 409);
            var item = input.Id == null ? new MedicalService() : s.Services.Find(x => x.Id == input.Id) ?? throw new RuleException("Услугата не е пронајдена.", 404);
            if (input.Id != null) { Version(item.Version, input.Version); item.Version++; }
            item.Name = name; item.SpecialtyId = input.SpecialtyId; item.DurationMinutes = input.DurationMinutes; item.Enabled = input.Enabled;
            if (input.Id == null) s.Services.Add(item);
            s.DoctorServices.RemoveAll(x => x.ServiceId == item.Id);
            s.DoctorServices.AddRange(input.DoctorIds.Distinct().Select(id => new DoctorService(id, item.Id)));
            return item;
        });
    }
    // Null service is supported for legacy providers until their catalogue is configured.
    public static Doctor ForBooking(DemoState s, Doctor doctor, string? serviceId, Appointment? existing = null)
    {
        if (!doctor.Enabled) throw new RuleException("Лекарот е неактивен. Контактирајте ја рецепцијата.", 409);
        if (existing != null) return doctor with { DurationMinutes = (int)(existing.End - existing.Start).TotalMinutes };
        if (string.IsNullOrEmpty(serviceId))
        {
            if (s.DoctorServices.Any(x => x.DoctorId == doctor.Id))
                throw new RuleException(s.Services.Any(service => service.Enabled && s.DoctorServices.Any(x => x.DoctorId == doctor.Id && x.ServiceId == service.Id))
                    ? "Изберете достапна услуга за лекарот." : "Нема активни услуги за лекарот. Контактирајте ја рецепцијата.");
            return doctor;
        }
        var service = s.Services.Find(x => x.Id == serviceId && x.Enabled);
        if (service == null || !s.DoctorServices.Any(x => x.DoctorId == doctor.Id && x.ServiceId == serviceId)) throw new RuleException("Услугата не е достапна за избраниот лекар.", 409);
        return doctor with { DurationMinutes = service.DurationMinutes };
    }
}
