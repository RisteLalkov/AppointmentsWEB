using Appointments.Core;
namespace Appointments.Web.Services;
public static class DisplayExtensions
{
    public static string RoleLabel(this DemoRole role) => role switch
    {
        DemoRole.Patient => UiText.T("Пациент"),
        DemoRole.Doctor => UiText.T("Лекар"),
        DemoRole.Administrator => UiText.T("Администратор"),
        _ => UiText.T("Корисник")
    };
}
