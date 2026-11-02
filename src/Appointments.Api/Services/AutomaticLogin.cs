using Appointments.Contracts;
using Appointments.Core;

namespace Appointments.Api.Services;

public sealed class AutomaticLogin(ClinicConnections connections, ClinicRegistry clinics, IServiceScopeFactory scopes)
{
    public async Task<SessionResponse> LoginAsync(LoginInput input, CancellationToken ct)
    {
        clinics.RequireFresh();
        var matches = await connections.FindEmailAsync(AccountService.Email(input.Email), ct);
        if (matches.Count != 1 || !matches[0].Clinic.Enabled)
            throw new RuleException("Е-поштата или лозинката е неточна, или сметката е недостапна.", 401);
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<ClinicContext>().Select(clinics.Resolve(matches[0].Clinic.Id));
        return await scope.ServiceProvider.GetRequiredService<AccountService>().LoginAsync(input, ct);
    }
}
