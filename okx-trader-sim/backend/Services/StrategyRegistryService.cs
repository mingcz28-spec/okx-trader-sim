using OkxTraderSim.Api.Models;

namespace OkxTraderSim.Api.Services;

public sealed class StrategyRegistryService
{
    private readonly IReadOnlyDictionary<string, ITradingStrategy> _activeStrategies;
    private readonly IReadOnlyList<StrategyDefinitionDto> _definitions;

    public StrategyRegistryService()
    {
        var strategies = new ITradingStrategy[]
        {
            new BuySellTradingStrategy(),
            new TrendTradingStrategy()
        };

        _activeStrategies = strategies.ToDictionary(x => x.Definition.Id, StringComparer.OrdinalIgnoreCase);
        _definitions =
        [
            ..strategies.Select(x => x.Definition),
            new StrategyDefinitionDto("mean-reversion", "均值回归策略", "价格偏离均值后等待回归确认，当前待接入。", "pending", false, false),
            new StrategyDefinitionDto("breakout", "突破策略", "价格突破关键区间后跟随入场，当前待接入。", "pending", false, false)
        ];
    }

    public IReadOnlyList<StrategyDefinitionDto> GetDefinitions() => _definitions;

    public string NormalizeStrategyId(string? strategyType)
    {
        if (string.IsNullOrWhiteSpace(strategyType)) return "buy-sell";

        var id = strategyType.Trim();
        return _definitions.Any(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase))
            ? id.ToLowerInvariant()
            : "buy-sell";
    }

    public ITradingStrategy GetRunnable(string? strategyType)
    {
        var id = NormalizeStrategyId(strategyType);
        if (_activeStrategies.TryGetValue(id, out var strategy)) return strategy;

        throw new InvalidOperationException("策略暂未接入");
    }

    public StrategyDefinitionDto GetDefinition(string? strategyType)
    {
        var id = NormalizeStrategyId(strategyType);
        return _definitions.FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase))
            ?? _definitions[0];
    }
}

public interface ITradingStrategy
{
    StrategyDefinitionDto Definition { get; }
    StrategyBacktestResult RunBacktest(List<CandlePointDto> candles, decimal stopLossPct, decimal trailingDrawdownPct);
    string EvaluateRealtimeSignal(RealtimeStrategyContext context);
}

public sealed record StrategyBacktestResult(BacktestResultDto Summary, List<BacktestTradePointDto> TradePoints);

public sealed record RealtimeStrategyContext(
    decimal? LastPrice,
    bool HasPosition,
    decimal? EntryPrice,
    StrategyConfigDocument Strategy,
    IReadOnlyList<CandlePointDto> RecentCandles);

internal abstract class TradingStrategyBase
{
    protected static StrategyBacktestResult BuildDetail(decimal stopLossPct, decimal trailingDrawdownPct, List<BacktestTradePointDto> trades)
    {
        var totalReturn = trades.Aggregate(1m, (acc, t) => acc * (1 + t.Ret)) - 1;
        var equity = 1m;
        var peakEq = 1m;
        var maxDrawdown = 0m;
        foreach (var t in trades)
        {
            equity *= 1 + t.Ret;
            peakEq = Math.Max(peakEq, equity);
            maxDrawdown = Math.Min(maxDrawdown, equity / peakEq - 1);
        }

        var wins = trades.Count(x => x.Ret > 0);
        var summary = new BacktestResultDto(
            stopLossPct,
            trailingDrawdownPct,
            trades.Count,
            trades.Count == 0 ? 0m : (decimal)wins / trades.Count,
            totalReturn,
            maxDrawdown);

        return new StrategyBacktestResult(summary, trades);
    }

    protected static string EvaluateStopAndTrailing(decimal lastPrice, bool hasPosition, decimal? entryPrice, StrategyConfigDocument strategy)
    {
        if (!hasPosition) return "buy";
        if (!entryPrice.HasValue || entryPrice.Value <= 0) return "hold";

        var stopLossLine = entryPrice.Value * (1 - strategy.StopLossPct / 100m);
        var peak = Math.Max(strategy.HighestPriceSinceEntry ?? entryPrice.Value, lastPrice);
        var trailingLine = peak * (1 - strategy.TrailingDrawdownPct / 100m);

        return lastPrice <= stopLossLine || lastPrice <= trailingLine ? "sell" : "hold";
    }
}

internal sealed class BuySellTradingStrategy : TradingStrategyBase, ITradingStrategy
{
    public StrategyDefinitionDto Definition { get; } =
        new("buy-sell", "买入卖出策略", "无仓即入场，按止损和移动回撤退出。", "active", true, true);

    public StrategyBacktestResult RunBacktest(List<CandlePointDto> candles, decimal stopLossPct, decimal trailingDrawdownPct)
    {
        var trades = new List<BacktestTradePointDto>();
        var inPosition = false;
        decimal entry = 0m;
        long entryTs = 0;
        decimal peak = 0m;

        foreach (var c in candles)
        {
            if (!inPosition)
            {
                entry = c.Close;
                entryTs = c.Ts;
                peak = c.Close;
                inPosition = true;
                continue;
            }

            if (c.High > peak) peak = c.High;
            var stopPrice = entry * (1 - stopLossPct / 100m);
            var trailingPrice = peak * (1 - trailingDrawdownPct / 100m);
            decimal? exitPrice = null;
            string? reason = null;

            if (c.Low <= stopPrice)
            {
                exitPrice = stopPrice;
                reason = "stop_loss";
            }
            else if (c.Low <= trailingPrice)
            {
                exitPrice = trailingPrice;
                reason = "trailing_exit";
            }

            if (exitPrice is not null && reason is not null)
            {
                trades.Add(new BacktestTradePointDto(entryTs, entry, c.Ts, exitPrice.Value, (exitPrice.Value - entry) / entry, reason));
                inPosition = false;
                entry = 0m;
                entryTs = 0;
                peak = 0m;
            }
        }

        return BuildDetail(stopLossPct, trailingDrawdownPct, trades);
    }

    public string EvaluateRealtimeSignal(RealtimeStrategyContext context)
    {
        if (!context.LastPrice.HasValue)
        {
            return context.Strategy.LastSignal is "buy" or "sell" or "hold" ? context.Strategy.LastSignal : "hold";
        }

        return EvaluateStopAndTrailing(context.LastPrice.Value, context.HasPosition, context.EntryPrice, context.Strategy);
    }
}

internal sealed class TrendTradingStrategy : TradingStrategyBase, ITradingStrategy
{
    public StrategyDefinitionDto Definition { get; } =
        new("trend", "趋势跟随策略", "价格站上 20 根均线并接近区间高点时入场，按止损、移动回撤或跌破均线退出。", "active", true, true);

    public StrategyBacktestResult RunBacktest(List<CandlePointDto> candles, decimal stopLossPct, decimal trailingDrawdownPct)
    {
        var trades = new List<BacktestTradePointDto>();
        var inPosition = false;
        decimal entry = 0m;
        long entryTs = 0;
        decimal peak = 0m;

        for (var i = 20; i < candles.Count; i++)
        {
            var c = candles[i];
            var prev = candles.Skip(i - 20).Take(20).ToList();
            var ma = prev.Average(x => x.Close);
            var prevHigh = prev.Max(x => x.High);

            if (!inPosition)
            {
                if (c.Close > ma && c.Close >= prevHigh * 0.995m)
                {
                    entry = c.Close;
                    entryTs = c.Ts;
                    peak = c.Close;
                    inPosition = true;
                }
                continue;
            }

            if (c.High > peak) peak = c.High;
            var stopPrice = entry * (1 - stopLossPct / 100m);
            var trailingPrice = peak * (1 - trailingDrawdownPct / 100m);
            var belowMa = c.Close < ma;
            decimal? exitPrice = null;
            string? reason = null;

            if (c.Low <= stopPrice)
            {
                exitPrice = stopPrice;
                reason = "stop_loss";
            }
            else if (c.Low <= trailingPrice || belowMa)
            {
                exitPrice = belowMa ? c.Close : trailingPrice;
                reason = "trailing_exit";
            }

            if (exitPrice is not null && reason is not null)
            {
                trades.Add(new BacktestTradePointDto(entryTs, entry, c.Ts, exitPrice.Value, (exitPrice.Value - entry) / entry, reason));
                inPosition = false;
                entry = 0m;
                entryTs = 0;
                peak = 0m;
            }
        }

        return BuildDetail(stopLossPct, trailingDrawdownPct, trades);
    }

    public string EvaluateRealtimeSignal(RealtimeStrategyContext context)
    {
        if (context.RecentCandles.Count < 21) return "hold";

        var latest = context.RecentCandles[^1];
        var prev = context.RecentCandles.Skip(context.RecentCandles.Count - 21).Take(20).ToList();
        var ma = prev.Average(x => x.Close);
        var prevHigh = prev.Max(x => x.High);
        var lastPrice = context.LastPrice ?? latest.Close;

        if (!context.HasPosition)
        {
            return latest.Close > ma && latest.Close >= prevHigh * 0.995m ? "buy" : "hold";
        }

        if (!context.EntryPrice.HasValue || context.EntryPrice.Value <= 0) return "hold";
        if (latest.Close < ma) return "sell";

        var stopOrTrailingSignal = EvaluateStopAndTrailing(lastPrice, true, context.EntryPrice, context.Strategy);
        return stopOrTrailingSignal == "sell" ? "sell" : "hold";
    }
}
