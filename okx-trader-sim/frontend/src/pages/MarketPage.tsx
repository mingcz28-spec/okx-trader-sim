import { useState } from 'react';
import { api } from '../api/client';
import { EmptyState } from '../components/common/EmptyState';
import type { AppState, OrderBook } from '../types';
import { formatNumber } from '../utils/format';

type AppContext = {
  state: AppState | null;
  setState: (state: AppState) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
};

export function MarketPage({ app }: { app: AppContext }) {
  const state = app.state!;
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({ apiKey: '', secretKey: '', passphrase: '' });
  const [bookInstId, setBookInstId] = useState('BTC-USDT-SWAP');
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [bookLoading, setBookLoading] = useState(false);

  const isBusy = saving || syncing || testing;
  const loginStatus = state.apiConnection.hasApiKey ? state.apiConnection.apiKeyMasked : '未登录';

  async function saveConfig() {
    setSaving(true);
    app.setError('');
    try {
      const apiConnection = await api.saveOkxConfig(form);
      app.setState({ ...state, apiConnection });
      app.setMessage('OKX 账号登录信息已加密保存。');
      setForm({ apiKey: '', secretKey: '', passphrase: '' });
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '保存 OKX 账号登录信息失败');
    } finally {
      setSaving(false);
    }
  }

  async function syncAccount() {
    setSyncing(true);
    app.setError('');
    try {
      const next = await api.syncOkx(mode);
      app.setState(next);
      app.setMessage(`已同步 OKX ${mode === 'live' ? '真实盘' : '模拟盘'}账号资金、持仓和历史委托。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '同步 OKX 账号信息失败');
    } finally {
      setSyncing(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    app.setError('');
    try {
      const result = await api.testOkxConnection(mode);
      app.setMessage(`OKX ${mode === 'live' ? '真实盘' : '模拟盘'}连接成功：总权益 ${formatNumber(result.totalEq, 4)}，可用余额 ${formatNumber(result.availableBalance, 4)}。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '测试 OKX 账号连接失败');
    } finally {
      setTesting(false);
    }
  }

  async function loadOrderBook() {
    setBookLoading(true);
    app.setError('');
    try {
      const next = await api.getOrderBook(bookInstId, 20);
      setOrderBook(next);
      app.setMessage(`已刷新 ${next.instId} 真实盘口。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '读取 OKX 真实盘口失败');
    } finally {
      setBookLoading(false);
    }
  }

  return (
    <div className="pageGrid">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">账号登录</p>
            <h2>OKX 账号登录与加密保存</h2>
            <p className="bodyCopy">填写 OKX API Key、Secret Key 和 Passphrase。Secret Key 与 Passphrase 会加密保存，页面不会回显明文。</p>
          </div>
          <div className="loginStatus">
            <span>登录状态</span>
            <strong>{loginStatus}</strong>
          </div>
        </div>

        <div className="formGrid">
          <label>OKX API Key
            <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="okx-api-key" disabled={isBusy} />
          </label>
          <label>OKX Secret Key
            <input type="password" value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} placeholder="okx-secret" disabled={isBusy} />
          </label>
          <label>OKX Passphrase
            <input type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} placeholder="okx-passphrase" disabled={isBusy} />
          </label>
          <label>账号模式
            <select value={mode} onChange={(e) => setMode(e.target.value as 'demo' | 'live')} disabled={isBusy}>
              <option value="demo">模拟盘</option>
              <option value="live">真实盘</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button onClick={saveConfig} disabled={saving}>{saving ? '加密保存中...' : '加密保存登录信息'}</button>
          <button className="secondary" onClick={testConnection} disabled={testing}>{testing ? '测试中...' : '测试账号连接'}</button>
          <button className="secondary" onClick={syncAccount} disabled={syncing}>{syncing ? '同步中...' : '同步账号资金信息'}</button>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">账号资金</p>
        <h2>资金概览</h2>
        <div className="accountSummaryGrid">
          <div><span>账号权益</span><strong>{formatNumber(state.equity, 4)}</strong></div>
          <div><span>可用保证金</span><strong>{formatNumber(state.availableMargin, 4)}</strong></div>
          <div><span>今日盈亏</span><strong className={state.dailyPnl >= 0 ? 'good' : 'bad'}>{formatNumber(state.dailyPnl, 4)}</strong></div>
          <div><span>当前持仓</span><strong>{state.positions.length}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">真实盘口</p>
            <h2>OKX 买卖盘深度</h2>
          </div>
          <strong>{orderBook ? orderBook.instId : '未加载'}</strong>
        </div>
        <div className="formGrid single">
          <label>合约
            <input value={bookInstId} onChange={(e) => setBookInstId(e.target.value.toUpperCase())} placeholder="BTC-USDT-SWAP" />
          </label>
        </div>
        <div className="actions">
          <button className="secondary" onClick={loadOrderBook} disabled={bookLoading}>{bookLoading ? '读取中...' : '刷新真实盘口'}</button>
        </div>
        {orderBook ? (
          <div className="orderBookGrid">
            <div>
              <div className="orderBookTitle bad">卖盘</div>
              {orderBook.asks.slice().reverse().map((level) => (
                <div className="orderBookRow ask" key={`ask-${level.price}`}>
                  <span>{formatNumber(level.price, 6)}</span>
                  <span>{formatNumber(level.size, 4)}</span>
                  <span>{level.orders}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="orderBookTitle good">买盘</div>
              {orderBook.bids.map((level) => (
                <div className="orderBookRow bid" key={`bid-${level.price}`}>
                  <span>{formatNumber(level.price, 6)}</span>
                  <span>{formatNumber(level.size, 4)}</span>
                  <span>{level.orders}</span>
                </div>
              ))}
            </div>
            <div className="orderBookMeta">更新时间 {new Date(orderBook.updatedAt).toLocaleString('zh-CN', { hour12: false })}</div>
          </div>
        ) : <EmptyState text="刷新后读取 OKX 公共盘口深度，不需要账号登录。" />}
      </section>

      <section className="panel wide">
        <p className="eyebrow">资金明细</p>
        <h2>账号资产</h2>
        {state.balanceDetails.length ? (
          <table>
            <thead><tr><th>币种</th><th>权益</th><th>现金余额</th><th>可用余额</th></tr></thead>
            <tbody>{state.balanceDetails.map((b) => <tr key={b.ccy}><td>{b.ccy}</td><td>{formatNumber(b.equity, 8)}</td><td>{formatNumber(b.cashBalance, 8)}</td><td>{formatNumber(b.availableBalance, 8)}</td></tr>)}</tbody>
          </table>
        ) : <EmptyState text="暂无资金明细。保存 OKX 登录信息后，可以同步账号资金信息。" />}
      </section>

      <section className="panel wide">
        <p className="eyebrow">持仓</p>
        <h2>当前持仓</h2>
        {state.positions.length ? (
          <table>
            <thead><tr><th>合约</th><th>方向</th><th>杠杆</th><th>数量</th><th>名义价值</th><th>未实现盈亏</th><th>开仓价</th><th>标记价</th></tr></thead>
            <tbody>{state.positions.map((p) => <tr key={p.id}><td>{p.symbol}</td><td>{p.side}</td><td>{p.leverage}x</td><td>{formatNumber(p.quantity, 8)}</td><td>{formatNumber(p.notional, 4)}</td><td className={(p.unrealizedPnl ?? 0) >= 0 ? 'good' : 'bad'}>{formatNumber(p.unrealizedPnl, 4)}</td><td>{formatNumber(p.entryPrice, 8)}</td><td>{formatNumber(p.markPrice, 8)}</td></tr>)}</tbody>
          </table>
        ) : <EmptyState text="暂无持仓。同步账号后会显示 OKX 返回的持仓信息。" />}
      </section>

      <section className="panel wide">
        <p className="eyebrow">委托</p>
        <h2>历史委托</h2>
        {state.orderHistory.length ? (
          <table>
            <thead><tr><th>时间</th><th>合约</th><th>方向</th><th>类型</th><th>状态</th><th>价格</th><th>数量</th><th>成交</th></tr></thead>
            <tbody>{state.orderHistory.map((o) => <tr key={o.id}><td>{new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</td><td>{o.symbol}</td><td>{o.side}</td><td>{o.orderType}</td><td>{o.state}</td><td>{formatNumber(o.price, 8)}</td><td>{formatNumber(o.size, 8)}</td><td>{formatNumber(o.filledSize, 8)}</td></tr>)}</tbody>
          </table>
        ) : <EmptyState text="暂无历史委托。同步账号后会显示 OKX 返回的历史委托。" />}
      </section>
    </div>
  );
}
