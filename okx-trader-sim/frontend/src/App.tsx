import { useState } from 'react';
import { StatusBanner } from './components/common/StatusBanner';
import { useAppState } from './hooks/useAppState';
import { BacktestPage } from './pages/BacktestPage';
import { MarketPage } from './pages/MarketPage';
import { RealtimePage } from './pages/RealtimePage';
import { formatNumber, formatSigned } from './utils/format';

type Mode = 'market' | 'backtest' | 'realtime';

export default function App() {
  const app = useAppState();
  const [mode, setMode] = useState<Mode>('market');
  const state = app.state;

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">OKX Trader Sim</p>
          <h1>交易控制台</h1>
          <p className="subtitle">真实盘口、策略回测、实时策略分离运行。</p>
          <div className="runtimeBadge">Vite 前端 + ASP.NET Core API，本地开发服务已连接</div>
        </div>
        <div className="modeTabs" aria-label="页面模式">
          <button className={mode === 'market' ? 'active' : ''} onClick={() => setMode('market')}>真实盘口</button>
          <button className={mode === 'backtest' ? 'active' : ''} onClick={() => setMode('backtest')}>策略回测</button>
          <button className={mode === 'realtime' ? 'active' : ''} onClick={() => setMode('realtime')}>实时策略</button>
        </div>
      </header>

      {state ? (
        <section className="metricStrip">
          <div><span>账号权益</span><strong>{formatNumber(state.equity, 4)}</strong></div>
          <div><span>可用保证金</span><strong>{formatNumber(state.availableMargin, 4)}</strong></div>
          <div><span>今日盈亏</span><strong className={state.dailyPnl >= 0 ? 'good' : 'bad'}>{formatSigned(state.dailyPnl, 4)}</strong></div>
          <div><span>策略状态</span><strong>{state.strategyStatus}</strong></div>
        </section>
      ) : null}

      <StatusBanner message={app.message} error={app.error} />

      {app.loading ? <div className="panel">加载中...</div> : null}
      {!app.loading && state && mode === 'market' ? <MarketPage app={app} /> : null}
      {!app.loading && state && mode === 'backtest' ? <BacktestPage app={app} /> : null}
      {!app.loading && state && mode === 'realtime' ? <RealtimePage app={app} /> : null}
    </main>
  );
}
