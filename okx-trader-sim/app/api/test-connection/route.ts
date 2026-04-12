import { NextRequest, NextResponse } from 'next/server';
import { testOkxConnection } from '@/lib/okx';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'live' ? 'live' : 'demo';
    const result = await testOkxConnection(mode);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '连接测试失败';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
