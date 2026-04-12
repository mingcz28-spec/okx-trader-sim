import fs from 'fs';

const BASE = 'https://www.okx.com';
const INST_ID = 'RAVE-USDT-SWAP';
const BAR = '1H';
const LIMIT = 100;
const PAGES = 10;

async function fetchCandles(after) {
  const url = new URL('/api/v5/market/history-candles', BASE);
  url.searchParams.set('instId', INST_ID);
  url.searchParams.set('bar', BAR);
  url.searchParams.set('limit', String(LIMIT));
  if (after) url.searchParams.set('after', String(after));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(json.msg || 'fetch failed');
  return json.data;
}

async function loadSeries() {
  let after = undefined;
  const rows = [];
  for (let i = 0; i < PAGES; i++) {
    const data = await fetchCandles(after);
    if (!data?.length) break;
    rows.push(...data);
    after = data[data.length - 1][0];
  }
  const candles = rows.map((r) => ({
    ts: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
  })).sort((a, b) => a.ts - b.ts);
  return candles;
}

function runStrategy(candles, stopLossPct, trailingDrawdownPct) {
  let trades = [];
  let inPosition = false;
  let entry = 0;
  let peak = 0;

  for (const c of candles) {
    if (!inPosition) {
      entry = c.close;
      peak = c.close;
      inPosition = true;
      continue;
    }

    if (c.high > peak) peak = c.high;

    const stopPrice = entry * (1 - stopLossPct / 100);
    const trailingPrice = peak * (1 - trailingDrawdownPct / 100);
    let exitPrice = null;
    let reason = null;

    if (c.low <= stopPrice) {
      exitPrice = stopPrice;
      reason = 'stop_loss';
    } else if (c.low <= trailingPrice) {
      exitPrice = trailingPrice;
      reason = 'trailing_exit';
    }

    if (exitPrice != null) {
      const ret = (exitPrice - entry) / entry;
      trades.push({ entry, exit: exitPrice, ret, reason, ts: c.ts });
      inPosition = false;
      entry = 0;
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
  };
}

function fmt(n) {
  return `${(n * 100).toFixed(2)}%`;
}

const candles = await loadSeries();
const results = [];
for (const stop of [0.5, 0.8, 1, 1.2, 1.5, 2]) {
  for (const trail of [1, 1.5, 2, 2.5, 3, 4]) {
    results.push(runStrategy(candles, stop, trail));
  }
}
results.sort((a, b) => b.totalReturn - a.totalReturn || b.winRate - a.winRate);

const top = results.slice(0, 10);
console.log(JSON.stringify({ instId: INST_ID, bar: BAR, candles: candles.length, top }, null, 2));
fs.writeFileSync('backtest-rave-results.json', JSON.stringify({ instId: INST_ID, bar: BAR, candles: candles.length, results }, null, 2));
for (const r of top) {
  console.log(`stop=${r.stopLossPct}% trail=${r.trailingDrawdownPct}% trades=${r.trades} winRate=${fmt(r.winRate)} total=${fmt(r.totalReturn)} maxDD=${fmt(r.maxDrawdown)}`);
}
