import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { CandleChart } from '../components/backtest/CandleChart';
import { StrategyPicker } from '../components/backtest/StrategyPicker';
import { EmptyState } from '../components/common/EmptyState';
import type {
  AppState,
  BacktestBar,
  InstrumentSuggestion,
  PositionSide,
  RealtimeWorkspace,
  StrategyDefinition,
  StrategyParameterSet,
  StrategyType,
} from '../types';
import { formatNumber, formatPercent } from '../utils/format';
import {
  DEFAULT_STRATEGY_PARAMS,
  DEFAULT_STRATEGY_TYPE,
  findStrategyDefinition,
  formatStrategyParams,
  getLeveragedStopLossValidationMessage,
  getStrategyName,
  sameStrategyParams,
} from '../utils/strategy';

type AppContext = {
  state: AppState | null;
  setState: (state: AppState) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
};

type CachedRealtimePageState = {
  instId: string;
  query: string;
  bar: BacktestBar;
  pendingStrategyType: StrategyType;
  paramDraft: StrategyParameterSet;
  paramsDirty: boolean;
  simAutoOptimize: boolean;
  liveParamDraft: StrategyParameterSet;
  liveParamsDirty: boolean;
  liveAutoOptimize: boolean;
};

const bars: BacktestBar[] = ['1m', '5m', '15m', '1H', '4H', '1D'];
const cacheKey = 'okx-trader-sim:realtime-page-state';

function actionLabel(action: string) {
  const map: Record<string, string> = {
    open_long: '开多',
    open_short: '开空',
    close: '平仓',
    force_close: '强制平仓',
    hold: '观望',
  };
  return map[action] ?? action;
}

function sideLabel(side?: PositionSide | string | null) {
  if (side === 'long') return '多单';
  if (side === 'short') return '空单';
  return '空仓';
}

function paramsSourceLabel(source?: string) {
  if (source === 'backtest-best') return '最近回测最佳参数';
  if (source === 'manual') return '当前参数';
  if (source === 'module-default') return '策略模块默认参数';
  if (source === 'follow-simulation') return '跟随模拟参数';
  if (source === 'live-manual') return '独立参数';
  if (source === 'auto-best') return '自动寻找最佳参数';
  if (source === 'live-auto-best') return '实盘自动寻找最佳参数';
  return source ?? '-';
}

function displayTime(value?: string | number | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function readCachedPageState(): CachedRealtimePageState | null {
  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRealtimePageState;
    if (!parsed.instId || !bars.includes(parsed.bar) || !parsed.pendingStrategyType) return null;
    return {
      instId: parsed.instId,
      query: parsed.query || parsed.instId,
      bar: parsed.bar,
      pendingStrategyType: parsed.pendingStrategyType,
      paramDraft: parsed.paramDraft ?? DEFAULT_STRATEGY_PARAMS,
      paramsDirty: Boolean(parsed.paramsDirty),
      simAutoOptimize: Boolean(parsed.simAutoOptimize),
      liveParamDraft: parsed.liveParamDraft ?? parsed.paramDraft ?? DEFAULT_STRATEGY_PARAMS,
      liveParamsDirty: Boolean(parsed.liveParamsDirty),
      liveAutoOptimize: Boolean(parsed.liveAutoOptimize),
    };
  } catch {
    return null;
  }
}

function saveCachedPageState(state: CachedRealtimePageState) {
  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify(state));
  } catch {
    // Ignore storage errors so realtime polling and trading controls keep working.
  }
}

export function RealtimePage({ app }: { app: AppContext }) {
  const state = app.state!;
  const cached = useMemo(() => readCachedPageState(), []);
  const initialInstId = cached?.instId ?? state.backtest?.instId ?? 'RAVE-USDT-SWAP';
  const initialBar = cached?.bar ?? (state.backtest?.bar as BacktestBar | undefined) ?? '1m';
  const initialStrategy = cached?.pendingStrategyType ?? state.strategyConfig.strategyType ?? state.backtest?.strategyType ?? DEFAULT_STRATEGY_TYPE;

  const [instId, setInstId] = useState(initialInstId);
  const [query, setQuery] = useState(cached?.query ?? initialInstId);
  const [bar, setBar] = useState<BacktestBar>(initialBar);
  const [pendingStrategyType, setPendingStrategyType] = useState<StrategyType>(initialStrategy);
  const [expandedStrategyType, setExpandedStrategyType] = useState<StrategyType | null>(null);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [paramDraft, setParamDraft] = useState<StrategyParameterSet>(cached?.paramDraft ?? DEFAULT_STRATEGY_PARAMS);
  const [paramsDirty, setParamsDirty] = useState(cached?.paramsDirty ?? false);
  const [simAutoOptimize, setSimAutoOptimize] = useState(cached?.simAutoOptimize ?? false);
  const [liveParamDraft, setLiveParamDraft] = useState<StrategyParameterSet>(cached?.liveParamDraft ?? DEFAULT_STRATEGY_PARAMS);
  const [liveParamsDirty, setLiveParamsDirty] = useState(cached?.liveParamsDirty ?? false);
  const [liveAutoOptimize, setLiveAutoOptimize] = useState(cached?.liveAutoOptimize ?? false);
  const [strategyPanelCollapsed, setStrategyPanelCollapsed] = useState(false);
  const [suggestions, setSuggestions] = useState<InstrumentSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [marketPanelCollapsed, setMarketPanelCollapsed] = useState(false);
  const [workspace, setWorkspace] = useState<RealtimeWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [forcingSimulation, setForcingSimulation] = useState(false);
  const [forcingLive, setForcingLive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [simulationPeriodPage, setSimulationPeriodPage] = useState(0);
  const { setError, setMessage } = app;

  useEffect(() => {
    saveCachedPageState({ instId, query, bar, pendingStrategyType, paramDraft, paramsDirty, simAutoOptimize, liveParamDraft, liveParamsDirty, liveAutoOptimize });
  }, [instId, query, bar, pendingStrategyType, paramDraft, paramsDirty, simAutoOptimize, liveParamDraft, liveParamsDirty, liveAutoOptimize]);

  const applyWorkspace = (data: RealtimeWorkspace, keepDraft = false) => {
    setWorkspace(data);
    setInstId(data.instId);
    setQuery(data.instId);
    setPendingStrategyType(data.selectedStrategyType);

    if (!keepDraft) {
      const nextSimParams = data.confirmedSession?.params ?? data.strategyParams;
      setParamDraft((prev) => (paramsDirty ? prev : nextSimParams));
      setLiveParamDraft((prev) => (liveParamsDirty ? prev : data.liveSession?.params ?? nextSimParams));
      if (!paramsDirty) setParamsDirty(false);
      if (!liveParamsDirty) setLiveParamsDirty(false);
      setSimAutoOptimize(data.confirmedSession?.autoOptimizeParameters ?? simAutoOptimize);
      setLiveAutoOptimize(data.liveSession?.autoOptimizeParameters ?? liveAutoOptimize);
    }
  };

  async function loadWorkspace(nextInstId = instId, nextBar = bar, nextStrategy = pendingStrategyType, keepDraft = false) {
    setLoading(true);
    try {
      const data = await api.getRealtimeWorkspace({ instId: nextInstId, bar: nextBar, strategyType: nextStrategy });
      applyWorkspace(data, keepDraft);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实时策略工作台失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.getStrategies()
      .then((items) => setStrategies(items))
      .catch((err) => setError(err instanceof Error ? err.message : '加载策略列表失败'));
    loadWorkspace(initialInstId, initialBar, initialStrategy, Boolean(cached));
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (!showSuggestions) return;
    if (keyword.length < 1) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearching(true);
      api.searchRealtimeInstruments(keyword)
        .then(setSuggestions)
        .catch((err) => setError(err instanceof Error ? err.message : '搜索 OKX 品种失败'))
        .finally(() => setSearching(false));
    }, 120);

    return () => window.clearTimeout(timer);
  }, [query, showSuggestions, setError]);

  useEffect(() => {
    if (!workspace?.nextRefreshAt) return;
    const delay = Math.max(1000, new Date(workspace.nextRefreshAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      loadWorkspace(instId, bar, pendingStrategyType, true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [workspace?.nextRefreshAt, instId, bar, pendingStrategyType]);

  useEffect(() => {
    setSimulationPeriodPage(0);
  }, [instId, bar, pendingStrategyType, workspace?.confirmedSession?.sessionId, workspace?.confirmedSession?.startedAt]);

  async function selectInstrument(item: InstrumentSuggestion) {
    setSuggestions([]);
    setShowSuggestions(false);
    setInstId(item.instId);
    setQuery(item.instId);
    await loadWorkspace(item.instId, bar, pendingStrategyType);
  }

  async function changeBar(next: BacktestBar) {
    setBar(next);
    await loadWorkspace(instId, next, pendingStrategyType);
  }

  async function previewStrategy(next: StrategyType) {
    const definition = strategies.find((item) => item.id === next);
    if (!definition || definition.status !== 'active' || !definition.supportsRealtime) return;
    setPendingStrategyType(next);
    await loadWorkspace(instId, bar, next);
  }

  async function toggleStrategyDetails(next: StrategyType) {
    const shouldExpand = expandedStrategyType !== next;
    setExpandedStrategyType(shouldExpand ? next : null);
    await previewStrategy(next);
  }

  function updateParam(key: keyof StrategyParameterSet, value: string) {
    const numeric = Number(value);
    const safeValue = Number.isFinite(numeric) ? numeric : 0;
    setParamDraft((prev) => ({ ...prev, [key]: safeValue }));
    setParamsDirty(true);
    if (!liveParamsDirty) {
      setLiveParamDraft((prev) => ({ ...prev, [key]: safeValue }));
    }
  }

  function updateLiveParam(key: keyof StrategyParameterSet, value: string) {
    const numeric = Number(value);
    setLiveParamDraft((prev) => ({ ...prev, [key]: Number.isFinite(numeric) ? numeric : 0 }));
    setLiveParamsDirty(true);
  }

  async function confirmSimulation() {
    const invalid = getLeveragedStopLossValidationMessage(paramDraft);
    if (invalid) {
      setError(invalid);
      return;
    }

    try {
      const data = await api.confirmRealtimeSession({
        instId,
        bar,
        strategyType: pendingStrategyType,
        movingAveragePeriod: paramDraft.movingAveragePeriod,
        stopLossPct: paramDraft.stopLossPct,
        trailingDrawdownPct: paramDraft.trailingDrawdownPct,
        leverage: paramDraft.leverage,
        autoOptimizeParameters: simAutoOptimize,
      });
      setParamsDirty(false);
      applyWorkspace(data);
      setMessage(`已启动 ${instId} ${bar} 的实时模拟；将从下一根已收盘 K 线开始执行。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动实时模拟失败');
    }
  }

  async function startLiveSession() {
    const invalid = getLeveragedStopLossValidationMessage(liveParamDraft);
    if (invalid) {
      setError(invalid);
      return;
    }

    try {
      const data = await api.putLiveRealtimeSession({
        instId,
        bar,
        strategyType: pendingStrategyType,
        movingAveragePeriod: liveParamDraft.movingAveragePeriod,
        stopLossPct: liveParamDraft.stopLossPct,
        trailingDrawdownPct: liveParamDraft.trailingDrawdownPct,
        leverage: liveParamDraft.leverage,
        autoOptimizeParameters: liveAutoOptimize,
      });
      setLiveParamsDirty(false);
      applyWorkspace(data, true);
      setMessage('已按当前实盘参数启动实时交易；如旧实盘有持仓，后端会先强制平仓再重启。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动实时交易失败');
    }
  }

  async function forceExitSimulation() {
    setForcingSimulation(true);
    setMessage('正在强制退出实时模拟持仓...');
    try {
      const data = await api.forceExitRealtimeSession();
      applyWorkspace(data, true);
      setMessage('已强制退出实时模拟，自动运行已停止；需重新启动后才会继续执行。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '强制退出模拟持仓失败');
    } finally {
      setForcingSimulation(false);
    }
  }

  async function pauseLive() {
    try {
      const data = await api.pauseLiveRealtimeSession();
      applyWorkspace(data, true);
      setMessage('实时交易已暂停。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂停实时交易失败');
    }
  }

  async function resumeLive() {
    try {
      const data = await api.resumeLiveRealtimeSession();
      applyWorkspace(data, true);
      setMessage('实时交易已恢复。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复实时交易失败');
    }
  }

  async function forceExitLive() {
    setForcingLive(true);
    setMessage('正在强制退出实时交易持仓...');
    try {
      const data = await api.forceExitLiveRealtimeSession();
      applyWorkspace(data, true);
      setMessage('已强制退出实时交易，自动运行已停止；需重新启动后才会继续执行。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '强制退出实时交易持仓失败');
    } finally {
      setForcingLive(false);
    }
  }

  async function deleteLive() {
    try {
      const data = await api.deleteLiveRealtimeSession();
      applyWorkspace(data, true);
      setMessage('实时交易会话已删除。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除实时交易会话失败');
    }
  }

  const selectedStrategy = findStrategyDefinition(strategies, pendingStrategyType);
  const simulation = workspace?.simulation;
  const live = workspace?.live;
  const liveSession = workspace?.liveSession;
  const liveTradingSummary = liveSession?.tradingSummary ?? liveSession?.summary;
  const liveModelSummary = liveSession?.modelSummary;
  const simTradingSummary = simulation?.tradingSummary;
  const currentSession = workspace?.confirmedSession;
  const summary = simulation?.summary;
  const allPeriods = simulation?.periodEvaluations ?? [];
  const lastPeriod = allPeriods.length ? allPeriods[allPeriods.length - 1] : null;
  const allLivePeriods = liveSession?.periodEvaluations ?? [];
  const lastLivePeriod = allLivePeriods.length ? allLivePeriods[allLivePeriods.length - 1] : null;
  const currentValidationMessage = getLeveragedStopLossValidationMessage(paramDraft);
  const liveValidationMessage = getLeveragedStopLossValidationMessage(liveParamDraft);
  const recentLiveTrades = liveSession?.tradePoints.slice(-10).reverse() ?? [];
  const simulationPeriodRows = [...allPeriods].reverse();
  const simulationPeriodPageCount = Math.max(1, Math.ceil(simulationPeriodRows.length / 10));
  const boundedSimulationPeriodPage = Math.min(simulationPeriodPage, simulationPeriodPageCount - 1);
  const recentPeriods = simulationPeriodRows.slice(boundedSimulationPeriodPage * 10, boundedSimulationPeriodPage * 10 + 10);
  const recentLivePeriods = allLivePeriods.slice(-20).reverse();
  const liveHasPosition = liveSession?.positionSide === 'long' || liveSession?.positionSide === 'short';
  const simHasPosition = currentSession?.positionSide === 'long' || currentSession?.positionSide === 'short';
  const liveCurrentUnrealizedReturn = liveHasPosition ? lastLivePeriod?.unrealizedReturn ?? 0 : 0;
  const simOpenCount = allPeriods.filter((period) => period.action === 'open_long' || period.action === 'open_short').length;
  const simCloseCount = allPeriods.filter((period) => period.action === 'close' || period.action === 'force_close').length;
  const liveOpenCount = allLivePeriods.filter((period) => period.action === 'open_long' || period.action === 'open_short').length;
  const liveCloseCount = allLivePeriods.filter((period) => period.action === 'close' || period.action === 'force_close').length;
  const sourceLabel = paramsSourceLabel(currentSession?.paramsSource ?? workspace?.paramsSource);
  const liveSourceLabel = liveParamsDirty || !sameStrategyParams(liveParamDraft, paramDraft) ? '独立参数' : '跟随模拟参数';
  const chartTrades = [...(simulation?.tradePoints ?? []), ...(liveSession?.tradePoints ?? [])];
  const simulationDisplayParams = currentSession?.params ?? workspace?.strategyParams ?? paramDraft;
  const parameterDefinitions = selectedStrategy?.parameters ?? simulation?.parameterDefinitions ?? [];
  const simulationDisplayParamsText = formatStrategyParams(parameterDefinitions, simulationDisplayParams);
  const selectedStrategyName = getStrategyName(strategies, pendingStrategyType);
  const simulationLatestAction = lastPeriod ? actionLabel(lastPeriod.action) : actionLabel(simulation?.lastSignal ?? 'hold');
  const simulationCurrentEquity = lastPeriod?.equity ?? 1;
  const simulationCurrentPositionReturn = simHasPosition ? lastPeriod?.unrealizedReturn ?? 0 : 0;
  const simulationCurrentFloatingPnl = simHasPosition ? lastPeriod?.netPnl ?? 0 : 0;

  return (
    <div className="backtestFlow">
      <section className="panel wide">
        <div className="panelHeader">
          <h2>行情与 K 线</h2>
          {marketPanelCollapsed ? (
            <div className="collapsedMarketSummary inline">
              <div><span>OKX 合约品种</span><strong>{workspace?.instId ?? (query || '未加载')}</strong></div>
              <div><span>时间间隔</span><strong>{bar}</strong></div>
              <div><span>连接状态</span><strong>{searching ? '搜索中...' : live?.connectionStatus ?? '等待行情'}</strong></div>
              <div><span>最新价</span><strong>{formatNumber(workspace?.latestPrice, 8)}</strong></div>
            </div>
          ) : null}
          <div className="panelHeaderActions">
            <button type="button" className="secondary" onClick={() => setMarketPanelCollapsed((value) => !value)}>
              {marketPanelCollapsed ? '展开' : '折叠'}
            </button>
          </div>
        </div>

        {!marketPanelCollapsed ? (
          <>
            <div className="formGrid">
              <label className="searchField">
                OKX 合约品种
                <input
                  value={query}
                  onFocus={() => setShowSuggestions(true)}
                  onClick={() => setShowSuggestions(true)}
                  onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
                  onChange={(event) => {
                    setQuery(event.target.value.toUpperCase());
                    setShowSuggestions(true);
                  }}
                  placeholder="输入 BTC-USDT-SWAP"
                />
                {showSuggestions ? (
                  suggestions.length ? (
                    <div className="suggestionDropdown">
                      {suggestions.map((item) => (
                        <button
                          type="button"
                          className="suggestionItem"
                          key={item.instId}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectInstrument(item)}
                        >
                          <strong>{item.instId}</strong>
                          <span>{item.baseCcy}/{item.quoteCcy} / {item.state || 'unknown'}</span>
                        </button>
                      ))}
                    </div>
                  ) : query.trim().length >= 1 && !searching ? (
                    <div className="suggestionDropdown">
                      <div className="emptyState compact">请选择 OKX 返回的真实品种后再运行。</div>
                    </div>
                  ) : null
                ) : null}
              </label>
              <label>
                时间间隔
                <select value={bar} onChange={(event) => changeBar(event.target.value as BacktestBar)} disabled={loading}>
                  {bars.map((item) => <option value={item} key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                连接状态
                <input value={searching ? '搜索中...' : live?.connectionStatus ?? '等待行情'} readOnly />
              </label>
              <label>
                最新价
                <input value={formatNumber(workspace?.latestPrice, 8)} readOnly />
              </label>
            </div>

            {workspace?.candles.length ? (
              <CandleChart candles={workspace.candles} trades={chartTrades} />
            ) : (
              <EmptyState text={loading ? '正在加载 K 线...' : '选择 OKX 品种后显示实时 K 线。'} />
            )}
          </>
        ) : null}
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>策略库</h2>
          <strong>{selectedStrategyName}</strong>
          <div className="panelHeaderActions">
            <button type="button" className="secondary" onClick={() => setStrategyPanelCollapsed((value) => !value)}>
              {strategyPanelCollapsed ? '展开' : '折叠'}
            </button>
          </div>
        </div>

        <StrategyPicker
          strategies={strategies}
          selected={pendingStrategyType}
          expanded={strategyPanelCollapsed ? null : expandedStrategyType}
          mode="realtime"
          disabled={loading}
          onSelect={toggleStrategyDetails}
        />

        {!strategyPanelCollapsed && expandedStrategyType === pendingStrategyType ? (
          <div className="analysisBlock compactHeader">
            <h2>策略参数</h2>
            <div className="formGrid parameterInlineRow">
              <label>
                均线周期
                <input type="number" min="2" step="1" value={paramDraft.movingAveragePeriod} onChange={(event) => updateParam('movingAveragePeriod', event.target.value)} />
              </label>
              <label>
                止损 %
                <input type="number" min="0.01" step="0.01" value={paramDraft.stopLossPct} onChange={(event) => updateParam('stopLossPct', event.target.value)} />
              </label>
              <label>
                回撤 %
                <input type="number" min="0.01" step="0.01" value={paramDraft.trailingDrawdownPct} onChange={(event) => updateParam('trailingDrawdownPct', event.target.value)} />
              </label>
              <label>
                杠杆 x
                <input type="number" min="1" step="1" value={paramDraft.leverage} onChange={(event) => updateParam('leverage', event.target.value)} />
              </label>
              <label>
                自动寻优
                <select value={simAutoOptimize ? 'on' : 'off'} onChange={(event) => setSimAutoOptimize(event.target.value === 'on')}>
                  <option value="off">关闭</option>
                  <option value="on">开启</option>
                </select>
              </label>
            </div>
            {currentValidationMessage ? <div className="statusBanner error">{currentValidationMessage}</div> : null}
          </div>
        ) : null}
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>实时模拟</h2>
          <strong>{selectedStrategyName}</strong>
        </div>

        <div className="analysisBlock compactHeader">
          <div className="actions">
            <button type="button" onClick={confirmSimulation} disabled={loading || Boolean(currentValidationMessage)}>
              启动实时模拟
            </button>
            <button type="button" className="secondary" onClick={forceExitSimulation} disabled={!currentSession || loading || forcingSimulation}>
              {forcingSimulation ? '模拟退出中...' : '强制退出模拟'}
            </button>
          </div>
        </div>

        <div className="resultSummaryStrip fiveCol compactHeader">
          <div><span>模拟状态</span><strong>{currentSession?.status ?? '未确认'}</strong></div>
          <div><span>开仓 / 平仓次数</span><strong>{simOpenCount} / {simCloseCount}</strong></div>
          <div><span>胜率</span><strong>{formatPercent(summary?.winRate ?? 0)}</strong></div>
          <div><span>最大回撤</span><strong className="bad">{formatPercent(summary?.maxDrawdown ?? 0)}</strong></div>
          <div><span>模拟总收益率</span><strong className={(simTradingSummary?.netReturn ?? 0) >= 0 ? 'good' : 'bad'}>{formatPercent(simTradingSummary?.netReturn ?? 0)}</strong></div>
          <div><span>模拟持仓</span><strong>{sideLabel(currentSession?.positionSide)}</strong></div>
          <div><span>持仓权益</span><strong>{formatNumber(simulationCurrentEquity, 6)}</strong></div>
          <div><span>当前持仓收益</span><strong className={simulationCurrentPositionReturn >= 0 ? 'good' : 'bad'}>{formatPercent(simulationCurrentPositionReturn)}</strong></div>
          <div><span>当前浮盈</span><strong className={simulationCurrentFloatingPnl >= 0 ? 'good' : 'bad'}>{formatNumber(simulationCurrentFloatingPnl, 6)}</strong></div>
          <div><span>最近动作</span><strong>{simulationLatestAction}</strong></div>
        </div>

        <div className="compactHeader">
          <h2>周期动作记录</h2>
          {recentPeriods.length ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>动作</th>
                    <th>结算价</th>
                    <th>执行价</th>
                    <th>持仓</th>
                    <th>周期收益</th>
                    <th>已实现收益</th>
                    <th>浮盈</th>
                    <th>累计收益</th>
                    <th>净PNL</th>
                    <th>手续费</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPeriods.map((period) => (
                    <tr key={[period.ts, period.action, period.close].join('-')}>
                      <td>{displayTime(period.ts)}</td>
                      <td>{actionLabel(period.action)}</td>
                      <td>{formatNumber(period.close, 8)}</td>
                      <td>{formatNumber(period.executionPrice, 8)}</td>
                      <td>{sideLabel(period.positionSide)}</td>
                      <td className={period.periodReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.periodReturn)}</td>
                      <td className={period.realizedReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.realizedReturn)}</td>
                      <td className={period.unrealizedReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.unrealizedReturn)}</td>
                      <td className={period.totalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.totalReturn)}</td>
                      <td className={(period.netPnl ?? 0) >= 0 ? 'good' : 'bad'}>{formatNumber(period.netPnl, 6)}</td>
                      <td>{formatNumber(period.fee, 6)}</td>
                      <td>{period.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="paginationRow">
                <button type="button" className="secondary" onClick={() => setSimulationPeriodPage((page) => Math.max(0, page - 1))} disabled={boundedSimulationPeriodPage === 0}>
                  上一页
                </button>
                <span>{boundedSimulationPeriodPage + 1} / {simulationPeriodPageCount}</span>
                <button type="button" className="secondary" onClick={() => setSimulationPeriodPage((page) => Math.min(simulationPeriodPageCount - 1, page + 1))} disabled={boundedSimulationPeriodPage >= simulationPeriodPageCount - 1}>
                  下一页
                </button>
              </div>
            </>
          ) : (
            <EmptyState text="暂无周期动作记录。" />
          )}
        </div>

      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>实时交易</h2>
          <strong>{selectedStrategyName}</strong>
        </div>

        <div className="analysisBlock compactHeader">
          <div className="formGrid">
            <label>
              实盘均线周期
              <input type="number" min="2" step="1" value={liveParamDraft.movingAveragePeriod} onChange={(event) => updateLiveParam('movingAveragePeriod', event.target.value)} />
            </label>
            <label>
              实盘止损比例 %
              <input type="number" min="0.01" step="0.01" value={liveParamDraft.stopLossPct} onChange={(event) => updateLiveParam('stopLossPct', event.target.value)} />
            </label>
            <label>
              实盘回撤比例 %
              <input type="number" min="0.01" step="0.01" value={liveParamDraft.trailingDrawdownPct} onChange={(event) => updateLiveParam('trailingDrawdownPct', event.target.value)} />
            </label>
            <label>
              实盘杠杆 x
              <input type="number" min="1" step="1" value={liveParamDraft.leverage} onChange={(event) => updateLiveParam('leverage', event.target.value)} />
            </label>
            <label>
              实盘自动寻找最佳参数
              <select value={liveAutoOptimize ? 'on' : 'off'} onChange={(event) => setLiveAutoOptimize(event.target.value === 'on')}>
                <option value="off">关闭</option>
                <option value="on">开启：开仓前自动优化</option>
              </select>
            </label>
            <label>
              参数状态
              <input value={liveHasPosition ? '有持仓，启动时会先强制退出' : liveSourceLabel} readOnly />
            </label>
          </div>
          {liveValidationMessage ? <div className="statusBanner error">{liveValidationMessage}</div> : null}
          {liveHasPosition ? <div className="statusBanner">实盘已有持仓；启动实时交易会先按真实持仓数量强制退出，再按当前参数创建新的运行会话。</div> : null}
          <div className="actions">
            <button type="button" className={liveAutoOptimize ? undefined : 'secondary'} onClick={() => setLiveAutoOptimize((value) => !value)}>
              {liveAutoOptimize ? '实时交易自动优化：开启' : '实时交易自动优化：关闭'}
            </button>
            <button type="button" className="secondary" onClick={startLiveSession} disabled={loading || Boolean(liveValidationMessage) || !currentSession}>
              启动实时交易
            </button>
            <button type="button" className="secondary" disabled>
              单次开仓最多使用可用余额 20%，止损优先执行
            </button>
          </div>
        </div>

        <div className="resultSummaryStrip compactHeader">
          <div><span>实盘状态</span><strong>{liveSession?.status ?? '未启动'}</strong></div>
          <div><span>实盘持仓</span><strong>{sideLabel(liveSession?.positionSide)}</strong></div>
          <div><span>实盘最近动作</span><strong>{lastLivePeriod ? actionLabel(lastLivePeriod.action) : actionLabel(liveSession?.lastSignal ?? 'hold')}</strong></div>
          <div><span>真实委托</span><strong>{liveSession?.lastOrderId ?? '-'}</strong></div>
          <div><span>真实成交价</span><strong>{formatNumber(liveSession?.lastExecutionPrice, 8)}</strong></div>
          <div><span>最近成交时间</span><strong>{displayTime(liveSession?.lastExecutionTs)}</strong></div>
          <div><span>实盘自动优化</span><strong>{liveSession?.autoOptimizeParameters ? '已开启' : '关闭'}</strong></div>
          <div><span>实盘最近优化</span><strong>{liveSession?.lastOptimizationResult ? `${liveSession.lastOptimizationResult.stopLossPct}% / ${liveSession.lastOptimizationResult.trailingDrawdownPct}% / ${liveSession.lastOptimizationResult.leverage}x` : '-'}</strong></div>
        </div>

        <div className="resultSummaryStrip">
          <div><span>OKX taker费率</span><strong>{formatPercent(liveSession?.lastTakerFeeRate ?? 0.0005)}</strong></div>
          <div><span>成交核对</span><strong>{liveTradingSummary?.reconciliationStatus ?? liveSession?.reconciliationStatus ?? '-'}</strong></div>
          <div><span>本次使用资金</span><strong>{formatNumber(liveSession?.allocatedCapital, 4)}</strong></div>
          <div><span>开仓张数</span><strong>{formatNumber(liveSession?.positionSize, 8)}</strong></div>
          <div><span>名义价值</span><strong>{formatNumber(liveSession?.entryNotionalUsd, 4)}</strong></div>
          <div><span>风险提示</span><strong>{live?.riskNote ?? '-'}</strong></div>
        </div>

        <div className="resultSummaryStrip">
          <div><span>实盘含浮盈累计收益</span><strong className={(liveTradingSummary?.netReturn ?? 0) >= 0 ? 'good' : 'bad'}>{formatPercent(liveTradingSummary?.netReturn ?? 0)}</strong></div>
          <div><span>实盘已实现收益</span><strong className={(lastLivePeriod?.realizedReturn ?? 0) >= 0 ? 'good' : 'bad'}>{formatPercent(lastLivePeriod?.realizedReturn ?? 0)}</strong></div>
          <div><span>实盘当前浮盈</span><strong className={liveCurrentUnrealizedReturn >= 0 ? 'good' : 'bad'}>{formatPercent(liveCurrentUnrealizedReturn)}</strong></div>
          <div><span>实盘权益值</span><strong>{formatNumber(lastLivePeriod?.equity ?? 1, 6)}</strong></div>
          <div><span>实盘最大回撤</span><strong className="bad">{formatPercent(liveModelSummary?.maxDrawdown ?? 0)}</strong></div>
          <div><span>实盘胜率</span><strong>{formatPercent(liveModelSummary?.winRate ?? 0)}</strong></div>
          <div><span>实盘费率成本</span><strong>{formatNumber(liveTradingSummary?.fee ?? 0, 6)}</strong></div>
          <div><span>实盘买入/开仓次数</span><strong>{liveOpenCount}</strong></div>
          <div><span>实盘卖出/平仓次数</span><strong>{liveCloseCount}</strong></div>
        </div>

        <div className="compactHeader">
          <p className="eyebrow">实盘每周期动作</p>
          <h2>实时交易动作与状态</h2>
          {recentLivePeriods.length ? (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>结算价</th>
                  <th>执行价</th>
                  <th>持仓</th>
                  <th>周期收益</th>
                  <th>已实现</th>
                  <th>浮盈</th>
                  <th>累计</th>
                  <th>费率</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {recentLivePeriods.map((period) => (
                  <tr key={['live', period.ts, period.action, period.close].join('-')}>
                    <td>{displayTime(period.ts)}</td>
                    <td>{actionLabel(period.action)}</td>
                    <td>{formatNumber(period.close, 8)}</td>
                    <td>{formatNumber(period.executionPrice, 8)}</td>
                    <td>{sideLabel(period.positionSide)}</td>
                    <td className={period.periodReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.periodReturn)}</td>
                    <td className={period.realizedReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.realizedReturn)}</td>
                    <td className={period.unrealizedReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.unrealizedReturn)}</td>
                    <td className={period.totalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(period.totalReturn)}</td>
                    <td>{formatNumber(period.fee, 6)}</td>
                    <td>{period.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState text={liveSession ? '实时交易启动后，每根已收盘 K 线都会生成实盘周期动作记录。' : '启动实时交易后显示每周期动作与状态。'} />
          )}
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={pauseLive} disabled={loading || !liveSession || liveSession.status !== 'running'}>
            暂停实时交易
          </button>
          <button type="button" className="secondary" onClick={resumeLive} disabled={loading || !liveSession || liveSession.status !== 'paused'}>
            恢复实时交易
          </button>
          <button type="button" className="secondary" onClick={forceExitLive} disabled={loading || forcingLive || !liveSession}>
            {forcingLive ? '实盘退出中...' : '强制退出实盘'}
          </button>
          <button type="button" className="secondary" onClick={deleteLive} disabled={loading || !liveSession}>
            删除实盘会话
          </button>
        </div>

        <div className="compactHeader">
          <p className="eyebrow">最近实盘交易</p>
          <h2>真实交易记录</h2>
          {recentLiveTrades.length ? (
            <table>
              <thead>
                <tr>
                  <th>方向</th>
                  <th>开仓时间</th>
                  <th>开仓价</th>
                  <th>平仓时间</th>
                  <th>成交价</th>
                  <th>张数</th>
                  <th>净收益率</th>
                  <th>净PNL</th>
                  <th>手续费</th>
                  <th>费率</th>
                  <th>订单号</th>
                  <th>核对</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {recentLiveTrades.map((trade) => (
                  <tr key={`${trade.entryTs}-${trade.exitTs}-${trade.orderId ?? ''}`}>
                    <td>{sideLabel(trade.side)}</td>
                    <td>{displayTime(trade.entryTs)}</td>
                    <td>{formatNumber(trade.entryPrice, 8)}</td>
                    <td>{displayTime(trade.exitTs)}</td>
                    <td>{formatNumber(trade.exitAvgPx ?? trade.executedPrice ?? trade.exitPrice, 8)}</td>
                    <td>{formatNumber(trade.executedSize, 8)}</td>
                    <td className={(trade.netReturn ?? trade.netRet ?? trade.ret) >= 0 ? 'good' : 'bad'}>{formatPercent(trade.netReturn ?? trade.netRet ?? trade.ret)}</td>
                    <td className={(trade.netPnl ?? 0) >= 0 ? 'good' : 'bad'}>{formatNumber(trade.netPnl, 6)}</td>
                    <td>{formatNumber(trade.fee, 6)}</td>
                    <td>{formatPercent(trade.feeCost ?? 0)}</td>
                    <td>{trade.exitOrderId ?? trade.orderId ?? '-'}</td>
                    <td>{trade.reconciliationStatus ?? '-'}</td>
                    <td>{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState text="当前还没有完成的实盘交易记录。" />
          )}
        </div>
      </section>
    </div>
  );
}
