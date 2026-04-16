import type {
  ApiConnectionSummary,
  ApiEnvelope,
  AppState,
  BacktestBar,
  BacktestSummary,
  OrderBook,
  RiskConfig,
  StrategyDefinition,
  StrategyConfig,
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
  loadBacktestDetail: (payload: { instId: string; bar: BacktestBar; strategyType: StrategyType; stopLossPct: number; trailingDrawdownPct: number }) =>
    envelope<BacktestSummary>('/api/backtests/detail', { method: 'POST', body: JSON.stringify(payload) }),
  getRealtimeConsole: () =>
    envelope<{ strategyType: StrategyType; strategyName: string; strategyStatusLabel: string; strategyStatus: string; lastSignal: string; stopLossPct: number; trailingDrawdownPct: number; riskState: string; executionAdvice: string; positionCount: number; logs: string[] }>('/api/realtime/console'),
};
