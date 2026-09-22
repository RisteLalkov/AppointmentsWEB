using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Appointments.Core;
using Microsoft.AspNetCore.Authentication;

namespace Appointments.Web.Services;

public sealed class ApiClient(HttpClient client, IHttpContextAccessor accessor)
{
    public async Task<T> SendAsync<T>(string path, object? body = null, bool authenticated = true, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, path);
        if (body != null) request.Content = JsonContent.Create(body, options: JsonDemoStore.JsonOptions);
        if (authenticated)
        {
            var token = await accessor.HttpContext!.GetTokenAsync("api_token");
            if (string.IsNullOrEmpty(token)) throw new RuleException("Please sign in again.", 401);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        try
        {
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var message = response.StatusCode == HttpStatusCode.Unauthorized ? "Your session has expired. Please sign in again." : "The API could not complete this request.";
                try { var error = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct); if (error.TryGetProperty("error", out var value)) message = value.GetString() ?? message; } catch (JsonException) { }
                throw new RuleException(message, (int)response.StatusCode);
            }
            return (await response.Content.ReadFromJsonAsync<T>(JsonDemoStore.JsonOptions, ct))!;
        }
        catch (HttpRequestException) { throw new RuleException("The appointment API is unavailable. Start Appointments.Api and check its database connection.", 503); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new RuleException("The API request timed out. Refresh before retrying; your last change may have been saved.", 504); }
    }
}
