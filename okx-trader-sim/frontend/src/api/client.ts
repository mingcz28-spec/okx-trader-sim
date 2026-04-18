import type {
  ApiConnectionSummary,
  ApiEnvelope,
  AppState,
  BacktestBar,
  BacktestSummary,
  ConfirmRealtimeSessionPayload,
  InstrumentSuggestion,
  LiveRealtimeSessionPayload,
  OkxAccountConfig,
  OrderBook,
  RealtimeConsole,
  RealtimeWorkspace,
  RiskConfig,
  StrategyConfig,
  StrategyDefinition,
  StrategyType,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.message ?? data?.title ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function envelope<T>(path: string, init?: RequestInit): Promise<T> {
  const data = await request<ApiEnvelope<T>>(path, init);
  if (!data.ok) throw new Error(data.message ?? '请求失败');
  return data.data as T;
}

export const api = {
  getState: () => request<AppState>('/api/state'),
  saveOkxConfig: (payload: { apiKey: string; secretKey: string; passphrase: string }) =>
    envelope<ApiConnectionSummary>('/api/config/okx', { method: 'POST', body: JSON.stringify(payload) }),
  testOkxConnection: (mode: 'demo' | 'live') =>
    envelope<{ mode: string; totalEq: number; availableBalance: number }>('/api/okx/test-connection', { method: 'POST', body: JSON.stringify({ mode }) }),
  getOkxAccountConfig: (mode: 'demo' | 'live' = 'live') =>
    envelope<OkxAccountConfig>(`/api/okx/account-config?mode=${mode}`),
  syncOkx: (mode: 'demo' | 'live') =>
    envelope<AppState>('/api/okx/sync', { method: 'POST', body: JSON.stringify({ mode }) }),
  getOrderBook: (instId: string, size = 20) =>
    envelope<OrderBook>(`/api/okx/orderbook?instId=${encodeURIComponent(instId)}&size=${size}`),
  saveRiskConfig: (payload: RiskConfig) =>
    envelope<RiskConfig>('/api/risk-config', { method: 'PUT', body: JSON.stringify(payload) }),
  saveStrategyConfig: (payload: StrategyConfig) =>
    envelope<StrategyConfig>('/api/strategy-config', { method: 'PUT', body: JSON.stringify(payload) }),
  openSimulatedTrade: (payload: { symbol: string; side: 'buy' | 'sell'; leverage: number; notional: number }) =>
    envelope<AppState>('/api/trades/simulated', { method: 'POST', body: JSON.stringify(payload) }),
  closeAllSimulated: () => envelope<AppState>('/api/trades/simulated', { method: 'DELETE' }),
  getStrategies: () => envelope<StrategyDefinition[]>('/api/strategies'),
  runBacktest: (payload: { instId: string; bar: BacktestBar; strategyType: StrategyType }) =>
    envelope<BacktestSummary>('/api/backtests', { method: 'POST', body: JSON.stringify(payload) }),
  loadBacktestDetail: (payload: { instId: string; bar: BacktestBar; strategyType: StrategyType; stopLossPct: number; trailingDrawdownPct: number; leverage: number }) =>
    envelope<BacktestSummary>('/api/backtests/detail', { method: 'POST', body: JSON.stringify(payload) }),
  getRealtimeConsole: () => envelope<RealtimeConsole>('/api/realtime/console'),
  searchRealtimeInstruments: (query: string) =>
    envelope<InstrumentSuggestion[]>(`/api/realtime/instruments?q=${encodeURIComponent(query)}`),
  getRealtimeWorkspace: (payload: { instId: string; bar: BacktestBar; strategyType: StrategyType; confirmed?: boolean }) =>
    envelope<RealtimeWorkspace>(`/api/realtime/workspace?instId=${encodeURIComponent(payload.instId)}&bar=${encodeURIComponent(payload.bar)}&strategyType=${encodeURIComponent(payload.strategyType)}&confirmed=${payload.confirmed ? 'true' : 'false'}`),
  confirmRealtimeSession: (payload: ConfirmRealtimeSessionPayload) =>
    envelope<RealtimeWorkspace>('/api/realtime/session', { method: 'PUT', body: JSON.stringify(payload) }),
  forceExitRealtimeSession: () =>
    envelope<RealtimeWorkspace>('/api/realtime/session/force-exit', { method: 'PUT' }),
  putLiveRealtimeSession: (payload: LiveRealtimeSessionPayload) =>
    envelope<RealtimeWorkspace>('/api/realtime/live-session', { method: 'PUT', body: JSON.stringify(payload) }),
  pauseLiveRealtimeSession: () =>
    envelope<RealtimeWorkspace>('/api/realtime/live-session/pause', { method: 'PUT' }),
  resumeLiveRealtimeSession: () =>
    envelope<RealtimeWorkspace>('/api/realtime/live-session/resume', { method: 'PUT' }),
  forceExitLiveRealtimeSession: () =>
    envelope<RealtimeWorkspace>('/api/realtime/live-session/force-exit', { method: 'PUT' }),
  deleteLiveRealtimeSession: () =>
    envelope<RealtimeWorkspace>('/api/realtime/live-session', { method: 'DELETE' }),
};
