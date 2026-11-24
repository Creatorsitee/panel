import { NextRequest, NextResponse } from 'next/server';
import {
  createServerRecord,
  listAllServers,
  listServersForUser,
} from '@/lib/db';
import { writeInitialDotEnv } from '@/lib/file-manager';
import { getServerMetrics } from '@/lib/process-manager';
import { requireAuth } from '@/lib/route-guard';
import {
  allocateNextPort,
  parseSafeStartupCommand,
  validateServerName,
} from '@/lib/security';
import type { ServerRuntime, ServerWithMetrics } from '@/lib/types';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth.error) return auth.error;

  const servers = listServersForUser(auth.session.userId, auth.session.role);
  const enriched: ServerWithMetrics[] = servers.map((srv) => ({
    ...srv,
    metrics: getServerMetrics(srv.id),
  }));

  return NextResponse.json({ servers: enriched });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      runtime?: ServerRuntime;
      startupCommand?: string;
      memoryLimitMb?: number;
      cpuLimitPercent?: number;
      autoRestart?: boolean;
    };

    const name = validateServerName(body.name || '');
    const runtime: ServerRuntime = body.runtime === 'python' ? 'python' : 'nodejs';
    const defaultCommand = runtime === 'nodejs' ? 'node index.js' : 'python3 -u main.py';
    const startupCommand = (body.startupCommand || defaultCommand).trim();
    parseSafeStartupCommand(startupCommand, runtime);

    const memoryLimitMb = Math.min(8192, Math.max(128, Number(body.memoryLimitMb) || 512));
    const cpuLimitPercent = Math.min(400, Math.max(25, Number(body.cpuLimitPercent) || 100));

    const usedPorts = listAllServers().map((s) => s.port);
    const port = allocateNextPort(usedPorts);

    const server = await createServerRecord({
      ownerId: auth.session.userId,
      name,
      description: (body.description || '').trim().slice(0, 160),
      runtime,
      startupCommand,
      port,
      memoryLimitMb,
      cpuLimitPercent,
      autoRestart: Boolean(body.autoRestart),
    });

    writeInitialDotEnv(server.id, {
      PORT: String(server.port),
      ...(runtime === 'nodejs' ? { NODE_ENV: 'production' } : { PYTHONUNBUFFERED: '1' }),
    });

    return NextResponse.json(
      { server: { ...server, metrics: getServerMetrics(server.id) } },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal membuat server.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
