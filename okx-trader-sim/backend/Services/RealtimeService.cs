using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class RealtimeService
{
    private readonly AppRepository _repository;
    private readonly OkxClient _okxClient;
    private readonly StrategyRegistryService _strategyRegistry;

    public RealtimeService(AppRepository repository, OkxClient okxClient, StrategyRegistryService strategyRegistry)
    {
        _repository = repository;
        _okxClient = okxClient;
        _strategyRegistry = strategyRegistry;
    }

    public async Task<object> GetConsoleAsync()
    {
        var state = await _repository.GetAppStateAsync();
        var strategyConfig = await _repository.GetStrategyConfigAsync();
        strategyConfig.StrategyType = _strategyRegistry.NormalizeStrategyId(strategyConfig.StrategyType);
        var tradingStrategy = _strategyRegistry.GetRunnable(strategyConfig.StrategyType);
        var strategyDefinition = tradingStrategy.Definition;
        var positions = await _repository.GetPositionsAsync();
        var balances = await _repository.GetBalancesAsync();
        var latestBacktest = await _repository.GetLatestBacktestAsync();

        var symbol = positions.FirstOrDefault()?.Symbol
            ?? latestBacktest?.InstId
            ?? "RAVE-USDT-SWAP";

        var candles = new List<CandlePointDto>();
        decimal? lastPrice = null;
        string? marketNote = null;
        try
        {
            candles = await _okxClient.GetHistoryCandlesAsync(symbol, "1m", 100, 1);
            lastPrice = candles.LastOrDefault()?.Close;
        }
        catch (Exception ex)
        {
            lastPrice = positions.FirstOrDefault()?.MarkPrice;
            marketNote = $"行情读取失败，已使用持仓标记价或保持观望：{ex.Message}";
        }

        var openPosition = positions.FirstOrDefault();
        var hasPosition = openPosition is not null;
        var entryPrice = strategyConfig.EntryPrice ?? openPosition?.EntryPrice;
        var riskState = BuildRiskState(state, hasPosition);
        var signal = tradingStrategy.EvaluateRealtimeSignal(new RealtimeStrategyContext(lastPrice, hasPosition, entryPrice, strategyConfig, candles));
        var advice = BuildAdvice(signal, hasPosition, state, riskState);
        var logs = BuildLogs(
            state,
            strategyConfig,
            strategyDefinition,
            symbol,
            lastPrice,
            hasPosition,
            entryPrice,
            latestBacktest,
            balances.Sum(x => x.AvailableBalance),
            candles.Count,
            marketNote);

        strategyConfig.LastSignal = signal;
        if (lastPrice.HasValue && hasPosition)
        {
            strategyConfig.HighestPriceSinceEntry = Math.Max(strategyConfig.HighestPriceSinceEntry ?? lastPrice.Value, lastPrice.Value);
        }
        else if (!hasPosition)
        {
            strategyConfig.HighestPriceSinceEntry = null;
            strategyConfig.EntryPrice = null;
        }

        await _repository.SaveStrategyConfigAsync(strategyConfig);

        return new
        {
            strategyType = strategyDefinition.Id,
            strategyName = strategyDefinition.Name,
            strategyStatusLabel = strategyDefinition.Status,
            strategyStatus = state.StrategyStatus,
            lastSignal = signal,
            stopLossPct = strategyConfig.StopLossPct,
            trailingDrawdownPct = strategyConfig.TrailingDrawdownPct,
            riskState,
            executionAdvice = advice,
            positionCount = positions.Count,
            logs
        };
    }

    private static string BuildRiskState(AppStateDocument state, bool hasPosition)
    {
        if (state.DrawdownPct <= -5m) return "高风险，停止加仓";
        if (state.DrawdownPct <= -3m) return "风险收缩";
        if (hasPosition) return "持仓监控中";
        return "正常观察";
    }

    private static string BuildAdvice(string signal, bool hasPosition, AppStateDocument state, string riskState)
    {
        if (riskState == "高风险，停止加仓")
        {
            return "暂停新增仓位，只允许人工减仓或观望。";
        }

        return signal switch
        {
            "buy" when !hasPosition => "满足入场条件，可人工确认后开仓。",
            "sell" when hasPosition => "已触发退出条件，可人工确认后平仓。",
            _ when state.StrategyStatus == "running" => "保持监控，等待下一次信号确认。",
            _ => "等待人工启动策略。"
        };
    }

    private static string[] BuildLogs(
        AppStateDocument state,
        StrategyConfigDocument strategy,
        StrategyDefinitionDto strategyDefinition,
        string symbol,
        decimal? lastPrice,
        bool hasPosition,
        decimal? entryPrice,
        BacktestDocument? latestBacktest,
        decimal availableBalance,
        int candleCount,
        string? marketNote)
    {
        var lines = new List<string>
        {
            $"当前策略: {strategyDefinition.Name} ({strategyDefinition.Id})",
            $"监控标的: {symbol}",
            $"策略状态: {state.StrategyStatus}",
            $"最近价格: {(lastPrice.HasValue ? lastPrice.Value.ToString("0.########") : "unknown")}",
            $"实时 K 线样本: {candleCount}",
            $"可用余额: {availableBalance:0.####}",
            $"持仓状态: {(hasPosition ? "已有持仓" : "空仓等待")}",
            $"参数: 止损 {strategy.StopLossPct:0.##}% / 移动回撤 {strategy.TrailingDrawdownPct:0.##}%"
        };

        if (!string.IsNullOrWhiteSpace(marketNote))
        {
            lines.Add(marketNote);
        }

        if (strategyDefinition.Id == "trend" && candleCount < 21)
        {
            lines.Add("趋势跟随策略需要至少 21 根 1m K 线，样本不足时保持观望。");
        }

        if (entryPrice.HasValue)
        {
            lines.Add($"入场参考价: {entryPrice.Value:0.########}");
        }

        if (strategy.HighestPriceSinceEntry.HasValue)
        {
            lines.Add($"入场后最高价: {strategy.HighestPriceSinceEntry.Value:0.########}");
        }

        if (latestBacktest?.Selected is not null)
        {
            lines.Add($"最近回测优选: 止损 {latestBacktest.Selected.StopLossPct}% / 回撤 {latestBacktest.Selected.TrailingDrawdownPct}% / 收益 {latestBacktest.Selected.TotalReturn:P2}");
        }

        lines.Add("系统只生成实时信号与人工执行建议，不会自动下单。");
        return lines.ToArray();
    }
}
