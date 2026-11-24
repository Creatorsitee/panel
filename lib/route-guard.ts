import { NextRequest, NextResponse } from 'next/server';
import { extractSessionFromRequest, type SessionPayload } from './auth';
import { getServerById, getUserById } from './db';
import type { ServerConfig, UserRecord } from './types';

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

export function requireAdmin(
  req: NextRequest
):
  | { session: SessionPayload; user: UserRecord; error?: never }
  | { session?: never; user?: never; error: NextResponse } {
  const authResult = requireAuth(req);
  if (authResult.error) {
    return { error: authResult.error };
  }

  const user = getUserById(authResult.session.userId);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: 'Akun tidak ditemukan atau telah dihapus.' },
        { status: 401 }
      ),
    };
  }

  if (user.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Akses ditolak. Fitur ini khusus administrator.' },
        { status: 403 }
      ),
    };
  }

  return { session: authResult.session, user };
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

  const user = getUserById(authResult.session.userId);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: 'Akun tidak ditemukan atau telah dihapus.' },
        { status: 401 }
      ),
    };
  }

  const server = getServerById(serverId);
  if (!server) {
    return {
      error: NextResponse.json({ error: 'Server tidak ditemukan.' }, { status: 404 }),
    };
  }

  if (user.role !== 'admin' && server.ownerId !== user.id) {
    return {
      error: NextResponse.json(
        { error: 'Anda tidak memiliki izin untuk mengakses server ini.' },
        { status: 403 }
      ),
    };
  }

  return { session: authResult.session, server };
}
