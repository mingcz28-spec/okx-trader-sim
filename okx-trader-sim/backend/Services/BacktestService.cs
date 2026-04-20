using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class BacktestService
{
    private static readonly decimal[] StopLossGrid = [0.5m, 0.8m, 1m, 1.2m, 1.5m, 2m];
    private static readonly decimal[] TrailingGrid = [1m, 1.5m, 2m, 2.5m, 3m, 4m];
    private static readonly decimal[] LeverageGrid = [1m, 2m, 3m, 5m];
    private static readonly HashSet<string> SupportedBars = ["1m", "5m", "15m", "1H", "4H", "1D"];

    private readonly OkxClient _client;
    private readonly AppRepository _repository;
    private readonly StrategyRegistryService _strategyRegistry;

    public BacktestService(OkxClient client, AppRepository repository, StrategyRegistryService strategyRegistry)
    {
        _client = client;
        _repository = repository;
        _strategyRegistry = strategyRegistry;
    }

    public async Task<BacktestSummaryDto> RunGridAsync(BacktestRequest request)
    {
        var instId = NormalizeInstId(request.InstId);
        var bar = NormalizeBar(request.Bar);
        var strategy = _strategyRegistry.GetRunnable(request.StrategyType);
        var strategyType = strategy.Definition.Id;

        var candles = await _client.GetHistoryCandlesAsync(instId, bar);
        var leverageCandidates = string.Equals(strategyType, "buy-sell", StringComparison.OrdinalIgnoreCase)
            ? LeverageGrid
            : [strategy.DefaultParams.Leverage];

        var results = new List<BacktestResultDto>();
        foreach (var leverage in leverageCandidates)
        {
            foreach (var stop in StopLossGrid)
            {
                foreach (var trail in TrailingGrid)
                {
                    if (!StrategyRegistryService.IsLeveragedStopLossAllowed(stop, leverage))
                    {
                        continue;
                    }

                    results.Add(strategy.RunBacktest(candles, stop, trail, leverage).Summary);
                }
            }
        }

        results = results
            .OrderByDescending(x => x.NetTotalReturn)
            .ThenByDescending(x => x.MaxDrawdown)
            .ThenByDescending(x => x.WinRate)
            .ToList();

        var latest = await _repository.GetLatestBacktestAsync();
        var keepDetails = latest?.StrategyType == strategyType && latest?.InstId == instId && latest?.Bar == bar;
        var doc = new BacktestDocument
        {
            InstId = instId,
            Bar = bar,
            StrategyType = strategyType,
            CandlesCount = candles.Count,
            Results = results,
            Top = results.Take(12).ToList(),
            Selected = keepDetails ? latest?.Selected : null,
            ChartCandles = keepDetails ? latest?.ChartCandles ?? [] : [],
            TradePoints = keepDetails ? latest?.TradePoints ?? [] : []
        };

        await _repository.SaveBacktestAsync(doc);
        return AppStateService.ToBacktestDto(doc);
    }

    public async Task<BacktestSummaryDto> RunDetailAsync(BacktestDetailRequest request)
    {
        var instId = NormalizeInstId(request.InstId);
        var bar = NormalizeBar(request.Bar);
        var strategy = _strategyRegistry.GetRunnable(request.StrategyType);
        var strategyType = strategy.Definition.Id;
        var stopLoss = request.StopLossPct ?? strategy.DefaultParams.StopLossPct;
        var trailing = request.TrailingDrawdownPct ?? strategy.DefaultParams.TrailingDrawdownPct;
        var leverage = request.Leverage ?? strategy.DefaultParams.Leverage;

        StrategyRegistryService.ValidateLeveragedStopLoss(stopLoss, leverage);

        var candles = await _client.GetHistoryCandlesAsync(instId, bar);
        var detail = strategy.RunBacktest(candles, stopLoss, trailing, leverage);

        var latest = await _repository.GetLatestBacktestAsync();
        var doc = latest ?? new BacktestDocument();
        doc.InstId = instId;
        doc.Bar = bar;
        doc.StrategyType = strategyType;
        doc.CandlesCount = candles.Count;
        doc.Selected = detail.Summary;
        doc.ChartCandles = candles;
        doc.TradePoints = detail.TradePoints;

        if (doc.Results.Count == 0 || latest?.StrategyType != strategyType)
        {
            doc.Results = [detail.Summary];
            doc.Top = [detail.Summary];
        }

        await _repository.UpdateLatestBacktestAsync(doc);
        return AppStateService.ToBacktestDto(doc);
    }

    public async Task<BacktestSummaryDto?> GetLatestAsync()
    {
        var latest = await _repository.GetLatestBacktestAsync();
        return latest is null ? null : AppStateService.ToBacktestDto(latest);
    }

    private static string NormalizeInstId(string? instId) =>
        string.IsNullOrWhiteSpace(instId) ? "RAVE-USDT-SWAP" : instId.Trim().ToUpperInvariant();

    private static string NormalizeBar(string? bar) =>
        !string.IsNullOrWhiteSpace(bar) && SupportedBars.Contains(bar) ? bar : "1H";
}
