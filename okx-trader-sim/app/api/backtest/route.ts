import { NextRequest, NextResponse } from 'next/server';
import { backtestGrid } from '@/lib/backtest';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const instId = typeof body.instId === 'string' && body.instId ? body.instId : 'RAVE-USDT-SWAP';
    const result = await backtestGrid(instId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '回测失败';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
