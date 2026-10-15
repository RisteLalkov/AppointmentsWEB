using Appointments.Contracts;
using Appointments.Core;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Services;

public sealed class PublicDiscovery(ClinicRegistry registry, ClinicConnections connections)
{
    public static PublicClinic Describe(ClinicDefinition c) => new(c.Id, c.Name, c.TimeZone, c.AllowRegistration, c.Description, c.Address, c.Phone);
    public IEnumerable<ClinicDefinition> Visible => registry.Clinics.Where(c => c.Enabled && c.Discoverable).OrderBy(c => c.Id, StringComparer.Ordinal);
    public ClinicDefinition Clinic(string id) => Visible.SingleOrDefault(c => c.Id == id) ?? throw new RuleException("Клиниката не е пронајдена.", 404);
    public PublicPage<PublicClinic> Clinics(DiscoveryQuery q)
    {
        var all = Visible.Where(c => string.IsNullOrWhiteSpace(q.Search) || c.Name.Contains(q.Search.Trim(), StringComparison.OrdinalIgnoreCase)).ToArray();
        return new(all.Skip((q.Page - 1) * q.PageSize).Take(q.PageSize).Select(Describe).ToArray(), all.Length, q.Page, q.PageSize);
    }
    public async Task<PublicPage<PublicDoctor>> DoctorsAsync(DiscoveryQuery q, CancellationToken ct, string? doctorId = null)
    {
        var rows = new List<PublicDoctor>(); var skip = (q.Page - 1) * q.PageSize; var total = 0;
        var selected = string.IsNullOrEmpty(q.ClinicId) ? Visible : new[] { Clinic(q.ClinicId) };
        foreach (var c in selected.Where(c => string.IsNullOrWhiteSpace(q.Clinic) || c.Name.Contains(q.Clinic.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            await using var db = await connections.OpenAsync(c, ct);
            var doctors = db.Doctors.AsNoTracking().Where(d => d.Enabled && !d.IsService);
            if (doctorId != null) doctors = doctors.Where(d => d.Id == doctorId);
            // One broad search across public fields. Explicit refinements still combine with AND.
            if (!string.IsNullOrWhiteSpace(q.Search))
            {
                var term = q.Search.Trim().ToLowerInvariant();
                var clinicMatches = c.Name.Contains(q.Search.Trim(), StringComparison.OrdinalIgnoreCase);
                doctors = doctors.Where(d => clinicMatches || d.Name.ToLower().Contains(term)
                    || d.Specialty.ToLower().Contains(term) || d.Subspecialty.ToLower().Contains(term)
                    || db.DoctorServices.Any(a => a.DoctorId == d.Id && db.Services.Any(s => s.Id == a.ServiceId && s.Enabled && s.Name.ToLower().Contains(term))));
            }
            if (!string.IsNullOrWhiteSpace(q.Specialty)) { var term = q.Specialty.Trim().ToLowerInvariant(); doctors = doctors.Where(d => d.Specialty.ToLower().Contains(term) || d.Subspecialty.ToLower().Contains(term)); }
            if (!string.IsNullOrWhiteSpace(q.Service)) { var term = q.Service.Trim().ToLowerInvariant(); doctors = doctors.Where(d => db.DoctorServices.Any(a => a.DoctorId == d.Id && db.Services.Any(s => s.Id == a.ServiceId && s.Enabled && s.Name.ToLower().Contains(term)))); }
            var count = await doctors.CountAsync(ct); total += count;
            if (skip >= count) { skip -= count; continue; }
            if (rows.Count == q.PageSize) continue;
            var page = await doctors.OrderBy(d => d.Name).ThenBy(d => d.Id).Skip(skip).Take(q.PageSize - rows.Count)
                .Select(d => new { d.Id, d.Name, d.Specialty, d.Subspecialty, d.StaffOnly }).ToListAsync(ct);
            skip = 0;
            var ids = page.Select(d => d.Id).ToArray();
            var services = await (from a in db.DoctorServices join s in db.Services on a.ServiceId equals s.Id where ids.Contains(a.DoctorId) && s.Enabled orderby s.Name select new { a.DoctorId, s.Id, s.Name, s.DurationMinutes }).ToListAsync(ct);
            rows.AddRange(page.Select(d => new PublicDoctor(d.Id, d.Name, d.Specialty, d.Subspecialty, Describe(c), services.Where(s => s.DoctorId == d.Id).Select(s => new PublicService(s.Id, s.Name, s.DurationMinutes)).ToArray(), d.StaffOnly)));
        }
        return new(rows, total, q.Page, q.PageSize);
    }
}
