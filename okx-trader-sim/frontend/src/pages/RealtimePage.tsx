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

type AppContext = {
  state: AppState | null;
  setState: (state: AppState) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
};

const bars: BacktestBar[] = ['1m', '5m', '15m', '1H', '4H', '1D'];
const fallbackParams: StrategyParameterSet = { stopLossPct: 1, trailingDrawdownPct: 2, leverage: 3 };
const fallbackStrategy: StrategyDefinition = {
  id: 'buy-sell',
  name: '买入卖出策略',
  description: '前 3 根结算价递增开多，递减开空；止损优先，回撤按已收盘结算价最值判断。',
  status: 'active',
  supportsBacktest: true,
  supportsRealtime: true,
  defaultParams: fallbackParams,
  parameters: [
    { id: 'stopLossPct', label: '止损比例', description: '价格触及止损线后平仓。', value: 1, unit: '%' },
    { id: 'trailingDrawdownPct', label: '移动回撤比例', description: '按结算价最值回撤触发平仓。', value: 2, unit: '%' },
    { id: 'leverage', label: '杠杆', description: '收益和止损约束使用该杠杆。', value: 3, unit: 'x' },
  ],
};

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
  if (source === 'manual') return '手工修改参数';
  if (source === 'module-default') return '策略模块默认参数';
  if (source === 'follow-simulation') return '跟随模拟参数';
  if (source === 'live-manual') return '实盘独立参数';
  return source ?? '-';
}

function displayTime(value?: string | number | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function validationMessage(params: StrategyParameterSet) {
  return params.stopLossPct * params.leverage > 10 ? '止损比例 * 杠杆不能超过 10%。' : '';
}

function sameParams(left: StrategyParameterSet, right: StrategyParameterSet) {
  return Math.abs(left.stopLossPct - right.stopLossPct) < 0.0001
    && Math.abs(left.trailingDrawdownPct - right.trailingDrawdownPct) < 0.0001
    && Math.abs(left.leverage - right.leverage) < 0.0001;
}

export function RealtimePage({ app }: { app: AppContext }) {
  const state = app.state!;
  const initialInstId = state.backtest?.instId ?? state.positions[0]?.symbol ?? 'RAVE-USDT-SWAP';
  const initialBar = (state.backtest?.bar as BacktestBar | undefined) ?? '1m';
  const initialStrategy = state.strategyConfig.strategyType ?? state.backtest?.strategyType ?? 'buy-sell';

  const [instId, setInstId] = useState(initialInstId);
  const [query, setQuery] = useState(initialInstId);
  const [bar, setBar] = useState<BacktestBar>(initialBar);
  const [pendingStrategyType, setPendingStrategyType] = useState<StrategyType>(initialStrategy);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([fallbackStrategy]);
  const [paramDraft, setParamDraft] = useState<StrategyParameterSet>(fallbackParams);
  const [paramsDirty, setParamsDirty] = useState(false);
  const [liveParamDraft, setLiveParamDraft] = useState<StrategyParameterSet>(fallbackParams);
  const [liveParamsDirty, setLiveParamsDirty] = useState(false);
  const [suggestions, setSuggestions] = useState<InstrumentSuggestion[]>([]);
  const [workspace, setWorkspace] = useState<RealtimeWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const { setError, setMessage } = app;

  const applyWorkspace = (data: RealtimeWorkspace, keepDraft = false) => {
    setWorkspace(data);
    setInstId(data.instId);
    setQuery(data.instId);
    setPendingStrategyType(data.selectedStrategyType);
    if (!keepDraft) {
      const nextSimParams = data.confirmedSession?.params ?? data.strategyParams;
      setParamDraft(nextSimParams);
      setParamsDirty(false);
      setLiveParamDraft(data.liveSession?.params ?? nextSimParams);
      setLiveParamsDirty(false);
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
      .then((items) => setStrategies(items.filter((item) => item.supportsRealtime || item.status === 'pending')))
      .catch((err) => setError(err instanceof Error ? err.message : '加载策略列表失败'));
    loadWorkspace();
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2 || keyword === instId) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearching(true);
      api.searchRealtimeInstruments(keyword)
        .then(setSuggestions)
        .catch((err) => setError(err instanceof Error ? err.message : '搜索 OKX 品种失败'))
        .finally(() => setSearching(false));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [query, instId]);

  useEffect(() => {
    if (!workspace?.nextRefreshAt) return;
    const delay = Math.max(1000, new Date(workspace.nextRefreshAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      loadWorkspace(instId, bar, pendingStrategyType, true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [workspace?.nextRefreshAt, instId, bar, pendingStrategyType]);

  async function selectInstrument(item: InstrumentSuggestion) {
    setSuggestions([]);
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

  function updateParam(key: keyof StrategyParameterSet, value: string) {
    const numeric = Number(value);
    setParamDraft((prev) => ({ ...prev, [key]: Number.isFinite(numeric) ? numeric : 0 }));
    setParamsDirty(true);
    if (!liveParamsDirty) {
      setLiveParamDraft((prev) => ({ ...prev, [key]: Number.isFinite(numeric) ? numeric : 0 }));
    }
  }

  function updateLiveParam(key: keyof StrategyParameterSet, value: string) {
    const numeric = Number(value);
    setLiveParamDraft((prev) => ({ ...prev, [key]: Number.isFinite(numeric) ? numeric : 0 }));
    setLiveParamsDirty(true);
  }

  async function confirmSimulation() {
    const invalid = validationMessage(paramDraft);
    if (invalid) {
      setError(invalid);
      return;
    }

    try {
      const data = await api.confirmRealtimeSession({
        instId,
        bar,
        strategyType: pendingStrategyType,
        stopLossPct: paramDraft.stopLossPct,
        trailingDrawdownPct: paramDraft.trailingDrawdownPct,
        leverage: paramDraft.leverage,
      });
      applyWorkspace(data);
      setMessage(`已确认 ${instId} ${bar} 的实时模拟会话。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认模拟会话失败');
    }
  }

  async function startLiveSession() {
    const invalid = validationMessage(liveParamDraft);
    if (invalid) {
      setError(invalid);
      return;
    }

    try {
      const data = await api.putLiveRealtimeSession({
        instId,
        bar,
        strategyType: pendingStrategyType,
        stopLossPct: liveParamDraft.stopLossPct,
        trailingDrawdownPct: liveParamDraft.trailingDrawdownPct,
        leverage: liveParamDraft.leverage,
      });
      applyWorkspace(data, true);
      setLiveParamsDirty(false);
      setMessage('已按当前实盘参数启动实时交易。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动实时交易失败');
    }
  }

  async function refreshNow() {
    await loadWorkspace(instId, bar, pendingStrategyType, true);
  }

  async function forceExitSimulation() {
    try {
      const data = await api.forceExitRealtimeSession();
      applyWorkspace(data, true);
      setMessage('已请求强制退出实时模拟持仓。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '强制退出模拟持仓失败');
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
    try {
      const data = await api.forceExitLiveRealtimeSession();
      applyWorkspace(data, true);
      setMessage('已请求强制退出实时交易持仓。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '强制退出实时交易持仓失败');
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

  const selectedStrategy = strategies.find((item) => item.id === pendingStrategyType) ?? fallbackStrategy;
  const simulation = workspace?.simulation;
  const live = workspace?.live;
  const liveSession = workspace?.liveSession;
  const currentSession = workspace?.confirmedSession;
  const summary = simulation?.summary;
  const currentValidationMessage = validationMessage(paramDraft);
  const liveValidationMessage = validationMessage(liveParamDraft);
  const recentTrades = simulation?.tradePoints.slice(-10).reverse() ?? [];
  const recentLiveTrades = liveSession?.tradePoints.slice(-10).reverse() ?? [];
  const recentPeriods = simulation?.periodEvaluations.slice(-10).reverse() ?? [];
  const liveHasPosition = liveSession?.positionSide === 'long' || liveSession?.positionSide === 'short';
  const simHasPosition = currentSession?.positionSide === 'long' || currentSession?.positionSide === 'short';
  const sourceLabel = paramsDirty ? '手工修改参数' : paramsSourceLabel(workspace?.paramsSource);
  const liveSourceLabel = liveParamsDirty || !sameParams(liveParamDraft, paramDraft) ? '实盘独立参数' : '跟随模拟参数';
  const chartTrades = [...(simulation?.tradePoints ?? []), ...(liveSession?.tradePoints ?? [])];

  const latestPeriodLabel = useMemo(() => {
    const lastPeriod = recentPeriods[0];
    if (!lastPeriod) return '等待下一根已收盘 K 线。';
    return `${actionLabel(lastPeriod.action)} / ${lastPeriod.reason}`;
  }, [recentPeriods]);

  return (
    <div className="backtestFlow">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">1 行情与 K 线</p>
            <h2>品种搜索与实时 K 线</h2>
          </div>
          <strong>{workspace?.instId ?? '未加载'}</strong>
        </div>

        <div className="formGrid">
          <label>
            OKX 合约品种
            <input value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} placeholder="输入 BTC-USDT-SWAP" />
          </label>
          <label>
            时间间隔
            <select value={bar} onChange={(e) => changeBar(e.target.value as BacktestBar)} disabled={loading}>
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

        {suggestions.length ? (
          <div className="suggestionList">
            {suggestions.map((item) => (
              <button type="button" className="suggestionItem" key={item.instId} onClick={() => selectInstrument(item)}>
                <strong>{item.instId}</strong>
                <span>{item.baseCcy}/{item.quoteCcy} / {item.state || 'unknown'}</span>
              </button>
            ))}
          </div>
        ) : query.trim().length >= 2 && query !== instId && !searching ? (
          <div className="emptyState compact">请选择 OKX 返回的真实品种后再运行。</div>
        ) : null}

        <div className="actions">
          <button type="button" onClick={refreshNow} disabled={loading}>{loading ? '刷新中...' : '立即刷新'}</button>
          <button type="button" className="secondary" disabled>{workspace?.nextRefreshAt ? `下次刷新 ${displayTime(workspace.nextRefreshAt)}` : '等待刷新时间'}</button>
        </div>

        {workspace?.candles.length ? (
          <CandleChart candles={workspace.candles} trades={chartTrades} />
        ) : (
          <EmptyState text={loading ? '正在加载 K 线...' : '选择 OKX 品种后显示实时 K 线。'} />
        )}
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">2 策略运行</p>
            <h2>实时模拟与实时交易并行</h2>
          </div>
          <strong>{selectedStrategy.name}</strong>
        </div>

        <StrategyPicker strategies={strategies} selected={pendingStrategyType} mode="realtime" disabled={loading} onSelect={previewStrategy} />

        <div className="analysisBlock compactHeader">
          <p className="eyebrow">实时模拟参数</p>
          <h2>{sourceLabel}</h2>
          <div className="formGrid">
            <label>
              止损比例 %
              <input type="number" min="0.01" step="0.01" value={paramDraft.stopLossPct} onChange={(e) => updateParam('stopLossPct', e.target.value)} />
            </label>
            <label>
              回撤比例 %
              <input type="number" min="0.01" step="0.01" value={paramDraft.trailingDrawdownPct} onChange={(e) => updateParam('trailingDrawdownPct', e.target.value)} />
            </label>
            <label>
              杠杆 x
              <input type="number" min="1" step="1" value={paramDraft.leverage} onChange={(e) => updateParam('leverage', e.target.value)} />
            </label>
            <label>
              最近动作
              <input value={simulation ? actionLabel(simulation.lastSignal) : '观望'} readOnly />
            </label>
          </div>
          {currentValidationMessage ? <div className="statusBanner error">{currentValidationMessage}</div> : null}
          <div className="actions">
            <button type="button" onClick={confirmSimulation} disabled={loading || Boolean(currentValidationMessage)}>
              确认实时模拟
            </button>
            <button type="button" className="secondary" onClick={refreshNow} disabled={loading}>
              刷新
            </button>
          </div>
        </div>

        <div className="resultSummaryStrip compactHeader">
          <div><span>模拟状态</span><strong>{currentSession?.status ?? '未确认'}</strong></div>
          <div><span>模拟持仓</span><strong>{sideLabel(currentSession?.positionSide)}</strong></div>
          <div><span>模拟入场价</span><strong>{formatNumber(currentSession?.entryPrice, 8)}</strong></div>
          <div><span>模拟最近结算</span><strong>{displayTime(currentSession?.lastSettledCandleTs)}</strong></div>
          <div><span>模拟净收益</span><strong className={(summary?.netTotalReturn ?? 0) >= 0 ? 'good' : 'bad'}>{formatPercent(summary?.netTotalReturn ?? 0)}</strong></div>
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={forceExitSimulation} disabled={!simHasPosition || loading}>
            强制退出模拟
          </button>
          <button type="button" className="secondary" disabled>{latestPeriodLabel}</button>
        </div>

        <div className="analysisBlock compactHeader">
          <p className="eyebrow">实时交易参数</p>
          <h2>{liveSourceLabel}</h2>
          <div className="formGrid">
            <label>
              实盘止损比例 %
              <input type="number" min="0.01" step="0.01" value={liveParamDraft.stopLossPct} onChange={(e) => updateLiveParam('stopLossPct', e.target.value)} />
            </label>
            <label>
              实盘回撤比例 %
              <input type="number" min="0.01" step="0.01" value={liveParamDraft.trailingDrawdownPct} onChange={(e) => updateLiveParam('trailingDrawdownPct', e.target.value)} />
            </label>
            <label>
              实盘杠杆 x
              <input type="number" min="1" step="1" value={liveParamDraft.leverage} onChange={(e) => updateLiveParam('leverage', e.target.value)} />
            </label>
            <label>
              参数状态
              <input value={liveHasPosition ? '有持仓，禁止覆盖参数' : liveSourceLabel} readOnly />
            </label>
          </div>
          {liveValidationMessage ? <div className="statusBanner error">{liveValidationMessage}</div> : null}
          {liveHasPosition ? <div className="statusBanner">实盘已有持仓，修改参数只能预览；请先强制退出或等待平仓后再覆盖。</div> : null}
          <div className="actions">
            <button type="button" className="secondary" onClick={startLiveSession} disabled={loading || Boolean(liveValidationMessage) || !currentSession || liveHasPosition}>
              启动/覆盖实时交易
            </button>
            <button type="button" className="secondary" disabled>
              单次开仓最多使用可用余额 20%，止损优先执行
            </button>
          </div>
        </div>

        <div className="resultSummaryStrip compactHeader">
          <div><span>实盘状态</span><strong>{liveSession?.status ?? '未启动'}</strong></div>
          <div><span>实盘持仓</span><strong>{sideLabel(liveSession?.positionSide)}</strong></div>
          <div><span>真实委托</span><strong>{liveSession?.lastOrderId ?? '-'}</strong></div>
          <div><span>真实成交价</span><strong>{formatNumber(liveSession?.lastExecutionPrice, 8)}</strong></div>
          <div><span>最近成交时间</span><strong>{displayTime(liveSession?.lastExecutionTs)}</strong></div>
        </div>

        <div className="resultSummaryStrip">
          <div><span>本次使用资金</span><strong>{formatNumber(liveSession?.allocatedCapital, 4)}</strong></div>
          <div><span>开仓张数</span><strong>{formatNumber(liveSession?.positionSize, 8)}</strong></div>
          <div><span>名义价值</span><strong>{formatNumber(liveSession?.entryNotionalUsd, 4)}</strong></div>
          <div><span>风险提示</span><strong>{live?.riskNote ?? '-'}</strong></div>
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={pauseLive} disabled={loading || !liveSession || liveSession.status !== 'running'}>
            暂停实时交易
          </button>
          <button type="button" className="secondary" onClick={resumeLive} disabled={loading || !liveSession || liveSession.status === 'running'}>
            恢复实时交易
          </button>
          <button type="button" className="secondary" onClick={forceExitLive} disabled={loading || !liveHasPosition}>
            强制退出实盘
          </button>
          <button type="button" className="secondary" onClick={deleteLive} disabled={loading || !liveSession}>
            删除实盘会话
          </button>
        </div>

        <div className="compactHeader">
          <p className="eyebrow">最近模拟交易</p>
          <h2>模拟交易记录</h2>
          {recentTrades.length ? (
            <table>
              <thead>
                <tr>
                  <th>方向</th>
                  <th>开仓时间</th>
                  <th>开仓价</th>
                  <th>平仓时间</th>
                  <th>平仓价</th>
                  <th>净收益</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade) => (
                  <tr key={`${trade.entryTs}-${trade.exitTs}`}>
                    <td>{sideLabel(trade.side)}</td>
                    <td>{displayTime(trade.entryTs)}</td>
                    <td>{formatNumber(trade.entryPrice, 8)}</td>
                    <td>{displayTime(trade.exitTs)}</td>
                    <td>{formatNumber(trade.exitPrice, 8)}</td>
                    <td className={(trade.netRet ?? trade.ret) >= 0 ? 'good' : 'bad'}>{formatPercent(trade.netRet ?? trade.ret)}</td>
                    <td>{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState text="当前还没有完成的模拟交易记录。" />
          )}
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
                  <th>净收益</th>
                  <th>委托号</th>
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
                    <td>{formatNumber(trade.executedPrice ?? trade.exitPrice, 8)}</td>
                    <td>{formatNumber(trade.executedSize, 8)}</td>
                    <td className={(trade.netRet ?? trade.ret) >= 0 ? 'good' : 'bad'}>{formatPercent(trade.netRet ?? trade.ret)}</td>
                    <td>{trade.orderId ?? '-'}</td>
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
