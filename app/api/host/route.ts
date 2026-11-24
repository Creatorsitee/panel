import { NextRequest, NextResponse } from 'next/server';
import { getHostVpsInfo } from '@/lib/process-manager';
import { requireAuth } from '@/lib/route-guard';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth.error) return auth.error;

  const host = getHostVpsInfo();
  return NextResponse.json({ host });
}
