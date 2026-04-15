import { NextRequest, NextResponse } from 'next/server';
import { backtestDetail, backtestGrid, type SupportedBar, type StrategyType } from '@/lib/backtest';
import { getSimState, updateBacktest } from '@/lib/sim-store';

export async function GET() {
  return NextResponse.json({ ok: true, backtest: getSimState().backtest ?? null });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const instId = typeof body.instId === 'string' && body.instId ? body.instId : 'RAVE-USDT-SWAP';
    const allowedBars: SupportedBar[] = ['1m', '5m', '15m', '1H', '4H', '1D'];
    const bar: SupportedBar = allowedBars.includes(body.bar) ? body.bar : '1H';
    const strategyType: StrategyType = body.strategyType === 'trend' ? 'trend' : body.strategyType === 'mean-reversion' ? 'mean-reversion' : body.strategyType === 'breakout' ? 'breakout' : 'buy-sell';
    if (body.mode === 'detail') {
      const result = await backtestDetail(
        instId,
        Number(body.stopLossPct ?? 1),
        Number(body.trailingDrawdownPct ?? 2),
        bar,
        strategyType,
      );
      const current = getSimState().backtest;
      updateBacktest({
        instId: result.instId,
        bar: result.bar,
        strategyType: result.strategyType,
        candles: result.candles.length,
        results: current?.results ?? [],
        top: current?.top ?? [],
        selected: result.summary,
        chartCandles: result.candles,
        tradePoints: result.tradePoints,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await backtestGrid(instId, bar, strategyType);
    updateBacktest({
      instId: result.instId,
      bar: result.bar,
      strategyType: result.strategyType,
      candles: result.candles,
      results: result.results,
      top: result.top,
      selected: getSimState().backtest?.selected,
      chartCandles: getSimState().backtest?.chartCandles ?? [],
      tradePoints: getSimState().backtest?.tradePoints ?? [],
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测失败';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
