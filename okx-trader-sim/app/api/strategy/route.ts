import { NextRequest, NextResponse } from 'next/server';
import { getSimState, updateStrategyConfig } from '@/lib/sim-store';

export async function GET() {
  return NextResponse.json(getSimState().strategyConfig ?? null);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const state = updateStrategyConfig({
    enabled: Boolean(body.enabled),
    entrySide: 'buy',
    stopLossPct: Number(body.stopLossPct ?? 1),
    trailingDrawdownPct: Number(body.trailingDrawdownPct ?? 2),
    highestPriceSinceEntry: body.highestPriceSinceEntry == null ? undefined : Number(body.highestPriceSinceEntry),
    entryPrice: body.entryPrice == null ? undefined : Number(body.entryPrice),
    lastSignal: body.lastSignal === 'buy' || body.lastSignal === 'sell' || body.lastSignal === 'hold' ? body.lastSignal : 'hold',
  });
  return NextResponse.json(state.strategyConfig);
}
