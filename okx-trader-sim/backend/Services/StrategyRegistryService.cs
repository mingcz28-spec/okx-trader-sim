using OkxTraderSim.Api.Models;

namespace OkxTraderSim.Api.Services;

public sealed class StrategyRegistryService
{
    public const decimal DefaultLeverage = 3m;
    public const decimal DefaultTakerFeeRate = 0.0005m;
    public const decimal MaxLeveragedStopLossPct = 10m;

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
            .. strategies.Select(x => x.Definition),
            BuildPendingDefinition("mean-reversion", "均值回归策略", "价格偏离均值后等待回归确认，当前待接入。"),
            BuildPendingDefinition("breakout", "突破策略", "价格突破关键区间后跟随入场，当前待接入。")
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

        throw new InvalidOperationException("该策略暂未接入实时测试。");
    }

    public StrategyDefinitionDto GetDefinition(string? strategyType)
    {
        var id = NormalizeStrategyId(strategyType);
        return _definitions.FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase))
            ?? _definitions[0];
    }

    public static bool IsLeveragedStopLossAllowed(decimal stopLossPct, decimal leverage) =>
        stopLossPct > 0m && leverage > 0m && stopLossPct * leverage <= MaxLeveragedStopLossPct;

    public static void ValidateLeveragedStopLoss(decimal stopLossPct, decimal leverage)
    {
        if (!IsLeveragedStopLossAllowed(stopLossPct, leverage))
        {
            throw new InvalidOperationException("LEVERAGED_STOP_LOSS_LIMIT_EXCEEDED: 止损比例 * 杠杆不能超过 10%。");
        }
    }

    private static StrategyDefinitionDto BuildPendingDefinition(string id, string name, string description)
    {
        var defaults = new StrategyParameterSetDto(1m, 2m, DefaultLeverage);
        return new StrategyDefinitionDto(id, name, description, "pending", false, false, defaults, BuildParameterDefinitions(defaults));
    }

    public static List<StrategyParameterDto> BuildParameterDefinitions(StrategyParameterSetDto values) =>
    [
        new("stopLossPct", "止损比例", "价格偏离入场价达到该比例时平仓。", values.StopLossPct, "%"),
        new("trailingDrawdownPct", "移动回撤比例", "按结算价极值回撤达到该比例时平仓。", values.TrailingDrawdownPct, "%"),
        new("leverage", "策略杠杆", "收益按该杠杆放大，净收益同时计入双边 taker 费率。", values.Leverage, "x")
    ];
}

public interface ITradingStrategy
{
    StrategyDefinitionDto Definition { get; }
    StrategyParameterSetDto DefaultParams { get; }
    StrategyBacktestResult RunBacktest(List<CandlePointDto> candles, decimal stopLossPct, decimal trailingDrawdownPct, decimal leverage);
    StrategyBacktestResult RunRealtimeTest(List<CandlePointDto> closedCandles, StrategyParameterSetDto parameters) =>
        RunBacktest(closedCandles, parameters.StopLossPct, parameters.TrailingDrawdownPct, parameters.Leverage);
    RealtimePeriodDecision EvaluateRealtimePeriod(RealtimePeriodContext context);
}

public sealed record StrategyBacktestResult(
    BacktestResultDto Summary,
    List<BacktestTradePointDto> TradePoints,
    bool HasOpenPosition = false,
    decimal? OpenEntryPrice = null,
    long? OpenEntryTs = null,
    string OpenPositionSide = "flat",
    string LastSignal = "hold",
    string SignalReason = "等待下一根已收盘 K 线确认。");

public sealed record RealtimePeriodDecision(string Action, string Reason, decimal? ExecutionPrice = null);

public sealed record RealtimePeriodContext(
    CandlePointDto Candle,
    IReadOnlyList<CandlePointDto> PreviousCandles,
    string PositionSide,
    decimal? EntryPrice,
    decimal? PeakPrice,
    decimal? TroughPrice,
    StrategyParameterSetDto Params);

internal abstract class TradingStrategyBase
{
    protected const string Hold = "hold";
    protected const string OpenLong = "open_long";
    protected const string OpenShort = "open_short";
    protected const string Close = "close";

    protected static decimal RoundTripFeeRate => StrategyRegistryService.DefaultTakerFeeRate * 2m;

    protected static StrategyDefinitionDto BuildDefinition(
        string id,
        string name,
        string description,
        StrategyParameterSetDto defaults) =>
        new(id, name, description, "active", true, true, defaults, StrategyRegistryService.BuildParameterDefinitions(defaults));

    protected static StrategyBacktestResult BuildDetail(
        decimal stopLossPct,
        decimal trailingDrawdownPct,
        decimal leverage,
        List<BacktestTradePointDto> trades,
        bool hasOpenPosition = false,
        decimal? openEntryPrice = null,
        long? openEntryTs = null,
        string openPositionSide = "flat",
        string lastSignal = Hold,
        string signalReason = "等待下一根已收盘 K 线确认。")
    {
        var grossTotalReturn = trades.Aggregate(1m, (acc, t) => acc * (1 + t.GrossRet)) - 1m;
        var netTotalReturn = trades.Aggregate(1m, (acc, t) => acc * (1 + t.NetRet)) - 1m;
        var equity = 1m;
        var peakEq = 1m;
        var maxDrawdown = 0m;
        foreach (var trade in trades)
        {
            equity *= 1 + trade.NetRet;
            peakEq = Math.Max(peakEq, equity);
            maxDrawdown = Math.Min(maxDrawdown, equity / peakEq - 1m);
        }

        var wins = trades.Count(x => x.NetRet > 0m);
        var feeCost = trades.Sum(x => x.FeeCost);
        var summary = new BacktestResultDto(
            stopLossPct,
            trailingDrawdownPct,
            leverage,
            trades.Count,
            trades.Count == 0 ? 0m : (decimal)wins / trades.Count,
            netTotalReturn,
            maxDrawdown,
            grossTotalReturn,
            netTotalReturn,
            feeCost);

        return new StrategyBacktestResult(summary, trades, hasOpenPosition, openEntryPrice, openEntryTs, openPositionSide, lastSignal, signalReason);
    }

    protected static RealtimePeriodDecision EvaluateContractStops(RealtimePeriodContext context, string holdReason)
    {
        if (!context.EntryPrice.HasValue || context.EntryPrice.Value <= 0m) return new(Hold, holdReason);

        var entry = context.EntryPrice.Value;
        if (string.Equals(context.PositionSide, "long", StringComparison.OrdinalIgnoreCase))
        {
            var peakClose = Math.Max(context.PeakPrice ?? entry, context.Candle.Close);
            var stopPrice = entry * (1m - context.Params.StopLossPct / 100m);
            var trailingPrice = peakClose * (1m - context.Params.TrailingDrawdownPct / 100m);

            if (context.Candle.Low <= stopPrice) return new(Close, "已收盘 K 线触发多单止损。", stopPrice);
            if (context.Candle.Close <= trailingPrice) return new(Close, "已收盘 K 线触发多单移动回撤。", context.Candle.Close);
            return new(Hold, holdReason);
        }

        if (string.Equals(context.PositionSide, "short", StringComparison.OrdinalIgnoreCase))
        {
            var troughClose = Math.Min(context.TroughPrice ?? entry, context.Candle.Close);
            var stopPrice = entry * (1m + context.Params.StopLossPct / 100m);
            var trailingPrice = troughClose * (1m + context.Params.TrailingDrawdownPct / 100m);

            if (context.Candle.High >= stopPrice) return new(Close, "已收盘 K 线触发空单止损。", stopPrice);
            if (context.Candle.Close >= trailingPrice) return new(Close, "已收盘 K 线触发空单移动回撤。", context.Candle.Close);
            return new(Hold, holdReason);
        }

        return new(Hold, holdReason);
    }

    protected static decimal CalculateBaseReturn(string side, decimal entryPrice, decimal exitPrice) =>
        string.Equals(side, "short", StringComparison.OrdinalIgnoreCase)
            ? (entryPrice - exitPrice) / entryPrice
            : (exitPrice - entryPrice) / entryPrice;

    protected static decimal CalculateGrossReturn(string side, decimal entryPrice, decimal exitPrice, decimal leverage) =>
        CalculateBaseReturn(side, entryPrice, exitPrice) * leverage;

    protected static decimal CalculateNetReturn(string side, decimal entryPrice, decimal exitPrice, decimal leverage) =>
        CalculateGrossReturn(side, entryPrice, exitPrice, leverage) - RoundTripFeeRate;

    protected static BacktestTradePointDto BuildTradePoint(
        long entryTs,
        decimal entryPrice,
        long exitTs,
        decimal exitPrice,
        string side,
        string reason,
        decimal leverage)
    {
        var grossRet = CalculateGrossReturn(side, entryPrice, exitPrice, leverage);
        var netRet = grossRet - RoundTripFeeRate;
        return new BacktestTradePointDto(
            entryTs,
            entryPrice,
            exitTs,
            exitPrice,
            netRet,
            reason,
            side,
            grossRet,
            netRet,
            leverage,
            RoundTripFeeRate,
            StrategyRegistryService.DefaultTakerFeeRate,
            StrategyRegistryService.DefaultTakerFeeRate);
    }

    protected static string NormalizeTradeReason(string reason)
    {
        if (reason.Contains("止损", StringComparison.Ordinal)) return "stop_loss";
        if (reason.Contains("回撤", StringComparison.Ordinal)) return "trailing_exit";
        if (reason.Contains("均线", StringComparison.Ordinal)) return "trend_exit";
        return "close";
    }
}

internal sealed class BuySellTradingStrategy : TradingStrategyBase, ITradingStrategy
{
    public StrategyParameterSetDto DefaultParams { get; } = new(1m, 2m, StrategyRegistryService.DefaultLeverage);
    public StrategyDefinitionDto Definition { get; }

    public BuySellTradingStrategy()
    {
        Definition = BuildDefinition("buy-sell", "买入卖出策略", "空仓时读取前 3 根已收盘 close，递增开多，递减开空；平仓遵循止损与移动回撤。", DefaultParams);
    }

    public StrategyBacktestResult RunBacktest(List<CandlePointDto> candles, decimal stopLossPct, decimal trailingDrawdownPct, decimal leverage)
    {
        StrategyRegistryService.ValidateLeveragedStopLoss(stopLossPct, leverage);

        var trades = new List<BacktestTradePointDto>();
        var positionSide = "flat";
        decimal? entry = null;
        long? entryTs = null;
        decimal? peak = null;
        decimal? trough = null;
        var lastSignal = Hold;
        var signalReason = "等待下一根已收盘 K 线确认。";

        var parameters = new StrategyParameterSetDto(stopLossPct, trailingDrawdownPct, leverage);

        for (var i = 0; i < candles.Count; i++)
        {
            var candle = candles[i];
            var previous = candles.Take(i).ToList();
            var decision = EvaluateRealtimePeriod(new RealtimePeriodContext(
                candle,
                previous,
                positionSide,
                entry,
                peak,
                trough,
                parameters));

            lastSignal = decision.Action;
            signalReason = decision.Reason;

            if (positionSide == "flat")
            {
                if (decision.Action == OpenLong)
                {
                    positionSide = "long";
                    entry = decision.ExecutionPrice ?? candle.Close;
                    entryTs = candle.Ts;
                    peak = candle.Close;
                    trough = candle.Close;
                }
                else if (decision.Action == OpenShort)
                {
                    positionSide = "short";
                    entry = decision.ExecutionPrice ?? candle.Close;
                    entryTs = candle.Ts;
                    peak = candle.Close;
                    trough = candle.Close;
                }

                continue;
            }

            peak = Math.Max(peak ?? entry ?? candle.Close, candle.Close);
            trough = Math.Min(trough ?? entry ?? candle.Close, candle.Close);

            if (decision.Action != Close || !entry.HasValue || !entryTs.HasValue) continue;

            var exit = decision.ExecutionPrice ?? candle.Close;
            trades.Add(BuildTradePoint(
                entryTs.Value,
                entry.Value,
                candle.Ts,
                exit,
                positionSide,
                NormalizeTradeReason(signalReason),
                leverage));

            positionSide = "flat";
            entry = null;
            entryTs = null;
            peak = null;
            trough = null;
        }

        return BuildDetail(
            stopLossPct,
            trailingDrawdownPct,
            leverage,
            trades,
            positionSide != "flat",
            entry,
            entryTs,
            positionSide,
            lastSignal,
            signalReason);
    }

    public RealtimePeriodDecision EvaluateRealtimePeriod(RealtimePeriodContext context)
    {
        if (string.Equals(context.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
        {
            if (context.PreviousCandles.Count < 3)
            {
                return new(Hold, "历史 K 线不足 3 根，继续等待。");
            }

            var closes = context.PreviousCandles.TakeLast(3).Select(x => x.Close).ToArray();
            if (closes[0] < closes[1] && closes[1] < closes[2])
            {
                return new(OpenLong, "前 3 根结算价严格递增，开多。", context.Candle.Close);
            }

            if (closes[0] > closes[1] && closes[1] > closes[2])
            {
                return new(OpenShort, "前 3 根结算价严格递减，开空。", context.Candle.Close);
            }

            return new(Hold, "前 3 根结算价未形成同向趋势，继续观望。");
        }

        return EvaluateContractStops(context, "持仓监控中，未触发平仓条件。");
    }
}

internal sealed class TrendTradingStrategy : TradingStrategyBase, ITradingStrategy
{
    public StrategyParameterSetDto DefaultParams { get; } = new(1.2m, 2.5m, StrategyRegistryService.DefaultLeverage);
    public StrategyDefinitionDto Definition { get; }

    public TrendTradingStrategy()
    {
        Definition = BuildDefinition("trend", "趋势跟随策略", "价格站上 20 均线时只开多，跌回均线下方或触发止损、回撤后平仓。", DefaultParams);
    }

    public StrategyBacktestResult RunBacktest(List<CandlePointDto> candles, decimal stopLossPct, decimal trailingDrawdownPct, decimal leverage)
    {
        StrategyRegistryService.ValidateLeveragedStopLoss(stopLossPct, leverage);

        var trades = new List<BacktestTradePointDto>();
        var positionSide = "flat";
        decimal? entry = null;
        long? entryTs = null;
        decimal? peak = null;
        decimal? trough = null;
        var lastSignal = Hold;
        var signalReason = candles.Count < 21 ? "趋势策略至少需要 21 根已收盘 K 线。" : "等待趋势确认。";
        var parameters = new StrategyParameterSetDto(stopLossPct, trailingDrawdownPct, leverage);

        for (var i = 0; i < candles.Count; i++)
        {
            var candle = candles[i];
            var previous = candles.Take(i).ToList();
            var decision = EvaluateRealtimePeriod(new RealtimePeriodContext(
                candle,
                previous,
                positionSide,
                entry,
                peak,
                trough,
                parameters));

            lastSignal = decision.Action;
            signalReason = decision.Reason;

            if (positionSide == "flat")
            {
                if (decision.Action == OpenLong)
                {
                    positionSide = "long";
                    entry = decision.ExecutionPrice ?? candle.Close;
                    entryTs = candle.Ts;
                    peak = candle.Close;
                    trough = candle.Close;
                }

                continue;
            }

            peak = Math.Max(peak ?? entry ?? candle.Close, candle.Close);
            trough = Math.Min(trough ?? entry ?? candle.Close, candle.Close);

            if (decision.Action != Close || !entry.HasValue || !entryTs.HasValue) continue;

            var exit = decision.ExecutionPrice ?? candle.Close;
            trades.Add(BuildTradePoint(
                entryTs.Value,
                entry.Value,
                candle.Ts,
                exit,
                positionSide,
                NormalizeTradeReason(signalReason),
                leverage));

            positionSide = "flat";
            entry = null;
            entryTs = null;
            peak = null;
            trough = null;
        }

        return BuildDetail(
            stopLossPct,
            trailingDrawdownPct,
            leverage,
            trades,
            positionSide != "flat",
            entry,
            entryTs,
            positionSide,
            lastSignal,
            signalReason);
    }

    public RealtimePeriodDecision EvaluateRealtimePeriod(RealtimePeriodContext context)
    {
        if (context.PreviousCandles.Count < 20)
        {
            return new(Hold, "趋势策略至少需要 20 根历史 K 线。");
        }

        var previous = context.PreviousCandles.TakeLast(20).ToList();
        var movingAverage = previous.Average(x => x.Close);
        var previousHigh = previous.Max(x => x.High);

        if (string.Equals(context.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
        {
            return context.Candle.Close > movingAverage && context.Candle.Close >= previousHigh * 0.995m
                ? new(OpenLong, "已收盘 K 线上穿 20 均线并接近区间高点。", context.Candle.Close)
                : new(Hold, "趋势未满足开仓条件。");
        }

        if (context.Candle.Close < movingAverage)
        {
            return new(Close, "已收盘 K 线跌回 20 均线下方。", context.Candle.Close);
        }

        return EvaluateContractStops(context, "趋势持仓中，未触发平仓条件。");
    }
}
