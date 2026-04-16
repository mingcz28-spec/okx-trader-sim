import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { EmptyState } from '../components/common/EmptyState';
import type { AppState, StrategyDefinition, StrategyType } from '../types';
import { formatNumber } from '../utils/format';

type AppContext = {
  state: AppState | null;
  setError: (message: string) => void;
};

type ConsoleState = {
  strategyType: StrategyType;
  strategyName: string;
  strategyStatusLabel: string;
  strategyStatus: string;
  lastSignal: string;
  stopLossPct: number;
  trailingDrawdownPct: number;
  riskState: string;
  executionAdvice: string;
  positionCount: number;
  logs: string[];
};

const fallbackStrategy: StrategyDefinition = {
  id: 'buy-sell',
  name: '买入卖出策略',
  description: '无仓即入场，按止损和移动回撤退出。',
  status: 'active',
  supportsBacktest: true,
  supportsRealtime: true,
};

export function RealtimePage({ app }: { app: AppContext }) {
  const state = app.state!;
  const [consoleState, setConsoleState] = useState<ConsoleState | null>(null);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([fallbackStrategy]);
  const [loading, setLoading] = useState(false);
  const { setError } = app;

  async function refreshConsole() {
    setLoading(true);
    try {
      const next = await api.getRealtimeConsole();
      setConsoleState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载实时策略状态失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.getStrategies()
      .then(setStrategies)
      .catch((err) => setError(err instanceof Error ? err.message : '加载策略列表失败'));
    refreshConsole();
  }, []);

  const strategyType = consoleState?.strategyType ?? state.strategyConfig.strategyType ?? 'buy-sell';
  const strategy = strategies.find((item) => item.id === strategyType) ?? fallbackStrategy;
  const signal = consoleState?.lastSignal ?? state.strategyConfig.lastSignal;

  return (
    <div className="pageGrid">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">实时策略</p>
            <h2>{consoleState?.strategyName ?? strategy.name}</h2>
            <p className="bodyCopy">{strategy.description}</p>
          </div>
          <strong>{strategy.status === 'active' ? '人工确认执行' : '待接入'}</strong>
        </div>
        <div className="actions">
          <button className="secondary" onClick={refreshConsole} disabled={loading || strategy.status !== 'active'}>{loading ? '刷新中...' : '刷新信号'}</button>
        </div>
        <div className="consoleGrid">
          <div><span>运行状态</span><strong>{consoleState?.strategyStatus ?? state.strategyStatus}</strong></div>
          <div><span>当前信号</span><strong>{signal === 'buy' ? '买入' : signal === 'sell' ? '卖出' : '观望'}</strong></div>
          <div><span>当前参数</span><strong>{formatNumber(consoleState?.stopLossPct ?? state.strategyConfig.stopLossPct, 2)}% / {formatNumber(consoleState?.trailingDrawdownPct ?? state.strategyConfig.trailingDrawdownPct, 2)}%</strong></div>
          <div><span>当前持仓</span><strong>{consoleState?.positionCount ?? state.positions.length}</strong></div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">风险状态</p>
        <h2>{consoleState?.riskState ?? '正常观察'}</h2>
        <p className="bodyCopy">根据真实账户状态、最新价格和当前策略生成实时信号，仅提供人工执行参考，不自动下单。</p>
      </section>

      <section className="panel">
        <p className="eyebrow">执行建议</p>
        <h2>{consoleState?.executionAdvice ?? '等待人工确认。'}</h2>
        <div className="actions">
          <button disabled>{signal === 'buy' ? '建议开仓' : signal === 'sell' ? '建议平仓' : '继续观察'}</button>
          <button className="secondary" onClick={refreshConsole} disabled={loading || strategy.status !== 'active'}>重新评估</button>
        </div>
      </section>

      <section className="panel wide">
        <p className="eyebrow">执行日志</p>
        <h2>预留记录</h2>
        <div className="logList">
          {consoleState?.logs?.length ? consoleState.logs.map((line) => <div key={line}>{line}</div>) : <EmptyState text="暂无实时策略日志" />}
        </div>
      </section>
    </div>
  );
}
