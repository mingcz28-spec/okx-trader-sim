'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatNumber } from '@/lib/format';

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
  equity: number;
  availableMargin: number;
  dailyPnl: number;
  drawdownPct: number;
  strategyStatus: 'idle' | 'running' | 'paused';
  currencyMode?: 'USD' | 'CAD';
  fxRateUSDCAD?: number;
  balanceDetails?: BalanceDetail[];
  orderHistory?: OrderHistoryItem[];
  positions: Position[];
};

const emptyState: SimState = {
  apiConfig: { apiKey: '', secretKey: '', passphrase: '' },
  riskConfig: { maxPositionPct: 5, maxDailyLossPct: 3, maxConsecutiveLosses: 3 },
  equity: 0,
  availableMargin: 0,
  dailyPnl: 0,
  drawdownPct: 0,
  strategyStatus: 'idle',
  currencyMode: 'USD',
  fxRateUSDCAD: 1.37,
  balanceDetails: [],
  orderHistory: [],
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
  const [syncMode, setSyncMode] = useState<'demo' | 'live'>('demo');
  const [testing, setTesting] = useState(false);

  const displayCurrency = syncMode === 'live' ? 'CAD' : 'USD';
  const fxRate = state.fxRateUSDCAD || 1.37;
  const convertMoney = (value: number) => (displayCurrency === 'CAD' ? value * fxRate : value);

  async function refreshState() {
    const res = await fetch('/api/sim');
    const data: SimState = await res.json();
    setState(data);
    setApiForm(data.apiConfig);
    setRiskForm(data.riskConfig);
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
    setMessage(mode === 'live' ? '已从 OKX 真实交易账号同步资金信息与持仓。' : '已从 OKX 模拟盘同步资金信息与持仓。');
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
      setMessage(`${mode === 'live' ? '真实盘' : '模拟盘'}连接成功，净值 ${formatCurrency(convertMoney(data.result.totalEq), displayCurrency)}，可用资金 ${formatCurrency(convertMoney(data.result.availableBalance), displayCurrency)}`);
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

  const totalPositionNotional = useMemo(
    () => state.positions.reduce((sum, p) => sum + p.notional, 0),
    [state.positions],
  );

  const totalUnrealizedPnl = useMemo(
    () => state.positions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0),
    [state.positions],
  );

  return (
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="badge">OKX 账户面板</div>
          <h1 style={{ margin: '12px 0 8px', fontSize: 34 }}>合约交易控制台</h1>
          <div className="small">真实盘资金与持仓金额默认按 CAD 显示，模拟盘保持 USD。</div>
        </div>
        <div className="card" style={{ minWidth: 280 }}>
          <div className="small">策略状态</div>
          <div className={`kpi ${state.strategyStatus === 'running' ? 'good' : state.strategyStatus === 'paused' ? 'bad' : ''}`}>
            {loading ? '加载中' : state.strategyStatus === 'idle' ? '已待命' : state.strategyStatus === 'running' ? '运行中' : '已暂停'}
          </div>
          <div className="small">API Key: {maskedApiKey}</div>
          <div className="small">显示币种: {displayCurrency}</div>
        </div>
      </div>

      {message ? <div className="card" style={{ marginBottom: 16 }}>{message}</div> : null}
      {error ? <div className="card bad" style={{ marginBottom: 16 }}>{error}</div> : null}

      <div className="grid">
        <section className="card">
          <h2>API 配置</h2>
          <p className="small">当前先保存到服务端内存，下一步会改成安全环境变量或密钥存储。</p>
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
          <h2>{syncMode === 'live' ? '真实交易账号资金概览' : '模拟盘资金概览'}</h2>
          <div className="small">总权益</div>
          <div className="kpi">{formatCurrency(convertMoney(state.equity), displayCurrency)}</div>
          <div className="small">可用资金 / 保证金 {formatCurrency(convertMoney(state.availableMargin), displayCurrency)}</div>
          <div className="row" style={{ marginTop: 16 }}>
            <div>
              <div className="small">未实现收益汇总</div>
              <div className={`kpi ${state.dailyPnl >= 0 ? 'good' : 'bad'}`}>{formatCurrency(convertMoney(state.dailyPnl), displayCurrency)}</div>
            </div>
            <div>
              <div className="small">最大回撤</div>
              <div className={`kpi ${state.drawdownPct >= 0 ? 'good' : 'bad'}`}>{state.drawdownPct}%</div>
            </div>
          </div>
          {syncMode === 'live' ? <div className="small" style={{ marginTop: 12 }}>换算汇率 USDT/CAD: {formatNumber(fxRate, 4)}</div> : null}
        </section>

        <section className="card">
          <h2>风控</h2>
          <div className="warn small">先控风险，再碰自动策略，不追求稳赚。</div>
          <label style={{ marginTop: 12 }}>单笔最大仓位 (%)</label>
          <input value={riskForm.maxPositionPct} onChange={(e) => setRiskForm({ ...riskForm, maxPositionPct: Number(e.target.value) })} />
          <label style={{ marginTop: 12 }}>每日最大亏损 (%)</label>
          <input value={riskForm.maxDailyLossPct} onChange={(e) => setRiskForm({ ...riskForm, maxDailyLossPct: Number(e.target.value) })} />
          <label style={{ marginTop: 12 }}>连续亏损暂停次数</label>
          <input value={riskForm.maxConsecutiveLosses} onChange={(e) => setRiskForm({ ...riskForm, maxConsecutiveLosses: Number(e.target.value) })} />
          <button style={{ marginTop: 12 }} onClick={saveRiskConfig}>更新风控</button>
        </section>

        <section className="card">
          <h2>下单面板</h2>
          <div className="row">
            <div>
              <label>交易对</label>
              <select value={tradeForm.symbol} onChange={(e) => setTradeForm({ ...tradeForm, symbol: e.target.value })}>
                <option>BTC-USDT-SWAP</option>
                <option>ETH-USDT-SWAP</option>
              </select>
            </div>
            <div>
              <label>方向</label>
              <select value={tradeForm.side} onChange={(e) => setTradeForm({ ...tradeForm, side: e.target.value })}>
                <option value="buy">开多</option>
                <option value="sell">开空</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>杠杆</label>
              <input value={tradeForm.leverage} onChange={(e) => setTradeForm({ ...tradeForm, leverage: Number(e.target.value) })} />
            </div>
            <div>
              <label>名义仓位 (USDT)</label>
              <input value={tradeForm.notional} onChange={(e) => setTradeForm({ ...tradeForm, notional: Number(e.target.value) })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={placeTrade}>模拟开仓</button>
            <button className="secondary" onClick={closeAll}>全部平仓</button>
          </div>
        </section>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>{syncMode === 'live' ? '资金币种明细' : '模拟盘资金明细'}</h2>
          <table className="table">
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
                  <td>{formatNumber(item.equity, 6)}</td>
                  <td>{formatNumber(item.cashBalance, 6)}</td>
                  <td>{formatNumber(item.availableBalance, 6)}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="small">暂无资金明细</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>{syncMode === 'live' ? '真实交易账号持仓摘要' : '模拟盘持仓摘要'}</h2>
          <div className="row">
            <div>
              <div className="small">持仓数量</div>
              <div className="kpi">{state.positions.length}</div>
            </div>
            <div>
              <div className="small">总名义仓位</div>
              <div className="kpi">{formatCurrency(convertMoney(totalPositionNotional), displayCurrency)}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <div>
              <div className="small">未实现盈亏</div>
              <div className={`kpi ${totalUnrealizedPnl >= 0 ? 'good' : 'bad'}`}>{formatCurrency(convertMoney(totalUnrealizedPnl), displayCurrency)}</div>
            </div>
            <div>
              <div className="small">数据来源</div>
              <div className="small">OKX {syncMode === 'live' ? '真实盘' : '模拟盘'} /account/positions</div>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{syncMode === 'live' ? '真实交易账号持仓' : '模拟盘持仓'}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={{ maxWidth: 160 }} onClick={() => syncLiveState('demo')}>刷新模拟盘</button>
            <button className="secondary" style={{ maxWidth: 160 }} onClick={() => syncLiveState('live')}>刷新真实盘</button>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>合约</th>
              <th>方向</th>
              <th>杠杆</th>
              <th>数量</th>
              <th>名义仓位</th>
              <th>保证金模式</th>
              <th>占用保证金</th>
              <th>未实现盈亏</th>
              <th>入场价</th>
              <th>标记价</th>
              <th>收益率</th>
              <th>开仓时间</th>
            </tr>
          </thead>
          <tbody>
            {state.positions.length ? state.positions.map((p) => (
              <tr key={p.id}>
                <td>{p.symbol}</td>
                <td>{p.side}</td>
                <td>{p.leverage}x</td>
                <td>{p.quantity ?? '-'}</td>
                <td>{formatCurrency(convertMoney(p.notional), displayCurrency)}</td>
                <td>{p.marginMode ?? '-'}</td>
                <td>{formatCurrency(convertMoney(p.marginUsed ?? 0), displayCurrency)}</td>
                <td className={(p.unrealizedPnl ?? 0) >= 0 ? 'good' : 'bad'}>{formatCurrency(convertMoney(p.unrealizedPnl ?? 0), displayCurrency)}</td>
                <td>{formatNumber(p.entryPrice, 4)}</td>
                <td>{formatNumber(p.markPrice, 4)}</td>
                <td className={p.pnlPct >= 0 ? 'good' : 'bad'}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct}%</td>
                <td>{new Date(p.openedAt).toLocaleString('zh-CN', { hour12: false })}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={12} className="small">暂无持仓</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>{syncMode === 'live' ? '真实交易订单历史' : '模拟订单历史'}</h2>
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
                <td>{formatNumber(o.price, 4)}</td>
                <td>{formatNumber(o.size, 6)}</td>
                <td>{formatNumber(o.filledSize, 6)}</td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="small">暂无订单历史</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
