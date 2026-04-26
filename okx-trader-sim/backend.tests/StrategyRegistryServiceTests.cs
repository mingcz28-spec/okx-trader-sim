using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;
using Xunit;

namespace OkxTraderSim.Api.Tests;

public sealed class StrategyRegistryServiceTests
{
    private readonly StrategyRegistryService _registry = new();

    [Fact]
    public void StrategyDefinitions_ExposeModuleCapabilities()
    {
        var buySell = _registry.GetDefinition("buy-sell");
        var trend = _registry.GetDefinition("trend");
        var meanReversion = _registry.GetDefinition("mean-reversion");

        Assert.True(buySell.SupportsBacktest);
        Assert.True(buySell.SupportsRealtime);
        Assert.True(buySell.SupportsSimulation);
        Assert.True(buySell.SupportsLive);

        Assert.True(trend.SupportsBacktest);
        Assert.True(trend.SupportsSimulation);
        Assert.True(trend.SupportsLive);

        Assert.False(meanReversion.SupportsBacktest);
        Assert.False(meanReversion.SupportsSimulation);
        Assert.False(meanReversion.SupportsLive);
    }

    [Fact]
    public void ValidateLeveragedStopLoss_RejectsStopLossAboveTenPercent()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => StrategyRegistryService.ValidateLeveragedStopLoss(10.1m, 1m));
        Assert.Contains("LEVERAGED_STOP_LOSS_LIMIT_EXCEEDED", ex.Message);
    }

    [Fact]
    public void BuySellRealtimeDecision_UsesMovingAverageTrendForLongEntry()
    {
        var strategy = _registry.GetRunnable("buy-sell");
        var previousCandles = BuildMovingAverageCandles(0.80m, 0.002m, 21);
        var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(
            Candle(22, 0.86m, 0.87m, 0.85m, 0.865m),
            previousCandles,
            "flat",
            null,
            null,
            null,
            new StrategyParameterSetDto(20, 1m, 2m, 3m)));

        Assert.Equal("open_long", decision.Action);
        Assert.Contains("均值曲线向上", decision.Reason);
        Assert.Equal(0.865m, decision.ExecutionPrice);
    }

    [Fact]
    public void BuySellRealtimeDecision_UsesMovingAverageTrendForShortEntry()
    {
        var strategy = _registry.GetRunnable("buy-sell");
        var previousCandles = BuildMovingAverageCandles(1.00m, -0.002m, 21);
        var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(
            Candle(22, 0.94m, 0.95m, 0.93m, 0.935m),
            previousCandles,
            "flat",
            null,
            null,
            null,
            new StrategyParameterSetDto(20, 1m, 2m, 3m)));

        Assert.Equal("open_short", decision.Action);
        Assert.Contains("均值曲线向下", decision.Reason);
    }

    [Fact]
    public void BuySellRealtimeDecision_LongStopLossHasPriority()
    {
        var strategy = _registry.GetRunnable("buy-sell");
        var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(
            Candle(40, 100m, 101m, 98m, 100.5m),
            BuildFlatCandles(39, 100m),
            "long",
            100m,
            110m,
            99m,
            new StrategyParameterSetDto(20, 3m, 10m, 3m)));

        Assert.Equal("close", decision.Action);
        Assert.Contains("止损", decision.Reason);
        Assert.Equal(99m, decision.ExecutionPrice);
    }

    [Fact]
    public void BuySellRealtimeDecision_LongTrailingDrawdownClosesByProfitGiveback()
    {
        var strategy = _registry.GetRunnable("buy-sell");
        var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(
            Candle(40, 111m, 112m, 110m, 110m),
            BuildFlatCandles(39, 100m),
            "long",
            100m,
            120m,
            100m,
            new StrategyParameterSetDto(20, 1m, 20m, 3m)));

        Assert.Equal("close", decision.Action);
        Assert.Contains("浮盈回撤", decision.Reason);
        Assert.Equal(110m, decision.ExecutionPrice);
    }

    [Fact]
    public void TrendRealtimeDecision_OnlyOpensLongWhenTrendBreaksHigher()
    {
        var strategy = _registry.GetRunnable("trend");
        var previousCandles = BuildFlatCandles(20, 100m);
        previousCandles[^1] = Candle(20, 100m, 101m, 99.5m, 100.8m);

        var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(
            Candle(21, 101m, 102m, 100.8m, 101.5m),
            previousCandles,
            "flat",
            null,
            null,
            null,
            new StrategyParameterSetDto(20, 1.2m, 2.5m, 3m)));

        Assert.Equal("open_long", decision.Action);
        Assert.Contains("20 均线", decision.Reason);
    }

    [Fact]
    public void RunRealtimeTest_ProducesTradePointsWithPnlFields()
    {
        var strategy = _registry.GetRunnable("buy-sell");
        var candles = new List<CandlePointDto>();
        candles.AddRange(BuildMovingAverageCandles(1.00m, 0.01m, 21));
        candles.Add(Candle(22, 1.22m, 1.25m, 1.21m, 1.24m));
        candles.Add(Candle(23, 1.24m, 1.25m, 1.10m, 1.12m));

        var result = strategy.RunRealtimeTest(candles, new StrategyParameterSetDto(20, 1m, 15m, 3m));

        var trade = Assert.Single(result.TradePoints);
        Assert.NotNull(trade.GrossPnl);
        Assert.NotNull(trade.Fee);
        Assert.NotNull(trade.NetPnl);
        Assert.NotNull(trade.NetReturn);
        Assert.Equal("simulated", trade.ExecutionMode);
        Assert.Equal("model", trade.ReconciliationStatus);
        Assert.True(trade.NetPnl < trade.GrossPnl);
    }

    private static List<CandlePointDto> BuildMovingAverageCandles(decimal start, decimal step, int count)
    {
        var candles = new List<CandlePointDto>(count);
        for (var i = 0; i < count; i++)
        {
            var close = start + step * i;
            candles.Add(Candle(i + 1, close, close + 0.01m, close - 0.01m, close));
        }

        return candles;
    }

    private static List<CandlePointDto> BuildFlatCandles(int count, decimal close)
    {
        var candles = new List<CandlePointDto>(count);
        for (var i = 0; i < count; i++)
        {
            candles.Add(Candle(i + 1, close, close + 0.01m, close - 0.01m, close));
        }

        return candles;
    }

    private static CandlePointDto Candle(long ts, decimal open, decimal high, decimal low, decimal close) =>
        new(ts, open, high, low, close);
}
