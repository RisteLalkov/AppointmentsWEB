using Appointments.Api.Services;
using Appointments.Contracts;
using Appointments.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Appointments.Api.Controllers;

[ApiController, Authorize(Roles = "Administrator"), Route("api/accounts"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AccountsController(AccountService service, AppointmentsDbContext db) : ApiControllerBase
{
    [HttpGet] public async Task<IReadOnlyList<AccountSummary>> List(CancellationToken ct) => (await db.Accounts.AsNoTracking().OrderBy(a => a.Name).ToListAsync(ct)).Select(AccountService.Summary).ToList();
    [HttpPost] public Task<AccountSummary> Create(AccountInput input, CancellationToken ct) => service.CreateAsync(Actor, input, ct);
    [HttpPost("{id}/credentials")] public async Task<object> Credentials(string id, LoginInput input, CancellationToken ct) { await service.CredentialsAsync(Actor, id, input, ct); return new { saved = true }; }
    [HttpPost("{id}/access")] public async Task<object> Access(string id, AccountAccessInput input, CancellationToken ct) { await service.AccessAsync(Actor, id, input.Enabled, ct); return new { saved = true }; }
    [HttpGet("audit")] public Task<List<AuditEvent>> Audit(int take = 100, CancellationToken ct = default) => db.AuditEvents.AsNoTracking().OrderByDescending(a => a.Id).Take(Math.Clamp(take, 1, 500)).ToListAsync(ct);
}
