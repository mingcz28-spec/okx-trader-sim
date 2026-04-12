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
  const [backtestTop, setBacktestTop] = useState<BacktestResult[]>([]);

  async function refreshState() {
    const res = await fetch('/api/sim');
    const data: SimState = await res.json();
    setState(data);
    setApiForm(data.apiConfig);
    setRiskForm(data.riskConfig);
    setStrategyForm(data.strategyConfig ?? emptyState.strategyConfig!);
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
      setBacktestTop(data.top || []);
      setMessage(`RAVE-USDT-SWAP 回测完成，样本 ${data.candles} 根 1H K 线。`);
    } finally {
      setBacktesting(false);
    }
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
        <table className="table">
          <thead>
            <tr>
              <th>止损 %</th>
              <th>回撤卖出 %</th>
              <th>交易次数</th>
              <th>胜率</th>
              <th>总收益</th>
              <th>最大回撤</th>
            </tr>
          </thead>
          <tbody>
            {backtestTop.length ? backtestTop.map((r) => (
              <tr key={`${r.stopLossPct}-${r.trailingDrawdownPct}`}>
                <td>{r.stopLossPct}</td>
                <td>{r.trailingDrawdownPct}</td>
                <td>{r.trades}</td>
                <td>{formatNumber(r.winRate * 100, 2)}%</td>
                <td>{formatNumber(r.totalReturn * 100, 2)}%</td>
                <td>{formatNumber(r.maxDrawdown * 100, 2)}%</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="small">还没有回测结果，点“回测 RAVE 策略”即可。</td></tr>
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
