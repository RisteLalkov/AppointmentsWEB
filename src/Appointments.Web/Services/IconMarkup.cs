using Microsoft.AspNetCore.Html;
using System.Text.RegularExpressions;
namespace Appointments.Web.Services;
public static class IconMarkup
{
    public static IHtmlContent Icon(string name) => Regex.IsMatch(name, "^[a-z0-9-]+$")
        ? new HtmlString($"<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><use href=\"/icons/interface.svg#{name}\"></use></svg>")
        : HtmlString.Empty;
}
