using System.Security.Claims;
using Appointments.Core;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Api.Controllers;

public abstract class ApiControllerBase : ControllerBase
{
    protected DemoActor Actor => new(User.FindFirstValue(ClaimTypes.NameIdentifier)!, User.Identity!.Name!, Enum.Parse<DemoRole>(User.FindFirstValue(ClaimTypes.Role)!), User.FindFirstValue("doctorId"), User.FindFirstValue("patientId"));
    protected bool IsDemo => User.FindFirstValue("demo") == "True";
}
