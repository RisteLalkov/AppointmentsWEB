using Microsoft.EntityFrameworkCore;

namespace Appointments.Data;

// A separate control database. No patients, appointments or tenant database passwords.
public sealed class PlatformClinic
{
    public bool Adopted { get; set; }
    public int Version { get; set; } = 1;
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ConnectionName { get; set; } = "";
    public string TimeZone { get; set; } = "Europe/Skopje";
    public string State { get; set; } = "Provisioning";
    public string AdminEmail { get; set; } = "";
    public string AdminName { get; set; } = "";
    public string? Description { get; set; }
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public bool Discoverable { get; set; }
    public bool AllowRegistration { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class PlatformOperator
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public int FailedAttempts { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
}
public sealed class PlatformAccessSession
{
    public string TokenHash { get; set; } = "";
    public string OperatorId { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public PlatformOperator Operator { get; set; } = null!;
}
public sealed class PlatformDbContext(DbContextOptions<PlatformDbContext> options) : DbContext(options)
{
    public DbSet<PlatformClinic> Clinics => Set<PlatformClinic>();
    public DbSet<PlatformOperator> Operators => Set<PlatformOperator>();
    public DbSet<PlatformAccessSession> Sessions => Set<PlatformAccessSession>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<PlatformClinic>(x => { x.ToTable("PlatformClinics"); x.HasKey(c => c.Id); x.Property(c => c.Version).IsConcurrencyToken(); });
        b.Entity<PlatformOperator>(x => { x.ToTable("PlatformOperators"); x.HasKey(c => c.Id); x.HasIndex(c => c.Email).IsUnique(); });
        b.Entity<PlatformAccessSession>(x => { x.ToTable("PlatformSessions"); x.HasKey(c => c.TokenHash); x.HasOne(c => c.Operator).WithMany().HasForeignKey(c => c.OperatorId); });
    }
}
