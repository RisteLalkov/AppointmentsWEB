using System.Security.Claims;
using Appointments.Core;

namespace Appointments.Web.Services;

public sealed class DemoIdentity(IHttpContextAccessor accessor, IServiceProvider services, BackendSettings settings)
{
    public IReadOnlyList<DemoActor> Users => services.GetRequiredService<IDemoStore>().Read(s => DemoSeed.Actors(s.Doctors, s.Patients));
    public DemoActor Actor
    {
        get
        {
            var user = accessor.HttpContext!.User; var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!settings.UseApi) return Users.FirstOrDefault(a => a.Id == id) ?? throw new RuleException("Select a demo user again.", 401);
            if (id == null || !Enum.TryParse<DemoRole>(user.FindFirstValue(ClaimTypes.Role), out var role)) throw new RuleException("Please sign in again.", 401);
            return new(id, user.Identity!.Name!, role, user.FindFirstValue("doctorId"), user.FindFirstValue("patientId"));
        }
    }
}
