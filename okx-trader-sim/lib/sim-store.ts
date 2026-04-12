export type ApiConfig = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
};

export type RiskConfig = {
  maxPositionPct: number;
  maxDailyLossPct: number;
  maxConsecutiveLosses: number;
};

export type Position = {
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

export type BalanceDetail = {
  ccy: string;
  equity: number;
  cashBalance: number;
  availableBalance: number;
};

export type OrderHistoryItem = {
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

export type OkxRawPayloads = {
  accountBalance?: unknown;
  accountPositions?: unknown;
  ordersHistory?: unknown;
};

export type StrategyConfig = {
  enabled: boolean;
  entrySide: 'buy';
  stopLossPct: number;
  trailingDrawdownPct: number;
  highestPriceSinceEntry?: number;
  entryPrice?: number;
  lastSignal?: 'buy' | 'sell' | 'hold';
};

export type SimState = {
  apiConfig: ApiConfig;
  riskConfig: RiskConfig;
  strategyConfig?: StrategyConfig;
  equity: number;
  availableMargin: number;
  dailyPnl: number;
  drawdownPct: number;
  strategyStatus: 'idle' | 'running' | 'paused';
  currencyMode?: 'USD' | 'CAD';
  balanceDetails?: BalanceDetail[];
  orderHistory?: OrderHistoryItem[];
  raw?: OkxRawPayloads;
  positions: Position[];
};

const globalStore = globalThis as typeof globalThis & { __okxSimState?: SimState };

function createInitialState(): SimState {
  return {
    apiConfig: { apiKey: '', secretKey: '', passphrase: '' },
    riskConfig: { maxPositionPct: 5, maxDailyLossPct: 3, maxConsecutiveLosses: 3 },
    strategyConfig: {
      enabled: false,
      entrySide: 'buy',
      stopLossPct: 1,
      trailingDrawdownPct: 2,
      lastSignal: 'hold',
    },
    equity: 10000,
    availableMargin: 8420,
    dailyPnl: 132.4,
    drawdownPct: -1.8,
    strategyStatus: 'idle',
    currencyMode: 'USD',
    balanceDetails: [
      { ccy: 'USDT', equity: 10000, cashBalance: 10000, availableBalance: 8420 },
    ],
    orderHistory: [],
    raw: {},
    positions: [
      {
        id: 'p1',
        symbol: 'BTC-USDT-SWAP',
        side: 'long',
        leverage: 3,
        quantity: 0.012,
        marginMode: 'cross',
        notional: 100,
        marginUsed: 33.33,
        unrealizedPnl: 2.4,
        entryPrice: 84250,
        markPrice: 86272,
        pnlPct: 2.4,
        openedAt: new Date().toISOString(),
      },
      {
        id: 'p2',
        symbol: 'ETH-USDT-SWAP',
        side: 'short',
        leverage: 2,
        quantity: 0.4,
        marginMode: 'isolated',
        notional: 100,
        marginUsed: 50,
        unrealizedPnl: -0.8,
        entryPrice: 1640,
        markPrice: 1653,
        pnlPct: -0.8,
        openedAt: new Date().toISOString(),
      },
    ],
  };
}

export function getSimState(): SimState {
  if (!globalStore.__okxSimState) {
    globalStore.__okxSimState = createInitialState();
  }
  return globalStore.__okxSimState;
}

export function updateApiConfig(apiConfig: ApiConfig) {
  const state = getSimState();
  state.apiConfig = apiConfig;
  return state;
}

export function updateRiskConfig(riskConfig: RiskConfig) {
  const state = getSimState();
  state.riskConfig = riskConfig;
  return state;
}

export function updateStrategyConfig(strategyConfig: StrategyConfig) {
  const state = getSimState();
  state.strategyConfig = strategyConfig;
  return state;
}

export function setStrategyStatus(status: SimState['strategyStatus']) {
  const state = getSimState();
  state.strategyStatus = status;
  return state;
}

export function openSimPosition(input: {
  symbol: string;
  side: 'buy' | 'sell';
  leverage: number;
  notional: number;
}) {
  const state = getSimState();
  const side = input.side === 'buy' ? 'long' : 'short';
  const basePrice = input.symbol.startsWith('BTC') ? 85000 : 1650;
  const drift = side === 'long' ? 0.01 : -0.008;
  const markPrice = Math.round(basePrice * (1 + drift));
  const pnlPct = Number(((markPrice - basePrice) / basePrice * (side === 'long' ? 100 : -100)).toFixed(2));

  state.positions.unshift({
    id: `p-${Date.now()}`,
    symbol: input.symbol,
    side,
    leverage: input.leverage,
    quantity: Number((input.notional / basePrice).toFixed(6)),
    marginMode: 'cross',
    notional: input.notional,
    marginUsed: Number((input.notional / input.leverage).toFixed(2)),
    unrealizedPnl: Number(((input.notional * pnlPct) / 100).toFixed(2)),
    entryPrice: basePrice,
    markPrice,
    pnlPct,
    openedAt: new Date().toISOString(),
  });

  state.availableMargin = Number(Math.max(0, state.availableMargin - input.notional / input.leverage).toFixed(2));
  state.strategyStatus = 'running';
  return state;
}

export function closeAllPositions() {
  const state = getSimState();
  state.positions = [];
  state.availableMargin = state.equity * 0.9;
  state.strategyStatus = 'paused';
  return state;
}
