import { NextRequest, NextResponse } from 'next/server';
import { getHostInfo } from '@/lib/processes';
import { requireAuth } from '@/lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth.error) return auth.error;

  const host = getHostInfo();
  return NextResponse.json({ host });
}
