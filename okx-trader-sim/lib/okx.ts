import crypto from 'crypto';
import { getSimState, type BalanceDetail, type OrderHistoryItem, type Position, type SimState } from '@/lib/sim-store';

const OKX_BASE_URL = 'https://www.okx.com';

type OkxTickerResponse = {
  code: string;
  msg: string;
  data?: Array<{
    instId?: string;
    last?: string;
  }>;
};

type OkxBalanceResponse = {
  code: string;
  msg: string;
  data?: Array<{
    totalEq?: string;
    adjEq?: string;
    details?: Array<{
      availBal?: string;
      ccy?: string;
      cashBal?: string;
      eq?: string;
    }>;
  }>;
};

type OkxOrdersHistoryResponse = {
  code: string;
  msg: string;
  data?: Array<{
    ordId?: string;
    instId?: string;
    side?: string;
    ordType?: string;
    state?: string;
    px?: string;
    sz?: string;
    accFillSz?: string;
    cTime?: string;
  }>;
};

type OkxPositionsResponse = {
  code: string;
  msg: string;
  data?: Array<{
    instId?: string;
    posSide?: string;
    lever?: string;
    mgnMode?: string;
    notionalUsd?: string;
    margin?: string;
    avgPx?: string;
    markPx?: string;
    uplRatio?: string;
    upl?: string;
    cTime?: string;
    pos?: string;
  }>;
};

function buildSignature(timestamp: string, method: string, requestPath: string, body = '') {
  const state = getSimState();
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return crypto.createHmac('sha256', state.apiConfig.secretKey).update(prehash).digest('base64');
}

async function okxGet<T>(requestPath: string, mode: 'demo' | 'live' = 'demo'): Promise<T> {
  const state = getSimState();
  if (!state.apiConfig.apiKey || !state.apiConfig.secretKey || !state.apiConfig.passphrase) {
    throw new Error('请先填写完整的 OKX API Key、Secret Key 和 Passphrase');
  }

  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': state.apiConfig.apiKey,
    'OK-ACCESS-SIGN': buildSignature(timestamp, 'GET', requestPath),
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': state.apiConfig.passphrase,
    'Content-Type': 'application/json',
  };

  if (mode === 'demo') {
    headers['x-simulated-trading'] = '1';
  }

  const response = await fetch(`${OKX_BASE_URL}${requestPath}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`OKX 请求失败: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function parseNumber(value: string | undefined, fallback = 0) {
  const n = Number(value ?? '');
  return Number.isFinite(n) ? n : fallback;
}

export async function testOkxConnection(mode: 'demo' | 'live' = 'demo') {
  const balanceRes = await okxGet<OkxBalanceResponse>('/api/v5/account/balance', mode);
  if (balanceRes.code !== '0') {
    throw new Error(balanceRes.msg || 'OKX 连接测试失败');
  }

  const balance = balanceRes.data?.[0];
  const usdtDetail = balance?.details?.find((item) => item.ccy === 'USDT') ?? balance?.details?.[0];

  return {
    mode,
    totalEq: parseNumber(balance?.totalEq, 0),
    availableBalance: parseNumber(usdtDetail?.availBal ?? usdtDetail?.cashBal ?? usdtDetail?.eq, 0),
  };
}

export async function syncOkxLiveState(mode: 'demo' | 'live' = 'demo'): Promise<SimState> {
  const state = getSimState();
  const [balanceRes, positionsRes, tickerRes, ordersRes] = await Promise.all([
    okxGet<OkxBalanceResponse>('/api/v5/account/balance', mode),
    okxGet<OkxPositionsResponse>('/api/v5/account/positions', mode),
    okxGet<OkxTickerResponse>('/api/v5/market/ticker?instId=USDT-CAD', mode).catch(() => ({ code: '1', msg: 'ticker unavailable', data: [] })),
    okxGet<OkxOrdersHistoryResponse>('/api/v5/trade/orders-history-archive?instType=SWAP&limit=10', mode).catch(() => ({ code: '1', msg: 'orders unavailable', data: [] })),
  ]);

  if (balanceRes.code !== '0') {
    throw new Error(balanceRes.msg || '读取 OKX 余额失败');
  }
  if (positionsRes.code !== '0') {
    throw new Error(positionsRes.msg || '读取 OKX 持仓失败');
  }

  const balance = balanceRes.data?.[0];
  const usdtDetail = balance?.details?.find((item) => item.ccy === 'USDT') ?? balance?.details?.[0];
  const fxRateUSDCAD = parseNumber(tickerRes.data?.[0]?.last, 1.37);

  state.fxRateUSDCAD = fxRateUSDCAD;
  state.currencyMode = mode === 'live' ? 'CAD' : 'USD';
  state.equity = parseNumber(balance?.totalEq, state.equity);
  state.availableMargin = parseNumber(usdtDetail?.availBal ?? usdtDetail?.cashBal ?? usdtDetail?.eq, state.availableMargin);

  const balanceDetails: BalanceDetail[] = (balance?.details ?? []).map((item) => ({
    ccy: item.ccy || 'UNKNOWN',
    equity: parseNumber(item.eq, 0),
    cashBalance: parseNumber(item.cashBal, 0),
    availableBalance: parseNumber(item.availBal, 0),
  }));

  state.balanceDetails = balanceDetails;

  const mappedPositions: Position[] = (positionsRes.data ?? []).map((item, index) => ({
    id: item.instId ? `${item.instId}-${index}` : `okx-${index}`,
    symbol: item.instId || 'UNKNOWN',
    side: item.posSide === 'short' ? 'short' : 'long',
    leverage: parseNumber(item.lever, 1),
    marginMode: item.mgnMode || 'unknown',
    quantity: Math.abs(parseNumber(item.pos, 0)),
    notional: Math.abs(parseNumber(item.notionalUsd || item.pos, 0)),
    marginUsed: Math.abs(parseNumber(item.margin, 0)),
    unrealizedPnl: parseNumber(item.upl, 0),
    entryPrice: parseNumber(item.avgPx, 0),
    markPrice: parseNumber(item.markPx, 0),
    pnlPct: Number((parseNumber(item.uplRatio, 0) * 100).toFixed(2)),
    openedAt: item.cTime ? new Date(Number(item.cTime)).toISOString() : new Date().toISOString(),
  }));

  state.positions = mappedPositions;
  state.dailyPnl = Number((mappedPositions.reduce((sum, item) => sum + (item.notional * item.pnlPct) / 100, 0)).toFixed(2));
  state.drawdownPct = Math.min(0, Number((mappedPositions.reduce((min, item) => Math.min(min, item.pnlPct), 0)).toFixed(2)));
  state.strategyStatus = mappedPositions.length ? 'running' : 'idle';

  const orderHistory: OrderHistoryItem[] = (ordersRes.data ?? []).map((item, index) => ({
    id: item.ordId || `ord-${index}`,
    symbol: item.instId || 'UNKNOWN',
    side: item.side || 'unknown',
    orderType: item.ordType || 'unknown',
    state: item.state || 'unknown',
    price: parseNumber(item.px, 0),
    size: parseNumber(item.sz, 0),
    filledSize: parseNumber(item.accFillSz, 0),
    createdAt: item.cTime ? new Date(Number(item.cTime)).toISOString() : new Date().toISOString(),
  }));
  state.orderHistory = orderHistory;

  return state;
}
