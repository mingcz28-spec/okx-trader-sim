using System.Globalization;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class RealtimeService
{
    private static readonly HashSet<string> SupportedBars = ["1m", "5m", "15m", "1H", "4H", "1D"];
    private const decimal EntryFeeRate = StrategyRegistryService.DefaultTakerFeeRate;
    private const decimal ExitFeeRate = StrategyRegistryService.DefaultTakerFeeRate;
    private const decimal RoundTripFeeRate = EntryFeeRate + ExitFeeRate;
    private const decimal MaxLiveCapitalUsageRate = 0.2m;
    private readonly AppRepository _repository;
    private readonly OkxClient _okxClient;
    private readonly StrategyRegistryService _strategyRegistry;

    public RealtimeService(AppRepository repository, OkxClient okxClient, StrategyRegistryService strategyRegistry)
    {
        _repository = repository;
        _okxClient = okxClient;
        _strategyRegistry = strategyRegistry;
    }

    public Task<IReadOnlyList<InstrumentSuggestionDto>> SearchInstrumentsAsync(string? query) => _okxClient.SearchSwapInstrumentsAsync(query ?? string.Empty);

    public async Task<RealtimeWorkspaceDto> ConfirmSessionAsync(ConfirmRealtimeSessionRequest request)
    {
        var latestBacktest = await _repository.GetLatestBacktestAsync();
        var positions = await _repository.GetPositionsAsync();
        var strategyType = _strategyRegistry.NormalizeStrategyId(request.StrategyType);
        var strategy = _strategyRegistry.GetRunnable(strategyType);
        var instId = NormalizeInstId(request.InstId, positions, latestBacktest);
        var bar = NormalizeBar(request.Bar);
        var parameters = BuildParameters(request.StopLossPct, request.TrailingDrawdownPct, request.Leverage, strategy.DefaultParams);
        var (defaultParams, defaultSource) = ResolveParameters(latestBacktest, strategy, strategyType, instId, bar);
        var source = SameParams(parameters, defaultParams) ? defaultSource : "manual";
        var session = new RealtimeSessionDocument
        {
            SessionId = DocumentIds.Default, Mode = "simulated", InstId = instId, Bar = bar, StrategyType = strategy.Definition.Id,
            StopLossPct = parameters.StopLossPct, TrailingDrawdownPct = parameters.TrailingDrawdownPct, Leverage = parameters.Leverage,
            ParamsSource = source, StartedAt = DateTime.UtcNow, Status = "running", PositionSide = "flat", RealizedEquity = 1m,
            LastEquity = 1m, LastSignal = "hold", SignalReason = "等待下一根已收盘 K 线确认。", PeriodEvaluations = [], TradePoints = []
        };
        await _repository.SaveRealtimeSessionAsync(session);
        var strategyConfig = await _repository.GetStrategyConfigAsync();
        strategyConfig.StrategyType = strategy.Definition.Id; strategyConfig.Enabled = true; strategyConfig.StopLossPct = parameters.StopLossPct;
        strategyConfig.TrailingDrawdownPct = parameters.TrailingDrawdownPct; strategyConfig.Leverage = parameters.Leverage; strategyConfig.LastSignal = "hold";
        strategyConfig.EntryPrice = null; strategyConfig.HighestPriceSinceEntry = null;
        await _repository.SaveStrategyConfigAsync(strategyConfig);
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(instId, bar, strategy.Definition.Id, true));
    }

    public async Task<RealtimeWorkspaceDto> PutLiveSessionAsync(LiveRealtimeSessionRequest request)
    {
        await EnsureLiveAccountReadyAsync();
        var simulatedSession = await _repository.GetRealtimeSessionAsync();
        if (simulatedSession is null || !string.Equals(simulatedSession.Status, "running", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("LIVE_SESSION_REQUIRES_CONFIRMED_SIMULATION: 请先确认实时模拟会话，再启动实盘交易。");
        }
        var simulatedParams = new StrategyParameterSetDto(simulatedSession.StopLossPct, simulatedSession.TrailingDrawdownPct, simulatedSession.Leverage);
        var liveParams = BuildParameters(request.StopLossPct, request.TrailingDrawdownPct, request.Leverage, simulatedParams);
        var liveParamsSource = SameParams(liveParams, simulatedParams) ? "follow-simulation" : "live-manual";

        if ((!string.IsNullOrWhiteSpace(request.InstId) && !string.Equals(request.InstId.Trim(), simulatedSession.InstId, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrWhiteSpace(request.Bar) && !string.Equals(request.Bar.Trim(), simulatedSession.Bar, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrWhiteSpace(request.StrategyType) && !string.Equals(_strategyRegistry.NormalizeStrategyId(request.StrategyType), simulatedSession.StrategyType, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("LIVE_SESSION_CONFIG_MISMATCH: 实盘品种、周期、策略必须与当前已确认的模拟会话一致。");
        }

        var liveSession = await _repository.GetLiveRealtimeSessionAsync();
        if (liveSession is not null
            && (string.Equals(liveSession.PositionSide, "long", StringComparison.OrdinalIgnoreCase)
                || string.Equals(liveSession.PositionSide, "short", StringComparison.OrdinalIgnoreCase)))
        {
            var sameConfig =
                string.Equals(liveSession.InstId, simulatedSession.InstId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(liveSession.Bar, simulatedSession.Bar, StringComparison.OrdinalIgnoreCase)
                && string.Equals(liveSession.StrategyType, simulatedSession.StrategyType, StringComparison.OrdinalIgnoreCase)
                && SameParams(
                    new StrategyParameterSetDto(liveSession.StopLossPct, liveSession.TrailingDrawdownPct, liveSession.Leverage),
                    liveParams);

            if (!sameConfig)
            {
                throw new InvalidOperationException("LIVE_SESSION_HAS_OPEN_POSITION: 当前实盘持仓未退出，不能切换配置或覆盖实盘参数。请先强制退出实盘持仓。");
            }
        }

        await SyncLiveLeverageAsync(simulatedSession.InstId, liveParams.Leverage);
        var session = new RealtimeSessionDocument
        {
            SessionId = "live-default", Mode = "live", InstId = simulatedSession.InstId, Bar = simulatedSession.Bar, StrategyType = simulatedSession.StrategyType,
            StopLossPct = liveParams.StopLossPct, TrailingDrawdownPct = liveParams.TrailingDrawdownPct, Leverage = liveParams.Leverage,
            ParamsSource = liveParamsSource, StartedAt = DateTime.UtcNow, Status = "running", PositionSide = liveSession?.PositionSide ?? "flat", RealizedEquity = 1m,
            LastEquity = 1m, LastSignal = "hold", SignalReason = "实盘自动交易已启动，等待下一根已收盘 K 线。", PeriodEvaluations = [], TradePoints = []
        };
        if (liveSession is not null && string.Equals(liveSession.InstId, simulatedSession.InstId, StringComparison.OrdinalIgnoreCase)
            && string.Equals(liveSession.Bar, simulatedSession.Bar, StringComparison.OrdinalIgnoreCase)
            && string.Equals(liveSession.StrategyType, simulatedSession.StrategyType, StringComparison.OrdinalIgnoreCase)
            && SameParams(new StrategyParameterSetDto(liveSession.StopLossPct, liveSession.TrailingDrawdownPct, liveSession.Leverage), liveParams))
        {
            session.PositionSide = liveSession.PositionSide;
            session.EntryPrice = liveSession.EntryPrice;
            session.EntryTs = liveSession.EntryTs;
            session.PeakPrice = liveSession.PeakPrice;
            session.TroughPrice = liveSession.TroughPrice;
            session.PositionSize = liveSession.PositionSize;
            session.AllocatedCapital = liveSession.AllocatedCapital;
            session.EntryNotionalUsd = liveSession.EntryNotionalUsd;
            session.LastSettledCandleTs = liveSession.LastSettledCandleTs;
            session.RealizedEquity = liveSession.RealizedEquity;
            session.LastEquity = liveSession.LastEquity;
            session.PeriodEvaluations = liveSession.PeriodEvaluations;
            session.TradePoints = liveSession.TradePoints;
        }
        await _repository.SaveLiveRealtimeSessionAsync(session);
        await SetStrategyStatusFromLiveSessionsAsync();
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(simulatedSession.InstId, simulatedSession.Bar, simulatedSession.StrategyType, true));
    }

    public async Task<RealtimeWorkspaceDto> ForceExitAsync()
    {
        var session = await _repository.GetRealtimeSessionAsync();
        if (session is null || !string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase)) return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(null, null, null, true));
        var strategy = _strategyRegistry.GetRunnable(session.StrategyType);
        var candles = await _okxClient.GetHistoryCandlesAsync(session.InstId, session.Bar, 120, 3);
        var latestPrice = await ReadLatestPriceAsync(session.InstId, candles);
        await SettleSimulatedSessionAsync(session, strategy, candles, latestPrice, true);
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(session.InstId, session.Bar, session.StrategyType, true));
    }

    public async Task<RealtimeWorkspaceDto> ForceExitLiveSessionAsync()
    {
        var session = await _repository.GetLiveRealtimeSessionAsync() ?? throw new InvalidOperationException("LIVE_SESSION_NOT_FOUND: 未找到该实盘会话。");
        var strategy = _strategyRegistry.GetRunnable(session.StrategyType);
        var candles = await _okxClient.GetHistoryCandlesAsync(session.InstId, session.Bar, 120, 3);
        var latestPrice = await ReadLatestPriceAsync(session.InstId, candles);
        await SettleLiveSessionAsync(session, strategy, candles, latestPrice, true);
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(session.InstId, session.Bar, session.StrategyType, true));
    }

    public async Task<RealtimeWorkspaceDto> PauseLiveSessionAsync()
    {
        var session = await _repository.GetLiveRealtimeSessionAsync() ?? throw new InvalidOperationException("LIVE_SESSION_NOT_FOUND: 未找到该实盘会话。");
        session.Status = "paused"; session.ErrorCode = null; session.ErrorMessage = null; await _repository.SaveLiveRealtimeSessionAsync(session); await SetStrategyStatusFromLiveSessionsAsync();
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(session.InstId, session.Bar, session.StrategyType, true));
    }

    public async Task<RealtimeWorkspaceDto> ResumeLiveSessionAsync()
    {
        var session = await _repository.GetLiveRealtimeSessionAsync() ?? throw new InvalidOperationException("LIVE_SESSION_NOT_FOUND: 未找到该实盘会话。");
        var simulatedSession = await _repository.GetRealtimeSessionAsync();
        if (simulatedSession is null || !string.Equals(simulatedSession.Status, "running", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("LIVE_SESSION_REQUIRES_CONFIRMED_SIMULATION: 请先确认实时模拟会话，再恢复实盘交易。");
        }
        if (!string.Equals(session.InstId, simulatedSession.InstId, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(session.Bar, simulatedSession.Bar, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(session.StrategyType, simulatedSession.StrategyType, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("LIVE_SESSION_CONFIG_MISMATCH: 当前模拟品种、周期或策略已变化，请先重新启动实盘交易。");
        }
        _ = BuildParameters(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage, new StrategyParameterSetDto(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage));
        await EnsureLiveAccountReadyAsync(); await SyncLiveLeverageAsync(session.InstId, session.Leverage); session.Status = "running"; session.ErrorCode = null; session.ErrorMessage = null;
        await _repository.SaveLiveRealtimeSessionAsync(session); await SetStrategyStatusFromLiveSessionsAsync();
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(session.InstId, session.Bar, session.StrategyType, true));
    }

    public async Task<RealtimeWorkspaceDto> DeleteLiveSessionAsync()
    {
        var session = await _repository.GetLiveRealtimeSessionAsync() ?? throw new InvalidOperationException("LIVE_SESSION_NOT_FOUND: 未找到该实盘会话。");
        await _repository.DeleteLiveRealtimeSessionAsync(); await SetStrategyStatusFromLiveSessionsAsync();
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(session.InstId, session.Bar, session.StrategyType, true));
    }
    public async Task SettleRealtimeSessionAsync(CancellationToken cancellationToken = default)
    {
        var session = await _repository.GetRealtimeSessionAsync();
        if (session is null || !string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase)) return;
        cancellationToken.ThrowIfCancellationRequested();
        var strategy = _strategyRegistry.GetRunnable(session.StrategyType);
        var candles = await _okxClient.GetHistoryCandlesAsync(session.InstId, session.Bar, 120, 3);
        await SettleSimulatedSessionAsync(session, strategy, candles, null, false);
    }

    public async Task SettleLiveRealtimeSessionsAsync(CancellationToken cancellationToken = default)
    {
        var session = await _repository.GetLiveRealtimeSessionAsync();
        if (session is null || !string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase)) return;
        cancellationToken.ThrowIfCancellationRequested();
        var strategy = _strategyRegistry.GetRunnable(session.StrategyType);
        var candles = await _okxClient.GetHistoryCandlesAsync(session.InstId, session.Bar, 120, 3);
        await SettleLiveSessionAsync(session, strategy, candles, null, false);
    }

    public async Task<RealtimeWorkspaceDto> GetWorkspaceAsync(RealtimeWorkspaceRequest request)
    {
        var state = await _repository.GetAppStateAsync();
        var strategyConfig = await _repository.GetStrategyConfigAsync();
        var latestBacktest = await _repository.GetLatestBacktestAsync();
        var positions = await _repository.GetPositionsAsync();
        var apiConnection = await _repository.GetApiConnectionAsync();
        var storedSession = await _repository.GetRealtimeSessionAsync();
        var strategyType = _strategyRegistry.NormalizeStrategyId(request.StrategyType ?? storedSession?.StrategyType ?? strategyConfig.StrategyType);
        var strategy = _strategyRegistry.GetRunnable(strategyType);
        var instId = NormalizeInstId(request.InstId ?? storedSession?.InstId, positions, latestBacktest);
        var bar = NormalizeBar(request.Bar ?? storedSession?.Bar);
        var session = IsMatchingSession(storedSession, instId, bar, strategy.Definition.Id) ? storedSession : null;
        var (previewParams, previewSource) = ResolveParameters(latestBacktest, strategy, strategy.Definition.Id, instId, bar);
        var activeParams = session is null ? previewParams : new StrategyParameterSetDto(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage);
        var activeSource = session?.ParamsSource ?? previewSource;
        var candles = await _okxClient.GetHistoryCandlesAsync(instId, bar, 120, 3);
        if (session is not null) await SettleSimulatedSessionAsync(session, strategy, candles, null, false);
        var refreshedSession = session is null ? null : await _repository.GetRealtimeSessionAsync();
        if (refreshedSession is not null && !IsMatchingSession(refreshedSession, instId, bar, strategy.Definition.Id)) refreshedSession = null;
        var currentCandle = await ReadCurrentCandleAsync(instId, bar, candles);
        var latestPrice = await ReadLatestPriceAsync(instId, candles);
        var simulation = BuildSimulation(candles, activeParams, activeSource, refreshedSession);
        var liveSession = await _repository.GetLiveRealtimeSessionAsync();
        if (liveSession is not null)
        {
            var liveStrategy = _strategyRegistry.GetRunnable(liveSession.StrategyType);
            var liveCandles = string.Equals(liveSession.InstId, instId, StringComparison.OrdinalIgnoreCase) && string.Equals(liveSession.Bar, bar, StringComparison.OrdinalIgnoreCase)
                ? candles
                : await _okxClient.GetHistoryCandlesAsync(liveSession.InstId, liveSession.Bar, 120, 3);
            await SettleLiveSessionAsync(liveSession, liveStrategy, liveCandles, null, false);
            liveSession = await _repository.GetLiveRealtimeSessionAsync();
        }
        var live = BuildLive(state, strategyConfig, positions, apiConnection, simulation, latestPrice, refreshedSession is not null, liveSession);
        return new RealtimeWorkspaceDto(instId, bar, strategy.Definition.Id, refreshedSession is null ? strategy.Definition.Id : null, refreshedSession?.StrategyType, refreshedSession is null ? null : ToSessionDto(refreshedSession), liveSession is null ? null : ToLiveSessionDto(liveSession), activeParams, activeSource, candles, currentCandle, latestPrice, candles.LastOrDefault()?.Ts, BuildNextRefreshAt(candles.LastOrDefault()?.Ts, bar), DateTime.UtcNow, simulation, live);
    }

    public async Task<object> GetConsoleAsync()
    {
        var workspace = await GetWorkspaceAsync(new RealtimeWorkspaceRequest(null, null, null, true));
        var state = await _repository.GetAppStateAsync();
        var strategyConfig = await _repository.GetStrategyConfigAsync();
        return new { strategyType = workspace.SelectedStrategyType, strategyName = _strategyRegistry.GetDefinition(workspace.SelectedStrategyType).Name, strategyStatusLabel = _strategyRegistry.GetDefinition(workspace.SelectedStrategyType).Status, strategyStatus = state.StrategyStatus, enabled = strategyConfig.Enabled, symbol = workspace.InstId, lastPrice = workspace.LatestPrice, candleCount = workspace.Candles.Count, hasPosition = workspace.Simulation.PositionStatus != "空仓", entryPrice = workspace.Simulation.OpenEntryPrice, lastSignal = workspace.Simulation.LastSignal, stopLossPct = workspace.StrategyParams.StopLossPct, trailingDrawdownPct = workspace.StrategyParams.TrailingDrawdownPct, leverage = workspace.StrategyParams.Leverage, riskState = workspace.Live.RiskNote, executionAdvice = workspace.Live.SignalReason, positionCount = workspace.Live.PositionCount, marketNote = workspace.Live.ConnectionStatus, liveSessionCount = workspace.LiveSession is null ? 0 : 1, updatedAt = workspace.UpdatedAt, logs = BuildConsoleLogs(workspace) };
    }

    private async Task SettleSimulatedSessionAsync(RealtimeSessionDocument session, ITradingStrategy strategy, List<CandlePointDto> candles, decimal? latestPrice, bool forceExit)
    {
        if (candles.Count == 0) return;
        var startIndex = ResolveSettlementStartIndex(session, candles);
        for (var i = startIndex; i < candles.Count; i++)
        {
            var candle = candles[i];
            var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(candle, candles.Take(i).ToList(), session.PositionSide, session.EntryPrice, session.PeakPrice, session.TroughPrice, new StrategyParameterSetDto(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage)));
            ApplySimulatedPeriodDecision(session, candle, decision);
        }
        if (forceExit)
        {
            if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase) && session.EntryPrice.HasValue && session.EntryTs.HasValue)
            {
                var closePrice = latestPrice ?? candles.LastOrDefault()?.Close ?? session.EntryPrice.Value;
                var closeTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var forceCandle = new CandlePointDto(closeTs, closePrice, closePrice, closePrice, closePrice);
                AppendEvaluation(session, forceCandle, "force_close", closePrice, "已按最新参考价强制退出模拟持仓。", true);
                ApplyClose(session, closeTs, closePrice, "force_close", "已按最新参考价强制退出模拟持仓。");
            }
            else session.SignalReason = "当前无模拟持仓。";
        }
        await _repository.SaveRealtimeSessionAsync(session);
    }

    private async Task SettleLiveSessionAsync(RealtimeSessionDocument session, ITradingStrategy strategy, List<CandlePointDto> candles, decimal? latestPrice, bool forceExit)
    {
        if (candles.Count == 0 || !string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)) return;
        if (!string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase) && !forceExit) return;
        var startIndex = ResolveSettlementStartIndex(session, candles);
        for (var i = startIndex; i < candles.Count; i++)
        {
            var candle = candles[i];
            var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(candle, candles.Take(i).ToList(), session.PositionSide, session.EntryPrice, session.PeakPrice, session.TroughPrice, new StrategyParameterSetDto(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage)));
            try { await ApplyLivePeriodDecisionAsync(session, candle, decision); }
            catch (Exception ex)
            {
                session.Status = "error"; session.ErrorCode = "OKX_ORDER_FAILED"; session.ErrorMessage = ex.Message; session.SignalReason = ex.Message;
                await _repository.SaveLiveRealtimeSessionAsync(session); await SetStrategyStatusFromLiveSessionsAsync(); return;
            }
        }
        if (forceExit)
        {
            if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase) && session.EntryPrice.HasValue && session.PositionSize.GetValueOrDefault() > 0m)
            {
                try
                {
                    var requestedPrice = latestPrice ?? candles.LastOrDefault()?.Close ?? session.EntryPrice.Value;
                    var executionPrice = await ExecuteLiveCloseAsync(session, "force_close", "已按最新参考价强制退出实盘持仓。", requestedPrice);
                    var closeTs = session.LastExecutionTs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    var forceCandle = new CandlePointDto(closeTs, executionPrice, executionPrice, executionPrice, executionPrice);
                    AppendEvaluation(session, forceCandle, "force_close", executionPrice, "已按最新参考价强制退出实盘持仓。", true);
                    ApplyClose(session, closeTs, executionPrice, "force_close", "已按最新参考价强制退出实盘持仓。");
                }
                catch (Exception ex) { session.Status = "error"; session.ErrorCode = "OKX_FORCE_EXIT_FAILED"; session.ErrorMessage = ex.Message; session.SignalReason = ex.Message; }
            }
            else session.SignalReason = "当前无实盘持仓。";
        }
        await _repository.SaveLiveRealtimeSessionAsync(session); await SetStrategyStatusFromLiveSessionsAsync();
    }
    private async Task ApplyLivePeriodDecisionAsync(RealtimeSessionDocument session, CandlePointDto candle, RealtimePeriodDecision decision)
    {
        session.LastSignal = decision.Action; session.SignalReason = decision.Reason; session.ErrorCode = null; session.ErrorMessage = null;
        if (string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
        {
            if (decision.Action == "open_long" || decision.Action == "open_short")
            {
                await SyncLiveLeverageAsync(session.InstId, session.Leverage);
                var executionPrice = await ExecuteLiveOpenAsync(session, candle, decision);
                session.PositionSide = decision.Action == "open_long" ? "long" : "short"; session.EntryPrice = executionPrice; session.EntryTs = candle.Ts; session.PeakPrice = candle.Close; session.TroughPrice = candle.Close;
                AppendEvaluation(session, candle, decision.Action, executionPrice, decision.Reason);
            }
            else AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason);
            session.LastSettledCandleTs = candle.Ts; return;
        }
        session.PeakPrice = Math.Max(session.PeakPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        session.TroughPrice = Math.Min(session.TroughPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        if (decision.Action == "close")
        {
            var executionPrice = await ExecuteLiveCloseAsync(session, "close", decision.Reason, decision.ExecutionPrice ?? candle.Close);
            AppendEvaluation(session, candle, decision.Action, executionPrice, decision.Reason, true);
            ApplyClose(session, session.LastExecutionTs ?? candle.Ts, executionPrice, "close", decision.Reason);
        }
        else AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason);
        session.LastSettledCandleTs = candle.Ts;
    }

    private async Task<decimal> ExecuteLiveOpenAsync(RealtimeSessionDocument session, CandlePointDto candle, RealtimePeriodDecision decision)
    {
        var price = await ReadLatestPriceAsync(session.InstId, [candle]) ?? candle.Close;
        var instrument = await _okxClient.GetSwapInstrumentAsync(session.InstId) ?? throw new InvalidOperationException($"LIVE_INSTRUMENT_NOT_FOUND: 未找到 {session.InstId} 合约信息。");
        var orderPlan = await BuildLiveOpenOrderPlanAsync(session, instrument, price);
        var request = new OkxPlaceOrderRequest { InstId = session.InstId, TdMode = "cross", OrdType = "market", PosSide = decision.Action == "open_long" ? "long" : "short", Side = decision.Action == "open_long" ? "buy" : "sell", Size = orderPlan.Size.ToString(CultureInfo.InvariantCulture), ReduceOnly = false };
        var response = await _okxClient.PlaceOrderAsync(request, "live");
        var data = response.Data.FirstOrDefault();
        session.LastOrderId = data?.OrdId; session.LastExecutionPrice = price; session.LastExecutionTs = candle.Ts; session.LastExecutionSize = orderPlan.Size;
        session.PositionSize = orderPlan.Size; session.AllocatedCapital = orderPlan.AllocatedCapital; session.EntryNotionalUsd = orderPlan.EntryNotionalUsd;
        return price;
    }

    private async Task<decimal> ExecuteLiveCloseAsync(RealtimeSessionDocument session, string action, string reason, decimal fallbackPrice)
    {
        var size = session.PositionSize.GetValueOrDefault();
        if (size <= 0m) throw new InvalidOperationException("LIVE_POSITION_SIZE_MISSING: 当前实盘持仓数量无效，不能平仓。");
        var currentPrice = await _okxClient.GetLatestPriceAsync(session.InstId) ?? fallbackPrice;
        var closeLong = string.Equals(session.PositionSide, "long", StringComparison.OrdinalIgnoreCase);
        var request = new OkxPlaceOrderRequest { InstId = session.InstId, TdMode = "cross", OrdType = "market", PosSide = closeLong ? "long" : "short", Side = closeLong ? "sell" : "buy", Size = size.ToString(CultureInfo.InvariantCulture), ReduceOnly = true };
        var response = await _okxClient.PlaceOrderAsync(request, "live");
        var data = response.Data.FirstOrDefault();
        session.LastOrderId = data?.OrdId; session.LastExecutionPrice = currentPrice; session.LastExecutionTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); session.LastExecutionSize = size; session.LastSignal = action; session.SignalReason = reason;
        return currentPrice;
    }

    private static void ApplySimulatedPeriodDecision(RealtimeSessionDocument session, CandlePointDto candle, RealtimePeriodDecision decision)
    {
        session.LastSignal = decision.Action; session.SignalReason = decision.Reason;
        if (string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
        {
            if (decision.Action == "open_long" || decision.Action == "open_short")
            {
                var side = decision.Action == "open_long" ? "long" : "short"; var executionPrice = decision.ExecutionPrice ?? candle.Close;
                session.PositionSide = side; session.EntryPrice = executionPrice; session.EntryTs = candle.Ts; session.PeakPrice = candle.Close; session.TroughPrice = candle.Close;
            }
            AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason); session.LastSettledCandleTs = candle.Ts; return;
        }
        session.PeakPrice = Math.Max(session.PeakPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        session.TroughPrice = Math.Min(session.TroughPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        if (decision.Action == "close")
        {
            var executionPrice = decision.ExecutionPrice ?? candle.Close; AppendEvaluation(session, candle, decision.Action, executionPrice, decision.Reason, true); ApplyClose(session, candle.Ts, executionPrice, "close", decision.Reason);
        }
        else AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason);
        session.LastSettledCandleTs = candle.Ts;
    }

    private static void ApplyClose(RealtimeSessionDocument session, long ts, decimal executionPrice, string action, string reason)
    {
        if (!session.EntryPrice.HasValue || !session.EntryTs.HasValue) return;
        var grossRet = CalculateGrossReturn(session.PositionSide, session.EntryPrice.Value, executionPrice, session.Leverage);
        var netRet = grossRet - RoundTripFeeRate;
        session.TradePoints.Add(new BacktestTradePointDto(session.EntryTs.Value, session.EntryPrice.Value, ts, executionPrice, netRet, action == "force_close" ? "force_close" : NormalizeReason(reason), session.PositionSide, grossRet, netRet, session.Leverage, RoundTripFeeRate, EntryFeeRate, ExitFeeRate, session.LastOrderId, session.Mode, action, session.PositionSide, executionPrice, session.LastExecutionSize, "filled"));
        session.RealizedEquity *= 1m + netRet; session.LastEquity = session.RealizedEquity; session.PositionSide = "flat"; session.EntryPrice = null; session.EntryTs = null; session.PeakPrice = null; session.TroughPrice = null; session.PositionSize = null; session.AllocatedCapital = null; session.EntryNotionalUsd = null; session.LastSignal = action; session.SignalReason = reason;
    }

    private static void AppendEvaluation(RealtimeSessionDocument session, CandlePointDto candle, string action, decimal? executionPrice, string reason, bool settleBeforeAppend = false)
    {
        var evaluationPositionSide = session.PositionSide; var realizedEquity = session.RealizedEquity; var currentEquity = session.LastEquity; var unrealizedReturn = 0m; var grossReturn = 0m; var netReturn = 0m; var feeCost = 0m;
        if (settleBeforeAppend && session.EntryPrice.HasValue)
        {
            var closePrice = executionPrice ?? candle.Close; grossReturn = CalculateGrossReturn(session.PositionSide, session.EntryPrice.Value, closePrice, session.Leverage); netReturn = grossReturn - RoundTripFeeRate; feeCost = RoundTripFeeRate; realizedEquity *= 1m + netReturn; currentEquity = realizedEquity; evaluationPositionSide = "flat";
        }
        else if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase) && session.EntryPrice.HasValue)
        {
            grossReturn = CalculateGrossReturn(session.PositionSide, session.EntryPrice.Value, candle.Close, session.Leverage); netReturn = grossReturn - RoundTripFeeRate; feeCost = RoundTripFeeRate; unrealizedReturn = netReturn; currentEquity = realizedEquity * (1m + unrealizedReturn);
        }
        var periodReturn = session.LastEquity == 0m ? 0m : currentEquity / session.LastEquity - 1m; var totalReturn = currentEquity - 1m;
        session.PeriodEvaluations.Add(new RealtimePeriodEvaluationDto(candle.Ts, candle.Close, action, evaluationPositionSide, executionPrice, reason, PositionStatusLabel(evaluationPositionSide), periodReturn, realizedEquity - 1m, unrealizedReturn, totalReturn, grossReturn, netReturn, feeCost, EntryFeeRate, ExitFeeRate, currentEquity));
        session.LastEquity = currentEquity;
    }

    private static RealtimeSimulationDto BuildSimulation(List<CandlePointDto> candles, StrategyParameterSetDto parameters, string paramsSource, RealtimeSessionDocument? session)
    {
        var parameterDefinitions = StrategyRegistryService.BuildParameterDefinitions(parameters);
        if (session is null) return new RealtimeSimulationDto(null, candles, [], parameters, parameterDefinitions, [], [], 0m, 0m, "待确认", null, null, null, "hold", "已预览策略参数。确认后才会从当前时刻开始结算。", 0, 0, paramsSource, true, false);
        var equityCurve = session.PeriodEvaluations.Select(x => x.Equity).ToList(); var maxDrawdown = 0m; var peakEquity = 1m;
        foreach (var equity in equityCurve) { peakEquity = Math.Max(peakEquity, equity); maxDrawdown = Math.Min(maxDrawdown, equity / peakEquity - 1m); }
        var wins = session.TradePoints.Count(x => x.NetRet > 0m); var grossTotalReturn = session.TradePoints.Aggregate(1m, (acc, trade) => acc * (1m + trade.GrossRet)) - 1m; var netTotalReturn = session.PeriodEvaluations.LastOrDefault()?.TotalReturn ?? 0m;
        var summary = new BacktestResultDto(parameters.StopLossPct, parameters.TrailingDrawdownPct, parameters.Leverage, session.TradePoints.Count, session.TradePoints.Count == 0 ? 0m : (decimal)wins / session.TradePoints.Count, netTotalReturn, maxDrawdown, grossTotalReturn, netTotalReturn, session.TradePoints.Sum(x => x.FeeCost));
        return new RealtimeSimulationDto(summary, candles, session.TradePoints, parameters, parameterDefinitions, session.PeriodEvaluations, equityCurve, session.PeriodEvaluations.LastOrDefault()?.RealizedReturn ?? 0m, session.PeriodEvaluations.LastOrDefault()?.UnrealizedReturn ?? 0m, PositionStatusLabel(session.PositionSide), session.EntryPrice, session.EntryTs, session.TradePoints.LastOrDefault()?.NetRet, session.LastSignal, session.SignalReason, session.PeriodEvaluations.Count(x => x.Action is "open_long" or "open_short"), session.PeriodEvaluations.Count(x => x.Action is "close" or "force_close"), paramsSource, true, true);
    }
    private static RealtimeLiveDto BuildLive(AppStateDocument state, StrategyConfigDocument strategyConfig, List<PositionDocument> positions, ApiConnectionDocument? apiConnection, RealtimeSimulationDto simulation, decimal? latestPrice, bool confirmed, RealtimeSessionDocument? liveSession)
    {
        var hasAccountConnection = apiConnection is not null && !string.IsNullOrWhiteSpace(apiConnection.ApiKey) && !string.IsNullOrWhiteSpace(apiConnection.EncryptedSecretKey) && !string.IsNullOrWhiteSpace(apiConnection.EncryptedPassphrase);
        var connectionStatus = hasAccountConnection ? "已接入行情与账户" : "已接入行情，未接入账户";
        var signal = liveSession?.LastSignal ?? (confirmed ? simulation.LastSignal : "hold");
        var confirmationStatus = liveSession is null
            ? confirmed ? "未启动实盘" : "未确认策略"
            : signal is "open_long" or "open_short" or "close" or "force_close" ? "等待执行" : liveSession.Status;
        var triggerPrice = liveSession?.LastExecutionPrice ?? latestPrice ?? simulation.Candles.LastOrDefault()?.Close;
        var riskNote = BuildRiskNote(state, hasAccountConnection, positions.Count);
        if (confirmed && !strategyConfig.Enabled) confirmationStatus = "未启用策略";
        return new RealtimeLiveDto(connectionStatus, confirmationStatus, signal, liveSession?.SignalReason ?? (confirmed ? simulation.SignalReason : "策略尚未确认，只展示参数预览。"), DateTime.UtcNow, triggerPrice, positions.Count, riskNote, hasAccountConnection);
    }

    private static RealtimeLiveSessionDto ToLiveSessionDto(RealtimeSessionDocument session)
    {
        var parameters = new StrategyParameterSetDto(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage);
        var summary = BuildSessionSummary(parameters, session);
        return new RealtimeLiveSessionDto(session.SessionId, session.Mode, session.InstId, session.Bar, session.StrategyType, parameters, session.ParamsSource, session.StartedAt, session.Status, session.PositionSide, session.EntryPrice, session.EntryTs, session.PositionSize, session.AllocatedCapital, session.EntryNotionalUsd, session.LastSettledCandleTs, session.LastSignal, session.SignalReason, session.LastOrderId, session.LastExecutionPrice, session.LastExecutionTs, session.LastExecutionSize, session.ErrorCode, session.ErrorMessage, summary, session.TradePoints, session.TradePoints.LastOrDefault(), session.PeriodEvaluations.LastOrDefault());
    }

    private static BacktestResultDto? BuildSessionSummary(StrategyParameterSetDto parameters, RealtimeSessionDocument session)
    {
        if (session.PeriodEvaluations.Count == 0 && session.TradePoints.Count == 0) return null;
        var maxDrawdown = 0m; var peakEquity = 1m;
        foreach (var equity in session.PeriodEvaluations.Select(x => x.Equity)) { peakEquity = Math.Max(peakEquity, equity); maxDrawdown = Math.Min(maxDrawdown, equity / peakEquity - 1m); }
        var wins = session.TradePoints.Count(x => x.NetRet > 0m); var grossTotalReturn = session.TradePoints.Aggregate(1m, (acc, trade) => acc * (1m + trade.GrossRet)) - 1m; var netTotalReturn = session.PeriodEvaluations.LastOrDefault()?.TotalReturn ?? 0m;
        return new BacktestResultDto(parameters.StopLossPct, parameters.TrailingDrawdownPct, parameters.Leverage, session.TradePoints.Count, session.TradePoints.Count == 0 ? 0m : (decimal)wins / session.TradePoints.Count, netTotalReturn, maxDrawdown, grossTotalReturn, netTotalReturn, session.TradePoints.Sum(x => x.FeeCost));
    }

    private static (StrategyParameterSetDto Parameters, string Source) ResolveParameters(BacktestDocument? latestBacktest, ITradingStrategy strategy, string strategyType, string instId, string bar)
    {
        if (latestBacktest?.Selected is not null && string.Equals(latestBacktest.StrategyType, strategyType, StringComparison.OrdinalIgnoreCase) && string.Equals(latestBacktest.InstId, instId, StringComparison.OrdinalIgnoreCase) && string.Equals(latestBacktest.Bar, bar, StringComparison.OrdinalIgnoreCase)) return (new StrategyParameterSetDto(latestBacktest.Selected.StopLossPct, latestBacktest.Selected.TrailingDrawdownPct, latestBacktest.Selected.Leverage), "backtest-best");
        return (strategy.DefaultParams, "module-default");
    }

    private static StrategyParameterSetDto BuildParameters(decimal? stopLossPct, decimal? trailingDrawdownPct, decimal? leverage, StrategyParameterSetDto defaults)
    {
        var result = new StrategyParameterSetDto(ClampPercent(stopLossPct ?? defaults.StopLossPct), ClampPercent(trailingDrawdownPct ?? defaults.TrailingDrawdownPct), ClampLeverage(leverage ?? defaults.Leverage));
        StrategyRegistryService.ValidateLeveragedStopLoss(result.StopLossPct, result.Leverage);
        return result;
    }

    private async Task EnsureLiveAccountReadyAsync()
    {
        var config = await _okxClient.GetAccountConfigAsync("live");
        if (config.Code != "0") throw new InvalidOperationException(config.Msg);
        var account = config.Data.FirstOrDefault();
        if (!string.Equals(account?.PosMode, "long_short_mode", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("LIVE_POSITION_MODE_INVALID: 当前 OKX 账户未启用双向持仓模式。");
    }

    private async Task SyncLiveLeverageAsync(string instId, decimal leverage)
    {
        await _okxClient.SetLeverageAsync(instId, leverage, "long", "live");
        await _okxClient.SetLeverageAsync(instId, leverage, "short", "live");
    }

    private async Task<decimal?> ReadLatestPriceAsync(string instId, List<CandlePointDto> candles)
    {
        try { return await _okxClient.GetLatestPriceAsync(instId) ?? candles.LastOrDefault()?.Close; }
        catch { return candles.LastOrDefault()?.Close; }
    }

    private async Task<CandlePointDto?> ReadCurrentCandleAsync(string instId, string bar, List<CandlePointDto> closedCandles)
    {
        try
        {
            var marketCandles = await _okxClient.GetMarketCandlesAsync(instId, bar, 2); var candidate = marketCandles.LastOrDefault(); var lastClosedTs = closedCandles.LastOrDefault()?.Ts;
            return candidate is not null && candidate.Ts != lastClosedTs ? candidate : marketCandles.FirstOrDefault();
        }
        catch { return null; }
    }

    private async Task SetStrategyStatusFromLiveSessionsAsync()
    {
        var state = await _repository.GetAppStateAsync();
        var liveSession = await _repository.GetLiveRealtimeSessionAsync();
        state.StrategyStatus = liveSession is not null && string.Equals(liveSession.Status, "running", StringComparison.OrdinalIgnoreCase) ? "running" : "paused";
        await _repository.SaveAppStateAsync(state);
    }

    private static int ResolveSettlementStartIndex(RealtimeSessionDocument session, List<CandlePointDto> candles)
    {
        var startMs = new DateTimeOffset(session.StartedAt).ToUnixTimeMilliseconds();
        if (session.LastSettledCandleTs.HasValue) { var index = candles.FindIndex(x => x.Ts > session.LastSettledCandleTs.Value); return index < 0 ? candles.Count : index; }
        var startIndex = candles.FindIndex(x => x.Ts >= startMs); return startIndex < 0 ? candles.Count : startIndex;
    }

    private static string NormalizeInstId(string? instId, List<PositionDocument> positions, BacktestDocument? latestBacktest)
    {
        if (!string.IsNullOrWhiteSpace(instId)) return instId.Trim().ToUpperInvariant();
        return positions.FirstOrDefault()?.Symbol ?? latestBacktest?.InstId ?? "RAVE-USDT-SWAP";
    }

    private static string NormalizeBar(string? bar) => string.IsNullOrWhiteSpace(bar) ? "1m" : SupportedBars.Contains(bar) ? bar : "1m";

    private static bool IsMatchingSession(RealtimeSessionDocument? session, string instId, string bar, string strategyType) => session is not null && string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase) && string.Equals(session.Mode, "simulated", StringComparison.OrdinalIgnoreCase) && string.Equals(session.InstId, instId, StringComparison.OrdinalIgnoreCase) && string.Equals(session.Bar, bar, StringComparison.OrdinalIgnoreCase) && string.Equals(session.StrategyType, strategyType, StringComparison.OrdinalIgnoreCase);

    private static RealtimeSessionDto ToSessionDto(RealtimeSessionDocument session) => new(session.SessionId, session.Mode, session.InstId, session.Bar, session.StrategyType, new StrategyParameterSetDto(session.StopLossPct, session.TrailingDrawdownPct, session.Leverage), session.ParamsSource, session.StartedAt, session.Status, session.PositionSide, session.EntryPrice, session.EntryTs, session.PeakPrice, session.TroughPrice, session.PositionSize, session.AllocatedCapital, session.EntryNotionalUsd, session.LastSettledCandleTs, session.LastOrderId, session.LastExecutionPrice, session.LastExecutionTs, session.LastExecutionSize, session.ErrorCode, session.ErrorMessage);

    private static bool SameParams(StrategyParameterSetDto left, StrategyParameterSetDto right) => Math.Abs(left.StopLossPct - right.StopLossPct) < 0.0001m && Math.Abs(left.TrailingDrawdownPct - right.TrailingDrawdownPct) < 0.0001m && Math.Abs(left.Leverage - right.Leverage) < 0.0001m;
    private static decimal ClampPercent(decimal value) => Math.Clamp(value, 0.01m, 100m);
    private static decimal ClampLeverage(decimal value) => Math.Clamp(value, 1m, 20m);

    private static DateTime? BuildNextRefreshAt(long? lastClosedTs, string bar)
    {
        if (!lastClosedTs.HasValue) return DateTime.UtcNow.AddSeconds(15);
        var lastClosedAt = DateTimeOffset.FromUnixTimeMilliseconds(lastClosedTs.Value).UtcDateTime; var candidate = lastClosedAt.Add(BarDuration(bar)).AddSeconds(2); var now = DateTime.UtcNow; return candidate > now ? candidate : now.AddSeconds(5);
    }

    private static TimeSpan BarDuration(string bar) => bar switch { "1m" => TimeSpan.FromMinutes(1), "5m" => TimeSpan.FromMinutes(5), "15m" => TimeSpan.FromMinutes(15), "1H" => TimeSpan.FromHours(1), "4H" => TimeSpan.FromHours(4), "1D" => TimeSpan.FromDays(1), _ => TimeSpan.FromMinutes(1) };
    private static decimal CalculateGrossReturn(string side, decimal entryPrice, decimal exitPrice, decimal leverage) => string.Equals(side, "short", StringComparison.OrdinalIgnoreCase) ? ((entryPrice - exitPrice) / entryPrice) * leverage : ((exitPrice - entryPrice) / entryPrice) * leverage;
    private static string PositionStatusLabel(string side) => side switch { "long" => "多单", "short" => "空单", _ => "空仓" };
    private static string NormalizeReason(string reason) { if (reason.Contains("止损", StringComparison.Ordinal)) return "stop_loss"; if (reason.Contains("回撤", StringComparison.Ordinal)) return "trailing_exit"; if (reason.Contains("强制", StringComparison.Ordinal)) return "force_close"; return "close"; }
    private static string BuildRiskNote(AppStateDocument state, bool hasAccountConnection, int positionCount) { if (!hasAccountConnection) return "只能查看真实行情，不能读取账户和持仓。"; if (state.DrawdownPct <= -5m) return "账户回撤较大，请确认真实仓位与策略是否一致。"; if (state.DrawdownPct <= -3m) return "账户回撤偏高，建议关注实盘会话状态。"; return positionCount > 0 ? "检测到真实持仓，请核对实盘会话和账户仓位。" : "账户已接入，可启动实盘自动交易。"; }
    private static string[] BuildConsoleLogs(RealtimeWorkspaceDto workspace) => [$"监控标的：{workspace.InstId}", $"时间间隔：{workspace.Bar}", $"已收盘 K 线：{workspace.Candles.Count}", $"最新参考价：{(workspace.LatestPrice.HasValue ? workspace.LatestPrice.Value.ToString("0.########") : "unknown")}", $"策略参数来源：{(workspace.ParamsSource switch { "backtest-best" => "最近回测最佳参数", "manual" => "手工修改参数", _ => "策略模块默认参数" })}", $"策略杠杆：{workspace.StrategyParams.Leverage:0.##}x", $"模拟状态：{workspace.Simulation.PositionStatus}", $"最近动作：{workspace.Simulation.LastSignal}", workspace.Simulation.Summary is null ? "模拟策略尚未确认。" : $"模拟净累计收益：{workspace.Simulation.Summary.NetTotalReturn:P2} / 已实现收益：{workspace.Simulation.RealizedReturn:P2}", $"实盘会话：{(workspace.LiveSession is null ? "未启动" : workspace.LiveSession.Status)}"];

    private async Task<LiveOrderPlan> BuildLiveOpenOrderPlanAsync(RealtimeSessionDocument session, OkxInstrumentData instrument, decimal latestPrice)
    {
        var balance = await _okxClient.GetBalanceAsync("live");
        if (balance.Code != "0") throw new InvalidOperationException(balance.Msg);
        var account = balance.Data.FirstOrDefault();
        var detail = account?.Details.FirstOrDefault(x => x.Ccy == "USDT") ?? account?.Details.FirstOrDefault();
        var availableBalance = ParseDecimal(detail?.AvailBal) > 0m ? ParseDecimal(detail?.AvailBal) : ParseDecimal(detail?.CashBal ?? detail?.Eq);
        if (availableBalance <= 0m) throw new InvalidOperationException("LIVE_AVAILABLE_BALANCE_EMPTY: 当前可用余额不足，不能开仓。");

        var allocatedCapital = availableBalance * MaxLiveCapitalUsageRate;
        var targetNotionalUsd = allocatedCapital * session.Leverage;
        var minSize = ResolveMinOrderSize(instrument);
        var lotSize = ResolveLotSize(instrument);
        var contractValue = ResolveContractValue(instrument);
        var contractNotionalUsd = contractValue > 0m ? contractValue * latestPrice : latestPrice;
        if (contractNotionalUsd <= 0m) throw new InvalidOperationException("LIVE_PRICE_INVALID: 当前价格无效，不能计算实盘下单数量。");

        var rawSize = targetNotionalUsd / contractNotionalUsd;
        var roundedSize = FloorToStep(rawSize, lotSize);
        if (roundedSize < minSize)
        {
            throw new InvalidOperationException("LIVE_ORDER_SIZE_TOO_SMALL: 按当前可用余额 20% 计算后，仍小于 OKX 最小下单张数。");
        }

        var actualNotionalUsd = roundedSize * contractNotionalUsd;
        var actualMargin = actualNotionalUsd / session.Leverage;
        if (actualMargin > allocatedCapital)
        {
            roundedSize = FloorToStep(roundedSize - lotSize, lotSize);
            if (roundedSize < minSize)
            {
                throw new InvalidOperationException("LIVE_ORDER_SIZE_EXCEEDS_CAPITAL_LIMIT: 最小可下单张数也会超过 20% 资金上限。");
            }
            actualNotionalUsd = roundedSize * contractNotionalUsd;
            actualMargin = actualNotionalUsd / session.Leverage;
        }

        return new LiveOrderPlan(roundedSize, allocatedCapital, actualNotionalUsd);
    }

    private static decimal ResolveMinOrderSize(OkxInstrumentData instrument)
    {
        if (decimal.TryParse(instrument.MinSz, NumberStyles.Any, CultureInfo.InvariantCulture, out var minSz) && minSz > 0m) return minSz;
        return ResolveLotSize(instrument);
    }

    private static decimal ResolveLotSize(OkxInstrumentData instrument)
    {
        if (decimal.TryParse(instrument.LotSz, NumberStyles.Any, CultureInfo.InvariantCulture, out var lotSz) && lotSz > 0m) return lotSz;
        return 1m;
    }

    private static decimal ResolveContractValue(OkxInstrumentData instrument)
    {
        if (decimal.TryParse(instrument.CtVal, NumberStyles.Any, CultureInfo.InvariantCulture, out var ctVal) && ctVal > 0m) return ctVal;
        return 1m;
    }

    private static decimal FloorToStep(decimal value, decimal step)
    {
        if (step <= 0m) return Math.Floor(value);
        return Math.Floor(value / step) * step;
    }

    private static decimal ParseDecimal(string? value) =>
        decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0m;
}

internal sealed record LiveOrderPlan(decimal Size, decimal AllocatedCapital, decimal EntryNotionalUsd);
