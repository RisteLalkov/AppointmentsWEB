using Appointments.Core;
namespace Appointments.Web.Services;
public static class DisplayExtensions
{
    public static string RoleLabel(this DemoRole role) => role switch
    {
        DemoRole.Patient => "Пациент",
        DemoRole.Doctor => "Лекар",
        DemoRole.Administrator => "Администратор",
        _ => "Корисник"
    };
}
