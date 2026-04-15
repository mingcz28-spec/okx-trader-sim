'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type BacktestBar = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';

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
  const [appMode, setAppMode] = useState<'market' | 'backtest' | 'realtime'>('backtest');
  const [testing, setTesting] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [backtestTop, setBacktestTop] = useState<BacktestResult[]>([]);
  const [backtestCandles, setBacktestCandles] = useState(0);
  const [selectedBacktestKey, setSelectedBacktestKey] = useState('');
  const [backtestSort, setBacktestSort] = useState<'return' | 'drawdown' | 'winRate'>('return');
  const [backtestChartCandles, setBacktestChartCandles] = useState<BacktestCandle[]>([]);
  const [backtestTradePoints, setBacktestTradePoints] = useState<BacktestTradePoint[]>([]);
  const [backtestBar, setBacktestBar] = useState<BacktestBar>('1H');
  const [chartWindow, setChartWindow] = useState<20 | 60 | 120>(20);
  const [mobileTab, setMobileTab] = useState<'backtest' | 'account' | 'raw'>('backtest');
  const [selectedTrade, setSelectedTrade] = useState<BacktestTradePoint | null>(null);
  const [focusedCandleIndex, setFocusedCandleIndex] = useState<number | null>(null);
  const [showBacktestResults, setShowBacktestResults] = useState(false);
  const [showEquityCurve, setShowEquityCurve] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const backtestResultRef = useRef<HTMLElement | null>(null);

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
    setBacktestBar((data.backtest?.bar as BacktestBar) ?? '1H');
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

  async function runBacktest(bar: BacktestBar = backtestBar) {
    setBacktesting(true);
    setError('');
    setMessage('正在回测 RAVE 策略，请稍等...');
    setMobileTab('backtest');
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instId: 'RAVE-USDT-SWAP', bar }),
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
      setShowBacktestResults(true);
      setSelectedBacktestKey(top[0] ? `${top[0].stopLossPct}-${top[0].trailingDrawdownPct}` : '');
      if (top[0]) {
        await loadBacktestDetail(top[0].stopLossPct, top[0].trailingDrawdownPct, (data.bar as BacktestBar) || bar);
        setBacktestBar((data.bar as BacktestBar) || bar);
        setMessage(`回测完成，共 ${data.results?.length || top.length || 0} 组结果，已自动选中 ${top[0].stopLossPct}% / ${top[0].trailingDrawdownPct}%，周期 ${(data.bar as BacktestBar) || bar}。`);
      } else {
        setBacktestBar((data.bar as BacktestBar) || bar);
        setMessage(`回测完成，但暂时没有可用结果。样本 ${data.candles} 根 ${(data.bar as BacktestBar) || bar} K 线。`);
      }
      setTimeout(() => {
        backtestResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } finally {
      setBacktesting(false);
    }
  }

  async function loadBacktestDetail(stopLossPct: number, trailingDrawdownPct: number, bar: BacktestBar = backtestBar) {
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'detail',
        instId: 'RAVE-USDT-SWAP',
        stopLossPct,
        trailingDrawdownPct,
        bar,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message || '加载回测图失败');
      return;
    }
    setBacktestChartCandles(data.candles || []);
    setBacktestTradePoints(data.tradePoints || []);
    setBacktestBar((data.bar as BacktestBar) || bar);
  }

  function applyBacktestParams(result: BacktestResult) {
    setStrategyForm((prev) => ({
      ...prev,
      stopLossPct: result.stopLossPct,
      trailingDrawdownPct: result.trailingDrawdownPct,
    }));
    setSelectedBacktestKey(`${result.stopLossPct}-${result.trailingDrawdownPct}`);
    setMessage(`已切换到 ${result.stopLossPct}% / ${result.trailingDrawdownPct}%，图表和交易明细正在更新。`);
    setMobileTab('backtest');
    setShowBacktestResults(true);
    loadBacktestDetail(result.stopLossPct, result.trailingDrawdownPct, backtestBar);
    setTimeout(() => {
      backtestResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  async function changeBacktestBar(nextBar: BacktestBar) {
    if (nextBar === backtestBar || backtesting) return;
    setBacktestBar(nextBar);
    setMessage(`正在切换到 ${nextBar} 周期并重新回测...`);
    if (selectedBacktest) {
      setBacktesting(true);
      setError('');
      try {
        const gridRes = await fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instId: 'RAVE-USDT-SWAP', bar: nextBar }),
        });
        const gridData = await gridRes.json();
        if (!gridRes.ok || !gridData.ok) {
          setError(gridData.message || '切换周期失败');
          return;
        }
        const results = gridData.results || [];
        const top = gridData.top || [];
        setBacktestResults(results);
        setBacktestTop(top);
        setBacktestCandles(Number(gridData.candles || 0));
        const matched = results.find((r: BacktestResult) => r.stopLossPct === selectedBacktest.stopLossPct && r.trailingDrawdownPct === selectedBacktest.trailingDrawdownPct) || top[0];
        if (matched) {
          setSelectedBacktestKey(`${matched.stopLossPct}-${matched.trailingDrawdownPct}`);
          await loadBacktestDetail(matched.stopLossPct, matched.trailingDrawdownPct, nextBar);
        } else {
          setBacktestChartCandles([]);
          setBacktestTradePoints([]);
          setSelectedBacktestKey('');
        }
        setMessage(`已切换到 ${nextBar} 周期。`);
      } finally {
        setBacktesting(false);
      }
      return;
    }
    await runBacktest(nextBar);
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
  const chartCandles = backtestChartCandles.slice(-chartWindow);
  const focusedCandle = focusedCandleIndex != null ? chartCandles[focusedCandleIndex] : null;
  const latestCandle = focusedCandle ?? chartCandles[chartCandles.length - 1];
  const latestChangePct = latestCandle ? ((latestCandle.close - latestCandle.open) / Math.max(latestCandle.open, 1e-9)) * 100 : 0;
  const chartWidth = 1180;
  const chartHeight = 460;
  const chartPadLeft = 60;
  const chartPadRight = 86;
  const chartPadTop = 26;
  const chartPadBottom = 46;
  const rawMinPrice = chartCandles.length ? Math.min(...chartCandles.map((c) => c.low)) : 0;
  const rawMaxPrice = chartCandles.length ? Math.max(...chartCandles.map((c) => c.high)) : 1;
  const rawPriceRange = Math.max(rawMaxPrice - rawMinPrice, 0.00000001);
  const paddedMinPrice = rawMinPrice - rawPriceRange * 0.05;
  const paddedMaxPrice = rawMaxPrice + rawPriceRange * 0.05;
  const minPrice = Math.max(0, paddedMinPrice);
  const maxPrice = paddedMaxPrice;
  const priceRange = Math.max(maxPrice - minPrice, 1e-9);
  const plotWidth = chartWidth - chartPadLeft - chartPadRight;
  const plotHeight = chartHeight - chartPadTop - chartPadBottom;
  const candleGap = chartCandles.length ? plotWidth / chartCandles.length : 1;
  const candleBodyWidth = Math.max(2, candleGap * 0.58);
  const yOf = (price: number) => chartHeight - chartPadBottom - ((price - minPrice) / priceRange) * plotHeight;
  const xOf = (index: number) => chartPadLeft + index * candleGap + candleGap / 2;
  const chartTrades = backtestTradePoints.filter((t) => chartCandles.some((c) => c.ts === t.entryTs) || chartCandles.some((c) => c.ts === t.exitTs));
  const focusedTrade = focusedCandle ? chartTrades.find((t) => t.entryTs === focusedCandle.ts || t.exitTs === focusedCandle.ts) : null;
  const chartPriceTicks = chartCandles.length ? [maxPrice, minPrice + priceRange * 0.75, minPrice + priceRange * 0.5, minPrice + priceRange * 0.25, minPrice] : [];
  const chartDateTicks = chartCandles.length
    ? chartCandles.reduce<number[]>((acc, candle, index) => {
        const dayKey = new Date(candle.ts).toLocaleDateString('zh-CN');
        const prevKey = index > 0 ? new Date(chartCandles[index - 1].ts).toLocaleDateString('zh-CN') : null;
        if (index === 0 || dayKey !== prevKey) acc.push(index);
        return acc;
      }, [])
    : [];
  const focusX = focusedCandleIndex != null ? xOf(focusedCandleIndex) : null;
  const candleRangeSeries = chartCandles.map((c) => ({
    ts: c.ts,
    range: c.high - c.low,
    up: c.close >= c.open,
  }));
  const maxCandleRange = candleRangeSeries.length ? Math.max(...candleRangeSeries.map((c) => c.range), 1e-9) : 1;
  const equitySeries = backtestTradePoints.reduce<Array<{ idx: number; equity: number }>>((acc, trade, index) => {
    const prev = acc.length ? acc[acc.length - 1].equity : 1;
    acc.push({ idx: index, equity: prev * (1 + trade.ret) });
    return acc;
  }, []);
  const equityWidth = 1100;
  const equityHeight = 260;
  const equityPad = 48;
  const minEquity = equitySeries.length ? Math.min(1, ...equitySeries.map((p) => p.equity)) : 0;
  const maxEquity = equitySeries.length ? Math.max(1, ...equitySeries.map((p) => p.equity)) : 1;
  const equityRange = Math.max(maxEquity - minEquity, 0.0001);
  const equityPath = equitySeries.map((p, i) => {
    const x = equityPad + (i / Math.max(equitySeries.length - 1, 1)) * (equityWidth - equityPad * 2);
    const y = equityHeight - equityPad - ((p.equity - minEquity) / equityRange) * (equityHeight - equityPad * 2);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const equityTicks = equitySeries.length ? [maxEquity, minEquity + equityRange * 0.66, minEquity + equityRange * 0.33, minEquity] : [];
  const equityXLabels = equitySeries.length ? [0, Math.floor((equitySeries.length - 1) / 2), equitySeries.length - 1] : [];

  return (
    <main>
      <div className="marketStrip">
        <div className="marketChip">
          <span>可用余额</span>
          <strong>{formatNumber(state.availableMargin, 4)}</strong>
        </div>
        <div className="marketChip">
          <span>状态</span>
          <strong className={state.strategyStatus === 'running' ? 'good' : state.strategyStatus === 'paused' ? 'bad' : ''}>{loading ? '加载中' : state.strategyStatus === 'idle' ? '已待命' : state.strategyStatus === 'running' ? '运行中' : '已暂停'}</strong>
        </div>
        <div className="marketChip">
          <span>模式</span>
          <strong>{appMode === 'market' ? '真实盘口' : appMode === 'backtest' ? '策略回测' : '实时策略'}</strong>
        </div>
        <div className="marketChip">
          <span>标的</span>
          <strong>RAVE-USDT-SWAP</strong>
        </div>
      </div>
      <div className="hero okxHero">
        <div>
          <div className="badge">M狙击手</div>
          <div className="deployVersionTag">版本 2026-04-14 / 23:01 / v0.3.3</div>
          <h1 className="heroTitle">M狙击手操作界面</h1>
          <div className="small">用数据说话，以数据制定策略。</div>
          <div className="modeOverviewStrip" style={{ marginTop: 14 }}>
            <div className={appMode === 'market' ? 'modeOverviewItem active' : 'modeOverviewItem'}>
              <strong>真实盘口</strong>
              <span>资金、持仓、账户状态</span>
            </div>
            <div className={appMode === 'backtest' ? 'modeOverviewItem active' : 'modeOverviewItem'}>
              <strong>策略回测</strong>
              <span>参数测试、结果排序、图表验证</span>
            </div>
            <div className={appMode === 'realtime' ? 'modeOverviewItem active' : 'modeOverviewItem'}>
              <strong>实时策略</strong>
              <span>实时信号、收益跟踪、动态执行</span>
            </div>
          </div>
          <div className="modeSelectorRow" style={{ marginTop: 14 }}>
            <button className={appMode === 'market' ? 'modeSwitchBtn active' : 'modeSwitchBtn'} onClick={() => setAppMode('market')}>真实盘口</button>
            <button className={appMode === 'backtest' ? 'modeSwitchBtn active' : 'modeSwitchBtn'} onClick={() => setAppMode('backtest')}>策略回测</button>
            <button className={appMode === 'realtime' ? 'modeSwitchBtn active' : 'modeSwitchBtn'} onClick={() => setAppMode('realtime')}>实时策略</button>
          </div>
        </div>
        <div className="card statusCard compactStatusCard">
          <div className="statusRow"><span className="small">连接状态</span><strong className={loading ? '' : 'good'}>{loading ? '加载中' : '已连接'}</strong></div>
          <div className="statusRow"><span className="small">API Key</span><strong>{maskedApiKey}</strong></div>
          <div className="statusRow"><span className="small">当前模式</span><strong>{appMode === 'market' ? '真实盘口' : appMode === 'backtest' ? '策略回测' : '实时策略'}</strong></div>
        </div>
      </div>

      <section className="card panelCard changelogCard" style={{ marginBottom: 16 }}>
        <div className="collapseBar">
          <div>
            <div className="sectionTag">更新日志</div>
            <h2 style={{ margin: 0 }}>版本记录</h2>
            <div className="small">当前版本 v0.3.3，可随时查看最近迭代内容。</div>
          </div>
          <button className="secondary collapseBtn" onClick={() => setShowChangelog((v) => !v)}>{showChangelog ? '收起日志' : '展开日志'}</button>
        </div>
        {showChangelog ? (
          <div className="changelogList" style={{ marginTop: 16 }}>
            <div className="changelogItem">
              <strong>v0.3.3 - 2026-04-14 23:01</strong>
              <div className="small">实时策略页升级为独立执行界面骨架，新增执行总览、实时信号、执行日志三块区域。</div>
            </div>
            <div className="changelogItem">
              <strong>v0.3.2 - 2026-04-14 22:45</strong>
              <div className="small">页面内新增可展开更新日志面板，方便直接查看迭代记录。</div>
            </div>
            <div className="changelogItem">
              <strong>v0.3.1 - 2026-04-14 22:37</strong>
              <div className="small">修复三模式串页，修正桌面端显示逻辑，更新页面版本标记。</div>
            </div>
            <div className="changelogItem">
              <strong>v0.3.0 - 2026-04-14 22:29</strong>
              <div className="small">真实盘口整理为账户 / 持仓 / 委托三段式结构。</div>
            </div>
            <div className="changelogItem">
              <strong>v0.2.8 - 2026-04-14 22:18</strong>
              <div className="small">明确分离真实盘口、策略回测、实时策略三种页面职责。</div>
            </div>
            <div className="changelogItem">
              <strong>完整日志</strong>
              <div className="small">查看文件：okx-trader-sim/CHANGELOG.md</div>
            </div>
          </div>
        ) : null}
      </section>

      {message ? <div className="card flashCard" style={{ marginBottom: 16 }}>{message}</div> : null}
      {error ? <div className="card bad" style={{ marginBottom: 16 }}>{error}</div> : null}

      <nav className="mobileTabs appModeTabs">
        <button className={appMode === 'market' ? 'mobileTab active' : 'mobileTab'} onClick={() => setAppMode('market')}>真实盘口</button>
        <button className={appMode === 'backtest' ? 'mobileTab active' : 'mobileTab'} onClick={() => setAppMode('backtest')}>策略回测</button>
        <button className={appMode === 'realtime' ? 'mobileTab active' : 'mobileTab'} onClick={() => setAppMode('realtime')}>实时策略</button>
      </nav>

      <div className="mobileSection" data-tab="account" data-active={appMode === 'market'}>
        <section className="card pageModeIntroCard" style={{ marginTop: 16 }}>
          <div className="sectionTag">真实盘口</div>
          <h2 style={{ marginTop: 0 }}>真实盘口操作界面</h2>
          <div className="small">只看账户资金、持仓、委托和连接状态，不混入回测结果。</div>
        </section>
        <section className="card panelCard marketModeHeroCard" style={{ marginTop: 16 }}>
          <div className="panelHeader"><div><div className="sectionTag">账户总览</div><h2>账户 / 持仓 / 委托</h2></div></div>
          <div className="modeHeroStats">
            <div className="heroStatBox">
              <span>账户权益</span>
              <strong>{balanceTop?.totalEq ?? '-'}</strong>
            </div>
            <div className="heroStatBox">
              <span>可用余额</span>
              <strong>{formatNumber(state.availableMargin, 8)}</strong>
            </div>
            <div className="heroStatBox">
              <span>当前持仓</span>
              <strong>{state.positions.length}</strong>
            </div>
            <div className="heroStatBox">
              <span>历史委托</span>
              <strong>{(state.orderHistory || []).length}</strong>
            </div>
          </div>
        </section>
        <div className="grid modePageGrid marketModeGrid" style={{ marginTop: 16 }}>
        <section className="card panelCard marketConnectCard">
          <div className="panelHeader"><div><div className="sectionTag">连接</div><h2>账户连接与同步</h2></div></div>
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

        <section className="card panelCard marketOverviewCard">
          <div className="panelHeader"><div><div className="sectionTag">账户概览</div><h2>账户核心数据</h2></div></div>
          <div className="small">这些数值直接来自交易所返回结果，不做额外换算。</div>
          <div className="modeHeroStats" style={{ marginTop: 16 }}>
            <div className="heroStatBox">
              <span>账户权益</span>
              <strong>{balanceTop?.totalEq ?? '-'}</strong>
            </div>
            <div className="heroStatBox">
              <span>调整后权益</span>
              <strong>{balanceTop?.adjEq ?? '-'}</strong>
            </div>
            <div className="heroStatBox">
              <span>可用余额</span>
              <strong>{formatNumber(state.availableMargin, 8)}</strong>
            </div>
            <div className="heroStatBox">
              <span>资产项数量</span>
              <strong>{balanceTop?.details?.length ?? 0}</strong>
            </div>
          </div>
        </section>
        <section className="card panelCard marketSyncCard">
          <div className="panelHeader"><div><div className="sectionTag">交易状态</div><h2>同步与连接状态</h2></div></div>
          <div className="statusRow"><span className="small">连接状态</span><strong>{loading ? '加载中' : '已连接'}</strong></div>
          <div className="statusRow"><span className="small">同步模式</span><strong>{syncMode === 'live' ? '真实盘' : '模拟盘'}</strong></div>
          <div className="statusRow"><span className="small">资产项数量</span><strong>{balanceTop?.details?.length ?? 0}</strong></div>
          <div className="statusRow"><span className="small">数据来源</span><strong>OKX 原始返回</strong></div>
        </section>
        </div>
      </div>

      <div className="mobileSection" data-tab="backtest" data-active={appMode === 'backtest'}>
      <section className="card pageModeIntroCard" style={{ marginTop: 16 }}>
        <div className="sectionTag">策略回测</div>
        <h2 style={{ marginTop: 0 }}>策略回测主界面</h2>
        <div className="small">先定策略，再调参数，再跑回测，用结果决定是否进入实时策略。</div>
      </section>

      <section className="card panelCard backtestControlHero" style={{ marginTop: 16 }}>
        <div className="panelHeader"><div><div className="sectionTag">策略控制</div><h2>回测参数与执行控制</h2></div></div>
        <div className="modeHeroStats">
          <div className="heroStatBox">
            <span>策略类型</span>
            <strong>买入 / 卖出</strong>
          </div>
          <div className="heroStatBox">
            <span>当前参数</span>
            <strong>{strategyForm.stopLossPct}% / {strategyForm.trailingDrawdownPct}%</strong>
          </div>
          <div className="heroStatBox">
            <span>较优组合</span>
            <strong>{bestBacktest ? `${bestBacktest.stopLossPct}% / ${bestBacktest.trailingDrawdownPct}%` : '-'}</strong>
          </div>
          <div className="heroStatBox">
            <span>样本数量</span>
            <strong>{backtestCandles || 0}</strong>
          </div>
        </div>
        <div className="grid modePageGrid" style={{ marginTop: 16 }}>
          <section className="subPanelCard">
            <div className="small">策略参数</div>
            <label style={{ marginTop: 12 }}>止损比例 (%)</label>
            <input value={strategyForm.stopLossPct} onChange={(e) => setStrategyForm({ ...strategyForm, stopLossPct: Number(e.target.value) })} />
            <label style={{ marginTop: 12 }}>回撤卖出比例 (%)</label>
            <input value={strategyForm.trailingDrawdownPct} onChange={(e) => setStrategyForm({ ...strategyForm, trailingDrawdownPct: Number(e.target.value) })} />
            <label style={{ marginTop: 12 }}>策略开关</label>
            <select value={strategyForm.enabled ? 'on' : 'off'} onChange={(e) => setStrategyForm({ ...strategyForm, enabled: e.target.value === 'on' })}>
              <option value="off">关闭</option>
              <option value="on">开启</option>
            </select>
            <button style={{ marginTop: 12 }} onClick={saveStrategyConfig}>保存策略参数</button>
          </section>
          <section className="subPanelCard">
            <div className="small">风控约束</div>
            <label style={{ marginTop: 12 }}>单次最大仓位 (%)</label>
            <input value={riskForm.maxPositionPct} onChange={(e) => setRiskForm({ ...riskForm, maxPositionPct: Number(e.target.value) })} />
            <label style={{ marginTop: 12 }}>单日最大亏损 (%)</label>
            <input value={riskForm.maxDailyLossPct} onChange={(e) => setRiskForm({ ...riskForm, maxDailyLossPct: Number(e.target.value) })} />
            <label style={{ marginTop: 12 }}>最大连续亏损次数</label>
            <input value={riskForm.maxConsecutiveLosses} onChange={(e) => setRiskForm({ ...riskForm, maxConsecutiveLosses: Number(e.target.value) })} />
            <button className="secondary" style={{ marginTop: 12 }} onClick={saveRiskConfig}>保存风控参数</button>
          </section>
          <section className="subPanelCard">
            <div className="small">回测操作</div>
            <label style={{ marginTop: 12 }}>周期</label>
            <select value={backtestBar} onChange={(e) => setBacktestBar(e.target.value as BacktestBar)}>
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1H">1H</option>
              <option value="4H">4H</option>
              <option value="1D">1D</option>
            </select>
            <div className="small" style={{ marginTop: 12 }}>当前只接入买入 / 卖出策略，后续可扩展更多策略种类。</div>
            <button style={{ marginTop: 12 }} onClick={() => runBacktest()} disabled={backtesting}>{backtesting ? '回测中...' : '运行策略回测'}</button>
            <button className="secondary" style={{ marginTop: 12 }} onClick={() => bestBacktest && applyBacktestParams(bestBacktest)} disabled={!bestBacktest}>采用较优组合</button>
          </section>
        </div>
      </section>

      <section className="card mobileSummaryBar backtestSummarySection" style={{ marginTop: 16 }}>
        <div className="mobileSummaryGrid">
          <div>
            <div className="small">样本</div>
            <div className="kpi">{backtestCandles || 0}</div>
          </div>
          <div>
            <div className="small">较优组合</div>
            <div className="kpi">{bestBacktest ? `${bestBacktest.stopLossPct}/${bestBacktest.trailingDrawdownPct}` : '-'}</div>
          </div>
          <div>
            <div className="small">当前选中</div>
            <div className="kpi">{selectedBacktest ? `${selectedBacktest.stopLossPct}/${selectedBacktest.trailingDrawdownPct}` : '-'}</div>
          </div>
        </div>
      </section>
      <section className="card backtestResultCard panelCard backtestResultSection" style={{ marginTop: 16 }} ref={backtestResultRef}>
        <div className="panelHeader"><div><div className="sectionTag">参数排行</div><h2>回测参数筛选结果</h2></div></div>
        <div className="collapseBar">
          <div className="small">样本: {backtestCandles || 0} 根 1H K 线。只用于测试，不代表实盘表现。</div>
          <button className="secondary collapseBtn" onClick={() => setShowBacktestResults((v) => !v)}>{showBacktestResults ? '收起结果' : '展开结果'}</button>
        </div>
        {showBacktestResults ? <>
        <div className="row" style={{ marginTop: 12, alignItems: 'end' }}>
          <div>
            <label>查看方式</label>
            <select value={backtestSort} onChange={(e) => setBacktestSort(e.target.value as 'return' | 'drawdown' | 'winRate')}>
              <option value="return">收益优先</option>
              <option value="drawdown">回撤优先</option>
              <option value="winRate">胜率优先</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <div className="small">较优组合</div>
            <div className="kpi">{bestBacktest ? `${bestBacktest.stopLossPct}% / ${bestBacktest.trailingDrawdownPct}%` : '-'}</div>
            <div className="small">总收益 {bestBacktest ? `${formatNumber(bestBacktest.totalReturn * 100, 2)}%` : '-'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="small">当前选中参数</div>
            <div className="kpi">{selectedBacktest ? `${selectedBacktest.stopLossPct}% / ${selectedBacktest.trailingDrawdownPct}%` : '-'}</div>
            <div className="small">最大回撤 {selectedBacktest ? `${formatNumber(selectedBacktest.maxDrawdown * 100, 2)}%` : '-'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="small">当前规则</div>
            <div className="kpi">{strategyForm.stopLossPct}% / {strategyForm.trailingDrawdownPct}%</div>
            <div className="small">可直接保存为默认参数</div>
          </div>
        </div>
        <div className="mobileList">
          {sortedBacktestResults.length ? sortedBacktestResults.map((r) => {
            const key = `${r.stopLossPct}-${r.trailingDrawdownPct}`;
            const isSelected = key === selectedBacktestKey;
            return (
              <div className="mobileItem" key={key} style={isSelected ? { borderColor: '#60a5fa' } : undefined}>
                <div><span className="small">规则组合</span><strong>{r.stopLossPct}% / {r.trailingDrawdownPct}%</strong></div>
                <div><span className="small">交易次数 / 胜率</span><strong>{r.trades} / {formatNumber(r.winRate * 100, 2)}%</strong></div>
                <div><span className="small">总收益 / 最大回撤</span><strong>{formatNumber(r.totalReturn * 100, 2)}% / {formatNumber(r.maxDrawdown * 100, 2)}%</strong></div>
                <div><button className="secondary" onClick={() => applyBacktestParams(r)}>{isSelected ? '已选中' : '应用到策略'}</button></div>
              </div>
            );
          }) : <div className="small">还没有回测结果，点“回测 RAVE 策略”即可。</div>}
        </div>
        <div className="desktopRankGrid" style={{ marginTop: 16 }}>
          {sortedBacktestResults.length ? sortedBacktestResults.map((r, index) => {
            const key = `${r.stopLossPct}-${r.trailingDrawdownPct}`;
            const isSelected = key === selectedBacktestKey;
            return (
              <div className={isSelected ? 'rankCard selected' : 'rankCard'} key={key}>
                <div className="rankCardHead">
                  <div>
                    <div className="small">参数排行 #{index + 1}</div>
                    <strong>{r.stopLossPct}% / {r.trailingDrawdownPct}%</strong>
                  </div>
                  <button className="secondary" onClick={() => applyBacktestParams(r)}>{isSelected ? '已选中' : '采用这组'}</button>
                </div>
                <div className="rankCardGrid">
                  <div><span className="small">交易次数</span><strong>{r.trades}</strong></div>
                  <div><span className="small">胜率</span><strong>{formatNumber(r.winRate * 100, 2)}%</strong></div>
                  <div><span className="small">总收益</span><strong className={r.totalReturn >= 0 ? 'good' : 'bad'}>{formatNumber(r.totalReturn * 100, 2)}%</strong></div>
                  <div><span className="small">最大回撤</span><strong>{formatNumber(r.maxDrawdown * 100, 2)}%</strong></div>
                </div>
              </div>
            );
          }) : <div className="small">还没有回测结果，点“回测 RAVE 策略”即可。</div>}
        </div>
        </> : null}
      </section>

      <section className="card panelCard primaryChartSection okxStageCard" style={{ marginTop: 16 }}>
        <div className="panelHeader"><div><div className="sectionTag">图表</div><h2>K 线主图区</h2></div></div>
        <div className="small">参考欧易主屏布局来收，主图更突出，只保留买点和卖点标记。手机上建议优先看最近 20 或 60 根。</div>
        <div className="okxTopTabs" style={{ marginTop: 12 }}>
          <span className="okxTopTab active">图表</span>
          <span className="okxTopTab">信息</span>
          <span className="okxTopTab">交易记录</span>
          <span className="okxTopTab">策略</span>
        </div>
        {latestCandle ? (
          <div className="tickerBar okxTickerBar" style={{ marginTop: 12 }}>
            <div className="tickerMain">
              <strong>RAVEUSDT 永续</strong>
              <span className={latestChangePct >= 0 ? 'good' : 'bad'}>{formatNumber(latestCandle.close, 6)}</span>
            </div>
            <div className="tickerStats">
              <span>开 {formatNumber(latestCandle.open, 6)}</span>
              <span>高 {formatNumber(latestCandle.high, 6)}</span>
              <span>低 {formatNumber(latestCandle.low, 6)}</span>
              <span>收 {formatNumber(latestCandle.close, 6)}</span>
              <span>窗口 {chartWindow} 根</span>
            </div>
          </div>
        ) : null}
        {focusedCandle ? (
          <div className="hoverInfoCard" style={{ marginTop: 12 }}>
            <div className="hoverInfoHead">
              <strong>{new Date(focusedCandle.ts).toLocaleString('zh-CN', { hour12: false })}</strong>
              <span>{focusedTrade ? `交易点 ${focusedTrade.entryTs === focusedCandle.ts ? '买入' : '卖出'}` : '无交易点'}</span>
            </div>
            <div className="hoverInfoGrid">
              <span>开 {formatNumber(focusedCandle.open, 6)}</span>
              <span>高 {formatNumber(focusedCandle.high, 6)}</span>
              <span>低 {formatNumber(focusedCandle.low, 6)}</span>
              <span>收 {formatNumber(focusedCandle.close, 6)}</span>
              <span>振幅 {formatNumber(focusedCandle.high - focusedCandle.low, 6)}</span>
              <span>{focusedTrade ? `信号 ${focusedTrade.entryTs === focusedCandle.ts ? 'B 买入' : 'S 卖出'}` : '等待信号'}</span>
            </div>
          </div>
        ) : null}
        <div className="chartToolbar okxToolbar" style={{ marginTop: 12 }}>
          <div className="chartLegend okxLegendRow okxIntervalRow">
            <span className="intervalLabel">时间间隔</span>
            <button className={backtestBar === '1m' ? 'periodBtn active' : 'periodBtn'} onClick={() => changeBacktestBar('1m')} disabled={backtesting}>1m</button>
            <button className={backtestBar === '5m' ? 'periodBtn active' : 'periodBtn'} onClick={() => changeBacktestBar('5m')} disabled={backtesting}>5m</button>
            <button className={backtestBar === '15m' ? 'periodBtn active' : 'periodBtn'} onClick={() => changeBacktestBar('15m')} disabled={backtesting}>15m</button>
            <button className={backtestBar === '1H' ? 'periodBtn active' : 'periodBtn'} onClick={() => changeBacktestBar('1H')} disabled={backtesting}>1H</button>
            <button className={backtestBar === '4H' ? 'periodBtn active' : 'periodBtn'} onClick={() => changeBacktestBar('4H')} disabled={backtesting}>4H</button>
            <button className={backtestBar === '1D' ? 'periodBtn active' : 'periodBtn'} onClick={() => changeBacktestBar('1D')} disabled={backtesting}>1D</button>
            <span className="intervalHint">当前周期 {backtestBar}，点击会重新拉取并回测</span>
          </div>
          <div className="chartControls dualControls">
            <div>
              <label>观察区间</label>
              <div className="windowQuickRow">
                <button className={chartWindow === 20 ? 'periodBtn active' : 'periodBtn'} onClick={() => setChartWindow(20)}>最近 20 根</button>
                <button className={chartWindow === 60 ? 'periodBtn active' : 'periodBtn'} onClick={() => setChartWindow(60)}>最近 60 根</button>
                <button className={chartWindow === 120 ? 'periodBtn active' : 'periodBtn'} onClick={() => setChartWindow(120)}>最近 120 根</button>
              </div>
            </div>
            <div>
              <label>K 线窗口</label>
              <select value={String(chartWindow)} onChange={(e) => setChartWindow(Number(e.target.value) as 20 | 60 | 120)}>
                <option value="20">最近 20 根</option>
                <option value="60">最近 60 根</option>
                <option value="120">最近 120 根</option>
              </select>
            </div>
          </div>
        </div>
        {chartCandles.length ? (
          <div className="okxChartShell" style={{ marginTop: 16 }}>
            <div className="okxToolRail" aria-hidden="true">
              <span className="toolDot active"></span>
              <span className="toolDot"></span>
              <span className="toolDot"></span>
              <span className="toolDot"></span>
              <span className="toolDot"></span>
            </div>
            <div className="chartWrap okxChartWrap okxMainChartWrap">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="backtestChart" role="img" aria-label="Backtest candle chart">
              <rect x={0} y={0} width={chartWidth} height={chartHeight} fill="#0b1420" />
              <rect x={chartPadLeft} y={chartPadTop} width={plotWidth} height={plotHeight} rx={8} fill="#0d1524" stroke="rgba(255,255,255,0.08)" />
              {chartPriceTicks.map((tick) => {
                const y = yOf(tick);
                return (
                  <g key={`price-${tick}`}>
                    <line x1={chartPadLeft} y1={y} x2={chartWidth - chartPadRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 6" />
                    <rect x={chartWidth - chartPadRight + 8} y={y - 10} width={72} height={20} rx={6} fill="rgba(10,18,29,0.96)" stroke="rgba(255,255,255,0.08)" />
                    <text x={chartWidth - chartPadRight + 44} y={y + 4} textAnchor="middle" fontSize="12" fill="rgba(235,242,255,0.96)">{formatNumber(tick, 6)}</text>
                  </g>
                );
              })}
              {chartDateTicks.map((tickIndex) => {
                const candle = chartCandles[tickIndex];
                if (!candle) return null;
                const x = xOf(tickIndex);
                const tickDate = new Date(candle.ts);
                return (
                  <g key={`date-${candle.ts}`}>
                    <line x1={x} y1={chartPadTop} x2={x} y2={chartHeight - chartPadBottom} stroke="rgba(255,255,255,0.05)" />
                    <text x={x} y={chartHeight - 14} textAnchor="middle" fontSize="11" fill="rgba(235,242,255,0.96)">{tickDate.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</text>
                  </g>
                );
              })}
              <line x1={chartPadLeft} y1={chartPadTop} x2={chartPadLeft} y2={chartHeight - chartPadBottom} stroke="rgba(255,255,255,0.08)" />
              <line x1={chartPadLeft} y1={chartHeight - chartPadBottom} x2={chartWidth - chartPadRight} y2={chartHeight - chartPadBottom} stroke="rgba(255,255,255,0.08)" />
              {chartCandles.map((c, index) => {
                const x = xOf(index);
                const openY = yOf(c.open);
                const closeY = yOf(c.close);
                const highY = yOf(c.high);
                const lowY = yOf(c.low);
                const up = c.close >= c.open;
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
                const isFocused = focusedCandleIndex === index;
                return (
                  <g key={c.ts} onMouseEnter={() => setFocusedCandleIndex(index)} onClick={() => setFocusedCandleIndex(index)} style={{ cursor: 'crosshair' }}>
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={up ? '#00c087' : '#ff5b6e'} strokeWidth={isFocused ? '1.8' : '1.2'} />
                    <rect x={x - candleBodyWidth / 2} y={bodyTop} width={candleBodyWidth} height={bodyHeight} rx={1} fill={up ? '#00c087' : '#ff5b6e'} opacity={isFocused ? '1' : '0.96'} />
                  </g>
                );
              })}
              {focusX != null ? (
                <g>
                  <line x1={focusX} y1={chartPadTop} x2={focusX} y2={chartHeight - chartPadBottom} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 6" />
                  {latestCandle ? <line x1={chartPadLeft} y1={yOf(latestCandle.close)} x2={chartWidth - chartPadRight} y2={yOf(latestCandle.close)} stroke="rgba(45,140,255,0.2)" strokeDasharray="4 6" /> : null}
                </g>
              ) : null}
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
                    {ex != null && xx != null ? <line x1={ex} y1={ey} x2={xx} y2={xy} stroke="rgba(96,165,250,0.18)" strokeDasharray="3 5" /> : null}
                    {ex != null ? (
                      <g onClick={() => setSelectedTrade(t)} style={{ cursor: 'pointer' }}>
                        <circle cx={ex} cy={ey} r={9} fill="rgba(41, 121, 255, 0.16)" />
                        <text x={ex} y={ey + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#2d8cff">B</text>
                        <polygon points={`${ex},${ey - 13} ${ex - 8},${ey + 3} ${ex + 8},${ey + 3}`} fill="#2d8cff">
                          <title>{entryTitle}</title>
                        </polygon>
                      </g>
                    ) : null}
                    {xx != null ? (
                      <g onClick={() => setSelectedTrade(t)} style={{ cursor: 'pointer' }}>
                        <circle cx={xx} cy={xy} r={9} fill="rgba(255, 91, 110, 0.16)" />
                        <text x={xx} y={xy + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={t.reason === 'stop_loss' ? '#ff5b6e' : '#f5b942'}>S</text>
                        <polygon points={`${xx},${xy + 13} ${xx - 8},${xy - 3} ${xx + 8},${xy - 3}`} fill={t.reason === 'stop_loss' ? '#ff5b6e' : '#f5b942'}>
                          <title>{exitTitle}</title>
                        </polygon>
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            </div>
            <div className="okxChartFoot">
              <span>主图</span>
              <span>价格轴已对齐</span>
              <span>时间轴细化</span>
              <span>买卖点联动</span>
            </div>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 12 }}>当前没有 K 线，是因为这个线上实例还没有生成回测明细。先点“回测 RAVE 策略”，再从结果表里选一组参数即可。</div>
        )}
        {candleRangeSeries.length ? (
          <div className="miniIndicatorWrap">
            <div className="small">波动副图（按每根 K 线高低差）</div>
            <div className="chartWrap okxChartWrap miniWrap" style={{ marginTop: 8 }}>
              <svg viewBox={`0 0 ${chartWidth} 140`} className="backtestChart" role="img" aria-label="Candle range sub chart">
                <rect x={0} y={0} width={chartWidth} height={140} fill="#0b1420" />
                <rect x={chartPadLeft} y={14} width={plotWidth} height={98} rx={8} fill="#0d1524" stroke="rgba(255,255,255,0.08)" />
                {candleRangeSeries.map((c, index) => {
                  const x = xOf(index);
                  const h = Math.max((c.range / Math.max(maxCandleRange, 1e-9)) * 84, 2);
                  const y = 104 - h;
                  const isFocused = focusedCandleIndex === index;
                  return <rect key={`${c.ts}-range`} x={x - Math.max(candleBodyWidth / 2, 3)} y={y} width={Math.max(candleBodyWidth, 6)} height={h} fill={c.up ? '#00c087' : '#ff5b6e'} opacity={isFocused ? '1' : '0.72'} rx={1} onMouseEnter={() => setFocusedCandleIndex(index)} onClick={() => setFocusedCandleIndex(index)} />;
                })}
                {focusX != null ? <line x1={focusX} y1={14} x2={focusX} y2={112} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 6" /> : null}
                {chartDateTicks.map((tickIndex) => {
                  const candle = chartCandles[tickIndex];
                  if (!candle) return null;
                  const x = xOf(tickIndex);
                  const tickDate = new Date(candle.ts);
                  return <text key={`mini-date-${candle.ts}`} x={x} y={132} textAnchor="middle" fontSize="11" fill="rgba(159,176,208,0.88)">{tickDate.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</text>;
                })}
              </svg>
            </div>
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 16 }}>
          <div className="small">买点数: {chartTrades.length}</div>
          <div className="small">卖点数: {chartTrades.length}</div>
        </div>
        <div className="chartMetaRow okxBottomStats">
          <div className="small"><span className="metaLabel">当前参数</span>{selectedBacktest ? `${selectedBacktest.stopLossPct}% / ${selectedBacktest.trailingDrawdownPct}%` : '-'}</div>
          <div className="small"><span className="metaLabel">总收益</span>{selectedBacktest ? `${formatNumber(selectedBacktest.totalReturn * 100, 2)}%` : '-'}</div>
          <div className="small"><span className="metaLabel">最大回撤</span>{selectedBacktest ? `${formatNumber(selectedBacktest.maxDrawdown * 100, 2)}%` : '-'}</div>
        </div>
        <div className="chartActionRow">
          <button className="secondary" onClick={() => runBacktest()} disabled={backtesting}>{backtesting ? '回测中...' : '重新运行回测'}</button>
          <button className="secondary" onClick={() => backtestResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>查看参数结果</button>
        </div>
        {selectedTrade ? (
          <div className="tradeDetailCard">
            <div className="row">
              <div><span className="small">买入时间</span><div>{new Date(selectedTrade.entryTs).toLocaleString('zh-CN', { hour12: false })}</div></div>
              <div><span className="small">买入价格</span><div>{formatNumber(selectedTrade.entryPrice, 8)}</div></div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div><span className="small">卖出时间</span><div>{new Date(selectedTrade.exitTs).toLocaleString('zh-CN', { hour12: false })}</div></div>
              <div><span className="small">卖出价格</span><div>{formatNumber(selectedTrade.exitPrice, 8)}</div></div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div><span className="small">收益率</span><div className={selectedTrade.ret >= 0 ? 'good' : 'bad'}>{formatNumber(selectedTrade.ret * 100, 2)}%</div></div>
              <div><span className="small">卖出原因</span><div>{selectedTrade.reason === 'stop_loss' ? '止损卖出' : '回撤卖出'}</div></div>
            </div>
            <button className="secondary" style={{ marginTop: 12 }} onClick={() => setSelectedTrade(null)}>关闭详情</button>
          </div>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="collapseBar">
          <div>
            <h2 style={{ margin: 0 }}>回测资金曲线</h2>
            <div className="small">从 1.0 初始资金开始，按每笔交易收益连续复利。</div>
          </div>
          <button className="secondary collapseBtn" onClick={() => setShowEquityCurve((v) => !v)}>{showEquityCurve ? '收起曲线' : '展开曲线'}</button>
        </div>
        {showEquityCurve && equitySeries.length ? (
          <div className="chartWrap" style={{ marginTop: 16 }}>
            <svg viewBox={`0 0 ${equityWidth} ${equityHeight}`} className="backtestChart" role="img" aria-label="Backtest equity curve">
              <line x1={equityPad} y1={equityPad} x2={equityPad} y2={equityHeight - equityPad} stroke="rgba(159,176,208,0.35)" />
              <line x1={equityPad} y1={equityHeight - equityPad} x2={equityWidth - equityPad} y2={equityHeight - equityPad} stroke="rgba(159,176,208,0.35)" />
              {equityTicks.map((tick) => {
                const y = equityHeight - equityPad - ((tick - minEquity) / equityRange) * (equityHeight - equityPad * 2);
                return (
                  <g key={`equity-${tick}`}>
                    <line x1={equityPad} y1={y} x2={equityWidth - equityPad} y2={y} stroke="rgba(159,176,208,0.12)" />
                    <text x={equityPad - 10} y={y + 4} textAnchor="end" fontSize="12" fill="rgba(159,176,208,0.85)">{formatNumber(tick, 4)}</text>
                  </g>
                );
              })}
              {equityXLabels.map((idx) => {
                const x = equityPad + (idx / Math.max(equitySeries.length - 1, 1)) * (equityWidth - equityPad * 2);
                return (
                  <g key={`equity-x-${idx}`}>
                    <line x1={x} y1={equityPad} x2={x} y2={equityHeight - equityPad} stroke="rgba(159,176,208,0.08)" />
                    <text x={x} y={equityHeight - equityPad + 20} textAnchor="middle" fontSize="12" fill="rgba(159,176,208,0.85)">{idx + 1}</text>
                  </g>
                );
              })}
              <text x={22} y={18} fontSize="12" fill="rgba(159,176,208,0.85)">净值</text>
              <text x={equityWidth - 18} y={equityHeight - 12} textAnchor="end" fontSize="12" fill="rgba(159,176,208,0.85)">交易序号</text>
              <path d={equityPath} fill="none" stroke="#60a5fa" strokeWidth="2.5" />
            </svg>
          </div>
        ) : showEquityCurve ? (
          <div className="small" style={{ marginTop: 12 }}>暂无资金曲线，请先运行回测并生成交易明细。</div>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>交易记录</h2>
        <div className="small">逐笔查看买入、卖出、收益和原因，更容易判断这套规则是否合理。</div>
        <div className="mobileList">
          {backtestTradePoints.length ? backtestTradePoints.slice(-40).reverse().map((t, idx) => (
            <div className="mobileItem" key={`${t.entryTs}-${t.exitTs}-${idx}`}>
              <div><span className="small">买入</span><strong>{new Date(t.entryTs).toLocaleString('zh-CN', { hour12: false })}</strong></div>
              <div><span className="small">买入价 / 卖出价</span><strong>{formatNumber(t.entryPrice, 8)} / {formatNumber(t.exitPrice, 8)}</strong></div>
              <div><span className="small">卖出</span><strong>{new Date(t.exitTs).toLocaleString('zh-CN', { hour12: false })}</strong></div>
              <div><span className="small">收益率 / 原因</span><strong className={t.ret >= 0 ? 'good' : 'bad'}>{formatNumber(t.ret * 100, 2)}% / {t.reason === 'stop_loss' ? '止损' : '回撤'}</strong></div>
            </div>
          )) : <div className="small" style={{ marginTop: 12 }}>暂无交易过程，请先运行回测。</div>}
        </div>
        <table className="table desktopOnly" style={{ marginTop: 16 }}>
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

      </div>

      <div className="mobileSection" data-tab="account" data-active={mobileTab === 'account'}>
      <section className="card mobileSummaryBar" style={{ marginTop: 16 }}>
        <div className="mobileSummaryGrid">
          <div>
            <div className="small">账户权益</div>
            <div className="kpi">{balanceTop?.totalEq ?? '-'}</div>
          </div>
          <div>
            <div className="small">调整后权益</div>
            <div className="kpi">{balanceTop?.adjEq ?? '-'}</div>
          </div>
          <div>
            <div className="small">可用余额</div>
            <div className="kpi">{formatNumber(state.availableMargin, 4)}</div>
          </div>
        </div>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>账户资产明细</h2>
        <div className="mobileList">
          {(state.balanceDetails || []).length ? state.balanceDetails!.map((item) => (
            <div className="mobileItem" key={item.ccy}>
              <div><span className="small">币种</span><strong>{item.ccy}</strong></div>
              <div><span className="small">权益</span><strong>{formatNumber(item.equity, 10)}</strong></div>
              <div><span className="small">现金余额</span><strong>{formatNumber(item.cashBalance, 10)}</strong></div>
              <div><span className="small">可用余额</span><strong>{formatNumber(item.availableBalance, 10)}</strong></div>
            </div>
          )) : <div className="small">暂无资产明细</div>}
        </div>
        <table className="table desktopOnly">
          <thead>
            <tr>
              <th>币种</th>
              <th>权益</th>
              <th>现金余额</th>
              <th>可用余额</th>
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

      <section className="card panelCard" style={{ marginTop: 16 }}>
        <div className="panelHeader"><div><div className="sectionTag">持仓</div><h2>当前持仓明细</h2></div></div>
        <div className="small">这里只展示当前持仓，不包含任何策略回测结果。</div>
        <div className="mobileList">
          {state.positions.length ? state.positions.map((p) => (
            <div className="mobileItem" key={p.id}>
              <div><span className="small">合约</span><strong>{p.symbol}</strong></div>
              <div><span className="small">方向 / 杠杆</span><strong>{p.side} / {p.leverage}x</strong></div>
              <div><span className="small">数量</span><strong>{p.quantity ?? '-'}</strong></div>
              <div><span className="small">开仓价 / 标记价</span><strong>{formatNumber(p.entryPrice, 8)} / {formatNumber(p.markPrice, 8)}</strong></div>
              <div><span className="small">未实现盈亏</span><strong className={Number(p.unrealizedPnl ?? 0) >= 0 ? 'good' : 'bad'}>{formatNumber(p.unrealizedPnl ?? 0, 8)}</strong></div>
            </div>
          )) : <div className="small">暂无持仓</div>}
        </div>
        <table className="table desktopOnly">
          <thead>
            <tr>
              <th>合约</th>
              <th>方向</th>
              <th>杠杆</th>
              <th>数量</th>
              <th>仓位价值</th>
              <th>占用保证金</th>
              <th>未实现盈亏</th>
              <th>开仓价</th>
              <th>标记价</th>
              <th>盈亏比例(%)</th>
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

      <section className="card panelCard" style={{ marginTop: 16 }}>
        <div className="panelHeader"><div><div className="sectionTag">委托</div><h2>历史委托明细</h2></div></div>
        <div className="small">这里只展示真实盘口相关的历史委托记录。</div>
        <div className="mobileList">
          {(state.orderHistory || []).length ? state.orderHistory!.map((o) => (
            <div className="mobileItem" key={o.id}>
              <div><span className="small">时间</span><strong>{new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</strong></div>
              <div><span className="small">合约</span><strong>{o.symbol}</strong></div>
              <div><span className="small">方向 / 状态</span><strong>{o.side} / {o.state}</strong></div>
              <div><span className="small">价格 / 数量</span><strong>{formatNumber(o.price, 8)} / {formatNumber(o.size, 8)}</strong></div>
            </div>
          )) : <div className="small">暂无订单历史</div>}
        </div>
        <table className="table desktopOnly">
          <thead>
            <tr>
              <th>时间</th>
              <th>合约</th>
              <th>方向</th>
              <th>委托类型</th>
              <th>状态</th>
              <th>价格</th>
              <th>数量</th>
              <th>已成交数量</th>
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

      </div>

      <div className="mobileSection" data-tab="realtime" data-active={appMode === 'realtime'}>
      <section className="card pageModeIntroCard" style={{ marginTop: 16 }}>
        <div className="sectionTag">实时策略</div>
        <h2 style={{ marginTop: 0 }}>实时策略执行界面</h2>
        <div className="small">这里单独承载实时信号、执行控制、实时收益、当前持仓、日志与异常状态，不和真实盘口、策略回测混排。</div>
      </section>

      <section className="card panelCard realtimeHeroCard" style={{ marginTop: 16 }}>
        <div className="panelHeader"><div><div className="sectionTag">执行总览</div><h2>实时策略主控台</h2></div></div>
        <div className="modeHeroStats">
          <div className="heroStatBox">
            <span>运行状态</span>
            <strong>{state.strategyStatus === 'running' ? '运行中' : state.strategyStatus === 'paused' ? '已暂停' : '已待命'}</strong>
          </div>
          <div className="heroStatBox">
            <span>当前信号</span>
            <strong>{strategyForm.lastSignal === 'buy' ? '买入' : strategyForm.lastSignal === 'sell' ? '卖出' : '观望'}</strong>
          </div>
          <div className="heroStatBox">
            <span>今日收益</span>
            <strong>{formatNumber(state.dailyPnl, 4)}</strong>
          </div>
          <div className="heroStatBox">
            <span>当前回撤</span>
            <strong>{formatNumber(state.drawdownPct, 2)}%</strong>
          </div>
        </div>
      </section>

      <div className="grid modePageGrid realtimeModeGrid" style={{ marginTop: 16 }}>
        <section className="card panelCard realtimeControlCard">
          <div className="panelHeader"><div><div className="sectionTag">执行控制</div><h2>实时执行控制</h2></div></div>
          <div className="small">后续这里会接启动、暂停、策略切换、风险停止等操作。</div>
          <div className="statusRow" style={{ marginTop: 16 }}><span className="small">当前策略</span><strong>买入 / 卖出</strong></div>
          <div className="statusRow"><span className="small">当前参数</span><strong>{strategyForm.stopLossPct}% / {strategyForm.trailingDrawdownPct}%</strong></div>
          <div className="statusRow"><span className="small">参考较优组合</span><strong>{bestBacktest ? `${bestBacktest.stopLossPct}% / ${bestBacktest.trailingDrawdownPct}%` : '-'}</strong></div>
          <div className="row" style={{ marginTop: 16 }}>
            <button>启动策略</button>
            <button className="secondary">暂停策略</button>
          </div>
        </section>

        <section className="card panelCard realtimeSignalCard">
          <div className="panelHeader"><div><div className="sectionTag">实时信号</div><h2>信号与仓位状态</h2></div></div>
          <div className="small">后续这里接实时行情、持仓方向、开仓价格、浮盈浮亏和最近一次信号。</div>
          <div className="modeHeroStats" style={{ marginTop: 16 }}>
            <div className="heroStatBox">
              <span>当前持仓</span>
              <strong>{state.positions.length}</strong>
            </div>
            <div className="heroStatBox">
              <span>浮动盈亏</span>
              <strong>{formatNumber(state.positions.reduce((sum, p) => sum + Number(p.unrealizedPnl ?? 0), 0), 4)}</strong>
            </div>
          </div>
        </section>

        <section className="card panelCard realtimeLogCard">
          <div className="panelHeader"><div><div className="sectionTag">执行日志</div><h2>策略日志预留区</h2></div></div>
          <div className="small">后续这里接策略触发记录、成交记录、异常信息和风控中断原因。</div>
          <div className="changelogList" style={{ marginTop: 16 }}>
            <div className="changelogItem"><strong>最近信号</strong><div className="small">暂无实时信号</div></div>
            <div className="changelogItem"><strong>最近执行</strong><div className="small">暂无执行记录</div></div>
            <div className="changelogItem"><strong>风险提醒</strong><div className="small">暂无风控中断</div></div>
          </div>
        </section>
      </div>
      </div>
    </main>
  );
}
