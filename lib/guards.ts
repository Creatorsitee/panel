import { NextRequest, NextResponse } from 'next/server';
import { extractSessionFromRequest, type SessionPayload } from './auth';
import { getServerById, getUserById } from './db';
import type { ServerConfig, UserRecord } from './types';

export function requireAuth(
  req: NextRequest
):
  | { session: SessionPayload; user: UserRecord; error?: never }
  | { session?: never; user?: never; error: NextResponse } {
  const session = extractSessionFromRequest(req);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' },
        { status: 401 }
      ),
    };
  }

  const user = getUserById(session.userId);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: 'Akun tidak ditemukan atau telah dihapus.' },
        { status: 401 }
      ),
    };
  }

  return { session, user };
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

  if (authResult.user.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Akses ditolak. Fitur ini khusus administrator.' },
        { status: 403 }
      ),
    };
  }

  return { session: authResult.session, user: authResult.user };
}

export function requireServerAccess(
  req: NextRequest,
  serverId: string
):
  | { session: SessionPayload; user: UserRecord; server: ServerConfig; error?: never }
  | { session?: never; user?: never; server?: never; error: NextResponse } {
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

  if (authResult.user.role !== 'admin' && server.ownerId !== authResult.user.id) {
    return {
      error: NextResponse.json(
        { error: 'Anda tidak memiliki izin untuk mengakses server ini.' },
        { status: 403 }
      ),
    };
  }

  return { session: authResult.session, user: authResult.user, server };
}
