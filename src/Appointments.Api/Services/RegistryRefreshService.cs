namespace Appointments.Api.Services;

public sealed class RegistryRefreshService(ClinicRegistry registry, ILogger<RegistryRefreshService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                // Bound both the query and connection wait; a failed refresh never extends the lease.
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(3));
                try { await registry.RefreshAsync(timeout.Token); }
                catch (Exception e) when (!stoppingToken.IsCancellationRequested)
                { logger.LogWarning(e, "Clinic registry refresh failed. Readiness is degraded; the routing lease expires after 30 seconds."); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
