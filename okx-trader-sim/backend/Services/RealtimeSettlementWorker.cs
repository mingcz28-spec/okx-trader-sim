using Microsoft.Extensions.Hosting;

namespace OkxTraderSim.Api.Services;

public sealed class RealtimeSettlementWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RealtimeSettlementWorker> _logger;

    public RealtimeSettlementWorker(IServiceScopeFactory scopeFactory, ILogger<RealtimeSettlementWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<RealtimeService>();
                await service.SettleRealtimeSessionAsync(stoppingToken);
                await service.SettleLiveRealtimeSessionsAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Realtime background settlement failed.");
            }

            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        }
    }
}
