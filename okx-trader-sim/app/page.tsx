'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber } from '@/lib/format';

type Position = {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  leverage: number;
  marginMode?: string;
  quantity?: number;
  notional: number;
  marginUsed?: number;
  unrealizedPnl?: number;
  entryPrice: number;
  markPrice: number;
  pnlPct: number;
  openedAt: string;
};

type BalanceDetail = {
  ccy: string;
  equity: number;
  cashBalance: number;
  availableBalance: number;
};

type OrderHistoryItem = {
  id: string;
  symbol: string;
  side: string;
  orderType: string;
  state: string;
  price: number;
  size: number;
  filledSize: number;
  createdAt: string;
};

type BacktestResult = {
  stopLossPct: number;
  trailingDrawdownPct: number;
  trades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
};

type BacktestCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type BacktestTradePoint = {
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  ret: number;
  reason: 'stop_loss' | 'trailing_exit';
};

type SimState = {
  apiConfig: {
    apiKey: string;
    secretKey: string;
    passphrase: string;
  };
  riskConfig: {
    maxPositionPct: number;
    maxDailyLossPct: number;
    maxConsecutiveLosses: number;
  };
  strategyConfig?: {
    enabled: boolean;
    entrySide: 'buy';
    stopLossPct: number;
    trailingDrawdownPct: number;
    highestPriceSinceEntry?: number;
    entryPrice?: number;
    lastSignal?: 'buy' | 'sell' | 'hold';
  };
  equity: number;
  availableMargin: number;
  dailyPnl: number;
  drawdownPct: number;
  strategyStatus: 'idle' | 'running' | 'paused';
  currencyMode?: 'USD' | 'CAD';
  balanceDetails?: BalanceDetail[];
  orderHistory?: OrderHistoryItem[];
  raw?: {
    accountBalance?: unknown;
    accountPositions?: unknown;
    ordersHistory?: unknown;
  };
  backtest?: {
    instId: string;
    bar: string;
    candles: number;
    results?: BacktestResult[];
    top?: BacktestResult[];
    selected?: BacktestResult;
    chartCandles?: BacktestCandle[];
    tradePoints?: BacktestTradePoint[];
  };
  positions: Position[];
};

const emptyState: SimState = {
  apiConfig: { apiKey: '', secretKey: '', passphrase: '' },
  riskConfig: { maxPositionPct: 5, maxDailyLossPct: 3, maxConsecutiveLosses: 3 },
  strategyConfig: { enabled: false, entrySide: 'buy', stopLossPct: 1, trailingDrawdownPct: 2, lastSignal: 'hold' },
  equity: 0,
  availableMargin: 0,
  dailyPnl: 0,
  drawdownPct: 0,
  strategyStatus: 'idle',
  currencyMode: 'USD',
  balanceDetails: [],
  orderHistory: [],
  raw: {},
  positions: [],
};

export default function HomePage() {
  const [state, setState] = useState<SimState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [apiForm, setApiForm] = useState(emptyState.apiConfig);
  const [riskForm, setRiskForm] = useState(emptyState.riskConfig);
  const [tradeForm, setTradeForm] = useState({ symbol: 'BTC-USDT-SWAP', side: 'buy', leverage: 3, notional: 100 });
  const [strategyForm, setStrategyForm] = useState(emptyState.strategyConfig!);
  const [syncMode, setSyncMode] = useState<'demo' | 'live'>('demo');
  const [testing, setTesting] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [backtestTop, setBacktestTop] = useState<BacktestResult[]>([]);
  const [backtestCandles, setBacktestCandles] = useState(0);
  const [selectedBacktestKey, setSelectedBacktestKey] = useState('');
  const [backtestSort, setBacktestSort] = useState<'return' | 'drawdown' | 'winRate'>('return');
  const [backtestChartCandles, setBacktestChartCandles] = useState<BacktestCandle[]>([]);
  const [backtestTradePoints, setBacktestTradePoints] = useState<BacktestTradePoint[]>([]);

  async function refreshState() {
    const res = await fetch('/api/sim');
    const data: SimState = await res.json();
    setState(data);
    setApiForm(data.apiConfig);
    setRiskForm(data.riskConfig);
    setStrategyForm(data.strategyConfig ?? emptyState.strategyConfig!);
    setBacktestResults(data.backtest?.results ?? []);
    setBacktestTop(data.backtest?.top ?? []);
    setBacktestCandles(data.backtest?.candles ?? 0);
    setBacktestChartCandles(data.backtest?.chartCandles ?? []);
    setBacktestTradePoints(data.backtest?.tradePoints ?? []);
    setSelectedBacktestKey(data.backtest?.selected ? `${data.backtest.selected.stopLossPct}-${data.backtest.selected.trailingDrawdownPct}` : '');
    setLoading(false);
  }

  async function syncLiveState(mode: 'demo' | 'live' = syncMode) {
    setError('');
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message || '同步 OKX 数据失败');
      return;
    }
    setSyncMode(mode);
    setState(data.state);
    setMessage(mode === 'live' ? '已同步 OKX 真实盘原始接口数据。' : '已同步 OKX 模拟盘原始接口数据。');
  }

  useEffect(() => {
    refreshState();
  }, []);

  async function testConnection(mode: 'demo' | 'live') {
    setTesting(true);
    setError('');
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || '连接测试失败');
        return;
      }
      setMessage(`${mode === 'live' ? '真实盘' : '模拟盘'}连接成功。totalEq=${data.result.totalEq}, availableBalance=${data.result.availableBalance}`);
    } finally {
      setTesting(false);
    }
  }

  async function saveApiConfig() {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiForm),
    });
    const data: SimState = await res.json();
    setState(data);
    setError('');
    setMessage('API 配置已保存到服务端内存。');
  }

  async function saveRiskConfig() {
    const res = await fetch('/api/risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(riskForm),
    });
    const data: SimState = await res.json();
    setState(data);
    setError('');
    setMessage('风控参数已更新。');
  }

  async function runBacktest() {
    setBacktesting(true);
    setError('');
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instId: 'RAVE-USDT-SWAP' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || '回测失败');
        return;
      }
      const top = data.top || [];
      setBacktestResults(data.results || []);
      setBacktestTop(top);
      setBacktestCandles(Number(data.candles || 0));
      setSelectedBacktestKey(top[0] ? `${top[0].stopLossPct}-${top[0].trailingDrawdownPct}` : '');
      setMessage(`RAVE-USDT-SWAP 回测完成，样本 ${data.candles} 根 1H K 线。`);
      if (top[0]) {
        await loadBacktestDetail(top[0].stopLossPct, top[0].trailingDrawdownPct);
      }
    } finally {
      setBacktesting(false);
    }
  }

  async function loadBacktestDetail(stopLossPct: number, trailingDrawdownPct: number) {
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'detail',
        instId: 'RAVE-USDT-SWAP',
        stopLossPct,
        trailingDrawdownPct,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message || '加载回测图失败');
      return;
    }
    setBacktestChartCandles(data.candles || []);
    setBacktestTradePoints(data.tradePoints || []);
  }

  function applyBacktestParams(result: BacktestResult) {
    setStrategyForm((prev) => ({
      ...prev,
      stopLossPct: result.stopLossPct,
      trailingDrawdownPct: result.trailingDrawdownPct,
    }));
    setSelectedBacktestKey(`${result.stopLossPct}-${result.trailingDrawdownPct}`);
    setMessage(`已将回测参数带入策略表单: 止损 ${result.stopLossPct}% , 回撤卖出 ${result.trailingDrawdownPct}%。`);
    loadBacktestDetail(result.stopLossPct, result.trailingDrawdownPct);
  }

  async function saveStrategyConfig() {
    const res = await fetch('/api/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(strategyForm),
    });
    const data = await res.json();
    setStrategyForm(data);
    setState((prev) => ({ ...prev, strategyConfig: data }));
    setMessage('策略参数已保存。');
  }

  async function placeTrade() {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tradeForm),
    });
    const data: SimState = await res.json();
    setState(data);
    setError('');
    setMessage(`已提交模拟${tradeForm.side === 'buy' ? '开多' : '开空'}订单。`);
  }

  async function closeAll() {
    const res = await fetch('/api/trade', { method: 'DELETE' });
    const data: SimState = await res.json();
    setState(data);
    setError('');
    setMessage('已清空所有模拟持仓。');
  }

  const maskedApiKey = useMemo(() => {
    if (!state.apiConfig.apiKey) return '未配置';
    if (state.apiConfig.apiKey.length <= 6) return '******';
    return `${state.apiConfig.apiKey.slice(0, 3)}***${state.apiConfig.apiKey.slice(-3)}`;
  }, [state.apiConfig.apiKey]);

  const rawBalanceObj = state.raw?.accountBalance as { code?: string; msg?: string; data?: Array<{ totalEq?: string; adjEq?: string; details?: unknown[] }> } | undefined;
  const balanceTop = rawBalanceObj?.data?.[0];
  const rawBalance = JSON.stringify(state.raw?.accountBalance ?? {}, null, 2);
  const rawPositions = JSON.stringify(state.raw?.accountPositions ?? {}, null, 2);
  const rawOrders = JSON.stringify(state.raw?.ordersHistory ?? {}, null, 2);
  const sortedBacktestResults = [...(backtestResults.length ? backtestResults : backtestTop)].sort((a, b) => {
    if (backtestSort === 'drawdown') {
      return b.maxDrawdown - a.maxDrawdown || b.totalReturn - a.totalReturn;
    }
    if (backtestSort === 'winRate') {
      return b.winRate - a.winRate || b.totalReturn - a.totalReturn;
    }
    return b.totalReturn - a.totalReturn || b.winRate - a.winRate;
  });
  const bestBacktest = sortedBacktestResults[0];
  const selectedBacktest = sortedBacktestResults.find((r) => `${r.stopLossPct}-${r.trailingDrawdownPct}` === selectedBacktestKey);
  const chartCandles = backtestChartCandles.slice(-120);
  const chartWidth = 1100;
  const chartHeight = 360;
  const chartPad = 28;
  const minPrice = chartCandles.length ? Math.min(...chartCandles.map((c) => c.low)) : 0;
  const maxPrice = chartCandles.length ? Math.max(...chartCandles.map((c) => c.high)) : 1;
  const priceRange = Math.max(maxPrice - minPrice, 1);
  const candleGap = chartCandles.length ? (chartWidth - chartPad * 2) / chartCandles.length : 1;
  const candleBodyWidth = Math.max(2, candleGap * 0.58);
  const yOf = (price: number) => chartHeight - chartPad - ((price - minPrice) / priceRange) * (chartHeight - chartPad * 2);
  const xOf = (index: number) => chartPad + index * candleGap + candleGap / 2;
  const chartTrades = backtestTradePoints.filter((t) => chartCandles.some((c) => c.ts === t.entryTs) || chartCandles.some((c) => c.ts === t.exitTs));
  const equitySeries = backtestTradePoints.reduce<Array<{ idx: number; equity: number }>>((acc, trade, index) => {
    const prev = acc.length ? acc[acc.length - 1].equity : 1;
    acc.push({ idx: index, equity: prev * (1 + trade.ret) });
    return acc;
  }, []);
  const equityWidth = 1100;
  const equityHeight = 220;
  const equityPad = 24;
  const minEquity = equitySeries.length ? Math.min(1, ...equitySeries.map((p) => p.equity)) : 0;
  const maxEquity = equitySeries.length ? Math.max(1, ...equitySeries.map((p) => p.equity)) : 1;
  const equityRange = Math.max(maxEquity - minEquity, 0.0001);
  const equityPath = equitySeries.map((p, i) => {
    const x = equityPad + (i / Math.max(equitySeries.length - 1, 1)) * (equityWidth - equityPad * 2);
    const y = equityHeight - equityPad - ((p.equity - minEquity) / equityRange) * (equityHeight - equityPad * 2);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  return (
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="badge">OKX 原始接口面板</div>
          <h1 style={{ margin: '12px 0 8px', fontSize: 34 }}>合约交易控制台</h1>
          <div className="small">按你的要求，界面直接显示 OKX API 原始数据，不做任何换算。</div>
        </div>
        <div className="card" style={{ minWidth: 280 }}>
          <div className="small">策略状态</div>
          <div className={`kpi ${state.strategyStatus === 'running' ? 'good' : state.strategyStatus === 'paused' ? 'bad' : ''}`}>
            {loading ? '加载中' : state.strategyStatus === 'idle' ? '已待命' : state.strategyStatus === 'running' ? '运行中' : '已暂停'}
          </div>
          <div className="small">API Key: {maskedApiKey}</div>
          <div className="small">当前模式: {syncMode === 'live' ? '真实盘' : '模拟盘'}</div>
        </div>
      </div>

      {message ? <div className="card" style={{ marginBottom: 16 }}>{message}</div> : null}
      {error ? <div className="card bad" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="grid">
        <section className="card">
          <h2>API 配置</h2>
          <label>API Key</label>
          <input value={apiForm.apiKey} onChange={(e) => setApiForm({ ...apiForm, apiKey: e.target.value })} placeholder="okx-api-key" />
          <label style={{ marginTop: 12 }}>Secret Key</label>
          <input value={apiForm.secretKey} onChange={(e) => setApiForm({ ...apiForm, secretKey: e.target.value })} placeholder="okx-secret" type="password" />
          <label style={{ marginTop: 12 }}>Passphrase</label>
          <input value={apiForm.passphrase} onChange={(e) => setApiForm({ ...apiForm, passphrase: e.target.value })} placeholder="okx-passphrase" type="password" />
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={saveApiConfig}>保存配置</button>
            <button className="secondary" onClick={refreshState}>刷新本地状态</button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => syncLiveState('demo')}>同步模拟盘</button>
            <button className="secondary" onClick={() => syncLiveState('live')}>同步真实盘</button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => testConnection('demo')} disabled={testing}>{testing ? '测试中...' : '测试模拟盘连接'}</button>
            <button className="secondary" onClick={() => testConnection('live')} disabled={testing}>{testing ? '测试中...' : '测试真实盘连接'}</button>
          </div>
        </section>

        <section className="card">
          <h2>策略准备</h2>
          <div className="small">策略规则，买入后两种卖出条件满足任一即卖出。</div>
          <label style={{ marginTop: 12 }}>启用策略</label>
          <select value={strategyForm.enabled ? 'on' : 'off'} onChange={(e) => setStrategyForm({ ...strategyForm, enabled: e.target.value === 'on' })}>
            <option value="off">关闭</option>
            <option value="on">开启</option>
          </select>
          <label style={{ marginTop: 12 }}>买入后跌幅止损 (%)</label>
          <input value={strategyForm.stopLossPct} onChange={(e) => setStrategyForm({ ...strategyForm, stopLossPct: Number(e.target.value) })} />
          <label style={{ marginTop: 12 }}>相对最高价回撤卖出 (%)</label>
          <input value={strategyForm.trailingDrawdownPct} onChange={(e) => setStrategyForm({ ...strategyForm, trailingDrawdownPct: Number(e.target.value) })} />
          <div className="small" style={{ marginTop: 12 }}>规则: 1) 跌破买入价 {strategyForm.stopLossPct}% 卖出, 2) 从买入后最高价回撤 {strategyForm.trailingDrawdownPct}% 卖出。</div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={saveStrategyConfig}>保存策略</button>
            <button className="secondary" onClick={runBacktest}>{backtesting ? '回测中...' : '回测 RAVE 策略'}</button>
          </div>
        </section>

        <section className="card">
          <h2>OKX 官方关键字段</h2>
          <div className="small">这些值直接来自接口，不做任何换算。</div>
          <div className="row" style={{ marginTop: 16 }}>
            <div>
              <div className="small">totalEq</div>
              <div className="kpi">{balanceTop?.totalEq ?? '-'}</div>
            </div>
            <div>
              <div className="small">adjEq</div>
              <div className="kpi">{balanceTop?.adjEq ?? '-'}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <div>
              <div className="small">availableBalance (parsed)</div>
              <div className="kpi">{formatNumber(state.availableMargin, 8)}</div>
            </div>
            <div>
              <div className="small">details count</div>
              <div className="kpi">{balanceTop?.details?.length ?? 0}</div>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>RAVE 策略回测结果</h2>
        <div className="small">样本: {backtestCandles || 0} 根 1H K 线。只用于测试，不代表实盘表现。</div>
        <div className="row" style={{ marginTop: 12, alignItems: 'end' }}>
          <div>
            <label>排序方式</label>
            <select value={backtestSort} onChange={(e) => setBacktestSort(e.target.value as 'return' | 'drawdown' | 'winRate')}>
              <option value="return">收益优先</option>
              <option value="drawdown">回撤优先</option>
              <option value="winRate">胜率优先</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <div className="small">当前最优候选</div>
            <div className="kpi">{bestBacktest ? `${bestBacktest.stopLossPct}% / ${bestBacktest.trailingDrawdownPct}%` : '-'}</div>
            <div className="small">总收益 {bestBacktest ? `${formatNumber(bestBacktest.totalReturn * 100, 2)}%` : '-'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="small">当前选中参数</div>
            <div className="kpi">{selectedBacktest ? `${selectedBacktest.stopLossPct}% / ${selectedBacktest.trailingDrawdownPct}%` : '-'}</div>
            <div className="small">最大回撤 {selectedBacktest ? `${formatNumber(selectedBacktest.maxDrawdown * 100, 2)}%` : '-'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="small">当前策略表单</div>
            <div className="kpi">{strategyForm.stopLossPct}% / {strategyForm.trailingDrawdownPct}%</div>
            <div className="small">可直接保存为默认参数</div>
          </div>
        </div>
        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>止损 %</th>
              <th>回撤卖出 %</th>
              <th>交易次数</th>
              <th>胜率</th>
              <th>总收益</th>
              <th>最大回撤</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedBacktestResults.length ? sortedBacktestResults.map((r) => {
              const key = `${r.stopLossPct}-${r.trailingDrawdownPct}`;
              const isSelected = key === selectedBacktestKey;
              return (
                <tr key={key} style={isSelected ? { background: 'rgba(96, 165, 250, 0.12)' } : undefined}>
                  <td>{r.stopLossPct}</td>
                  <td>{r.trailingDrawdownPct}</td>
                  <td>{r.trades}</td>
                  <td>{formatNumber(r.winRate * 100, 2)}%</td>
                  <td>{formatNumber(r.totalReturn * 100, 2)}%</td>
                  <td>{formatNumber(r.maxDrawdown * 100, 2)}%</td>
                  <td><button className="secondary" onClick={() => applyBacktestParams(r)}>{isSelected ? '已选中' : '应用到策略'}</button></td>
                </tr>
              );
            }) : (
              <tr><td colSpan={7} className="small">还没有回测结果，点“回测 RAVE 策略”即可。</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>回测 K 线与买卖点</h2>
        <div className="small">显示最近 120 根 1H K 线。绿色三角是买点，红色三角是卖点。</div>
        {chartCandles.length ? (
          <div className="chartWrap" style={{ marginTop: 16 }}>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="backtestChart" role="img" aria-label="Backtest candle chart">
              <line x1={chartPad} y1={chartPad} x2={chartPad} y2={chartHeight - chartPad} stroke="rgba(159,176,208,0.35)" />
              <line x1={chartPad} y1={chartHeight - chartPad} x2={chartWidth - chartPad} y2={chartHeight - chartPad} stroke="rgba(159,176,208,0.35)" />
              {chartCandles.map((c, index) => {
                const x = xOf(index);
                const openY = yOf(c.open);
                const closeY = yOf(c.close);
                const highY = yOf(c.high);
                const lowY = yOf(c.low);
                const up = c.close >= c.open;
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
                return (
                  <g key={c.ts}>
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={up ? '#35d07f' : '#ff6b81'} strokeWidth="1.2" />
                    <rect x={x - candleBodyWidth / 2} y={bodyTop} width={candleBodyWidth} height={bodyHeight} fill={up ? '#35d07f' : '#ff6b81'} opacity="0.92" />
                  </g>
                );
              })}
              {chartTrades.map((t, idx) => {
                const entryIndex = chartCandles.findIndex((c) => c.ts === t.entryTs);
                const exitIndex = chartCandles.findIndex((c) => c.ts === t.exitTs);
                const ex = entryIndex >= 0 ? xOf(entryIndex) : null;
                const ey = yOf(t.entryPrice);
                const xx = exitIndex >= 0 ? xOf(exitIndex) : null;
                const xy = yOf(t.exitPrice);
                const entryTitle = `买入\n时间: ${new Date(t.entryTs).toLocaleString('zh-CN', { hour12: false })}\n价格: ${formatNumber(t.entryPrice, 8)}`;
                const exitTitle = `卖出\n时间: ${new Date(t.exitTs).toLocaleString('zh-CN', { hour12: false })}\n价格: ${formatNumber(t.exitPrice, 8)}\n收益: ${formatNumber(t.ret * 100, 2)}%\n原因: ${t.reason === 'stop_loss' ? '止损卖出' : '回撤卖出'}`;
                return (
                  <g key={`${t.entryTs}-${t.exitTs}-${idx}`}>
                    {ex != null ? (
                      <polygon points={`${ex},${ey - 10} ${ex - 7},${ey + 4} ${ex + 7},${ey + 4}`} fill="#60a5fa">
                        <title>{entryTitle}</title>
                      </polygon>
                    ) : null}
                    {xx != null ? (
                      <polygon points={`${xx},${xy + 10} ${xx - 7},${xy - 4} ${xx + 7},${xy - 4}`} fill={t.reason === 'stop_loss' ? '#ff6b81' : '#f5b942'}>
                        <title>{exitTitle}</title>
                      </polygon>
                    ) : null}
                    {ex != null && xx != null ? <line x1={ex} y1={ey} x2={xx} y2={xy} stroke="rgba(96,165,250,0.28)" strokeDasharray="4 4" /> : null}
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 12 }}>先运行回测，或从结果表里选择一组参数。</div>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <div className="small">买点数: {chartTrades.length}</div>
          <div className="small">卖点数: {chartTrades.length}</div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>回测资金曲线</h2>
        <div className="small">从 1.0 初始资金开始，按每笔交易收益连续复利，方便看策略过程是否平滑。</div>
        {equitySeries.length ? (
          <div className="chartWrap" style={{ marginTop: 16 }}>
            <svg viewBox={`0 0 ${equityWidth} ${equityHeight}`} className="backtestChart" role="img" aria-label="Backtest equity curve">
              <line x1={equityPad} y1={equityPad} x2={equityPad} y2={equityHeight - equityPad} stroke="rgba(159,176,208,0.35)" />
              <line x1={equityPad} y1={equityHeight - equityPad} x2={equityWidth - equityPad} y2={equityHeight - equityPad} stroke="rgba(159,176,208,0.35)" />
              <path d={equityPath} fill="none" stroke="#60a5fa" strokeWidth="2.5" />
            </svg>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 12 }}>暂无资金曲线，请先运行回测。</div>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>回测交易过程明细</h2>
        <div className="small">逐笔检查买点、卖点、收益和卖出原因，更容易判断这套规则是否合理。</div>
        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>买入时间</th>
              <th>买入价</th>
              <th>卖出时间</th>
              <th>卖出价</th>
              <th>收益率</th>
              <th>卖出原因</th>
            </tr>
          </thead>
          <tbody>
            {backtestTradePoints.length ? backtestTradePoints.slice(-40).reverse().map((t, idx) => (
              <tr key={`${t.entryTs}-${t.exitTs}-${idx}`}>
                <td>{new Date(t.entryTs).toLocaleString('zh-CN', { hour12: false })}</td>
                <td>{formatNumber(t.entryPrice, 8)}</td>
                <td>{new Date(t.exitTs).toLocaleString('zh-CN', { hour12: false })}</td>
                <td>{formatNumber(t.exitPrice, 8)}</td>
                <td className={t.ret >= 0 ? 'good' : 'bad'}>{formatNumber(t.ret * 100, 2)}%</td>
                <td>{t.reason === 'stop_loss' ? '止损卖出' : '回撤卖出'}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="small">暂无交易过程，请先运行回测。</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>账户资产明细（接口解析）</h2>
        <table className="table">
          <thead>
            <tr>
              <th>币种</th>
              <th>eq</th>
              <th>cashBal</th>
              <th>availBal</th>
            </tr>
          </thead>
          <tbody>
            {(state.balanceDetails || []).length ? state.balanceDetails!.map((item) => (
              <tr key={item.ccy}>
                <td>{item.ccy}</td>
                <td>{formatNumber(item.equity, 10)}</td>
                <td>{formatNumber(item.cashBalance, 10)}</td>
                <td>{formatNumber(item.availableBalance, 10)}</td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="small">暂无资产明细</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>持仓（接口解析）</h2>
        <table className="table">
          <thead>
            <tr>
              <th>合约</th>
              <th>方向</th>
              <th>杠杆</th>
              <th>数量</th>
              <th>notionalUsd</th>
              <th>margin</th>
              <th>upl</th>
              <th>avgPx</th>
              <th>markPx</th>
              <th>uplRatio(%)</th>
            </tr>
          </thead>
          <tbody>
            {state.positions.length ? state.positions.map((p) => (
              <tr key={p.id}>
                <td>{p.symbol}</td>
                <td>{p.side}</td>
                <td>{p.leverage}x</td>
                <td>{p.quantity ?? '-'}</td>
                <td>{formatNumber(p.notional, 10)}</td>
                <td>{formatNumber(p.marginUsed ?? 0, 10)}</td>
                <td>{formatNumber(p.unrealizedPnl ?? 0, 10)}</td>
                <td>{formatNumber(p.entryPrice, 10)}</td>
                <td>{formatNumber(p.markPrice, 10)}</td>
                <td>{formatNumber(p.pnlPct, 4)}</td>
              </tr>
            )) : (
              <tr><td colSpan={10} className="small">暂无持仓</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>订单历史（接口解析）</h2>
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>合约</th>
              <th>方向</th>
              <th>类型</th>
              <th>状态</th>
              <th>价格</th>
              <th>数量</th>
              <th>已成交</th>
            </tr>
          </thead>
          <tbody>
            {(state.orderHistory || []).length ? state.orderHistory!.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                <td>{o.symbol}</td>
                <td>{o.side}</td>
                <td>{o.orderType}</td>
                <td>{o.state}</td>
                <td>{formatNumber(o.price, 10)}</td>
                <td>{formatNumber(o.size, 10)}</td>
                <td>{formatNumber(o.filledSize, 10)}</td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="small">暂无订单历史</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>OKX 原始返回: /api/v5/account/balance</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', fontSize: 12 }}>{rawBalance}</pre>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>OKX 原始返回: /api/v5/account/positions</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', fontSize: 12 }}>{rawPositions}</pre>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>OKX 原始返回: /api/v5/trade/orders-history-archive</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', fontSize: 12 }}>{rawOrders}</pre>
      </section>
    </main>
  );
}
