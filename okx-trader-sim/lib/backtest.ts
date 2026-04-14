const BASE = 'https://www.okx.com';

export type CandlePoint = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BacktestTradePoint = {
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  ret: number;
  reason: 'stop_loss' | 'trailing_exit';
};

export type BacktestResult = {
  stopLossPct: number;
  trailingDrawdownPct: number;
  trades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
};

export type BacktestDetail = BacktestResult & {
  candles: CandlePoint[];
  tradePoints: BacktestTradePoint[];
};

async function fetchCandles(instId: string, bar: string, limit: number, after?: string) {
  const url = new URL('/api/v5/market/history-candles', BASE);
  url.searchParams.set('instId', instId);
  url.searchParams.set('bar', bar);
  url.searchParams.set('limit', String(limit));
  if (after) url.searchParams.set('after', after);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(json.msg || 'fetch failed');
  return json.data as string[][];
}

export type SupportedBar = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';

async function loadSeries(instId: string, bar: SupportedBar = '1H', limit = 100, pages = 10) {
  let after: string | undefined;
  const rows: string[][] = [];
  for (let i = 0; i < pages; i++) {
    const data = await fetchCandles(instId, bar, limit, after);
    if (!data?.length) break;
    rows.push(...data);
    after = data[data.length - 1][0];
  }
  return rows
    .map((r) => ({ ts: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) }))
    .sort((a, b) => a.ts - b.ts);
}

function runStrategy(candles: CandlePoint[], stopLossPct: number, trailingDrawdownPct: number): BacktestDetail {
  const trades: BacktestTradePoint[] = [];
  let inPosition = false;
  let entry = 0;
  let entryTs = 0;
  let peak = 0;

  for (const c of candles) {
    if (!inPosition) {
      entry = c.close;
      entryTs = c.ts;
      peak = c.close;
      inPosition = true;
      continue;
    }
    if (c.high > peak) peak = c.high;

    const stopPrice = entry * (1 - stopLossPct / 100);
    const trailingPrice = peak * (1 - trailingDrawdownPct / 100);

    let exitPrice: number | null = null;
    let reason: 'stop_loss' | 'trailing_exit' | null = null;
    if (c.low <= stopPrice) {
      exitPrice = stopPrice;
      reason = 'stop_loss';
    } else if (c.low <= trailingPrice) {
      exitPrice = trailingPrice;
      reason = 'trailing_exit';
    }

    if (exitPrice != null && reason) {
      trades.push({
        entryTs,
        entryPrice: entry,
        exitTs: c.ts,
        exitPrice,
        ret: (exitPrice - entry) / entry,
        reason,
      });
      inPosition = false;
      entry = 0;
      entryTs = 0;
      peak = 0;
    }
  }

  const totalReturn = trades.reduce((acc, t) => acc * (1 + t.ret), 1) - 1;
  let equity = 1;
  let peakEq = 1;
  let maxDd = 0;
  for (const t of trades) {
    equity *= 1 + t.ret;
    peakEq = Math.max(peakEq, equity);
    maxDd = Math.min(maxDd, equity / peakEq - 1);
  }
  const wins = trades.filter((t) => t.ret > 0).length;
  return {
    stopLossPct,
    trailingDrawdownPct,
    trades: trades.length,
    winRate: trades.length ? wins / trades.length : 0,
    totalReturn,
    maxDrawdown: maxDd,
    candles,
    tradePoints: trades,
  };
}

export async function backtestGrid(instId = 'RAVE-USDT-SWAP', bar: SupportedBar = '1H') {
  const candles = await loadSeries(instId, bar);
  const results: BacktestResult[] = [];
  for (const stop of [0.5, 0.8, 1, 1.2, 1.5, 2]) {
    for (const trail of [1, 1.5, 2, 2.5, 3, 4]) {
      results.push(runStrategy(candles, stop, trail));
    }
  }
  results.sort((a, b) => b.totalReturn - a.totalReturn || b.winRate - a.winRate);
  return { instId, bar, candles: candles.length, top: results.slice(0, 12), results };
}

export async function backtestDetail(instId = 'RAVE-USDT-SWAP', stopLossPct = 1, trailingDrawdownPct = 2, bar: SupportedBar = '1H') {
  const candles = await loadSeries(instId, bar);
  const detail = runStrategy(candles, stopLossPct, trailingDrawdownPct);
  return {
    instId,
    bar,
    candles: detail.candles,
    tradePoints: detail.tradePoints,
    summary: {
      stopLossPct: detail.stopLossPct,
      trailingDrawdownPct: detail.trailingDrawdownPct,
      trades: detail.trades,
      winRate: detail.winRate,
      totalReturn: detail.totalReturn,
      maxDrawdown: detail.maxDrawdown,
    },
  };
}
