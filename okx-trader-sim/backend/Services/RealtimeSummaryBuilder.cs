using OkxTraderSim.Api.Models;

namespace OkxTraderSim.Api.Services;

public static class RealtimeSummaryBuilder
{
    public static RealtimeTradingSummaryDto? BuildLiveTradingSummary(RealtimeSessionDocument? session)
    {
        return BuildTradingSummary(session, "live");
    }

    public static RealtimeTradingSummaryDto? BuildSimulatedTradingSummary(RealtimeSessionDocument? session)
    {
        return BuildTradingSummary(session, "simulated");
    }

    public static RealtimeTradingSummaryDto? BuildTradingSummary(RealtimeSessionDocument? session, string mode)
    {
        if (session is null)
        {
            return null;
        }

        var trades = session.TradePoints
            .Where(x => string.Equals(x.ExecutionMode, mode, StringComparison.OrdinalIgnoreCase))
            .ToList();
        var lastTrade = trades.LastOrDefault();
        var lastEvaluation = session.PeriodEvaluations.LastOrDefault();

        var grossPnl = trades.Sum(x => x.GrossPnl ?? 0m);
        var fee = trades.Sum(x => Math.Abs(x.Fee ?? 0m));
        var fundingFee = trades.Sum(x => x.FundingFee ?? 0m);
        var netPnl = trades.Sum(x => x.NetPnl ?? 0m);
        var netReturn = trades.Count == 0
            ? 0m
            : trades.Aggregate(1m, (acc, trade) => acc * (1m + (trade.NetReturn ?? trade.NetRet))) - 1m;

        return new RealtimeTradingSummaryDto(
            session.Status,
            session.InstId,
            session.Bar,
            session.StrategyType,
            session.PositionSide,
            Math.Round(netPnl, 8),
            netReturn,
            Math.Round(grossPnl, 8),
            Math.Round(fee, 8),
            Math.Round(fundingFee, 8),
            lastTrade?.ExitOrderId ?? lastTrade?.OrderId ?? session.LastOrderId,
            lastTrade?.ExitAvgPx ?? lastTrade?.ExecutedPrice ?? session.LastExecutionPrice,
            lastTrade?.ExitTs > 0 ? lastTrade.ExitTs : session.LastExecutionTs,
            ResolveReconciliationStatus(session, trades, lastEvaluation, mode));
    }

    private static string ResolveReconciliationStatus(
        RealtimeSessionDocument session,
        List<BacktestTradePointDto> trades,
        RealtimePeriodEvaluationDto? lastEvaluation,
        string mode)
    {
        if (string.Equals(mode, "simulated", StringComparison.OrdinalIgnoreCase))
        {
            return trades.Count > 0 || session.PeriodEvaluations.Count > 0 ? "model" : "not_started";
        }

        var statuses = trades
            .Select(x => x.ReconciliationStatus)
            .Append(session.ReconciliationStatus)
            .Append(lastEvaluation?.ReconciliationStatus)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!)
            .ToList();

        if (statuses.Count == 0)
        {
            return "not_started";
        }

        if (statuses.Any(x => string.Equals(x, "failed", StringComparison.OrdinalIgnoreCase)))
        {
            return "failed";
        }

        if (statuses.Any(x => string.Equals(x, "pending_fills", StringComparison.OrdinalIgnoreCase)))
        {
            return "pending_fills";
        }

        if (statuses.Any(x => string.Equals(x, "pending_position_history", StringComparison.OrdinalIgnoreCase)))
        {
            return "pending_position_history";
        }

        if (trades.Count > 0 && trades.All(x => string.Equals(x.ReconciliationStatus, "reconciled", StringComparison.OrdinalIgnoreCase)))
        {
            return "reconciled";
        }

        return session.ReconciliationStatus;
    }
}
