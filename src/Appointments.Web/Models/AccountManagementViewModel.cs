using Appointments.Contracts;

namespace Appointments.Web.Models;

public sealed class AccountManagementViewModel
{
    public IReadOnlyList<AccountSummary> AllAccounts { get; init; } = [];
    public IReadOnlyList<AccountSummary> Accounts { get; init; } = [];
    public string Search { get; init; } = "";
    public string Role { get; init; } = "";
    public string Status { get; init; } = "";
    public int Matches { get; init; }
    public int Page { get; init; } = 1;
    public int Pages { get; init; } = 1;
}
