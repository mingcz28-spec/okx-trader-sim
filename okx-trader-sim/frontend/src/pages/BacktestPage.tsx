import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { CandleChart } from '../components/backtest/CandleChart';
import { EquityCurve } from '../components/backtest/EquityCurve';
import { EmptyState } from '../components/common/EmptyState';
import type { AppState, BacktestBar, BacktestResult, StrategyDefinition, StrategyType } from '../types';
import { formatNumber, formatPercent } from '../utils/format';

type AppContext = {
  state: AppState | null;
  setState: (state: AppState) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
};

const fallbackStrategies: StrategyDefinition[] = [
  { id: 'buy-sell', name: '买入卖出策略', description: '无仓即入场，按止损和移动回撤退出。', status: 'active', supportsBacktest: true, supportsRealtime: true },
  { id: 'trend', name: '趋势跟随策略', description: '价格站上 20 根均线并接近区间高点时入场。', status: 'active', supportsBacktest: true, supportsRealtime: true },
  { id: 'mean-reversion', name: '均值回归策略', description: '待接入。', status: 'pending', supportsBacktest: false, supportsRealtime: false },
  { id: 'breakout', name: '突破策略', description: '待接入。', status: 'pending', supportsBacktest: false, supportsRealtime: false },
];

export function BacktestPage({ app }: { app: AppContext }) {
  const state = app.state!;
  const initialStrategy = state.strategyConfig.strategyType ?? state.backtest?.strategyType ?? 'buy-sell';
  const [strategy, setStrategy] = useState<StrategyType>(initialStrategy);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>(fallbackStrategies);
  const [bar, setBar] = useState<BacktestBar>((state.backtest?.bar as BacktestBar) ?? '1H');
  const [risk, setRisk] = useState(state.riskConfig);
  const [strategyConfig, setStrategyConfig] = useState({ ...state.strategyConfig, strategyType: initialStrategy });
  const instId = state.positions[0]?.symbol || state.backtest?.instId || 'RAVE-USDT-SWAP';
  const [running, setRunning] = useState(false);
  const backtest = state.backtest;
  const selectedStrategy = strategies.find((item) => item.id === strategy) ?? strategies[0];
  const canRunStrategy = selectedStrategy.status === 'active' && selectedStrategy.supportsBacktest;
  const rows = useMemo(() => [...(backtest?.results?.length ? backtest.results : backtest?.top ?? [])].sort((a, b) => b.totalReturn - a.totalReturn), [backtest]);

  useEffect(() => {
    api.getStrategies()
      .then(setStrategies)
      .catch((err) => app.setError(err instanceof Error ? err.message : '加载策略列表失败'));
  }, []);

  function changeStrategy(next: StrategyType) {
    setStrategy(next);
    setStrategyConfig((current) => ({ ...current, strategyType: next }));
  }

  async function saveRisk() {
    app.setError('');
    try {
      await api.saveRiskConfig(risk);
      app.setState({ ...state, riskConfig: risk });
      app.setMessage('风控参数已保存。');
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '保存风控失败');
    }
  }

  async function saveStrategy() {
    app.setError('');
    try {
      const next = await api.saveStrategyConfig({ ...strategyConfig, strategyType: strategy });
      app.setState({ ...state, strategyConfig: next });
      app.setMessage('策略参数已保存。');
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '保存策略失败');
    }
  }

  async function runBacktest() {
    setRunning(true);
    app.setError('');
    try {
      const result = await api.runBacktest({ instId, bar, strategyType: strategy });
      app.setState({ ...state, backtest: result, strategyConfig: { ...strategyConfig, strategyType: strategy } });
      app.setMessage(`回测完成，共 ${result.results.length} 组参数。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '回测失败');
    } finally {
      setRunning(false);
    }
  }

  async function selectResult(result: BacktestResult) {
    app.setError('');
    try {
      const detail = await api.loadBacktestDetail({ instId, bar, strategyType: strategy, stopLossPct: result.stopLossPct, trailingDrawdownPct: result.trailingDrawdownPct });
      const nextStrategyConfig = { ...strategyConfig, strategyType: strategy, stopLossPct: result.stopLossPct, trailingDrawdownPct: result.trailingDrawdownPct };
      setStrategyConfig(nextStrategyConfig);
      app.setState({ ...state, backtest: detail, strategyConfig: nextStrategyConfig });
      app.setMessage(`已加载 ${selectedStrategy.name} ${result.stopLossPct}% / ${result.trailingDrawdownPct}% 回测详情。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '加载回测详情失败');
    }
  }

  return (
    <div className="pageGrid">
      <section className="panel">
        <p className="eyebrow">策略参数</p>
        <h2>回测控制</h2>
        <p className="bodyCopy">{selectedStrategy.description}</p>
        <div className="formGrid single">
          <label>
            策略
            <select value={strategy} onChange={(e) => changeStrategy(e.target.value as StrategyType)}>
              {strategies.map((item) => (
                <option key={item.id} value={item.id} disabled={item.status !== 'active' || !item.supportsBacktest}>
                  {item.name}{item.status === 'pending' ? '（待接入）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>标的<input value={instId} readOnly /></label>
          <label>周期<select value={bar} onChange={(e) => setBar(e.target.value as BacktestBar)}><option value="1m">1m</option><option value="5m">5m</option><option value="15m">15m</option><option value="1H">1H</option><option value="4H">4H</option><option value="1D">1D</option></select></label>
          <label>止损 %<input type="number" value={strategyConfig.stopLossPct} onChange={(e) => setStrategyConfig({ ...strategyConfig, stopLossPct: Number(e.target.value) })} /></label>
          <label>移动回撤 %<input type="number" value={strategyConfig.trailingDrawdownPct} onChange={(e) => setStrategyConfig({ ...strategyConfig, trailingDrawdownPct: Number(e.target.value) })} /></label>
        </div>
        <div className="actions">
          <button onClick={runBacktest} disabled={running || !canRunStrategy}>{running ? '回测中...' : '运行回测'}</button>
          <button className="secondary" onClick={saveStrategy}>保存策略参数</button>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">风控参数</p>
        <h2>开仓限制</h2>
        <div className="formGrid single">
          <label>最大仓位 %<input type="number" value={risk.maxPositionPct} onChange={(e) => setRisk({ ...risk, maxPositionPct: Number(e.target.value) })} /></label>
          <label>最大日亏损 %<input type="number" value={risk.maxDailyLossPct} onChange={(e) => setRisk({ ...risk, maxDailyLossPct: Number(e.target.value) })} /></label>
          <label>最大连续亏损<input type="number" value={risk.maxConsecutiveLosses} onChange={(e) => setRisk({ ...risk, maxConsecutiveLosses: Number(e.target.value) })} /></label>
        </div>
        <div className="actions"><button className="secondary" onClick={saveRisk}>保存风控参数</button></div>
      </section>

      <section className="panel wide">
        <div className="panelHeader"><div><p className="eyebrow">参数排行</p><h2>回测结果</h2></div><strong>{backtest?.candles ?? 0} 根 K 线</strong></div>
        {rows.length ? (
          <table>
            <thead><tr><th>止损</th><th>移动回撤</th><th>交易数</th><th>胜率</th><th>总收益</th><th>最大回撤</th><th></th></tr></thead>
            <tbody>{rows.slice(0, 18).map((r) => <tr key={`${r.stopLossPct}-${r.trailingDrawdownPct}`}><td>{r.stopLossPct}%</td><td>{r.trailingDrawdownPct}%</td><td>{r.trades}</td><td>{formatPercent(r.winRate)}</td><td className={r.totalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(r.totalReturn)}</td><td className="bad">{formatPercent(r.maxDrawdown)}</td><td><button className="tableAction" onClick={() => selectResult(r)} disabled={!canRunStrategy}>查看</button></td></tr>)}</tbody>
          </table>
        ) : <EmptyState text="暂无回测结果" />}
      </section>

      <section className="panel wide">
        <div className="panelHeader"><div><p className="eyebrow">K 线图</p><h2>交易信号</h2></div><strong>{backtest?.selected ? `${backtest.selected.stopLossPct}% / ${backtest.selected.trailingDrawdownPct}%` : '未选择'}</strong></div>
        <CandleChart candles={backtest?.chartCandles ?? []} trades={backtest?.tradePoints ?? []} />
      </section>

      <section className="panel wide">
        <p className="eyebrow">资金曲线</p>
        <h2>回测净值</h2>
        <EquityCurve trades={backtest?.tradePoints ?? []} />
      </section>

      <section className="panel wide">
        <p className="eyebrow">交易记录</p>
        <h2>最近交易</h2>
        {backtest?.tradePoints?.length ? (
          <table>
            <thead><tr><th>买入时间</th><th>买入价</th><th>卖出时间</th><th>卖出价</th><th>收益</th><th>原因</th></tr></thead>
            <tbody>{backtest.tradePoints.slice(-40).reverse().map((t) => <tr key={`${t.entryTs}-${t.exitTs}`}><td>{new Date(t.entryTs).toLocaleString('zh-CN', { hour12: false })}</td><td>{formatNumber(t.entryPrice, 8)}</td><td>{new Date(t.exitTs).toLocaleString('zh-CN', { hour12: false })}</td><td>{formatNumber(t.exitPrice, 8)}</td><td className={t.ret >= 0 ? 'good' : 'bad'}>{formatPercent(t.ret)}</td><td>{t.reason === 'stop_loss' ? '止损' : '移动回撤'}</td></tr>)}</tbody>
          </table>
        ) : <EmptyState text="暂无交易记录" />}
      </section>
    </div>
  );
}
