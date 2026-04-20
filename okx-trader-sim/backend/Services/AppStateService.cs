using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class AppStateService
{
    private readonly AppRepository _repository;

    public AppStateService(AppRepository repository)
    {
        _repository = repository;
    }

    public async Task<AppStateDto> GetStateAsync()
    {
        var state = await _repository.GetAppStateAsync();
        var api = await _repository.GetApiConnectionAsync();
        var risk = await _repository.GetRiskConfigAsync();
        var strategy = await _repository.GetStrategyConfigAsync();
        var balances = await _repository.GetBalancesAsync();
        var orders = await _repository.GetOrderHistoryAsync();
        var positions = await _repository.GetPositionsAsync();
        var backtest = await _repository.GetLatestBacktestAsync();

        return new AppStateDto(
            ToApiSummary(api),
            ToRiskDto(risk),
            ToStrategyDto(strategy),
            state.Equity,
            state.AvailableMargin,
            state.DailyPnl,
            state.DrawdownPct,
            state.StrategyStatus,
            state.CurrencyMode,
            balances.Select(ToBalanceDto).ToList(),
            orders.Select(ToOrderDto).ToList(),
            backtest is null ? null : ToBacktestDto(backtest),
            positions.Select(ToPositionDto).ToList());
    }

    public static ApiConnectionSummaryDto ToApiSummary(ApiConnectionDocument? api)
    {
        if (api is null || string.IsNullOrWhiteSpace(api.ApiKey))
        {
            return new ApiConnectionSummaryDto(string.Empty, false, null);
        }

        var masked = api.ApiKey.Length <= 6
            ? "******"
            : $"{api.ApiKey[..3]}***{api.ApiKey[^3..]}";
        return new ApiConnectionSummaryDto(masked, true, api.UpdatedAt);
    }

    public static RiskConfigDto ToRiskDto(RiskConfigDocument doc) =>
        new(doc.MaxPositionPct, doc.MaxDailyLossPct, doc.MaxConsecutiveLosses);

    public static StrategyConfigDto ToStrategyDto(StrategyConfigDocument doc) =>
        new(string.IsNullOrWhiteSpace(doc.StrategyType) ? "buy-sell" : doc.StrategyType, doc.Enabled, doc.EntrySide, doc.StopLossPct, doc.TrailingDrawdownPct, doc.Leverage, doc.HighestPriceSinceEntry, doc.EntryPrice, doc.LastSignal);

    public static PositionDto ToPositionDto(PositionDocument doc) =>
        new(doc.Id, doc.Symbol, doc.Side, doc.Leverage, doc.MarginMode, doc.Quantity, doc.Notional, doc.MarginUsed, doc.UnrealizedPnl, doc.EntryPrice, doc.MarkPrice, doc.PnlPct, doc.OpenedAt);

    public static BalanceDetailDto ToBalanceDto(BalanceDetailDocument doc) =>
        new(doc.Ccy, doc.Equity, doc.CashBalance, doc.AvailableBalance);

    public static OrderHistoryDto ToOrderDto(OrderHistoryDocument doc) =>
        new(doc.Id, doc.Symbol, doc.Side, doc.OrderType, doc.State, doc.Price, doc.Size, doc.FilledSize, doc.CreatedAt);

    public static BacktestSummaryDto ToBacktestDto(BacktestDocument doc) =>
        new(doc.Id, doc.InstId, doc.Bar, doc.StrategyType, doc.CandlesCount, doc.Results, doc.Top, doc.Selected, doc.ChartCandles, doc.TradePoints);
}
