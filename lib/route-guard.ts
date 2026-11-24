import { NextRequest, NextResponse } from 'next/server';
import { extractSessionFromRequest, type SessionPayload } from './auth';
import { getServerById } from './db';
import type { ServerConfig } from './types';

export function requireAuth(
  req: NextRequest
): { session: SessionPayload; error?: never } | { session?: never; error: NextResponse } {
  const session = extractSessionFromRequest(req);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' },
        { status: 401 }
      ),
    };
  }
  return { session };
}

export function requireServerAccess(
  req: NextRequest,
  serverId: string
):
  | { session: SessionPayload; server: ServerConfig; error?: never }
  | { session?: never; server?: never; error: NextResponse } {
  const authResult = requireAuth(req);
  if (authResult.error) {
    return { error: authResult.error };
  }

  const server = getServerById(serverId);
  if (!server) {
    return {
      error: NextResponse.json({ error: 'Server tidak ditemukan.' }, { status: 404 }),
    };
  }

  if (authResult.session.role !== 'admin' && server.ownerId !== authResult.session.userId) {
    return {
      error: NextResponse.json(
        { error: 'Anda tidak memiliki izin untuk mengakses server ini.' },
        { status: 403 }
      ),
    };
  }

  return { session: authResult.session, server };
}
