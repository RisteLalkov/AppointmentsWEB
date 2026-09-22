using Appointments.Core;
namespace Appointments.Web.Services;
public static class DisplayExtensions
{
    public static string RoleLabel(this DemoRole role) => role.ToString();
}
