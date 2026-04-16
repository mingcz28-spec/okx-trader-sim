export type ApiConnectionSummary = {
  apiKeyMasked: string;
  hasApiKey: boolean;
  updatedAt?: string | null;
};

export type RiskConfig = {
  maxPositionPct: number;
  maxDailyLossPct: number;
  maxConsecutiveLosses: number;
};

export type StrategyConfig = {
  strategyType: StrategyType;
  enabled: boolean;
  entrySide: 'buy';
  stopLossPct: number;
  trailingDrawdownPct: number;
  highestPriceSinceEntry?: number | null;
  entryPrice?: number | null;
  lastSignal: 'buy' | 'sell' | 'hold';
};

export type Position = {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  leverage: number;
  marginMode?: string | null;
  quantity?: number | null;
  notional: number;
  marginUsed?: number | null;
  unrealizedPnl?: number | null;
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

export type BacktestResult = {
  stopLossPct: number;
  trailingDrawdownPct: number;
  trades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
};

export type CandlePoint = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type OrderBookLevel = {
  price: number;
  size: number;
  total: number;
  orders: number;
};

export type OrderBook = {
  instId: string;
  updatedAt: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export type BacktestTradePoint = {
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  ret: number;
  reason: 'stop_loss' | 'trailing_exit';
};

export type BacktestSummary = {
  id?: string | null;
  instId: string;
  bar: string;
  strategyType: StrategyType;
  candles: number;
  results: BacktestResult[];
  top: BacktestResult[];
  selected?: BacktestResult | null;
  chartCandles: CandlePoint[];
  tradePoints: BacktestTradePoint[];
};

export type StrategyDefinition = {
  id: StrategyType;
  name: string;
  description: string;
  status: 'active' | 'pending';
  supportsBacktest: boolean;
  supportsRealtime: boolean;
};

export type AppState = {
  apiConnection: ApiConnectionSummary;
  riskConfig: RiskConfig;
  strategyConfig: StrategyConfig;
  equity: number;
  availableMargin: number;
  dailyPnl: number;
  drawdownPct: number;
  strategyStatus: 'idle' | 'running' | 'paused';
  currencyMode: 'USD' | 'CAD';
  balanceDetails: BalanceDetail[];
  orderHistory: OrderHistoryItem[];
  backtest?: BacktestSummary | null;
  positions: Position[];
};

export type StrategyType = 'buy-sell' | 'trend' | 'mean-reversion' | 'breakout';
export type BacktestBar = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';

export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T | null;
  message?: string | null;
  code?: string | null;
};
