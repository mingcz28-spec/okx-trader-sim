import { useEffect, useState } from 'react';
import { api } from './api/client';
import { useAppState } from './hooks/useAppState';
import { BacktestPage } from './pages/BacktestPage';
import { RealtimePage } from './pages/RealtimePage';
import type { OkxAccountConfig } from './types';
import { formatNumber } from './utils/format';

type Mode = 'backtest' | 'realtime';

type OkxLoginForm = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
};

const EMPTY_LOGIN_FORM: OkxLoginForm = {
  apiKey: '',
  secretKey: '',
  passphrase: ''
};

const accountConfigNote = (config: OkxAccountConfig | null | undefined) => {
  if (!config) return '未读取';
  if (!config.canTrade) return '不可交易';
  if (config.positionMode && config.positionMode !== 'long_short_mode') return '非双向持仓';
  return '已接入';
};

const liveNetPnlText = (value: number | undefined) => {
  if (value === undefined || value === null) return '-';
  return formatNumber(value, 4);
};

export default function App() {
  const app = useAppState();
  const { state, loading } = app;
  const [mode, setMode] = useState<Mode>('realtime');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loginForm, setLoginForm] = useState<OkxLoginForm>(EMPTY_LOGIN_FORM);
  const [topSyncReady, setTopSyncReady] = useState(false);
  const [accountConfig, setAccountConfig] = useState<OkxAccountConfig | null>(null);

  const refreshTopAccountStatus = async () => {
    try {
      const latest = await api.getState();
      const hasConfig = latest.apiConnection?.hasApiKey;
      if (hasConfig) {
        await api.syncOkx('live');
        const config = await api.getOkxAccountConfig('live');
        setAccountConfig(config);
      }
      await app.refresh(true);
      setTopSyncReady(true);
    } catch {
      setTopSyncReady(true);
    }
  };

  useEffect(() => {
    void refreshTopAccountStatus();
    const timer = window.setInterval(() => {
      void refreshTopAccountStatus();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const openConfigModal = async () => {
    setSyncMessage(null);
    try {
      await api.getOkxAccountConfig('live');
      setLoginForm({
        apiKey: state?.apiConnection.apiKeyMasked || '',
        secretKey: '',
        passphrase: ''
      });
    } catch {
      setLoginForm(EMPTY_LOGIN_FORM);
    }
    setShowConfigModal(true);
  };

  const saveAccountConfig = async () => {
    if (!loginForm.apiKey || !loginForm.secretKey || !loginForm.passphrase) {
      setSyncMessage('请填写 API Key、Secret Key 和 Passphrase');
      return;
    }

    setSavingConfig(true);
    setSyncMessage(null);
    try {
      await api.saveOkxConfig(loginForm);
      await refreshTopAccountStatus();
      setShowConfigModal(false);
      setLoginForm(EMPTY_LOGIN_FORM);
      setSyncMessage('账号密钥已保存');
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : '账号密钥保存失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const liveSummary = state?.liveTradingSummary;
  const accountStatus = state?.apiConnection.hasApiKey ? accountConfigNote(accountConfig) : '未配置';
  const equityText = topSyncReady && state ? formatNumber(state.equity, 4) : '-';
  const availableMarginText = topSyncReady && state ? formatNumber(state.availableMargin, 4) : '-';

  if (loading && !state) {
    return <div className="appShell loading">加载中...</div>;
  }

  return (
    <div className="appShell">
      <header className="hero">
        <div className="heroTopRow">
          <h1>M狙击手</h1>
          <section className="accountStatusHero" aria-label="账号状态">
            <div className="accountStatusRow">
              <div className="accountStatusGrid compact">
                <span>
                  <strong>账户状态</strong>
                  {accountStatus}
                </span>
                <span>
                  <strong>账户权益</strong>
                  {equityText}
                </span>
                <span>
                  <strong>可用保证金</strong>
                  {availableMarginText}
                </span>
                <span>
                  <strong>实时净收益</strong>
                  {liveNetPnlText(liveSummary?.netPnl)}
                </span>
              </div>
              <button className="ghostButton compact" type="button" onClick={openConfigModal}>
                配置密钥
              </button>
            </div>
          </section>
          <nav className="modeTabs" aria-label="功能切换">
            <button
              className={mode === 'backtest' ? 'active' : ''}
              type="button"
              onClick={() => setMode('backtest')}
            >
              策略回测
            </button>
            <button
              className={mode === 'realtime' ? 'active' : ''}
              type="button"
              onClick={() => setMode('realtime')}
            >
              实时策略
            </button>
          </nav>
        </div>
      </header>

      <main>
        {mode === 'backtest' && state ? <BacktestPage app={app} /> : null}
        {mode === 'realtime' && state ? <RealtimePage app={app} /> : null}
      </main>

      {showConfigModal ? (
        <div className="modalOverlay" role="presentation">
          <section className="modalCard" role="dialog" aria-modal="true" aria-label="账号密钥">
            <div className="modalHeader">
              <h2>配置 OKX API</h2>
              <button type="button" className="ghostButton compact" onClick={() => setShowConfigModal(false)}>
                关闭
              </button>
            </div>
            {syncMessage ? <div className="statusBanner error compactHeader">{syncMessage}</div> : null}
            <label>
              API Key
              <input
                value={loginForm.apiKey}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="OKX API Key"
              />
            </label>
            <label>
              Secret Key
              <input
                type="password"
                value={loginForm.secretKey}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, secretKey: event.target.value }))}
                placeholder="OKX Secret Key"
              />
            </label>
            <label>
              Passphrase
              <input
                type="password"
                value={loginForm.passphrase}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, passphrase: event.target.value }))}
                placeholder="OKX Passphrase"
              />
            </label>
            <button className="primaryButton" type="button" onClick={saveAccountConfig} disabled={savingConfig}>
              {savingConfig ? '保存中...' : '保存'}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
