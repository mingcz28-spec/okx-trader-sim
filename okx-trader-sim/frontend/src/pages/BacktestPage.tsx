import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { BacktestAnalysisPanel } from '../components/backtest/BacktestAnalysisPanel';
import { BacktestParameterPanel } from '../components/backtest/BacktestParameterPanel';
import { CandleChart } from '../components/backtest/CandleChart';
import { EquityCurve } from '../components/backtest/EquityCurve';
import { StrategyPicker } from '../components/backtest/StrategyPicker';
import { EmptyState } from '../components/common/EmptyState';
import type { AppState, BacktestBar, BacktestResult, StrategyDefinition, StrategyType } from '../types';
import { formatNumber, formatPercent } from '../utils/format';
import {
  DEFAULT_STRATEGY_PARAMS,
  DEFAULT_STRATEGY_TYPE,
  findStrategyDefinition,
  getLeveragedStopLossValidationMessage,
  getStrategyName,
} from '../utils/strategy';

type AppContext = {
  state: AppState | null;
  setState: (state: AppState) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
};

function tradeReason(reason: string) {
  if (reason === 'stop_loss') return '止损';
  if (reason === 'trailing_exit') return '浮盈回撤';
  if (reason === 'force_close') return '强制平仓';
  return reason;
}

export function BacktestPage({ app }: { app: AppContext }) {
  const state = app.state!;
  const initialStrategy = state.strategyConfig.strategyType ?? state.backtest?.strategyType ?? DEFAULT_STRATEGY_TYPE;
  const [strategy, setStrategy] = useState<StrategyType>(initialStrategy);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [bar, setBar] = useState<BacktestBar>((state.backtest?.bar as BacktestBar) ?? '1H');
  const [strategyConfig, setStrategyConfig] = useState({
    ...state.strategyConfig,
    strategyType: initialStrategy,
    movingAveragePeriod: state.strategyConfig.movingAveragePeriod ?? DEFAULT_STRATEGY_PARAMS.movingAveragePeriod,
    stopLossPct: state.strategyConfig.stopLossPct ?? DEFAULT_STRATEGY_PARAMS.stopLossPct,
    trailingDrawdownPct: state.strategyConfig.trailingDrawdownPct ?? DEFAULT_STRATEGY_PARAMS.trailingDrawdownPct,
    leverage: state.strategyConfig.leverage ?? 3,
  });
  const [running, setRunning] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const instId = state.backtest?.instId || 'RAVE-USDT-SWAP';
  const backtest = state.backtest;
  const selectedStrategy = findStrategyDefinition(strategies, strategy);
  const canRunStrategy = selectedStrategy?.status === 'active' && selectedStrategy.supportsBacktest;
  const candidates = useMemo(
    () => [...(backtest?.results?.length ? backtest.results : backtest?.top ?? [])].sort((a, b) => b.netTotalReturn - a.netTotalReturn),
    [backtest],
  );
  const bestResult = candidates[0] ?? null;
  const hasDetail = Boolean(backtest?.selected && backtest.chartCandles.length && backtest.tradePoints.length);
  const validationMessage = getLeveragedStopLossValidationMessage({
    movingAveragePeriod: Number(strategyConfig.movingAveragePeriod),
    stopLossPct: Number(strategyConfig.stopLossPct),
    trailingDrawdownPct: Number(strategyConfig.trailingDrawdownPct),
    leverage: Number(strategyConfig.leverage),
  });

  useEffect(() => {
    api.getStrategies()
      .then(setStrategies)
      .catch((err) => app.setError(err instanceof Error ? err.message : '加载策略列表失败'));
  }, []);

  async function selectStrategy(next: StrategyType) {
    const nextDefinition = strategies.find((item) => item.id === next);
    if (!nextDefinition || nextDefinition.status !== 'active' || !nextDefinition.supportsBacktest) return;

    setStrategy(next);
    const nextConfig = { ...strategyConfig, strategyType: next, movingAveragePeriod: nextDefinition.defaultParams.movingAveragePeriod ?? strategyConfig.movingAveragePeriod, leverage: nextDefinition.defaultParams.leverage ?? strategyConfig.leverage };
    setStrategyConfig(nextConfig);
    app.setState({ ...state, strategyConfig: nextConfig, backtest: state.backtest?.strategyType === next ? state.backtest : null });
    await runBacktest(next, nextConfig);
  }

  async function runBacktest(targetStrategy = strategy, config = strategyConfig) {
    setRunning(true);
    setLoadingDetail(false);
    app.setError('');
    try {
      const result = await api.runBacktest({ instId, bar, strategyType: targetStrategy });
      const best = result.results[0] ?? result.top[0];
      if (!best) {
        app.setState({ ...state, backtest: result, strategyConfig: config });
        app.setMessage('回测完成，但没有产生可用参数。');
        return;
      }

      const bestConfig = {
        ...config,
        strategyType: targetStrategy,
        movingAveragePeriod: best.movingAveragePeriod,
        stopLossPct: best.stopLossPct,
        trailingDrawdownPct: best.trailingDrawdownPct,
        leverage: best.leverage,
      };
      setStrategyConfig(bestConfig);
      await loadBacktestDetail(best, targetStrategy, bestConfig, result);
        app.setMessage(`已为 ${getStrategyName(strategies, targetStrategy)} 找到最优参数：均线 ${best.movingAveragePeriod} / 止损收益 ${best.stopLossPct}% / 回撤 ${best.trailingDrawdownPct}% / 杠杆 ${best.leverage}x。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '回测失败');
    } finally {
      setRunning(false);
    }
  }

  async function loadBacktestDetail(result: BacktestResult, targetStrategy = strategy, config = strategyConfig, gridResult = backtest) {
    setLoadingDetail(true);
    app.setError('');
    try {
      const detail = await api.loadBacktestDetail({
        instId,
        bar,
        strategyType: targetStrategy,
        movingAveragePeriod: result.movingAveragePeriod,
        stopLossPct: result.stopLossPct,
        trailingDrawdownPct: result.trailingDrawdownPct,
        leverage: result.leverage,
      });
      const nextConfig = {
        ...config,
        strategyType: targetStrategy,
        movingAveragePeriod: result.movingAveragePeriod,
        stopLossPct: result.stopLossPct,
        trailingDrawdownPct: result.trailingDrawdownPct,
        leverage: result.leverage,
      };
      setStrategyConfig(nextConfig);
      app.setState({ ...state, backtest: { ...detail, results: detail.results.length ? detail.results : gridResult?.results ?? [], top: detail.top.length ? detail.top : gridResult?.top ?? [] }, strategyConfig: nextConfig });
    } catch (err) {
      if (gridResult) app.setState({ ...state, backtest: gridResult, strategyConfig: config });
      app.setError(err instanceof Error ? err.message : '加载回测详情失败');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function runCurrentParameters() {
    if (validationMessage) {
      app.setError(validationMessage);
      return;
    }

    const manualResult: BacktestResult = {
      movingAveragePeriod: Number(strategyConfig.movingAveragePeriod),
      stopLossPct: Number(strategyConfig.stopLossPct),
      trailingDrawdownPct: Number(strategyConfig.trailingDrawdownPct),
      leverage: Number(strategyConfig.leverage),
      trades: 0,
      winRate: 0,
      totalReturn: 0,
      maxDrawdown: 0,
      grossTotalReturn: 0,
      netTotalReturn: 0,
      feeCost: 0,
    };
    await loadBacktestDetail(manualResult, strategy, strategyConfig);
    app.setMessage(`已按当前参数加载回测：均线 ${manualResult.movingAveragePeriod} / 止损收益 ${manualResult.stopLossPct}% / 回撤 ${manualResult.trailingDrawdownPct}% / 杠杆 ${manualResult.leverage}x。`);
  }

  async function saveStrategy() {
    if (validationMessage) {
      app.setError(validationMessage);
      return;
    }

    app.setError('');
    try {
      const next = await api.saveStrategyConfig({ ...strategyConfig, strategyType: strategy });
      app.setState({ ...state, strategyConfig: next });
      app.setMessage('策略参数已保存；已运行的实时模拟或实盘会话不会自动切换参数。');
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '保存策略失败');
    }
  }

  return (
    <div className="backtestFlow">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">1 策略选择</p>
            <h2>选择回测策略</h2>
          </div>
          <strong>{getStrategyName(strategies, strategy)}</strong>
        </div>
        <StrategyPicker strategies={strategies} selected={strategy} mode="backtest" disabled={running || loadingDetail} onSelect={selectStrategy} />
      </section>

      <BacktestParameterPanel
        instId={instId}
        bar={bar}
        movingAveragePeriod={strategyConfig.movingAveragePeriod}
        stopLossPct={strategyConfig.stopLossPct}
        trailingDrawdownPct={strategyConfig.trailingDrawdownPct}
        leverage={strategyConfig.leverage}
        bestResult={bestResult}
        candidates={candidates}
        selected={backtest?.selected}
        running={running}
        loadingDetail={loadingDetail}
        canRun={canRunStrategy}
        validationMessage={validationMessage}
        onBarChange={setBar}
        onMovingAveragePeriodChange={(value) => setStrategyConfig({ ...strategyConfig, movingAveragePeriod: value })}
        onStopLossChange={(value) => setStrategyConfig({ ...strategyConfig, stopLossPct: value })}
        onTrailingChange={(value) => setStrategyConfig({ ...strategyConfig, trailingDrawdownPct: value })}
        onLeverageChange={(value) => setStrategyConfig({ ...strategyConfig, leverage: value })}
        onRunGrid={() => runBacktest()}
        onRunCurrent={runCurrentParameters}
        onSelectCandidate={(result) => loadBacktestDetail(result)}
        onSaveStrategy={saveStrategy}
      />

      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">3 回测结果</p>
            <h2>曲线与结果分析</h2>
          </div>
          <strong>{backtest?.selected ? `${backtest.selected.movingAveragePeriod} / ${backtest.selected.stopLossPct}% / ${backtest.selected.trailingDrawdownPct}% / ${backtest.selected.leverage}x` : '未选择参数'}</strong>
        </div>

        {hasDetail ? (
          <>
            <div className="resultSummaryStrip">
              <div><span>策略</span><strong>{getStrategyName(strategies, backtest!.strategyType)}</strong></div>
              <div><span>K 线数</span><strong>{backtest!.candles}</strong></div>
              <div><span>净收益</span><strong className={backtest!.selected!.netTotalReturn >= 0 ? 'good' : 'bad'}>{formatPercent(backtest!.selected!.netTotalReturn)}</strong></div>
              <div><span>费率成本</span><strong>{formatPercent(backtest!.selected!.feeCost)}</strong></div>
              <div><span>最大回撤</span><strong className="bad">{formatPercent(backtest!.selected!.maxDrawdown)}</strong></div>
            </div>

            <div className="resultCharts">
              <div>
                <p className="eyebrow">K 线交易信号</p>
                <h2>开平仓点</h2>
                <CandleChart candles={backtest!.chartCandles} trades={backtest!.tradePoints} />
              </div>
              <div>
                <p className="eyebrow">资金曲线</p>
                <h2>净值变化</h2>
                <EquityCurve trades={backtest!.tradePoints} />
              </div>
            </div>

            <div className="analysisBlock">
              <p className="eyebrow">结果分析</p>
              <h2>详细指标</h2>
              <BacktestAnalysisPanel selected={backtest!.selected} trades={backtest!.tradePoints} />
            </div>

            <div>
              <p className="eyebrow">交易记录</p>
              <h2>最近交易</h2>
              {backtest!.tradePoints.length ? (
                <table>
                  <thead><tr><th>方向</th><th>开仓时间</th><th>开仓价</th><th>平仓时间</th><th>平仓价</th><th>净收益</th><th>费率</th><th>原因</th></tr></thead>
                  <tbody>
                    {backtest!.tradePoints.slice(-40).reverse().map((trade) => (
                      <tr key={`${trade.entryTs}-${trade.exitTs}`}>
                        <td className={trade.side === 'short' ? 'good' : 'bad'}>{trade.side === 'short' ? '空单' : '多单'}</td>
                        <td>{new Date(trade.entryTs).toLocaleString('zh-CN', { hour12: false })}</td>
                        <td>{formatNumber(trade.entryPrice, 8)}</td>
                        <td>{new Date(trade.exitTs).toLocaleString('zh-CN', { hour12: false })}</td>
                        <td>{formatNumber(trade.exitPrice, 8)}</td>
                        <td className={(trade.netRet ?? trade.ret) >= 0 ? 'good' : 'bad'}>{formatPercent(trade.netRet ?? trade.ret)}</td>
                        <td>{formatPercent(trade.feeCost)}</td>
                        <td>{tradeReason(trade.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <EmptyState text="暂无交易记录" />}
            </div>
          </>
        ) : (
          <EmptyState text={running || loadingDetail ? '正在生成回测结果...' : '请选择一个可用策略，系统会自动加载曲线和分析。'} />
        )}
      </section>
    </div>
  );
}
