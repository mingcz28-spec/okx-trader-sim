import { NextRequest, NextResponse } from 'next/server';
import { updateRiskConfig } from '@/lib/sim-store';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const state = updateRiskConfig({
    maxPositionPct: Number(body.maxPositionPct ?? 5),
    maxDailyLossPct: Number(body.maxDailyLossPct ?? 3),
    maxConsecutiveLosses: Number(body.maxConsecutiveLosses ?? 3),
  });
  return NextResponse.json(state);
}
