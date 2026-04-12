import { NextRequest, NextResponse } from 'next/server';
import { syncOkxLiveState } from '@/lib/okx';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'live' ? 'live' : 'demo';
    const state = await syncOkxLiveState(mode);
    return NextResponse.json({ ok: true, state, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步 OKX 数据失败';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
