using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace OkxTraderSim.Api.Models;

public static class DocumentIds
{
    public const string Default = "default";
}

public sealed class AppStateDocument
{
    [BsonId] public string Id { get; set; } = DocumentIds.Default;
    public decimal Equity { get; set; } = 10000m;
    public decimal AvailableMargin { get; set; } = 8420m;
    public decimal DailyPnl { get; set; } = 132.4m;
    public decimal DrawdownPct { get; set; } = -1.8m;
    public string StrategyStatus { get; set; } = "idle";
    public string CurrencyMode { get; set; } = "USD";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class ApiConnectionDocument
{
    [BsonId] public string Id { get; set; } = DocumentIds.Default;
    public string ApiKey { get; set; } = string.Empty;
    public string EncryptedSecretKey { get; set; } = string.Empty;
    public string EncryptedPassphrase { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class RiskConfigDocument
{
    [BsonId] public string Id { get; set; } = DocumentIds.Default;
    public decimal MaxPositionPct { get; set; } = 5m;
    public decimal MaxDailyLossPct { get; set; } = 3m;
    public int MaxConsecutiveLosses { get; set; } = 3;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class StrategyConfigDocument
{
    [BsonId] public string Id { get; set; } = DocumentIds.Default;
    public string StrategyType { get; set; } = "buy-sell";
    public bool Enabled { get; set; }
    public string EntrySide { get; set; } = "buy";
    public decimal StopLossPct { get; set; } = 1m;
    public decimal TrailingDrawdownPct { get; set; } = 2m;
    public decimal Leverage { get; set; } = 3m;
    public decimal? HighestPriceSinceEntry { get; set; }
    public decimal? EntryPrice { get; set; }
    public string LastSignal { get; set; } = "hold";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class PositionDocument
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Symbol { get; set; } = string.Empty;
    public string Side { get; set; } = "long";
    public decimal Leverage { get; set; }
    public string? MarginMode { get; set; }
    public decimal? Quantity { get; set; }
    public decimal Notional { get; set; }
    public decimal? MarginUsed { get; set; }
    public decimal? UnrealizedPnl { get; set; }
    public decimal EntryPrice { get; set; }
    public decimal MarkPrice { get; set; }
    public decimal PnlPct { get; set; }
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
}

public sealed class BalanceDetailDocument
{
    [BsonId] public string Ccy { get; set; } = "USDT";
    public decimal Equity { get; set; }
    public decimal CashBalance { get; set; }
    public decimal AvailableBalance { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class OrderHistoryDocument
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Symbol { get; set; } = string.Empty;
    public string Side { get; set; } = string.Empty;
    public string OrderType { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public decimal Size { get; set; }
    public decimal FilledSize { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class RawOkxPayloadDocument
{
    [BsonId] public string Id { get; set; } = DocumentIds.Default;
    public string? AccountBalance { get; set; }
    public string? AccountPositions { get; set; }
    public string? OrdersHistory { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class BacktestDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    public bool IsLatest { get; set; }
    public string InstId { get; set; } = "RAVE-USDT-SWAP";
    public string Bar { get; set; } = "1H";
    public string StrategyType { get; set; } = "buy-sell";
    public int CandlesCount { get; set; }
    public List<BacktestResultDto> Results { get; set; } = [];
    public List<BacktestResultDto> Top { get; set; } = [];
    public BacktestResultDto? Selected { get; set; }
    public List<CandlePointDto> ChartCandles { get; set; } = [];
    public List<BacktestTradePointDto> TradePoints { get; set; } = [];
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class RealtimeSessionDocument
{
    [BsonId] public string Id { get; set; } = DocumentIds.Default;
    public string SessionId { get; set; } = DocumentIds.Default;
    public string Mode { get; set; } = "simulated";
    public string InstId { get; set; } = "RAVE-USDT-SWAP";
    public string Bar { get; set; } = "1m";
    public string StrategyType { get; set; } = "buy-sell";
    public decimal StopLossPct { get; set; } = 1m;
    public decimal TrailingDrawdownPct { get; set; } = 2m;
    public decimal Leverage { get; set; } = 3m;
    public string ParamsSource { get; set; } = "module-default";
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "running";
    public string PositionSide { get; set; } = "flat";
    public decimal? EntryPrice { get; set; }
    public long? EntryTs { get; set; }
    public decimal? PeakPrice { get; set; }
    public decimal? TroughPrice { get; set; }
    public decimal? PositionSize { get; set; }
    public decimal? AllocatedCapital { get; set; }
    public decimal? EntryNotionalUsd { get; set; }
    public long? LastSettledCandleTs { get; set; }
    public decimal RealizedEquity { get; set; } = 1m;
    public decimal LastEquity { get; set; } = 1m;
    public string LastSignal { get; set; } = "hold";
    public string SignalReason { get; set; } = "等待下一根已收盘 K 线确认。";
    public string? LastOrderId { get; set; }
    public decimal? LastExecutionPrice { get; set; }
    public long? LastExecutionTs { get; set; }
    public decimal? LastExecutionSize { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public List<RealtimePeriodEvaluationDto> PeriodEvaluations { get; set; } = [];
    public List<BacktestTradePointDto> TradePoints { get; set; } = [];
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed record ApiConnectionSummaryDto(string ApiKeyMasked, bool HasApiKey, DateTime? UpdatedAt);
public sealed record RiskConfigDto(decimal MaxPositionPct, decimal MaxDailyLossPct, int MaxConsecutiveLosses);
public sealed record StrategyConfigDto(string StrategyType, bool Enabled, string EntrySide, decimal StopLossPct, decimal TrailingDrawdownPct, decimal Leverage, decimal? HighestPriceSinceEntry, decimal? EntryPrice, string LastSignal);
public sealed record BalanceDetailDto(string Ccy, decimal Equity, decimal CashBalance, decimal AvailableBalance);
public sealed record OrderHistoryDto(string Id, string Symbol, string Side, string OrderType, string State, decimal Price, decimal Size, decimal FilledSize, DateTime CreatedAt);
public sealed record PositionDto(string Id, string Symbol, string Side, decimal Leverage, string? MarginMode, decimal? Quantity, decimal Notional, decimal? MarginUsed, decimal? UnrealizedPnl, decimal EntryPrice, decimal MarkPrice, decimal PnlPct, DateTime OpenedAt);
public sealed record CandlePointDto(long Ts, decimal Open, decimal High, decimal Low, decimal Close);
public sealed record OrderBookLevelDto(decimal Price, decimal Size, decimal Total, int Orders);
public sealed record OrderBookDto(string InstId, DateTime UpdatedAt, List<OrderBookLevelDto> Bids, List<OrderBookLevelDto> Asks);
public sealed record BacktestTradePointDto(
    long EntryTs,
    decimal EntryPrice,
    long ExitTs,
    decimal ExitPrice,
    decimal Ret,
    string Reason,
    string Side,
    decimal GrossRet,
    decimal NetRet,
    decimal Leverage,
    decimal FeeCost,
    decimal EntryFeeRate,
    decimal ExitFeeRate,
    string? OrderId = null,
    string ExecutionMode = "simulated",
    string? RequestedAction = null,
    string? ExecutedSide = null,
    decimal? ExecutedPrice = null,
    decimal? ExecutedSize = null,
    string? ExchangeState = null);
public sealed record BacktestResultDto(
    decimal StopLossPct,
    decimal TrailingDrawdownPct,
    decimal Leverage,
    int Trades,
    decimal WinRate,
    decimal TotalReturn,
    decimal MaxDrawdown,
    decimal GrossTotalReturn,
    decimal NetTotalReturn,
    decimal FeeCost);
public sealed record StrategyParameterSetDto(decimal StopLossPct, decimal TrailingDrawdownPct, decimal Leverage = 3m);
public sealed record StrategyParameterDto(string Id, string Label, string Description, decimal Value, string Unit);
public sealed record StrategyDefinitionDto(string Id, string Name, string Description, string Status, bool SupportsBacktest, bool SupportsRealtime, StrategyParameterSetDto DefaultParams, List<StrategyParameterDto> Parameters);
public sealed record InstrumentSuggestionDto(string InstId, string BaseCcy, string QuoteCcy, string InstType, string State);
public sealed record RealtimeSessionDto(
    string SessionId,
    string Mode,
    string InstId,
    string Bar,
    string StrategyType,
    StrategyParameterSetDto Params,
    string ParamsSource,
    DateTime StartedAt,
    string Status,
    string PositionSide,
    decimal? EntryPrice,
    long? EntryTs,
    decimal? PeakPrice,
    decimal? TroughPrice,
    decimal? PositionSize,
    decimal? AllocatedCapital,
    decimal? EntryNotionalUsd,
    long? LastSettledCandleTs,
    string? LastOrderId,
    decimal? LastExecutionPrice,
    long? LastExecutionTs,
    decimal? LastExecutionSize,
    string? ErrorCode,
    string? ErrorMessage);
public sealed record RealtimeLiveSessionDto(
    string SessionId,
    string Mode,
    string InstId,
    string Bar,
    string StrategyType,
    StrategyParameterSetDto Params,
    string ParamsSource,
    DateTime StartedAt,
    string Status,
    string PositionSide,
    decimal? EntryPrice,
    long? EntryTs,
    decimal? PositionSize,
    decimal? AllocatedCapital,
    decimal? EntryNotionalUsd,
    long? LastSettledCandleTs,
    string LastSignal,
    string SignalReason,
    string? LastOrderId,
    decimal? LastExecutionPrice,
    long? LastExecutionTs,
    decimal? LastExecutionSize,
    string? ErrorCode,
    string? ErrorMessage,
    BacktestResultDto? Summary,
    List<BacktestTradePointDto> TradePoints,
    BacktestTradePointDto? LastTrade,
    RealtimePeriodEvaluationDto? LastEvaluation);
public sealed record RealtimePeriodEvaluationDto(
    long Ts,
    decimal Close,
    string Action,
    string PositionSide,
    decimal? ExecutionPrice,
    string Reason,
    string PositionStatus,
    decimal PeriodReturn,
    decimal RealizedReturn,
    decimal UnrealizedReturn,
    decimal TotalReturn,
    decimal GrossReturn,
    decimal NetReturn,
    decimal FeeCost,
    decimal EntryFeeRate,
    decimal ExitFeeRate,
    decimal Equity);
public sealed record RealtimeSimulationDto(
    BacktestResultDto? Summary,
    List<CandlePointDto> Candles,
    List<BacktestTradePointDto> TradePoints,
    StrategyParameterSetDto StrategyParams,
    List<StrategyParameterDto> ParameterDefinitions,
    List<RealtimePeriodEvaluationDto> PeriodEvaluations,
    List<decimal> EquityCurve,
    decimal RealizedReturn,
    decimal UnrealizedReturn,
    string PositionStatus,
    decimal? OpenEntryPrice,
    long? OpenEntryTs,
    decimal? LastTradeReturn,
    string LastSignal,
    string SignalReason,
    int BuyPoints,
    int SellPoints,
    string ParamsSource,
    bool HasSelectedParams,
    bool IsConfirmed);
public sealed record RealtimeLiveDto(
    string ConnectionStatus,
    string ConfirmationStatus,
    string Signal,
    string SignalReason,
    DateTime TriggeredAt,
    decimal? TriggerPrice,
    int PositionCount,
    string RiskNote,
    bool HasAccountConnection);
public sealed record RealtimeWorkspaceDto(
    string InstId,
    string Bar,
    string SelectedStrategyType,
    string? PendingStrategyType,
    string? ConfirmedStrategyType,
    RealtimeSessionDto? ConfirmedSession,
    RealtimeLiveSessionDto? LiveSession,
    StrategyParameterSetDto StrategyParams,
    string ParamsSource,
    List<CandlePointDto> Candles,
    CandlePointDto? CurrentCandle,
    decimal? LatestPrice,
    long? LastClosedCandleTs,
    DateTime? NextRefreshAt,
    DateTime UpdatedAt,
    RealtimeSimulationDto Simulation,
    RealtimeLiveDto Live);

public sealed record OkxAccountConfigDto(
    string PositionMode,
    bool CanTrade,
    string AccountLevel,
    string MarginModeHint,
    string TradingMode);

public sealed record BacktestSummaryDto(string? Id, string InstId, string Bar, string StrategyType, int Candles, List<BacktestResultDto> Results, List<BacktestResultDto> Top, BacktestResultDto? Selected, List<CandlePointDto> ChartCandles, List<BacktestTradePointDto> TradePoints);

public sealed record AppStateDto(
    ApiConnectionSummaryDto ApiConnection,
    RiskConfigDto RiskConfig,
    StrategyConfigDto StrategyConfig,
    decimal Equity,
    decimal AvailableMargin,
    decimal DailyPnl,
    decimal DrawdownPct,
    string StrategyStatus,
    string CurrencyMode,
    List<BalanceDetailDto> BalanceDetails,
    List<OrderHistoryDto> OrderHistory,
    BacktestSummaryDto? Backtest,
    List<PositionDto> Positions);
