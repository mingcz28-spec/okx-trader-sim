import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { EmptyState } from '../components/common/EmptyState';
import type { AppState, OkxAccountConfig } from '../types';
import { formatNumber } from '../utils/format';

type AppContext = {
  state: AppState | null;
  setState: (state: AppState) => void;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
};

type OkxMode = 'demo' | 'live';

type OkxLoginForm = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
};

type CachedOkxLoginDraft = {
  version: number;
  form: OkxLoginForm;
  mode: OkxMode;
  expiresAt: number;
};

const EMPTY_LOGIN_FORM: OkxLoginForm = { apiKey: '', secretKey: '', passphrase: '' };
const DEFAULT_OKX_MODE: OkxMode = 'live';
const LOGIN_DRAFT_CACHE_VERSION = 2;
const LOGIN_DRAFT_CACHE_KEY = 'okx-trader-sim:okx-login-draft';
const LOGIN_DRAFT_TTL_MS = 10 * 60 * 1000;
const MISSING_LOGIN_MESSAGE = '请填写完整的 OKX API Key、Secret Key 和 Passphrase。';

function getSessionStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isValidMode(value: unknown): value is OkxMode {
  return value === 'demo' || value === 'live';
}

function isValidLoginForm(value: unknown): value is OkxLoginForm {
  if (!value || typeof value !== 'object') return false;
  const form = value as Partial<OkxLoginForm>;
  return typeof form.apiKey === 'string' && typeof form.secretKey === 'string' && typeof form.passphrase === 'string';
}

function clearCachedLoginDraft() {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(LOGIN_DRAFT_CACHE_KEY);
  } catch {
    // ignore
  }
}

function readCachedLoginDraft(): CachedOkxLoginDraft | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(LOGIN_DRAFT_CACHE_KEY);
    if (!raw) return null;

    const draft = JSON.parse(raw) as Partial<CachedOkxLoginDraft>;
    if (!isValidLoginForm(draft.form) || !isValidMode(draft.mode) || typeof draft.expiresAt !== 'number') {
      clearCachedLoginDraft();
      return null;
    }

    if (draft.expiresAt <= Date.now()) {
      clearCachedLoginDraft();
      return null;
    }

    const cachedMode = draft.version === LOGIN_DRAFT_CACHE_VERSION ? draft.mode : DEFAULT_OKX_MODE;
    return { version: LOGIN_DRAFT_CACHE_VERSION, form: draft.form, mode: cachedMode, expiresAt: draft.expiresAt };
  } catch {
    clearCachedLoginDraft();
    return null;
  }
}

function cacheLoginDraft(form: OkxLoginForm, mode: OkxMode) {
  const storage = getSessionStorage();
  if (!storage) return;

  const draft: CachedOkxLoginDraft = {
    version: LOGIN_DRAFT_CACHE_VERSION,
    form,
    mode,
    expiresAt: Date.now() + LOGIN_DRAFT_TTL_MS,
  };

  try {
    storage.setItem(LOGIN_DRAFT_CACHE_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

function isCompleteLoginForm(form: OkxLoginForm) {
  return Boolean(form.apiKey.trim() && form.secretKey.trim() && form.passphrase.trim());
}

function accountConfigNote(config: OkxAccountConfig | null) {
  if (!config) return '尚未读取账号配置。';
  if (!config.canTrade) return '当前账号已接入，但交易权限未通过检查。';
  if (config.positionMode !== 'long_short_mode') return '当前不是双向持仓模式，不能启动实盘自动交易。';
  return '账号已连接，可交易，双向持仓检查通过。';
}

export function MarketPage({ app }: { app: AppContext }) {
  const state = app.state!;
  const [initialDraft] = useState(() => readCachedLoginDraft());
  const [mode, setModeState] = useState<OkxMode>(initialDraft?.mode ?? DEFAULT_OKX_MODE);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [accountConfig, setAccountConfig] = useState<OkxAccountConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [form, setFormState] = useState<OkxLoginForm>(initialDraft?.form ?? EMPTY_LOGIN_FORM);

  const isBusy = saving || syncing || testing || configLoading;
  const loginStatus = state.apiConnection.hasApiKey ? state.apiConnection.apiKeyMasked : '未接入';

  function updateForm(nextForm: OkxLoginForm) {
    setFormState(nextForm);
    cacheLoginDraft(nextForm, mode);
  }

  function updateMode(nextMode: OkxMode) {
    setModeState(nextMode);
    cacheLoginDraft(form, nextMode);
  }

  async function refreshAccountConfig(nextMode = mode) {
    setConfigLoading(true);
    try {
      const config = await api.getOkxAccountConfig(nextMode);
      setAccountConfig(config);
    } catch (err) {
      setAccountConfig(null);
      app.setError(err instanceof Error ? err.message : '读取 OKX 账号配置失败');
    } finally {
      setConfigLoading(false);
    }
  }

  useEffect(() => {
    if (state.apiConnection.hasApiKey) {
      refreshAccountConfig(mode);
    }
  }, [state.apiConnection.hasApiKey, mode]);

  async function saveConfig() {
    app.setError('');
    if (!isCompleteLoginForm(form)) {
      app.setError(MISSING_LOGIN_MESSAGE);
      return;
    }

    setSaving(true);
    try {
      const apiConnection = await api.saveOkxConfig(form);
      app.setState({ ...state, apiConnection });
      cacheLoginDraft(form, mode);
      await refreshAccountConfig(mode);
      app.setMessage('OKX 真实账号接入信息已加密保存。');
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '保存 OKX 账号信息失败');
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
      await refreshAccountConfig(mode);
      app.setMessage(`已同步 OKX ${mode === 'live' ? '真实盘' : '模拟盘'} 的资金、持仓和委托。`);
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '同步 OKX 账号失败');
    } finally {
      setSyncing(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    app.setError('');
    try {
      const result = await api.testOkxConnection(mode);
      await refreshAccountConfig(mode);
      app.setMessage(
        `OKX ${mode === 'live' ? '真实盘' : '模拟盘'}连接成功：总权益 ${formatNumber(result.totalEq, 4)}，可用余额 ${formatNumber(result.availableBalance, 4)}。`,
      );
    } catch (err) {
      app.setError(err instanceof Error ? err.message : '测试 OKX 连接失败');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="pageGrid">
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">真实账号接入</p>
            <h2>OKX 账号连接</h2>
          </div>
          <div className="loginStatus">
            <span>接入状态</span>
            <strong>{loginStatus}</strong>
          </div>
        </div>

        <div className="formGrid">
          <label>
            OKX API Key
            <input value={form.apiKey} onChange={(e) => updateForm({ ...form, apiKey: e.target.value })} placeholder="okx-api-key" disabled={isBusy} />
          </label>
          <label>
            OKX Secret Key
            <input type="password" value={form.secretKey} onChange={(e) => updateForm({ ...form, secretKey: e.target.value })} placeholder="okx-secret" disabled={isBusy} />
          </label>
          <label>
            OKX Passphrase
            <input type="password" value={form.passphrase} onChange={(e) => updateForm({ ...form, passphrase: e.target.value })} placeholder="okx-passphrase" disabled={isBusy} />
          </label>
          <label>
            账号模式
            <select value={mode} onChange={(e) => updateMode(e.target.value as OkxMode)} disabled={isBusy}>
              <option value="live">真实盘</option>
              <option value="demo">模拟盘</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button onClick={saveConfig} disabled={isBusy}>{saving ? '保存中...' : '保存接入信息'}</button>
          <button className="secondary" onClick={testConnection} disabled={isBusy}>{testing ? '检测中...' : '检测连接'}</button>
          <button className="secondary" onClick={syncAccount} disabled={isBusy}>{syncing ? '同步中...' : '同步账号数据'}</button>
        </div>
      </section>

      <section className="panel wide">
        <p className="eyebrow">交易检查</p>
        <h2>实盘账号状态</h2>
        <div className="accountSummaryGrid">
          <div>
            <span>交易模式</span>
            <strong>{accountConfig?.tradingMode ?? (configLoading ? '读取中...' : '-')}</strong>
          </div>
          <div>
            <span>持仓模式</span>
            <strong>{accountConfig?.positionMode ?? '-'}</strong>
          </div>
          <div>
            <span>可交易</span>
            <strong>{accountConfig ? (accountConfig.canTrade ? '是' : '否') : '-'}</strong>
          </div>
          <div>
            <span>保证金提示</span>
            <strong>{accountConfig?.marginModeHint ?? '-'}</strong>
          </div>
        </div>
        <p>{accountConfigNote(accountConfig)}</p>
      </section>

      <section className="panel wide">
        <p className="eyebrow">账户资金</p>
        <h2>资产概览</h2>
        <div className="accountSummaryGrid">
          <div><span>账户权益</span><strong>{formatNumber(state.equity, 4)}</strong></div>
          <div><span>可用保证金</span><strong>{formatNumber(state.availableMargin, 4)}</strong></div>
          <div><span>今日盈亏</span><strong className={state.dailyPnl >= 0 ? 'good' : 'bad'}>{formatNumber(state.dailyPnl, 4)}</strong></div>
          <div><span>当前持仓</span><strong>{state.positions.length}</strong></div>
        </div>
        {state.balanceDetails.length ? (
          <table className="assetDetailTable">
            <thead>
              <tr>
                <th>币种</th>
                <th>权益</th>
                <th>现金余额</th>
                <th>可用余额</th>
              </tr>
            </thead>
            <tbody>
              {state.balanceDetails.map((b) => (
                <tr key={b.ccy}>
                  <td>{b.ccy}</td>
                  <td>{formatNumber(b.equity, 8)}</td>
                  <td>{formatNumber(b.cashBalance, 8)}</td>
                  <td>{formatNumber(b.availableBalance, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState text="暂无资金明细。保存账号后可同步真实盘资金信息。" />
        )}
      </section>

      <section className="panel wide">
        <p className="eyebrow">持仓</p>
        <h2>当前持仓</h2>
        {state.positions.length ? (
          <table>
            <thead>
              <tr>
                <th>合约</th>
                <th>方向</th>
                <th>杠杆</th>
                <th>数量</th>
                <th>名义价值</th>
                <th>未实现盈亏</th>
                <th>开仓价</th>
                <th>标记价</th>
              </tr>
            </thead>
            <tbody>
              {state.positions.map((p) => (
                <tr key={p.id}>
                  <td>{p.symbol}</td>
                  <td>{p.side}</td>
                  <td>{p.leverage}x</td>
                  <td>{formatNumber(p.quantity, 8)}</td>
                  <td>{formatNumber(p.notional, 4)}</td>
                  <td className={(p.unrealizedPnl ?? 0) >= 0 ? 'good' : 'bad'}>{formatNumber(p.unrealizedPnl, 4)}</td>
                  <td>{formatNumber(p.entryPrice, 8)}</td>
                  <td>{formatNumber(p.markPrice, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState text="暂无持仓。同步账号后会显示 OKX 返回的真实持仓。" />
        )}
      </section>

      <section className="panel wide">
        <p className="eyebrow">委托</p>
        <h2>历史委托</h2>
        {state.orderHistory.length ? (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>合约</th>
                <th>方向</th>
                <th>类型</th>
                <th>状态</th>
                <th>价格</th>
                <th>数量</th>
                <th>成交量</th>
              </tr>
            </thead>
            <tbody>
              {state.orderHistory.map((o) => (
                <tr key={o.id}>
                  <td>{new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td>{o.symbol}</td>
                  <td>{o.side}</td>
                  <td>{o.orderType}</td>
                  <td>{o.state}</td>
                  <td>{formatNumber(o.price, 8)}</td>
                  <td>{formatNumber(o.size, 8)}</td>
                  <td>{formatNumber(o.filledSize, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState text="暂无历史委托。同步账号后会显示 OKX 返回的委托记录。" />
        )}
      </section>
    </div>
  );
}
