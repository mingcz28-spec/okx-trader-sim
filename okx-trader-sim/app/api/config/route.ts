import { NextRequest, NextResponse } from 'next/server';
import { updateApiConfig } from '@/lib/sim-store';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const state = updateApiConfig({
    apiKey: String(body.apiKey ?? ''),
    secretKey: String(body.secretKey ?? ''),
    passphrase: String(body.passphrase ?? ''),
  });
  return NextResponse.json(state);
}
