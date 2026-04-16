namespace OkxTraderSim.Api.Models;

public sealed record SaveOkxConfigRequest(string ApiKey, string SecretKey, string Passphrase);
public sealed record OkxModeRequest(string? Mode);
public sealed record SimulatedTradeRequest(string? Symbol, string? Side, decimal? Leverage, decimal? Notional);
public sealed record BacktestRequest(string? InstId, string? Bar, string? StrategyType);
public sealed record BacktestDetailRequest(string? InstId, string? Bar, string? StrategyType, decimal? StopLossPct, decimal? TrailingDrawdownPct);
public sealed record ApiEnvelope<T>(bool Ok, T? Data, string? Message = null, string? Code = null);
