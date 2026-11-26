import { NextRequest, NextResponse } from 'next/server';
import { toPublicUser } from '@/lib/auth';
import {
  getUserById,
  listAllServers,
  listAllUsers,
  listServersForUser,
} from '@/lib/db';
import { getHostInfo, getServerMetrics } from '@/lib/processes';
import { subscribeFilesChanged, subscribeWorkspaceEvents } from '@/lib/events';
import { requireAuth } from '@/lib/guards';
import type {
  AdminServerSummary,
  AdminUserSummary,
  ServerWithMetrics,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth.error) return auth.error;

  const scope = req.nextUrl.searchParams.get('scope') === 'admin' ? 'admin' : 'workspace';
  if (scope === 'admin' && auth.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Akses ditolak. Diperlukan hak akses administrator.' },
      { status: 403 }
    );
  }

  const userId = auth.user.id;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let unsubscribeFiles: (() => void) | null = null;
  let metricsTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeFiles) {
      unsubscribeFiles();
      unsubscribeFiles = null;
    }
    if (metricsTimer) {
      clearInterval(metricsTimer);
      metricsTimer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      if (req.signal.aborted) {
        cleanup();
        try {
          controller.close();
        } catch {

        }
        return;
      }

      const sendRaw = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const sendEvent = (event: string, data: unknown) => {
        sendRaw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const pushSnapshot = () => {
        if (closed) return;
        const freshUser = getUserById(userId);
        if (!freshUser) {
          sendEvent('auth-error', { status: 401, error: 'Sesi tidak valid.' });
          cleanup();
          try {
            controller.close();
          } catch {
          }
          return;
        }

        if (scope === 'admin' && freshUser.role !== 'admin') {
          sendEvent('auth-error', {
            status: 403,
            error: 'Akses ditolak. Diperlukan hak akses administrator.',
          });
          cleanup();
          try {
            controller.close();
          } catch {
          }
          return;
        }

        const host = getHostInfo();

        if (scope === 'admin') {
          const users = listAllUsers();
          const allServers = listAllServers();
          const serverCountMap = new Map<string, number>();
          const userMap = new Map(users.map((u) => [u.id, u]));

          for (const srv of allServers) {
            serverCountMap.set(srv.ownerId, (serverCountMap.get(srv.ownerId) || 0) + 1);
          }

          const adminUsers: AdminUserSummary[] = users.map((u) => ({
            ...toPublicUser(u),
            serverCount: serverCountMap.get(u.id) || 0,
          }));

          const adminServers: AdminServerSummary[] = allServers.map((srv) => {
            const owner = userMap.get(srv.ownerId);
            return {
              ...srv,
              metrics: getServerMetrics(srv.id),
              ownerName: owner?.name || 'User Terhapus',
              ownerEmail: owner?.email || '—',
            };
          });

          sendEvent('snapshot', {
            user: toPublicUser(freshUser),
            users: adminUsers,
            servers: adminServers,
            host,
          });
          return;
        }

        const userServers = listServersForUser(freshUser.id, freshUser.role);
        const enrichedServers: ServerWithMetrics[] = userServers.map((srv) => ({
          ...srv,
          metrics: getServerMetrics(srv.id),
        }));

        sendEvent('snapshot', {
          user: toPublicUser(freshUser),
          servers: enrichedServers,
          host,
        });
      };

      sendRaw('retry: 1000\n: connected\n\n');
      pushSnapshot();

      unsubscribe = subscribeWorkspaceEvents(() => {
        if (closed || debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          pushSnapshot();
        }, 40);
      });

      if (scope === 'workspace') {
        unsubscribeFiles = subscribeFilesChanged((changedServerId) => {
          if (closed) return;
          const freshUser = getUserById(userId);
          if (!freshUser) return;
          const allowed =
            freshUser.role === 'admin' ||
            listServersForUser(freshUser.id, freshUser.role).some((s) => s.id === changedServerId);
          if (allowed) {
            sendEvent('files-changed', { serverId: changedServerId });
          }
        });
      }

      metricsTimer = setInterval(() => {
        pushSnapshot();
      }, 1000);

      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
