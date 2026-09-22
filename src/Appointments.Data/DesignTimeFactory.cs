using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Appointments.Data;

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AppointmentsDbContext>
{
    public AppointmentsDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Appointments")
            ?? "Host=localhost;Port=55432;Database=appointments_dev;Username=careline_app";
        return new(new DbContextOptionsBuilder<AppointmentsDbContext>().UseNpgsql(connection).Options);
    }
}
