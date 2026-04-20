export type StrategyType = 'buy-sell' | 'trend' | 'mean-reversion' | 'breakout';
export type BacktestBar = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';
export type RealtimeAction = 'open_long' | 'open_short' | 'close' | 'force_close' | 'hold';
export type PositionSide = 'long' | 'short' | 'flat';

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
  leverage: number;
  highestPriceSinceEntry?: number | null;
  entryPrice?: number | null;
  lastSignal: string;
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
  posSide?: string | null;
  orderType: string;
  state: string;
  price: number;
  size: number;
  filledSize: number;
  createdAt: string;
  avgPrice?: number | null;
  fee?: number | null;
  feeCcy?: string | null;
  pnl?: number | null;
};

export type BacktestResult = {
  stopLossPct: number;
  trailingDrawdownPct: number;
  leverage: number;
  trades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  grossTotalReturn: number;
  netTotalReturn: number;
  feeCost: number;
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
  reason: string;
  side: 'long' | 'short';
  grossRet: number;
  netRet: number;
  leverage: number;
  feeCost: number;
  entryFeeRate: number;
  exitFeeRate: number;
  orderId?: string | null;
  executionMode?: 'simulated' | 'live';
  requestedAction?: string | null;
  executedSide?: string | null;
  executedPrice?: number | null;
  executedSize?: number | null;
  exchangeState?: string | null;
  entryOrderId?: string | null;
  exitOrderId?: string | null;
  entryAvgPx?: number | null;
  exitAvgPx?: number | null;
  grossPnl?: number | null;
  fee?: number | null;
  fundingFee?: number | null;
  netPnl?: number | null;
  netReturn?: number | null;
  feeRateSource?: string;
  reconciliationStatus?: string;
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

export type StrategyParameterSet = {
  stopLossPct: number;
  trailingDrawdownPct: number;
  leverage: number;
};

export type StrategyParameter = {
  id: string;
  label: string;
  description: string;
  value: number;
  unit: string;
};

export type ConfirmRealtimeSessionPayload = {
  instId: string;
  bar: BacktestBar;
  strategyType: StrategyType;
  stopLossPct: number;
  trailingDrawdownPct: number;
  leverage: number;
  autoOptimizeParameters?: boolean;
};

export type LiveRealtimeSessionPayload = ConfirmRealtimeSessionPayload;

export type StrategyDefinition = {
  id: StrategyType;
  name: string;
  description: string;
  status: 'active' | 'pending';
  supportsBacktest: boolean;
  supportsRealtime: boolean;
  defaultParams: StrategyParameterSet;
  parameters: StrategyParameter[];
};

export type InstrumentSuggestion = {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  instType: string;
  state: string;
};

export type RealtimeConsole = {
  strategyType: StrategyType;
  strategyName: string;
  strategyStatusLabel: string;
  strategyStatus: 'idle' | 'running' | 'paused';
  enabled: boolean;
  symbol: string;
  lastPrice?: number | null;
  candleCount: number;
  hasPosition: boolean;
  entryPrice?: number | null;
  lastSignal: RealtimeAction | string;
  stopLossPct: number;
  trailingDrawdownPct: number;
  leverage: number;
  riskState: string;
  executionAdvice: string;
  positionCount: number;
  marketNote?: string | null;
  updatedAt: string;
  logs: string[];
};

export type RealtimeSession = {
  sessionId: string;
  mode: 'simulated' | 'live';
  instId: string;
  bar: BacktestBar;
  strategyType: StrategyType;
  params: StrategyParameterSet;
  autoOptimizeParameters: boolean;
  lastOptimizationResult?: BacktestResult | null;
  lastOptimizationReason?: string | null;
  paramsSource: string;
  startedAt: string;
  status: string;
  positionSide: PositionSide;
  entryPrice?: number | null;
  entryTs?: number | null;
  peakPrice?: number | null;
  troughPrice?: number | null;
  positionSize?: number | null;
  allocatedCapital?: number | null;
  entryNotionalUsd?: number | null;
  lastSettledCandleTs?: number | null;
  lastOrderId?: string | null;
  lastExecutionPrice?: number | null;
  lastExecutionTs?: number | null;
  lastExecutionSize?: number | null;
  lastTakerFeeRate: number;
  feeRateSource: string;
  reconciliationStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type RealtimeLiveSession = {
  sessionId: string;
  mode: 'simulated' | 'live';
  instId: string;
  bar: BacktestBar;
  strategyType: StrategyType;
  params: StrategyParameterSet;
  autoOptimizeParameters: boolean;
  lastOptimizationResult?: BacktestResult | null;
  lastOptimizationReason?: string | null;
  paramsSource: string;
  startedAt: string;
  status: string;
  positionSide: PositionSide;
  entryPrice?: number | null;
  entryTs?: number | null;
  positionSize?: number | null;
  allocatedCapital?: number | null;
  entryNotionalUsd?: number | null;
  lastSettledCandleTs?: number | null;
  lastSignal: RealtimeAction | string;
  signalReason: string;
  lastOrderId?: string | null;
  lastExecutionPrice?: number | null;
  lastExecutionTs?: number | null;
  lastExecutionSize?: number | null;
  lastTakerFeeRate: number;
  feeRateSource: string;
  reconciliationStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  summary?: BacktestResult | null;
  tradePoints: BacktestTradePoint[];
  periodEvaluations: RealtimePeriodEvaluation[];
  lastTrade?: BacktestTradePoint | null;
  lastEvaluation?: RealtimePeriodEvaluation | null;
};

export type RealtimePeriodEvaluation = {
  ts: number;
  close: number;
  action: RealtimeAction;
  positionSide: PositionSide;
  executionPrice?: number | null;
  reason: string;
  positionStatus: string;
  periodReturn: number;
  realizedReturn: number;
  unrealizedReturn: number;
  totalReturn: number;
  grossReturn: number;
  netReturn: number;
  feeCost: number;
  entryFeeRate: number;
  exitFeeRate: number;
  equity: number;
  grossPnl?: number | null;
  fee?: number | null;
  fundingFee?: number | null;
  netPnl?: number | null;
  feeRateSource?: string;
  reconciliationStatus?: string;
};

export type RealtimeSimulation = {
  summary?: BacktestResult | null;
  candles: CandlePoint[];
  tradePoints: BacktestTradePoint[];
  strategyParams: StrategyParameterSet;
  parameterDefinitions: StrategyParameter[];
  periodEvaluations: RealtimePeriodEvaluation[];
  equityCurve: number[];
  realizedReturn: number;
  unrealizedReturn: number;
  positionStatus: string;
  openEntryPrice?: number | null;
  openEntryTs?: number | null;
  lastTradeReturn?: number | null;
  lastSignal: RealtimeAction | string;
  signalReason: string;
  buyPoints: number;
  sellPoints: number;
  paramsSource: string;
  hasSelectedParams: boolean;
  isConfirmed: boolean;
};

export type RealtimeLive = {
  connectionStatus: string;
  confirmationStatus: string;
  signal: RealtimeAction | string;
  signalReason: string;
  triggeredAt: string;
  triggerPrice?: number | null;
  positionCount: number;
  riskNote: string;
  hasAccountConnection: boolean;
};

export type RealtimeWorkspace = {
  instId: string;
  bar: BacktestBar;
  selectedStrategyType: StrategyType;
  pendingStrategyType?: StrategyType | null;
  confirmedStrategyType?: StrategyType | null;
  confirmedSession?: RealtimeSession | null;
  liveSession?: RealtimeLiveSession | null;
  strategyParams: StrategyParameterSet;
  paramsSource: string;
  candles: CandlePoint[];
  currentCandle?: CandlePoint | null;
  latestPrice?: number | null;
  lastClosedCandleTs?: number | null;
  nextRefreshAt?: string | null;
  updatedAt: string;
  simulation: RealtimeSimulation;
  live: RealtimeLive;
};

export type OkxAccountConfig = {
  positionMode: string;
  canTrade: boolean;
  accountLevel: string;
  marginModeHint: string;
  tradingMode: string;
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

export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T | null;
  message?: string | null;
  code?: string | null;
};
