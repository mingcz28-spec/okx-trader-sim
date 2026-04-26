using System.Globalization;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class RealtimeService
{
    private static readonly HashSet<string> SupportedBars = ["1m", "5m", "15m", "1H", "4H", "1D"];
    private const decimal FallbackTakerFeeRate = StrategyRegistryService.DefaultTakerFeeRate;
    private const decimal SimulatedAccountCapital = 1m;
    private const decimal MaxLiveCapitalUsageRate = 0.2m;
    private const int MaxLiveCloseAttempts = 3;
    private static readonly TimeSpan LiveCloseVerificationDelay = TimeSpan.FromMilliseconds(700);
    private static readonly decimal[] OptimizationStopLossGrid = [0.5m, 0.8m, 1m, 1.2m, 1.5m, 2m];
    private static readonly decimal[] OptimizationTrailingGrid = [1m, 1.5m, 2m, 2.5m, 3m, 4m];
    private static readonly decimal[] OptimizationLeverageGrid = [1m, 2m, 3m, 5m];
    private static readonly int[] OptimizationMovingAverageGrid = [5, 10, 20, 30, 60];
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
        var parameters = BuildParameters(request.MovingAveragePeriod, request.StopLossPct, request.TrailingDrawdownPct, request.Leverage, strategy.DefaultParams);
        var (defaultParams, defaultSource) = ResolveParameters(latestBacktest, strategy, strategyType, instId, bar);
        var source = SameParams(parameters, defaultParams) ? defaultSource : "manual";
        var fee = await ResolveTakerFeeRateAsync(instId, "live");
        var previousSession = await _repository.GetRealtimeSessionAsync();
        if (HasOpenPosition(previousSession))
        {
            await ForceExitSimulatedSessionImmediateAsync(previousSession!);
        }

        var candles = await _okxClient.GetHistoryCandlesAsync(instId, bar, 120, 3);
        var session = new RealtimeSessionDocument
        {
            SessionId = DocumentIds.Default, Mode = "simulated", InstId = instId, Bar = bar, StrategyType = strategy.Definition.Id,
            MovingAveragePeriod = parameters.MovingAveragePeriod, StopLossPct = parameters.StopLossPct, TrailingDrawdownPct = parameters.TrailingDrawdownPct, Leverage = parameters.Leverage,
            AutoOptimizeParameters = request.AutoOptimizeParameters == true,
            ParamsSource = source, StartedAt = DateTime.UtcNow, Status = "running", PositionSide = "flat", RealizedEquity = 1m,
            LastEquity = 1m, LastSettledCandleTs = candles.LastOrDefault()?.Ts, LastSignal = "hold", SignalReason = "实时模拟已启动，将从下一根已收盘 K 线开始执行。",
            LastTakerFeeRate = fee.Rate, FeeRateSource = fee.Source, ReconciliationStatus = "model", PeriodEvaluations = [], TradePoints = []
        };
        await _repository.SaveRealtimeSessionAsync(session);
        var strategyConfig = await _repository.GetStrategyConfigAsync();
        strategyConfig.StrategyType = strategy.Definition.Id; strategyConfig.Enabled = true; strategyConfig.MovingAveragePeriod = parameters.MovingAveragePeriod; strategyConfig.StopLossPct = parameters.StopLossPct;
        strategyConfig.TrailingDrawdownPct = parameters.TrailingDrawdownPct; strategyConfig.Leverage = parameters.Leverage; strategyConfig.LastSignal = "hold";
        strategyConfig.EntryPrice = null; strategyConfig.HighestPriceSinceEntry = null;
        await _repository.SaveStrategyConfigAsync(strategyConfig);
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(instId, bar, strategy.Definition.Id, true));
    }

    public async Task<RealtimeWorkspaceDto> PutLiveSessionAsync(LiveRealtimeSessionRequest request)
    {
        await EnsureLiveAccountReadyAsync();
        var simulatedSession = await _repository.GetRealtimeSessionAsync();
        if (simulatedSession is null)
        {
            throw new InvalidOperationException("LIVE_SESSION_REQUIRES_CONFIRMED_SIMULATION: 请先确认实时模拟会话，再启动实盘交易。");
        }
        var simulatedParams = new StrategyParameterSetDto(simulatedSession.MovingAveragePeriod, simulatedSession.StopLossPct, simulatedSession.TrailingDrawdownPct, simulatedSession.Leverage);
        var liveParams = BuildParameters(request.MovingAveragePeriod, request.StopLossPct, request.TrailingDrawdownPct, request.Leverage, simulatedParams);
        var liveParamsSource = SameParams(liveParams, simulatedParams) ? "follow-simulation" : "live-manual";

        if ((!string.IsNullOrWhiteSpace(request.InstId) && !string.Equals(request.InstId.Trim(), simulatedSession.InstId, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrWhiteSpace(request.Bar) && !string.Equals(request.Bar.Trim(), simulatedSession.Bar, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrWhiteSpace(request.StrategyType) && !string.Equals(_strategyRegistry.NormalizeStrategyId(request.StrategyType), simulatedSession.StrategyType, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("LIVE_SESSION_CONFIG_MISMATCH: 实盘品种、周期、策略必须与当前已确认的模拟会话一致。");
        }

        var liveSession = await _repository.GetLiveRealtimeSessionAsync();
        if (HasOpenPosition(liveSession))
        {
            await ForceExitLiveSessionImmediateAsync(liveSession!);
            if (string.Equals(liveSession!.Status, "error", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(liveSession.ErrorMessage ?? "LIVE_FORCE_EXIT_BEFORE_START_FAILED: 启动实盘前平仓失败。");
        }
        else if (liveSession is not null && (await ReadLivePositionSnapshotsAsync(liveSession.InstId)).Count > 0)
        {
            await ForceExitLiveSessionImmediateAsync(liveSession);
            if (string.Equals(liveSession.Status, "error", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(liveSession.ErrorMessage ?? "LIVE_FORCE_EXIT_BEFORE_START_FAILED: 启动实盘前平仓失败。");
        }

        await SyncLiveLeverageAsync(simulatedSession.InstId, liveParams.Leverage);
        var fee = await ResolveTakerFeeRateAsync(simulatedSession.InstId, "live");
        var candles = await _okxClient.GetHistoryCandlesAsync(simulatedSession.InstId, simulatedSession.Bar, 120, 3);
        var session = new RealtimeSessionDocument
        {
            SessionId = "live-default", Mode = "live", InstId = simulatedSession.InstId, Bar = simulatedSession.Bar, StrategyType = simulatedSession.StrategyType,
            MovingAveragePeriod = liveParams.MovingAveragePeriod, StopLossPct = liveParams.StopLossPct, TrailingDrawdownPct = liveParams.TrailingDrawdownPct, Leverage = liveParams.Leverage,
            AutoOptimizeParameters = request.AutoOptimizeParameters == true,
            ParamsSource = liveParamsSource, StartedAt = DateTime.UtcNow, Status = "running", PositionSide = "flat", RealizedEquity = 1m,
            LastEquity = 1m, LastSettledCandleTs = candles.LastOrDefault()?.Ts, LastSignal = "hold", SignalReason = "实盘自动交易已启动，将从下一根已收盘 K 线开始执行。",
            LastTakerFeeRate = fee.Rate, FeeRateSource = fee.Source, ReconciliationStatus = "pending_fills", PeriodEvaluations = [], TradePoints = []
        };
        await _repository.SaveLiveRealtimeSessionAsync(session);
        await SetStrategyStatusFromLiveSessionsAsync();
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(simulatedSession.InstId, simulatedSession.Bar, simulatedSession.StrategyType, true));
    }

    public async Task<RealtimeTradingSummaryDto?> GetLiveReconciliationAsync()
    {
        var session = await _repository.GetLiveRealtimeSessionAsync();
        return RealtimeSummaryBuilder.BuildLiveTradingSummary(session);
    }

    public async Task<RealtimeWorkspaceDto> ForceExitAsync()
    {
        var session = await _repository.GetRealtimeSessionAsync();
        if (session is null) return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(null, null, null, true));
        await ForceExitSimulatedSessionImmediateAsync(session);
        return await GetWorkspaceAsync(new RealtimeWorkspaceRequest(session.InstId, session.Bar, session.StrategyType, true));
    }

    public async Task<RealtimeWorkspaceDto> ForceExitLiveSessionAsync()
    {
        var session = await _repository.GetLiveRealtimeSessionAsync() ?? throw new InvalidOperationException("LIVE_SESSION_NOT_FOUND: 未找到该实盘会话。");
        await ForceExitLiveSessionImmediateAsync(session);
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
        if (!string.Equals(session.Status, "paused", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("LIVE_SESSION_NOT_PAUSED: 只有暂停状态可以恢复；已停止会话请重新启动实时交易。");
        }
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
        _ = BuildParameters(session.MovingAveragePeriod, session.StopLossPct, session.TrailingDrawdownPct, session.Leverage, new StrategyParameterSetDto(session.MovingAveragePeriod, session.StopLossPct, session.TrailingDrawdownPct, session.Leverage));
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
        var simulatedSession = await _repository.GetRealtimeSessionAsync();
        AlignLiveStrategyStateWithSimulation(session, simulatedSession);
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
        var activeParams = session is null ? previewParams : new StrategyParameterSetDto(session.MovingAveragePeriod, session.StopLossPct, session.TrailingDrawdownPct, session.Leverage);
        var activeSource = session?.ParamsSource ?? previewSource;
        var candles = await _okxClient.GetHistoryCandlesAsync(instId, bar, 120, 3);
        if (session is not null && string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase)) await SettleSimulatedSessionAsync(session, strategy, candles, null, false);
        var refreshedSession = session is null ? null : await _repository.GetRealtimeSessionAsync();
        if (refreshedSession is not null && !IsMatchingSession(refreshedSession, instId, bar, strategy.Definition.Id)) refreshedSession = null;
        var refreshedActiveParams = refreshedSession is null ? activeParams : new StrategyParameterSetDto(refreshedSession.MovingAveragePeriod, refreshedSession.StopLossPct, refreshedSession.TrailingDrawdownPct, refreshedSession.Leverage);
        var refreshedActiveSource = refreshedSession?.ParamsSource ?? activeSource;
        var currentCandle = await ReadCurrentCandleAsync(instId, bar, candles);
        var latestPrice = await ReadLatestPriceAsync(instId, candles);
        var simulation = BuildSimulation(candles, refreshedActiveParams, refreshedActiveSource, refreshedSession);
        var liveSession = await _repository.GetLiveRealtimeSessionAsync();
        if (liveSession is not null)
        {
            AlignLiveStrategyStateWithSimulation(liveSession, refreshedSession);
            var liveStrategy = _strategyRegistry.GetRunnable(liveSession.StrategyType);
            var liveCandles = string.Equals(liveSession.InstId, instId, StringComparison.OrdinalIgnoreCase) && string.Equals(liveSession.Bar, bar, StringComparison.OrdinalIgnoreCase)
                ? candles
                : await _okxClient.GetHistoryCandlesAsync(liveSession.InstId, liveSession.Bar, 120, 3);
            await SettleLiveSessionAsync(liveSession, liveStrategy, liveCandles, null, false);
            liveSession = await _repository.GetLiveRealtimeSessionAsync();
        }
        var live = BuildLive(state, strategyConfig, positions, apiConnection, simulation, latestPrice, refreshedSession is not null, liveSession);
        return new RealtimeWorkspaceDto(instId, bar, strategy.Definition.Id, refreshedSession is null ? strategy.Definition.Id : null, refreshedSession?.StrategyType, refreshedSession is null ? null : ToSessionDto(refreshedSession), liveSession is null ? null : ToLiveSessionDto(liveSession), refreshedActiveParams, refreshedActiveSource, candles, currentCandle, latestPrice, candles.LastOrDefault()?.Ts, BuildNextRefreshAt(candles.LastOrDefault()?.Ts, bar), DateTime.UtcNow, simulation, live);
    }

    private async Task SettleSimulatedSessionAsync(RealtimeSessionDocument session, ITradingStrategy strategy, List<CandlePointDto> candles, decimal? latestPrice, bool forceExit)
    {
        if (candles.Count == 0) return;
        await RefreshSessionFeeRateAsync(session, "live");
        var startIndex = ResolveSettlementStartIndex(session, candles);
        for (var i = startIndex; i < candles.Count; i++)
        {
            var candle = candles[i];
            var previousCandles = candles.Take(i).ToList();
            var decision = EvaluateRealtimeDecision(session, strategy, candle, previousCandles);
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
            else session.SignalReason = "当前无模拟持仓，实时模拟已停止。";
            session.Status = "stopped";
        }
        await _repository.SaveRealtimeSessionAsync(session);
    }

    private async Task ForceExitSimulatedSessionImmediateAsync(RealtimeSessionDocument session)
    {
        if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
        {
            var closePrice = await ReadLatestPriceAsync(session.InstId, []) ?? session.EntryPrice ?? 0m;
            var closeTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var forceCandle = new CandlePointDto(closeTs, closePrice, closePrice, closePrice, closePrice);
            AppendEvaluation(session, forceCandle, "force_close", closePrice, "已按最新参考价强制退出模拟持仓。", true);
            ApplyClose(session, closeTs, closePrice, "force_close", "已按最新参考价强制退出模拟持仓。");
            session.LastSettledCandleTs = closeTs;
        }
        else
        {
            session.LastSignal = "hold";
            session.SignalReason = "当前无模拟持仓，实时模拟已停止。";
        }

        session.Status = "stopped";
        session.ErrorCode = null;
        session.ErrorMessage = null;
        await _repository.SaveRealtimeSessionAsync(session);
    }

    private async Task SettleLiveSessionAsync(RealtimeSessionDocument session, ITradingStrategy strategy, List<CandlePointDto> candles, decimal? latestPrice, bool forceExit)
    {
        if (candles.Count == 0 || !string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)) return;
        if (!string.Equals(session.Status, "running", StringComparison.OrdinalIgnoreCase) && !forceExit) return;
        await RefreshSessionFeeRateAsync(session, "live");
        var startIndex = ResolveSettlementStartIndex(session, candles);
        for (var i = startIndex; i < candles.Count; i++)
        {
            var candle = candles[i];
            var previousCandles = candles.Take(i).ToList();
            var decision = EvaluateRealtimeDecision(session, strategy, candle, previousCandles);
            try { await ApplyLivePeriodDecisionAsync(session, candle, decision); }
            catch (Exception ex)
            {
                session.Status = "error"; session.ErrorCode = "OKX_ORDER_FAILED"; session.ErrorMessage = ex.Message; session.SignalReason = ex.Message;
                await _repository.SaveLiveRealtimeSessionAsync(session); await SetStrategyStatusFromLiveSessionsAsync(); return;
            }
        }
        if (forceExit)
        {
            if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var fallbackEntry = session.EntryPrice ?? session.ExecutionEntryPrice ?? candles.LastOrDefault()?.Close ?? 0m;
                    var requestedPrice = latestPrice ?? candles.LastOrDefault()?.Close ?? fallbackEntry;
                    var executionPrice = await ExecuteLiveCloseAsync(session, "force_close", "已按最新参考价强制退出实盘持仓。", requestedPrice);
                    await TryReconcilePositionHistoryAsync(session);
                    var closeTs = session.LastExecutionTs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    var forceCandle = new CandlePointDto(closeTs, executionPrice, executionPrice, executionPrice, executionPrice);
                    AppendEvaluation(session, forceCandle, "force_close", executionPrice, "已按最新参考价强制退出实盘持仓。", true);
                    ApplyClose(session, closeTs, executionPrice, "force_close", "已按最新参考价强制退出实盘持仓。");
                    session.Status = "stopped";
                }
                catch (Exception ex) { session.Status = "error"; session.ErrorCode = "OKX_FORCE_EXIT_FAILED"; session.ErrorMessage = ex.Message; session.SignalReason = ex.Message; }
            }
            else { session.SignalReason = "当前无实盘持仓，实时交易已停止。"; session.Status = "stopped"; }
        }
        await _repository.SaveLiveRealtimeSessionAsync(session); await SetStrategyStatusFromLiveSessionsAsync();
    }

    private async Task ForceExitLiveSessionImmediateAsync(RealtimeSessionDocument session)
    {
        if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var fallbackEntry = session.EntryPrice ?? session.ExecutionEntryPrice ?? 0m;
                var requestedPrice = await ReadLatestPriceAsync(session.InstId, []) ?? fallbackEntry;
                var executionPrice = await ExecuteLiveCloseAsync(session, "force_close", "已按最新参考价强制退出实盘持仓。", requestedPrice);
                await TryReconcilePositionHistoryAsync(session);
                var closeTs = session.LastExecutionTs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var forceCandle = new CandlePointDto(closeTs, executionPrice, executionPrice, executionPrice, executionPrice);
                AppendEvaluation(session, forceCandle, "force_close", executionPrice, "已按最新参考价强制退出实盘持仓。", true);
                ApplyClose(session, closeTs, executionPrice, "force_close", "已按最新参考价强制退出实盘持仓。");
                session.LastSettledCandleTs = closeTs;
                session.Status = "stopped";
                session.ErrorCode = null;
                session.ErrorMessage = null;
            }
            catch (Exception ex)
            {
                session.Status = "error";
                session.ErrorCode = "OKX_FORCE_EXIT_FAILED";
                session.ErrorMessage = ex.Message;
                session.SignalReason = ex.Message;
            }
        }
        else
        {
            try
            {
                var requestedPrice = await ReadLatestPriceAsync(session.InstId, []) ?? session.EntryPrice ?? session.ExecutionEntryPrice ?? 0m;
                var closedResiduals = await ExecuteLiveCloseAllExchangePositionsAsync(session, "force_close", "已按最新参考价强制退出 OKX 剩余实盘持仓。", requestedPrice);
                if (closedResiduals > 0)
                {
                    var closeTs = session.LastExecutionTs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    var executionPrice = session.LastExecutionPrice ?? requestedPrice;
                    var forceCandle = new CandlePointDto(closeTs, executionPrice, executionPrice, executionPrice, executionPrice);
                    ClearPositionState(session, "force_close", "已按最新参考价强制退出 OKX 剩余实盘持仓。");
                    AppendEvaluation(session, forceCandle, "force_close", executionPrice, "已按最新参考价强制退出 OKX 剩余实盘持仓。");
                    session.LastSettledCandleTs = closeTs;
                }
                else
                {
                    session.LastSignal = "hold";
                    session.SignalReason = "当前无实盘持仓，实时交易已停止。";
                }

                session.Status = "stopped";
                session.ErrorCode = null;
                session.ErrorMessage = null;
            }
            catch (Exception ex)
            {
                session.Status = "error";
                session.ErrorCode = "OKX_FORCE_EXIT_FAILED";
                session.ErrorMessage = ex.Message;
                session.SignalReason = ex.Message;
            }
        }

        await _repository.SaveLiveRealtimeSessionAsync(session);
        await SetStrategyStatusFromLiveSessionsAsync();
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
                session.PositionSide = decision.Action == "open_long" ? "long" : "short";
                session.EntryPrice = decision.ExecutionPrice ?? candle.Close;
                session.EntryTs = candle.Ts;
                session.ExecutionEntryPrice = executionPrice;
                session.ExecutionEntryTs = session.LastExecutionTs ?? candle.Ts;
                session.PeakPrice = candle.Close;
                session.TroughPrice = candle.Close;
                AppendEvaluation(session, candle, decision.Action, session.EntryPrice, decision.Reason);
            }
            else AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason);
            session.LastSettledCandleTs = candle.Ts; return;
        }
        session.PeakPrice = Math.Max(session.PeakPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        session.TroughPrice = Math.Min(session.TroughPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        if (decision.Action == "close")
        {
            var closeReason = ResolveCloseReason(session, candle, decision);
            var strategyClosePrice = decision.ExecutionPrice ?? candle.Close;
            _ = await ExecuteLiveCloseAsync(session, "close", closeReason, strategyClosePrice);
            await TryReconcilePositionHistoryAsync(session);
            AppendEvaluation(session, candle, decision.Action, session.ExitAvgPx ?? session.LastExecutionPrice ?? strategyClosePrice, closeReason, true);
            ApplyClose(session, session.LastExecutionTs ?? candle.Ts, strategyClosePrice, "close", closeReason);
        }
        else AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason);
        session.LastSettledCandleTs = candle.Ts;
    }

    private static RealtimePeriodDecision EvaluateRealtimeDecision(RealtimeSessionDocument session, ITradingStrategy strategy, CandlePointDto candle, List<CandlePointDto> previousCandles)
    {
        var optimizationReason = TryOptimizeParametersBeforeEntry(session, strategy, previousCandles);
        var decision = strategy.EvaluateRealtimePeriod(new RealtimePeriodContext(
            candle,
            previousCandles,
            session.PositionSide,
            session.EntryPrice,
            session.PeakPrice,
            session.TroughPrice,
            new StrategyParameterSetDto(session.MovingAveragePeriod, session.StopLossPct, session.TrailingDrawdownPct, session.Leverage)));

        if (!string.IsNullOrWhiteSpace(optimizationReason) && decision.Action is "open_long" or "open_short")
        {
            return decision with { Reason = $"{optimizationReason}；{decision.Reason}" };
        }

        return decision;
    }

    private static string? TryOptimizeParametersBeforeEntry(RealtimeSessionDocument session, ITradingStrategy strategy, List<CandlePointDto> previousCandles)
    {
        if (!session.AutoOptimizeParameters) return null;
        if (!string.Equals(strategy.Definition.Id, "buy-sell", StringComparison.OrdinalIgnoreCase)) return null;
        if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase)) return null;
        if (!HasBuySellEntryOpportunity(previousCandles)) return null;

        var best = FindBestRealtimeParameters(strategy, previousCandles);
        if (best is null)
        {
            session.LastOptimizationReason = "自动寻找最佳参数：历史 K 线不足或没有可用结果，继续使用当前参数。";
            return session.LastOptimizationReason;
        }

        session.StopLossPct = best.StopLossPct;
        session.TrailingDrawdownPct = best.TrailingDrawdownPct;
        session.Leverage = best.Leverage;
        session.ParamsSource = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)
            ? "live-auto-best"
            : "auto-best";
        session.LastOptimizationResult = best;
        session.LastOptimizationReason = $"自动寻找最佳参数：止损 {best.StopLossPct:0.##}% / 浮盈回撤 {best.TrailingDrawdownPct:0.##}% / 杠杆 {best.Leverage:0.##}x，净收益 {best.NetTotalReturn:P2}。";
        return session.LastOptimizationReason;
    }

    private static bool HasBuySellEntryOpportunity(List<CandlePointDto> previousCandles)
    {
        foreach (var movingAveragePeriod in OptimizationMovingAverageGrid)
        {
            if (previousCandles.Count < movingAveragePeriod + 1) continue;
            if (StrategyRegistryService.ResolveBuySellMovingAverageTrend(previousCandles, movingAveragePeriod) != 0)
            {
                return true;
            }
        }

        return false;
    }

    private static BacktestResultDto? FindBestRealtimeParameters(ITradingStrategy strategy, List<CandlePointDto> previousCandles)
    {
        if (previousCandles.Count < OptimizationMovingAverageGrid.Min() + 1) return null;

        var results = new List<BacktestResultDto>();
        foreach (var movingAveragePeriod in OptimizationMovingAverageGrid)
        {
            foreach (var leverage in OptimizationLeverageGrid)
            {
                foreach (var stop in OptimizationStopLossGrid)
                {
                    foreach (var trailing in OptimizationTrailingGrid)
                    {
                        if (!StrategyRegistryService.IsLeveragedStopLossAllowed(stop, leverage)) continue;
                        results.Add(strategy.RunRealtimeTest(previousCandles, new StrategyParameterSetDto(movingAveragePeriod, stop, trailing, leverage)).Summary);
                    }
                }
            }
        }

        return results
            .OrderByDescending(x => x.NetTotalReturn)
            .ThenByDescending(x => x.MaxDrawdown)
            .ThenByDescending(x => x.WinRate)
            .FirstOrDefault();
    }

    private async Task<decimal> ExecuteLiveOpenAsync(RealtimeSessionDocument session, CandlePointDto candle, RealtimePeriodDecision decision)
    {
        var price = await ReadLatestPriceAsync(session.InstId, [candle]) ?? candle.Close;
        var instrument = await _okxClient.GetSwapInstrumentAsync(session.InstId) ?? throw new InvalidOperationException($"LIVE_INSTRUMENT_NOT_FOUND: 未找到 {session.InstId} 合约信息。");
        var orderPlan = await BuildLiveOpenOrderPlanAsync(session, instrument, price);
        var request = new OkxPlaceOrderRequest { InstId = session.InstId, TdMode = "cross", OrdType = "market", PosSide = decision.Action == "open_long" ? "long" : "short", Side = decision.Action == "open_long" ? "buy" : "sell", Size = orderPlan.Size.ToString(CultureInfo.InvariantCulture), ReduceOnly = false };
        var response = await _okxClient.PlaceOrderAsync(request, "live");
        var data = response.Data.FirstOrDefault();
        var orderId = data?.OrdId;
        var fills = await FetchAndStoreOrderFillsAsync(session.InstId, orderId);
        var actualPrice = fills?.AveragePrice > 0m ? fills.AveragePrice : price;
        session.LastOrderId = orderId; session.EntryOrderId = orderId; session.LastExecutionPrice = actualPrice; session.LastExecutionTs = fills?.LastFillTs ?? candle.Ts; session.LastExecutionSize = fills?.Size > 0m ? fills.Size : orderPlan.Size;
        session.PositionSize = session.LastExecutionSize; session.AllocatedCapital = orderPlan.AllocatedCapital; session.EntryNotionalUsd = orderPlan.EntryNotionalUsd;
        session.EntryAvgPx = actualPrice;
        session.EntryFillSize = session.LastExecutionSize;
        session.EntryFee = fills?.Fee;
        session.EntryFeeCcy = fills?.FeeCcy;
        session.ReconciliationStatus = fills is null ? "pending_fills" : "pending_position_history";
        return actualPrice;
    }

    private async Task<decimal> ExecuteLiveCloseAsync(RealtimeSessionDocument session, string action, string reason, decimal fallbackPrice)
    {
        var currentPrice = await _okxClient.GetLatestPriceAsync(session.InstId) ?? fallbackPrice;
        var closeLong = string.Equals(session.PositionSide, "long", StringComparison.OrdinalIgnoreCase);
        var totalRequestedSize = 0m;
        var totalFilledSize = 0m;
        var weightedExitPrice = 0m;
        var totalExitFee = 0m;
        var totalFillPnl = 0m;
        string? exitFeeCcy = null;
        string? lastOrderId = null;

        for (var attempt = 0; attempt < MaxLiveCloseAttempts; attempt++)
        {
            var position = await ReadLivePositionSnapshotAsync(session);
            if (position is null || position.Size <= 0m)
            {
                session.PositionSize = null;
                session.LastOrderId = lastOrderId ?? session.LastOrderId;
                session.LastExecutionPrice = currentPrice;
                session.LastExecutionTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                session.LastExecutionSize = totalRequestedSize;
                session.LastSignal = action;
                session.SignalReason = totalRequestedSize > 0m ? reason : "OKX 未返回对应实盘持仓，本地会话已按空仓处理。";
                return currentPrice;
            }

            ApplyLivePositionSnapshot(session, position);
            var request = new OkxPlaceOrderRequest
            {
                InstId = session.InstId,
                TdMode = "cross",
                OrdType = "market",
                PosSide = closeLong ? "long" : "short",
                Side = closeLong ? "sell" : "buy",
                Size = position.Size.ToString(CultureInfo.InvariantCulture),
                ReduceOnly = true
            };
            var response = await _okxClient.PlaceOrderAsync(request, "live");
            var data = response.Data.FirstOrDefault();
            lastOrderId = data?.OrdId ?? lastOrderId;
            var fills = await FetchAndStoreOrderFillsAsync(session.InstId, data?.OrdId);
            if (fills is not null && fills.Size > 0m)
            {
                weightedExitPrice += fills.AveragePrice * fills.Size;
                totalFilledSize += fills.Size;
                totalExitFee += fills.Fee;
                totalFillPnl += fills.FillPnl;
                exitFeeCcy ??= fills.FeeCcy;
                currentPrice = fills.AveragePrice;
            }
            totalRequestedSize += position.Size;
            session.LastOrderId = lastOrderId;
            session.LastExecutionPrice = currentPrice;
            session.LastExecutionTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            session.LastExecutionSize = totalFilledSize > 0m ? totalFilledSize : totalRequestedSize;
            session.ExitOrderId = lastOrderId;
            session.ExitAvgPx = totalFilledSize > 0m ? weightedExitPrice / totalFilledSize : currentPrice;
            session.ExitFillSize = totalFilledSize > 0m ? totalFilledSize : totalRequestedSize;
            session.ExitFee = totalFilledSize > 0m ? totalExitFee : null;
            session.ExitFeeCcy = exitFeeCcy;
            session.LastGrossPnl = totalFillPnl == 0m ? null : totalFillPnl;
            session.LastSignal = action;
            session.SignalReason = reason;

            await Task.Delay(LiveCloseVerificationDelay);
        }

        var remaining = await ReadLivePositionSnapshotAsync(session);
        if (remaining is not null && remaining.Size > 0m)
        {
            ApplyLivePositionSnapshot(session, remaining);
            throw new InvalidOperationException($"LIVE_POSITION_NOT_FULLY_CLOSED: 平仓后 OKX 仍返回 {remaining.Size:0.########} 张 {session.PositionSide} 持仓，已停止继续自动交易。");
        }

        session.PositionSize = null;
        if (totalFilledSize > 0m)
        {
            session.LastExecutionPrice = weightedExitPrice / totalFilledSize;
            session.LastExecutionSize = totalFilledSize;
            session.ExitAvgPx = session.LastExecutionPrice;
            session.ExitFillSize = totalFilledSize;
            session.ExitFee = totalExitFee;
            session.ExitFeeCcy = exitFeeCcy;
            session.LastGrossPnl = totalFillPnl == 0m ? null : totalFillPnl;
            session.ReconciliationStatus = "pending_position_history";
        }
        return currentPrice;
    }

    private async Task<LivePositionSnapshot?> ReadLivePositionSnapshotAsync(RealtimeSessionDocument session)
    {
        var side = session.PositionSide;
        return (await ReadLivePositionSnapshotsAsync(session.InstId))
            .FirstOrDefault(x => string.Equals(x.Side, side, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<FillAggregate?> FetchAndStoreOrderFillsAsync(string instId, string? orderId)
    {
        if (string.IsNullOrWhiteSpace(orderId)) return null;
        try
        {
            var response = await _okxClient.GetFillsHistoryAsync("live", instId, orderId, DateTime.UtcNow.AddDays(-1), DateTime.UtcNow);
            if (response.Code != "0") return null;
            var fills = response.Data.Select(ToFillDocument).Where(x => x.OrderId == orderId).ToList();
            await _repository.UpsertOkxFillsAsync(fills, DateTime.UtcNow.AddDays(-1));
            return PnlCalculator.AggregateFills(fills);
        }
        catch
        {
            var cached = await _repository.GetOkxFillsByOrderIdAsync(orderId);
            return PnlCalculator.AggregateFills(cached);
        }
    }

    private async Task TryReconcilePositionHistoryAsync(RealtimeSessionDocument session)
    {
        try
        {
            var response = await _okxClient.GetPositionsHistoryAsync("live", session.InstId, DateTime.UtcNow.AddDays(-1), DateTime.UtcNow);
            if (response.Code != "0") return;
            var docs = response.Data.Select(ToPositionHistoryDocument).ToList();
            await _repository.UpsertOkxPositionHistoryAsync(docs, DateTime.UtcNow.AddDays(-1));
            var closedAt = session.LastExecutionTs.HasValue
                ? DateTimeOffset.FromUnixTimeMilliseconds(session.LastExecutionTs.Value).UtcDateTime
                : DateTime.UtcNow;
            var match = docs
                .Where(x => string.Equals(x.InstId, session.InstId, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(x.PosSide, session.PositionSide, StringComparison.OrdinalIgnoreCase)
                    && x.UpdatedAt >= closedAt.AddMinutes(-10)
                    && x.UpdatedAt <= closedAt.AddMinutes(10))
                .OrderBy(x => Math.Abs((x.UpdatedAt - closedAt).TotalMilliseconds))
                .FirstOrDefault();
            if (match is null) return;

            session.LastGrossPnl = match.Pnl;
            session.LastFundingFee = match.FundingFee;
            session.LastNetPnl = match.RealizedPnl;
            var totalFee = Math.Abs(match.Fee);
            if (totalFee > 0m)
            {
                session.ExitFee = Math.Max(0m, totalFee - Math.Abs(session.EntryFee ?? 0m));
                session.LastFee = totalFee;
            }
            if (match.CloseAvgPx > 0m) session.ExitAvgPx = match.CloseAvgPx;
            if (match.OpenAvgPx > 0m && !session.EntryAvgPx.HasValue) session.EntryAvgPx = match.OpenAvgPx;
            if (match.CloseTotalPos > 0m) session.ExitFillSize = match.CloseTotalPos;
            session.ReconciliationStatus = "reconciled";
        }
        catch
        {
            if (string.Equals(session.ReconciliationStatus, "model", StringComparison.OrdinalIgnoreCase))
            {
                session.ReconciliationStatus = "pending_position_history";
            }
        }
    }

    private async Task RefreshSessionFeeRateAsync(RealtimeSessionDocument session, string mode)
    {
        var fee = await ResolveTakerFeeRateAsync(session.InstId, mode);
        session.LastTakerFeeRate = fee.Rate;
        session.FeeRateSource = fee.Source;
    }

    private async Task<(decimal Rate, string Source)> ResolveTakerFeeRateAsync(string instId, string mode)
    {
        var id = $"SWAP:{instId}";
        try
        {
            var response = await _okxClient.GetTradeFeeAsync(mode, instId);
            if (response.Code == "0")
            {
                var data = response.Data.FirstOrDefault();
                var takerRaw = ParseDecimal(data?.TakerU);
                if (takerRaw == 0m) takerRaw = ParseDecimal(data?.Taker);
                var makerRaw = ParseDecimal(data?.MakerU);
                if (makerRaw == 0m) makerRaw = ParseDecimal(data?.Maker);
                var taker = Math.Abs(takerRaw);
                var maker = Math.Abs(makerRaw);
                if (taker > 0m)
                {
                    await _repository.SaveOkxTradeFeeAsync(new OkxTradeFeeDocument
                    {
                        Id = id,
                        InstType = data?.InstType ?? "SWAP",
                        InstId = data?.InstId ?? instId,
                        InstFamily = data?.InstFamily,
                        MakerFeeRate = maker,
                        TakerFeeRate = taker,
                        Source = "okx"
                    });
                    return (taker, "okx");
                }
            }
        }
        catch
        {
            // Use cached or fallback below. Trading should not stop just because fee lookup is delayed.
        }

        var cached = await _repository.GetOkxTradeFeeAsync(id);
        if (cached is not null && cached.TakerFeeRate > 0m) return (cached.TakerFeeRate, cached.Source);
        return (FallbackTakerFeeRate, "fallback");
    }

    private async Task<List<LivePositionSnapshot>> ReadLivePositionSnapshotsAsync(string instId)
    {
        var positions = await _okxClient.GetPositionsAsync("live");
        if (positions.Code != "0") throw new InvalidOperationException(positions.Msg);

        return positions.Data
            .Where(x => string.Equals(x.InstId, instId, StringComparison.OrdinalIgnoreCase)
                && (string.Equals(x.PosSide, "long", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(x.PosSide, "short", StringComparison.OrdinalIgnoreCase)))
            .Select(x => new LivePositionSnapshot(x.PosSide ?? string.Empty, Math.Abs(ParseDecimal(x.Pos)), ParseDecimal(x.AvgPx)))
            .Where(x => x.Size > 0m)
            .ToList();
    }

    private async Task<int> ExecuteLiveCloseAllExchangePositionsAsync(RealtimeSessionDocument session, string action, string reason, decimal fallbackPrice)
    {
        var positions = await ReadLivePositionSnapshotsAsync(session.InstId);
        var closed = 0;
        foreach (var position in positions)
        {
            ApplyLivePositionSnapshot(session, position);
            _ = await ExecuteLiveCloseAsync(session, action, reason, fallbackPrice);
            closed++;
        }

        session.PositionSide = "flat";
        session.PositionSize = null;
        return closed;
    }

    private static void ApplyLivePositionSnapshot(RealtimeSessionDocument session, LivePositionSnapshot position)
    {
        if (string.Equals(position.Side, "long", StringComparison.OrdinalIgnoreCase)
            || string.Equals(position.Side, "short", StringComparison.OrdinalIgnoreCase))
        {
            session.PositionSide = position.Side;
        }
        session.PositionSize = position.Size;
        if (!session.ExecutionEntryPrice.HasValue && position.EntryPrice > 0m) session.ExecutionEntryPrice = position.EntryPrice;
        if (!session.ExecutionEntryTs.HasValue) session.ExecutionEntryTs = session.EntryTs;
        if (!session.EntryPrice.HasValue && position.EntryPrice > 0m) session.EntryPrice = position.EntryPrice;
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
                session.AllocatedCapital = SimulatedAccountCapital;
                session.PositionSize = PnlCalculator.CalculateSimulatedSize(SimulatedAccountCapital, session.Leverage, executionPrice, 1m);
                session.EntryNotionalUsd = SimulatedAccountCapital * session.Leverage;
                session.EntryAvgPx = executionPrice;
                session.EntryFillSize = session.PositionSize;
                session.EntryFee = session.EntryNotionalUsd * session.LastTakerFeeRate;
                session.EntryFeeCcy = "USDT";
                session.ReconciliationStatus = "model";
            }
            AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason); session.LastSettledCandleTs = candle.Ts; return;
        }
        session.PeakPrice = Math.Max(session.PeakPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        session.TroughPrice = Math.Min(session.TroughPrice ?? session.EntryPrice ?? candle.Close, candle.Close);
        if (decision.Action == "close")
        {
            var executionPrice = decision.ExecutionPrice ?? candle.Close;
            var closeReason = ResolveCloseReason(session, candle, decision);
            AppendEvaluation(session, candle, decision.Action, executionPrice, closeReason, true);
            ApplyClose(session, candle.Ts, executionPrice, "close", closeReason);
        }
        else AppendEvaluation(session, candle, decision.Action, decision.ExecutionPrice, decision.Reason);
        session.LastSettledCandleTs = candle.Ts;
    }

    private static string ResolveCloseReason(RealtimeSessionDocument session, CandlePointDto candle, RealtimePeriodDecision decision)
    {
        if (IsStopLossTriggered(session, candle))
        {
            return string.Equals(session.PositionSide, "short", StringComparison.OrdinalIgnoreCase)
                ? "已收盘 K 线触发空单止损。"
                : "已收盘 K 线触发多单止损。";
        }

        if (IsTrailingExitTriggered(session, candle))
        {
            return string.Equals(session.PositionSide, "short", StringComparison.OrdinalIgnoreCase)
                ? "已收盘 K 线触发空单浮盈回撤。"
                : "已收盘 K 线触发多单浮盈回撤。";
        }

        return decision.Reason;
    }

    private static bool IsStopLossTriggered(RealtimeSessionDocument session, CandlePointDto candle)
    {
        if (!session.EntryPrice.HasValue || session.EntryPrice.Value <= 0m) return false;
        var entry = session.EntryPrice.Value;
        if (string.Equals(session.PositionSide, "long", StringComparison.OrdinalIgnoreCase))
        {
            return candle.Low <= entry * (1m - session.StopLossPct / 100m);
        }

        if (string.Equals(session.PositionSide, "short", StringComparison.OrdinalIgnoreCase))
        {
            return candle.High >= entry * (1m + session.StopLossPct / 100m);
        }

        return false;
    }

    private static bool IsTrailingExitTriggered(RealtimeSessionDocument session, CandlePointDto candle)
    {
        if (!session.EntryPrice.HasValue || session.EntryPrice.Value <= 0m) return false;
        var entry = session.EntryPrice.Value;
        if (string.Equals(session.PositionSide, "long", StringComparison.OrdinalIgnoreCase))
        {
            var peakClose = Math.Max(session.PeakPrice ?? entry, candle.Close);
            var maxProfit = peakClose - entry;
            var currentProfit = candle.Close - entry;
            var profitDrawdown = maxProfit <= 0m ? 0m : (maxProfit - currentProfit) / maxProfit * 100m;
            return maxProfit > 0m && currentProfit > 0m && profitDrawdown >= session.TrailingDrawdownPct;
        }

        if (string.Equals(session.PositionSide, "short", StringComparison.OrdinalIgnoreCase))
        {
            var troughClose = Math.Min(session.TroughPrice ?? entry, candle.Close);
            var maxProfit = entry - troughClose;
            var currentProfit = entry - candle.Close;
            var profitDrawdown = maxProfit <= 0m ? 0m : (maxProfit - currentProfit) / maxProfit * 100m;
            return maxProfit > 0m && currentProfit > 0m && profitDrawdown >= session.TrailingDrawdownPct;
        }

        return false;
    }

    private static void ApplyClose(RealtimeSessionDocument session, long ts, decimal executionPrice, string action, string reason)
    {
        var entryPrice = ResolveReturnEntryPrice(session);
        var entryTs = ResolveReturnEntryTs(session);
        if (!entryPrice.HasValue || !entryTs.HasValue)
        {
            ClearPositionState(session, action, reason);
            return;
        }

        var pnl = CalculateSessionPnl(session, executionPrice);
        var grossRet = pnl.GrossReturn;
        var netRet = pnl.NetReturn;
        var actualExecutionPrice = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)
            ? session.ExitAvgPx ?? session.LastExecutionPrice ?? executionPrice
            : executionPrice;
        session.LastGrossPnl = pnl.GrossPnl;
        session.LastFee = pnl.EntryFee + pnl.ExitFee;
        session.LastFundingFee = pnl.FundingFee;
        session.LastNetPnl = pnl.NetPnl;
        session.LastNetReturn = pnl.NetReturn;
        var status = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)
            ? session.ReconciliationStatus
            : "model";
        session.TradePoints.Add(new BacktestTradePointDto(
            entryTs.Value,
            entryPrice.Value,
            ts,
            executionPrice,
            netRet,
            action == "force_close" ? "force_close" : NormalizeReason(reason),
            session.PositionSide,
            grossRet,
            netRet,
            session.Leverage,
            pnl.FeeCostRate,
            session.LastTakerFeeRate,
            session.LastTakerFeeRate,
            session.LastOrderId,
            session.Mode,
            action,
            session.PositionSide,
            actualExecutionPrice,
            session.LastExecutionSize,
            "filled",
            session.EntryOrderId,
            session.ExitOrderId ?? session.LastOrderId,
            session.EntryAvgPx,
            session.ExitAvgPx ?? actualExecutionPrice,
            pnl.GrossPnl,
            pnl.EntryFee + pnl.ExitFee,
            pnl.FundingFee,
            pnl.NetPnl,
            pnl.NetReturn,
            session.FeeRateSource,
            status));
        session.RealizedEquity *= 1m + netRet; session.LastEquity = session.RealizedEquity; ClearPositionState(session, action, reason);
    }

    private static void ClearPositionState(RealtimeSessionDocument session, string action, string reason)
    {
        session.PositionSide = "flat";
        session.EntryPrice = null;
        session.EntryTs = null;
        session.ExecutionEntryPrice = null;
        session.ExecutionEntryTs = null;
        session.EntryOrderId = null;
        session.EntryAvgPx = null;
        session.EntryFillSize = null;
        session.EntryFee = null;
        session.EntryFeeCcy = null;
        session.PeakPrice = null;
        session.TroughPrice = null;
        session.PositionSize = null;
        session.AllocatedCapital = null;
        session.EntryNotionalUsd = null;
        session.LastSignal = action;
        session.SignalReason = reason;
    }

    private static void AppendEvaluation(RealtimeSessionDocument session, CandlePointDto candle, string action, decimal? executionPrice, string reason, bool settleBeforeAppend = false)
    {
        var evaluationPositionSide = session.PositionSide; var realizedEquity = session.RealizedEquity; var currentEquity = session.LastEquity; var unrealizedReturn = 0m; var grossReturn = 0m; var netReturn = 0m; var feeCost = 0m; decimal? grossPnl = null; decimal? fee = null; decimal? fundingFee = null; decimal? netPnl = null;
        var returnEntryPrice = ResolveReturnEntryPrice(session);
        if (settleBeforeAppend && returnEntryPrice.HasValue)
        {
            var closePrice = executionPrice ?? candle.Close;
            var pnl = CalculateSessionPnl(session, closePrice);
            grossReturn = pnl.GrossReturn; netReturn = pnl.NetReturn; feeCost = pnl.FeeCostRate; unrealizedReturn = netReturn; realizedEquity *= 1m + netReturn; currentEquity = realizedEquity; evaluationPositionSide = "flat";
            grossPnl = pnl.GrossPnl; fee = pnl.EntryFee + pnl.ExitFee; fundingFee = pnl.FundingFee; netPnl = pnl.NetPnl;
        }
        else if (!string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase) && returnEntryPrice.HasValue)
        {
            var pnl = CalculateSessionPnl(session, candle.Close);
            grossReturn = pnl.GrossReturn; netReturn = pnl.NetReturn; feeCost = pnl.FeeCostRate; unrealizedReturn = netReturn; currentEquity = realizedEquity * (1m + unrealizedReturn);
            grossPnl = pnl.GrossPnl; fee = pnl.EntryFee + pnl.ExitFee; fundingFee = pnl.FundingFee; netPnl = pnl.NetPnl;
        }
        var periodReturn = session.LastEquity == 0m ? 0m : currentEquity / session.LastEquity - 1m; var totalReturn = currentEquity - 1m;
        session.PeriodEvaluations.Add(new RealtimePeriodEvaluationDto(candle.Ts, candle.Close, action, evaluationPositionSide, executionPrice, reason, PositionStatusLabel(evaluationPositionSide), periodReturn, realizedEquity - 1m, unrealizedReturn, totalReturn, grossReturn, netReturn, feeCost, session.LastTakerFeeRate, session.LastTakerFeeRate, currentEquity, grossPnl, fee, fundingFee, netPnl, session.FeeRateSource, session.ReconciliationStatus));
        session.LastEquity = currentEquity;
    }

    private static decimal? ResolveReturnEntryPrice(RealtimeSessionDocument session) => session.EntryPrice;

    private static long? ResolveReturnEntryTs(RealtimeSessionDocument session) => session.EntryTs;

    private static TradePnlResult CalculateSessionPnl(RealtimeSessionDocument session, decimal exitPrice)
    {
        var entryPrice = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)
            ? session.EntryAvgPx ?? session.ExecutionEntryPrice ?? session.EntryPrice
            : session.EntryPrice;
        var resolvedExitPrice = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)
            ? session.ExitAvgPx ?? session.LastExecutionPrice ?? exitPrice
            : exitPrice;
        var size = session.ExitFillSize ?? session.LastExecutionSize ?? session.PositionSize;
        if (!entryPrice.HasValue || !size.HasValue || !session.AllocatedCapital.HasValue)
        {
            var fallbackGross = session.EntryPrice.HasValue ? CalculateGrossReturn(session.PositionSide, session.EntryPrice.Value, exitPrice, session.Leverage) : 0m;
            var fallbackFee = session.LastTakerFeeRate * 2m;
            return new TradePnlResult(0m, 0m, 0m, 0m, 0m, fallbackGross, fallbackGross - fallbackFee, 0m, 0m, fallbackFee);
        }

        var contractValue = ResolveContractValueFromSession(session, entryPrice.Value, size.Value);
        var actualGrossPnl = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase)
            ? session.LastGrossPnl
            : null;
        var entryFee = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase) ? session.EntryFee : null;
        var exitFee = string.Equals(session.Mode, "live", StringComparison.OrdinalIgnoreCase) ? session.ExitFee : null;
        return PnlCalculator.CalculateLinearSwap(
            session.PositionSide,
            entryPrice.Value,
            resolvedExitPrice,
            size.Value,
            contractValue,
            session.AllocatedCapital.Value,
            session.LastTakerFeeRate,
            session.LastTakerFeeRate,
            entryFee,
            exitFee,
            session.LastFundingFee ?? 0m,
            actualGrossPnl);
    }

    private static decimal ResolveContractValueFromSession(RealtimeSessionDocument session, decimal entryPrice, decimal size)
    {
        if (session.EntryNotionalUsd.HasValue && entryPrice > 0m && size > 0m)
        {
            var inferred = session.EntryNotionalUsd.Value / (entryPrice * size);
            if (inferred > 0m) return inferred;
        }

        return 1m;
    }

    private static RealtimeSimulationDto BuildSimulation(List<CandlePointDto> candles, StrategyParameterSetDto parameters, string paramsSource, RealtimeSessionDocument? session)
    {
        var parameterDefinitions = StrategyRegistryService.BuildParameterDefinitions(parameters);
        if (session is null) return new RealtimeSimulationDto(null, null, candles, [], parameters, parameterDefinitions, [], [], 0m, 0m, "待确认", null, null, null, "hold", "已预览策略参数。确认后才会从当前时刻开始结算。", 0, 0, paramsSource, true, false);
        var equityCurve = session.PeriodEvaluations.Select(x => x.Equity).ToList(); var maxDrawdown = 0m; var peakEquity = 1m;
        foreach (var equity in equityCurve) { peakEquity = Math.Max(peakEquity, equity); maxDrawdown = Math.Min(maxDrawdown, equity / peakEquity - 1m); }
        var wins = session.TradePoints.Count(x => x.NetRet > 0m); var grossTotalReturn = session.TradePoints.Aggregate(1m, (acc, trade) => acc * (1m + trade.GrossRet)) - 1m; var netTotalReturn = session.PeriodEvaluations.LastOrDefault()?.TotalReturn ?? 0m;
        var summary = new BacktestResultDto(parameters.MovingAveragePeriod, parameters.StopLossPct, parameters.TrailingDrawdownPct, parameters.Leverage, session.TradePoints.Count, session.TradePoints.Count == 0 ? 0m : (decimal)wins / session.TradePoints.Count, netTotalReturn, maxDrawdown, grossTotalReturn, netTotalReturn, session.TradePoints.Sum(x => x.FeeCost));
        var currentUnrealizedReturn = string.Equals(session.PositionSide, "flat", StringComparison.OrdinalIgnoreCase)
            ? 0m
            : session.PeriodEvaluations.LastOrDefault()?.UnrealizedReturn ?? 0m;
        return new RealtimeSimulationDto(summary, RealtimeSummaryBuilder.BuildSimulatedTradingSummary(session), candles, session.TradePoints, parameters, parameterDefinitions, session.PeriodEvaluations, equityCurve, session.PeriodEvaluations.LastOrDefault()?.RealizedReturn ?? 0m, currentUnrealizedReturn, PositionStatusLabel(session.PositionSide), session.EntryPrice, session.EntryTs, session.TradePoints.LastOrDefault()?.NetRet, session.LastSignal, session.SignalReason, session.PeriodEvaluations.Count(x => x.Action is "open_long" or "open_short"), session.PeriodEvaluations.Count(x => x.Action is "close" or "force_close"), paramsSource, true, true);
    }
    private static RealtimeLiveDto BuildLive(AppStateDocument state, StrategyConfigDocument strategyConfig, List<PositionDocument> positions, ApiConnectionDocument? apiConnection, RealtimeSimulationDto simulation, decimal? latestPrice, bool confirmed, RealtimeSessionDocument? liveSession)
    {
        var hasAccountConnection = apiConnection is not null && !string.IsNullOrWhiteSpace(apiConnection.ApiKey) && !string.IsNullOrWhiteSpace(apiConnection.EncryptedSecretKey) && !string.IsNullOrWhiteSpace(apiConnection.EncryptedPassphrase);
        var connectionStatus = hasAccountConnection ? "已接入行情与账户" : "已接入行情，未接入账户";
        var signal = liveSession?.LastSignal ?? (confirmed ? simulation.LastSignal : "hold");
        var confirmationStatus = liveSession is null
            ? confirmed ? "未启动实盘" : "未确认策略"
            : !string.Equals(liveSession.Status, "running", StringComparison.OrdinalIgnoreCase)
                ? liveSession.Status
                : signal is "open_long" or "open_short" or "close" or "force_close" ? "等待执行" : liveSession.Status;
        var triggerPrice = liveSession?.LastExecutionPrice ?? latestPrice ?? simulation.Candles.LastOrDefault()?.Close;
        var riskNote = BuildRiskNote(state, hasAccountConnection, positions.Count);
        if (confirmed && !strategyConfig.Enabled) confirmationStatus = "未启用策略";
        return new RealtimeLiveDto(connectionStatus, confirmationStatus, signal, liveSession?.SignalReason ?? (confirmed ? simulation.SignalReason : "策略尚未确认，只展示参数预览。"), DateTime.UtcNow, triggerPrice, positions.Count, riskNote, hasAccountConnection);
    }

    private static RealtimeLiveSessionDto ToLiveSessionDto(RealtimeSessionDocument session)
    {
        var parameters = new StrategyParameterSetDto(session.MovingAveragePeriod, session.StopLossPct, session.TrailingDrawdownPct, session.Leverage);
        var modelSummary = BuildSessionSummary(parameters, session);
        var tradingSummary = RealtimeSummaryBuilder.BuildLiveTradingSummary(session);
        return new RealtimeLiveSessionDto(session.SessionId, session.Mode, session.InstId, session.Bar, session.StrategyType, parameters, session.AutoOptimizeParameters, session.LastOptimizationResult, session.LastOptimizationReason, session.ParamsSource, session.StartedAt, session.Status, session.PositionSide, session.EntryPrice, session.EntryTs, session.PositionSize, session.AllocatedCapital, session.EntryNotionalUsd, session.LastSettledCandleTs, session.LastSignal, session.SignalReason, session.LastOrderId, session.LastExecutionPrice, session.LastExecutionTs, session.LastExecutionSize, session.LastTakerFeeRate, session.FeeRateSource, session.ReconciliationStatus, session.ErrorCode, session.ErrorMessage, tradingSummary, modelSummary, tradingSummary, session.TradePoints, session.PeriodEvaluations, session.TradePoints.LastOrDefault(), session.PeriodEvaluations.LastOrDefault());
    }

    private static BacktestResultDto? BuildSessionSummary(StrategyParameterSetDto parameters, RealtimeSessionDocument session)
    {
        if (session.PeriodEvaluations.Count == 0 && session.TradePoints.Count == 0) return null;
        var maxDrawdown = 0m; var peakEquity = 1m;
        foreach (var equity in session.PeriodEvaluations.Select(x => x.Equity)) { peakEquity = Math.Max(peakEquity, equity); maxDrawdown = Math.Min(maxDrawdown, equity / peakEquity - 1m); }
        var wins = session.TradePoints.Count(x => x.NetRet > 0m); var grossTotalReturn = session.TradePoints.Aggregate(1m, (acc, trade) => acc * (1m + trade.GrossRet)) - 1m; var netTotalReturn = session.PeriodEvaluations.LastOrDefault()?.TotalReturn ?? 0m;
        return new BacktestResultDto(parameters.MovingAveragePeriod, parameters.StopLossPct, parameters.TrailingDrawdownPct, parameters.Leverage, session.TradePoints.Count, session.TradePoints.Count == 0 ? 0m : (decimal)wins / session.TradePoints.Count, netTotalReturn, maxDrawdown, grossTotalReturn, netTotalReturn, session.TradePoints.Sum(x => x.FeeCost));
    }

    private static (StrategyParameterSetDto Parameters, string Source) ResolveParameters(BacktestDocument? latestBacktest, ITradingStrategy strategy, string strategyType, string instId, string bar)
    {
        if (latestBacktest?.Selected is not null && string.Equals(latestBacktest.StrategyType, strategyType, StringComparison.OrdinalIgnoreCase) && string.Equals(latestBacktest.InstId, instId, StringComparison.OrdinalIgnoreCase) && string.Equals(latestBacktest.Bar, bar, StringComparison.OrdinalIgnoreCase)) return (new StrategyParameterSetDto(latestBacktest.Selected.MovingAveragePeriod, latestBacktest.Selected.StopLossPct, latestBacktest.Selected.TrailingDrawdownPct, latestBacktest.Selected.Leverage), "backtest-best");
        return (strategy.DefaultParams, "module-default");
    }

    private static StrategyParameterSetDto BuildParameters(int? movingAveragePeriod, decimal? stopLossPct, decimal? trailingDrawdownPct, decimal? leverage, StrategyParameterSetDto defaults)
    {
        var result = new StrategyParameterSetDto(ClampMovingAveragePeriod(movingAveragePeriod ?? defaults.MovingAveragePeriod), ClampPercent(stopLossPct ?? defaults.StopLossPct), ClampPercent(trailingDrawdownPct ?? defaults.TrailingDrawdownPct), ClampLeverage(leverage ?? defaults.Leverage));
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

    private static void AlignLiveStrategyStateWithSimulation(RealtimeSessionDocument liveSession, RealtimeSessionDocument? simulatedSession)
    {
        if (simulatedSession is null) return;
        if (!string.Equals(liveSession.Mode, "live", StringComparison.OrdinalIgnoreCase)) return;
        if (!string.Equals(liveSession.PositionSide, "long", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(liveSession.PositionSide, "short", StringComparison.OrdinalIgnoreCase)) return;
        if (!string.Equals(simulatedSession.PositionSide, liveSession.PositionSide, StringComparison.OrdinalIgnoreCase)) return;
        if (!string.Equals(simulatedSession.InstId, liveSession.InstId, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(simulatedSession.Bar, liveSession.Bar, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(simulatedSession.StrategyType, liveSession.StrategyType, StringComparison.OrdinalIgnoreCase)) return;
        if (!SameParams(
                new StrategyParameterSetDto(simulatedSession.MovingAveragePeriod, simulatedSession.StopLossPct, simulatedSession.TrailingDrawdownPct, simulatedSession.Leverage),
                new StrategyParameterSetDto(liveSession.MovingAveragePeriod, liveSession.StopLossPct, liveSession.TrailingDrawdownPct, liveSession.Leverage))) return;
        if (simulatedSession.EntryTs != liveSession.EntryTs || !simulatedSession.EntryPrice.HasValue) return;

        liveSession.ExecutionEntryPrice ??= liveSession.EntryPrice;
        liveSession.ExecutionEntryTs ??= liveSession.EntryTs;
        liveSession.EntryPrice = simulatedSession.EntryPrice;
        liveSession.EntryTs = simulatedSession.EntryTs;
        liveSession.PeakPrice = simulatedSession.PeakPrice;
        liveSession.TroughPrice = simulatedSession.TroughPrice;
    }

    private static string NormalizeInstId(string? instId, List<PositionDocument> positions, BacktestDocument? latestBacktest)
    {
        if (!string.IsNullOrWhiteSpace(instId)) return instId.Trim().ToUpperInvariant();
        return positions.FirstOrDefault()?.Symbol ?? latestBacktest?.InstId ?? "RAVE-USDT-SWAP";
    }

    private static string NormalizeBar(string? bar) => string.IsNullOrWhiteSpace(bar) ? "1m" : SupportedBars.Contains(bar) ? bar : "1m";

    private static bool IsMatchingSession(RealtimeSessionDocument? session, string instId, string bar, string strategyType) => session is not null && string.Equals(session.Mode, "simulated", StringComparison.OrdinalIgnoreCase) && string.Equals(session.InstId, instId, StringComparison.OrdinalIgnoreCase) && string.Equals(session.Bar, bar, StringComparison.OrdinalIgnoreCase) && string.Equals(session.StrategyType, strategyType, StringComparison.OrdinalIgnoreCase);

    private static bool HasOpenPosition(RealtimeSessionDocument? session) =>
        session is not null
        && (string.Equals(session.PositionSide, "long", StringComparison.OrdinalIgnoreCase)
            || string.Equals(session.PositionSide, "short", StringComparison.OrdinalIgnoreCase));

    private static RealtimeSessionDto ToSessionDto(RealtimeSessionDocument session) => new(session.SessionId, session.Mode, session.InstId, session.Bar, session.StrategyType, new StrategyParameterSetDto(session.MovingAveragePeriod, session.StopLossPct, session.TrailingDrawdownPct, session.Leverage), session.AutoOptimizeParameters, session.LastOptimizationResult, session.LastOptimizationReason, session.ParamsSource, session.StartedAt, session.Status, session.PositionSide, session.EntryPrice, session.EntryTs, session.PeakPrice, session.TroughPrice, session.PositionSize, session.AllocatedCapital, session.EntryNotionalUsd, session.LastSettledCandleTs, session.LastOrderId, session.LastExecutionPrice, session.LastExecutionTs, session.LastExecutionSize, session.ErrorCode, session.ErrorMessage);

    private static bool SameParams(StrategyParameterSetDto left, StrategyParameterSetDto right) => left.MovingAveragePeriod == right.MovingAveragePeriod && Math.Abs(left.StopLossPct - right.StopLossPct) < 0.0001m && Math.Abs(left.TrailingDrawdownPct - right.TrailingDrawdownPct) < 0.0001m && Math.Abs(left.Leverage - right.Leverage) < 0.0001m;
    private static int ClampMovingAveragePeriod(int value) => Math.Clamp(value, 2, 240);
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

    private static OkxFillDocument ToFillDocument(OkxFillData x)
    {
        var orderId = x.OrdId ?? string.Empty;
        var tradeId = x.TradeId ?? $"{orderId}-{x.Ts}";
        return new OkxFillDocument
        {
            Id = $"{orderId}-{tradeId}",
            TradeId = tradeId,
            OrderId = orderId,
            InstId = x.InstId ?? string.Empty,
            Side = x.Side ?? string.Empty,
            PosSide = x.PosSide ?? string.Empty,
            ExecType = x.ExecType ?? string.Empty,
            FillPrice = ParseDecimal(x.FillPx),
            FillSize = ParseDecimal(x.FillSz),
            FillPnl = ParseDecimal(x.FillPnl),
            Fee = ParseDecimal(x.Fee),
            FeeCcy = x.FeeCcy ?? string.Empty,
            FillTime = ParseDateTime(x.Ts)
        };
    }

    private static OkxPositionHistoryDocument ToPositionHistoryDocument(OkxPositionHistoryData x)
    {
        var id = string.IsNullOrWhiteSpace(x.PosId)
            ? $"{x.InstId}-{x.PosSide}-{x.UTime ?? x.CTime}"
            : $"{x.PosId}-{x.UTime ?? x.CTime}";
        return new OkxPositionHistoryDocument
        {
            Id = id,
            InstId = x.InstId ?? string.Empty,
            PosSide = x.PosSide ?? string.Empty,
            Direction = x.Direction ?? string.Empty,
            OpenAvgPx = ParseDecimal(x.OpenAvgPx),
            CloseAvgPx = ParseDecimal(x.CloseAvgPx),
            OpenMaxPos = ParseDecimal(x.OpenMaxPos),
            CloseTotalPos = ParseDecimal(x.CloseTotalPos),
            RealizedPnl = ParseDecimal(x.RealizedPnl),
            Pnl = ParseDecimal(x.Pnl),
            Fee = ParseDecimal(x.Fee),
            FundingFee = ParseDecimal(x.FundingFee),
            PnlRatio = ParseDecimal(x.PnlRatio),
            CreatedAt = ParseDateTime(x.CTime),
            UpdatedAt = ParseDateTime(x.UTime)
        };
    }

    private static DateTime ParseDateTime(string? millis)
    {
        if (long.TryParse(millis, NumberStyles.Any, CultureInfo.InvariantCulture, out var ms))
        {
            return DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
        }

        return DateTime.UtcNow;
    }
}

internal sealed record LiveOrderPlan(decimal Size, decimal AllocatedCapital, decimal EntryNotionalUsd);
internal sealed record LivePositionSnapshot(string Side, decimal Size, decimal EntryPrice);
