import { NextRequest, NextResponse } from 'next/server';
import { getHostInfo } from '@/lib/process-manager';
import { requireAuth } from '@/lib/route-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth.error) return auth.error;

  const host = getHostInfo();
  return NextResponse.json({ host });
}
