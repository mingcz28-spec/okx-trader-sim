using OkxTraderSim.Api.Models;

namespace OkxTraderSim.Api.Services;

public sealed record TradePnlResult(
    decimal GrossPnl,
    decimal EntryFee,
    decimal ExitFee,
    decimal FundingFee,
    decimal NetPnl,
    decimal GrossReturn,
    decimal NetReturn,
    decimal EntryNotionalUsd,
    decimal ExitNotionalUsd,
    decimal FeeCostRate);

public sealed record FillAggregate(
    decimal AveragePrice,
    decimal Size,
    decimal Fee,
    decimal FillPnl,
    string? FeeCcy,
    long? LastFillTs);

public static class PnlCalculator
{
    public static TradePnlResult CalculateLinearSwap(
        string side,
        decimal entryPrice,
        decimal exitPrice,
        decimal size,
        decimal contractValue,
        decimal allocatedCapital,
        decimal entryFeeRate,
        decimal exitFeeRate,
        decimal? actualEntryFee = null,
        decimal? actualExitFee = null,
        decimal fundingFee = 0m,
        decimal? actualGrossPnl = null)
    {
        if (entryPrice <= 0m || exitPrice <= 0m || size <= 0m || contractValue <= 0m || allocatedCapital <= 0m)
        {
            return new TradePnlResult(0m, 0m, 0m, fundingFee, 0m, 0m, 0m, 0m, 0m, 0m);
        }

        var quantity = size * contractValue;
        var modelGrossPnl = string.Equals(side, "short", StringComparison.OrdinalIgnoreCase)
            ? (entryPrice - exitPrice) * quantity
            : (exitPrice - entryPrice) * quantity;
        var grossPnl = actualGrossPnl ?? modelGrossPnl;
        var entryNotional = entryPrice * quantity;
        var exitNotional = exitPrice * quantity;
        var entryFee = NormalizeFee(actualEntryFee) ?? entryNotional * entryFeeRate;
        var exitFee = NormalizeFee(actualExitFee) ?? exitNotional * exitFeeRate;
        var totalFee = entryFee + exitFee;
        var netPnl = grossPnl - totalFee + fundingFee;
        var grossReturn = grossPnl / allocatedCapital;
        var netReturn = netPnl / allocatedCapital;
        var feeCostRate = totalFee / allocatedCapital;

        return new TradePnlResult(grossPnl, entryFee, exitFee, fundingFee, netPnl, grossReturn, netReturn, entryNotional, exitNotional, feeCostRate);
    }

    public static FillAggregate? AggregateFills(IEnumerable<OkxFillDocument> fills)
    {
        var list = fills.Where(x => x.FillSize > 0m).ToList();
        if (list.Count == 0) return null;

        var size = list.Sum(x => x.FillSize);
        var weightedPrice = list.Sum(x => x.FillPrice * x.FillSize) / size;
        var fee = list.Sum(x => x.Fee);
        var fillPnl = list.Sum(x => x.FillPnl);
        var feeCcy = list.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x.FeeCcy))?.FeeCcy;
        var lastFillTs = list.Max(x => new DateTimeOffset(x.FillTime).ToUnixTimeMilliseconds());
        return new FillAggregate(weightedPrice, size, fee, fillPnl, feeCcy, lastFillTs);
    }

    public static decimal CalculateSimulatedSize(decimal allocatedCapital, decimal leverage, decimal entryPrice, decimal contractValue)
    {
        if (allocatedCapital <= 0m || leverage <= 0m || entryPrice <= 0m || contractValue <= 0m) return 0m;
        return allocatedCapital * leverage / (entryPrice * contractValue);
    }

    private static decimal? NormalizeFee(decimal? fee)
    {
        if (!fee.HasValue) return null;
        return Math.Abs(fee.Value);
    }
}
