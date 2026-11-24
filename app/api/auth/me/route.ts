import { NextRequest, NextResponse } from 'next/server';
import { extractSessionFromRequest, toPublicUser } from '@/lib/auth';
import { getUserById } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = extractSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const user = getUserById(session.userId);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json({ user: toPublicUser(user) });
}
