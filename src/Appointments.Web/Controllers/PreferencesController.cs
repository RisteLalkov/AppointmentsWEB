using Microsoft.AspNetCore.Localization;
using Microsoft.AspNetCore.Mvc;

namespace Appointments.Web.Controllers;

public sealed class PreferencesController : Controller
{
    [HttpPost]
    public IActionResult Language(string culture, string? returnUrl)
    {
        if (culture is not ("mk-MK" or "en-GB")) return BadRequest();
        Response.Cookies.Append("MedTermin.Language", CookieRequestCultureProvider.MakeCookieValue(new RequestCulture(culture)),
            new CookieOptions { HttpOnly = true, Secure = Request.IsHttps, SameSite = SameSiteMode.Lax,
                Path = "/", MaxAge = TimeSpan.FromDays(365), IsEssential = true });
        var target = Url.IsLocalUrl(returnUrl) ? Url.Content(returnUrl!) : "/Discover";
        // Location headers must be ASCII even when a search/filter uses Cyrillic.
        var escaped = new Uri(new Uri("https://local.invalid/"), target)
            .GetComponents(UriComponents.PathAndQuery | UriComponents.Fragment, UriFormat.UriEscaped);
        return LocalRedirect(escaped);
    }
}
