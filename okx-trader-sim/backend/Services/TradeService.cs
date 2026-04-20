using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class TradeService
{
    private readonly AppRepository _repository;
    private readonly AppStateService _stateService;

    public TradeService(AppRepository repository, AppStateService stateService)
    {
        _repository = repository;
        _stateService = stateService;
    }

    public async Task<(bool Ok, string? Code, string? Message, AppStateDto? State)> OpenSimulatedAsync(SimulatedTradeRequest request)
    {
        var state = await _repository.GetAppStateAsync();
        var risk = await _repository.GetRiskConfigAsync();
        var notional = Math.Max(0m, request.Notional ?? 100m);
        var maxNotional = state.Equity * risk.MaxPositionPct / 100m;

        if (notional > maxNotional)
        {
            return (false, "MAX_POSITION_EXCEEDED", $"单笔名义价值 {notional} 超过风控上限 {maxNotional}.", null);
        }

        if (state.DailyPnl < 0 && Math.Abs(state.DailyPnl) >= state.Equity * risk.MaxDailyLossPct / 100m)
        {
            return (false, "MAX_DAILY_LOSS_EXCEEDED", "今日亏损已触达风控上限，拒绝新模拟开仓。", null);
        }

        // OKX order state is execution status, not realized PnL; do not infer consecutive losses from it.

        var side = request.Side == "sell" ? "short" : "long";
        var symbol = string.IsNullOrWhiteSpace(request.Symbol) ? "BTC-USDT-SWAP" : request.Symbol.Trim().ToUpperInvariant();
        var leverage = Math.Max(1m, request.Leverage ?? 3m);
        var basePrice = symbol.StartsWith("BTC", StringComparison.OrdinalIgnoreCase) ? 85000m : 1650m;
        var drift = side == "long" ? 0.01m : -0.008m;
        var markPrice = Math.Round(basePrice * (1 + drift), 2);
        var pnlPct = Math.Round((markPrice - basePrice) / basePrice * (side == "long" ? 100m : -100m), 2);

        await _repository.AddPositionAsync(new PositionDocument
        {
            Id = $"p-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
            Symbol = symbol,
            Side = side,
            Leverage = leverage,
            Quantity = Math.Round(notional / basePrice, 8),
            MarginMode = "cross",
            Notional = notional,
            MarginUsed = Math.Round(notional / leverage, 2),
            UnrealizedPnl = Math.Round(notional * pnlPct / 100m, 2),
            EntryPrice = basePrice,
            MarkPrice = markPrice,
            PnlPct = pnlPct,
            OpenedAt = DateTime.UtcNow
        });

        state.AvailableMargin = Math.Max(0m, state.AvailableMargin - notional / leverage);
        state.StrategyStatus = "running";
        await _repository.SaveAppStateAsync(state);

        var strategy = await _repository.GetStrategyConfigAsync();
        strategy.EntryPrice = basePrice;
        strategy.HighestPriceSinceEntry = markPrice;
        strategy.LastSignal = side == "short" ? "open_short" : "open_long";
        strategy.Enabled = true;
        await _repository.SaveStrategyConfigAsync(strategy);

        return (true, null, null, await _stateService.GetStateAsync());
    }

    public async Task<AppStateDto> CloseAllAsync()
    {
        var state = await _repository.GetAppStateAsync();
        await _repository.ClearPositionsAsync();
        state.AvailableMargin = state.Equity * 0.9m;
        state.StrategyStatus = "paused";
        await _repository.SaveAppStateAsync(state);

        var strategy = await _repository.GetStrategyConfigAsync();
        strategy.EntryPrice = null;
        strategy.HighestPriceSinceEntry = null;
        strategy.LastSignal = "close";
        await _repository.SaveStrategyConfigAsync(strategy);

        return await _stateService.GetStateAsync();
    }
}
