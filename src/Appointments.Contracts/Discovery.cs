using System.ComponentModel.DataAnnotations;

namespace Appointments.Contracts;

// Explicit public projections. Never serialize tenant entities on anonymous endpoints.
public record PublicClinic(string Id, string Name, string TimeZone, bool AllowRegistration, string? Description, string? Address, string? Phone);
public record PublicService(string Id, string Name, int DurationMinutes);
public record PublicDoctor(string Id, string Name, string Specialty, string Subspecialty, PublicClinic Clinic, IReadOnlyList<PublicService> Services, bool StaffOnly);
public record PublicPage<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
public sealed record DiscoveryQuery
{
    [StringLength(100)] public string? Search { get; init; }
    [StringLength(100)] public string? Clinic { get; init; }
    [StringLength(40)] public string? ClinicId { get; init; }
    [StringLength(100)] public string? Specialty { get; init; }
    [StringLength(100)] public string? Service { get; init; }
    [Range(1,100)] public int Page { get; init; } = 1;
    [Range(1,24)] public int PageSize { get; init; } = 12;
}
public record PlatformSession(string AccessToken, DateTimeOffset ExpiresAt, string Id, string Name);
public record PlatformClinicSummary(string Id, string Name, string State, bool Discoverable, string? Address, string? Phone, string? Description, bool Managed);
public record ProvisionClinicInput(
    [Required, RegularExpression("^[a-z0-9][a-z0-9-]{0,39}$")] string Id,
    [Required, StringLength(100, MinimumLength = 2)] string Name,
    [Required, StringLength(100)] string TimeZone,
    [StringLength(1000)] string? Description,
    [StringLength(200)] string? Address,
    [StringLength(30)] string? Phone,
    bool Discoverable, bool AllowRegistration,
    [Required, StringLength(80, MinimumLength = 2)] string AdminName,
    [Required, EmailAddress, StringLength(120)] string AdminEmail,
    [Required, StringLength(128, MinimumLength = 12)] string AdminPassword);
