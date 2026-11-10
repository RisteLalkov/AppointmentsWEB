using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Appointments.Core;
using Microsoft.AspNetCore.Authentication;

namespace Appointments.Web.Services;

public sealed class ApiClient(HttpClient client, IHttpContextAccessor accessor, IConfiguration configuration)
{
    public async Task<T> SendAsync<T>(string path, object? body = null, bool authenticated = true, CancellationToken ct = default, string? clinicId = null, bool platform = false, bool patientIdentity = false)
    {
        using var request = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, path);
        var secret = configuration["Hosting:WebProxyKey"] ?? "";
        var address = accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();
        if (secret.Length >= 32 && address != null)
        {
            var stamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            request.Headers.Add("X-Web-Client", address);
            request.Headers.Add("X-Web-Time", stamp.ToString(System.Globalization.CultureInfo.InvariantCulture));
            request.Headers.Add("X-Web-Signature", WebProxyIdentity.Sign(secret, address, stamp));
        }
        request.Headers.AcceptLanguage.ParseAdd(System.Globalization.CultureInfo.CurrentUICulture.Name);
        if (body != null) request.Content = JsonContent.Create(body, options: JsonDemoStore.JsonOptions);
        if (authenticated && platform)
        {
            clinicId = null;
            var platformToken = await accessor.HttpContext!.GetTokenAsync("PlatformCookie", "api_token");
            if (string.IsNullOrEmpty(platformToken)) throw new RuleException(UiText.T("Најавете се повторно."), 401);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", platformToken);
        }
        else if (authenticated)
        {
            var patient = accessor.HttpContext!.User.HasClaim("globalPatient", "true");
            if (patientIdentity && !patient) throw new RuleException(UiText.T("Потребна е лична пациентска сметка."), 403);
            clinicId = patientIdentity ? null : accessor.HttpContext.User.FindFirst("clinicId")?.Value;
            if (string.IsNullOrEmpty(clinicId) && !patient) throw new RuleException(UiText.T("Најавете се повторно."), 401);
            var token = await accessor.HttpContext.GetTokenAsync("api_token");
            if (string.IsNullOrEmpty(token)) throw new RuleException(UiText.T("Најавете се повторно."), 401);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        if (!string.IsNullOrEmpty(clinicId)) request.Headers.Add("X-Clinic", clinicId);
        try
        {
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                // A revoked/expired API session must not leave a seemingly signed-in web cookie.
                // Only clear the scheme used by this request; company and clinic sessions are independent.
                if (authenticated && response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    await accessor.HttpContext!.SignOutAsync(platform ? "PlatformCookie" : Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationDefaults.AuthenticationScheme);
                    if (!platform) accessor.HttpContext!.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity());
                }
                var message = response.StatusCode == HttpStatusCode.Unauthorized ? UiText.T("Вашата сесија истече. Најавете се повторно.") : UiText.T("Серверот не можеше да го изврши барањето.");
                try { var error = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct); if (error.TryGetProperty("error", out var value)) message = value.GetString() ?? message; } catch (JsonException) { }
                throw new RuleException(message, (int)response.StatusCode);
            }
            return (await response.Content.ReadFromJsonAsync<T>(JsonDemoStore.JsonOptions, ct))!;
        }
        catch (HttpRequestException) { throw new RuleException(UiText.T("Сервисот за термини е недостапен. Обидете се повторно подоцна или контактирајте ја рецепцијата."), 503); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new RuleException(UiText.T("Истече времето за одговор од серверот. Освежете пред да се обидете повторно; последната промена можеби е зачувана."), 504); }
    }
}
