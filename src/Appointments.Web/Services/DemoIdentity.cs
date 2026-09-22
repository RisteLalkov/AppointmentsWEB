using System.Security.Claims;
using Appointments.Core;

namespace Appointments.Web.Services;

public sealed class DemoIdentity(IHttpContextAccessor accessor, IDemoStore store)
{
    public IReadOnlyList<DemoActor> Users => store.Read(s => DemoSeed.Actors(s.Doctors, s.Patients));
    public DemoActor Actor => Users.FirstOrDefault(a => a.Id == accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier))
        ?? throw new RuleException("Your demo user no longer exists. Switch to another demo user.", 401);
}
