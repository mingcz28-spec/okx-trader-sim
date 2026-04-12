import { NextRequest, NextResponse } from 'next/server';
import { closeAllPositions, openSimPosition } from '@/lib/sim-store';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const state = openSimPosition({
    symbol: String(body.symbol ?? 'BTC-USDT-SWAP'),
    side: body.side === 'sell' ? 'sell' : 'buy',
    leverage: Number(body.leverage ?? 3),
    notional: Number(body.notional ?? 100),
  });
  return NextResponse.json(state);
}

export async function DELETE() {
  return NextResponse.json(closeAllPositions());
}
