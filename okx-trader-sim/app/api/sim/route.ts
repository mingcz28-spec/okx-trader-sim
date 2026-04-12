import { NextResponse } from 'next/server';
import { getSimState } from '@/lib/sim-store';

export async function GET() {
  return NextResponse.json(getSimState());
}
