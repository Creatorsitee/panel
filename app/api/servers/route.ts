import { NextRequest, NextResponse } from 'next/server';
import {
  createServerRecord,
  listAllServers,
  listServersForUser,
} from '@/lib/db';
import { writeInitialDotEnv } from '@/lib/file-manager';
import { getHostVpsInfo, getServerMetrics } from '@/lib/process-manager';
import { requireAuth } from '@/lib/route-guard';
import {
  allocateNextPort,
  parseSafeStartupCommand,
  validateServerName,
  validateServerPort,
} from '@/lib/security';
import {
  getDefaultCpuPercent,
  getDefaultMemoryMb,
  getPerServerMaxCpuPercent,
  getPerServerMaxMemoryMb,
} from '@/lib/vps-specs';
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
      port?: number | string;
      memoryLimitMb?: number;
      cpuLimitPercent?: number;
      autoRestart?: boolean;
    };

    const name = validateServerName(body.name || '');
    const runtime: ServerRuntime = body.runtime === 'python' ? 'python' : 'nodejs';
    const defaultCommand = runtime === 'nodejs' ? 'node index.js' : 'python3 -u main.py';
    const startupCommand = (body.startupCommand || defaultCommand).trim();
    parseSafeStartupCommand(startupCommand, runtime);

    const host = getHostVpsInfo();
    if (host.availableMemoryMb < 512) {
      return NextResponse.json(
        { error: 'Sisa memori VPS sudah tidak mencukupi (minimal 512 MB tersedia).' },
        { status: 400 }
      );
    }
    if (host.availableCpuPercent < 10) {
      return NextResponse.json(
        { error: 'Sisa batas CPU VPS sudah tidak mencukupi (minimal 10% tersedia).' },
        { status: 400 }
      );
    }

    const perServerMaxMem = getPerServerMaxMemoryMb(host);
    const perServerMaxCpu = getPerServerMaxCpuPercent(host);
    const effectiveMaxMem = Math.min(host.availableMemoryMb, perServerMaxMem);
    const effectiveMaxCpu = Math.min(host.availableCpuPercent, perServerMaxCpu);

    const defaultMemoryMb = getDefaultMemoryMb(host);
    const defaultCpuPercent = getDefaultCpuPercent(host);
    const requestedMem = Number(body.memoryLimitMb);
    const requestedCpu = Number(body.cpuLimitPercent);

    if (Number.isFinite(requestedMem) && requestedMem > host.availableMemoryMb) {
      return NextResponse.json(
        { error: `Alokasi memori melebihi sisa kapasitas VPS (${host.availableMemoryMb} MB tersedia).` },
        { status: 400 }
      );
    }
    if (Number.isFinite(requestedMem) && requestedMem > perServerMaxMem) {
      return NextResponse.json(
        { error: `Alokasi memori per server maksimal ${perServerMaxMem} MB agar resource VPS tetap merata.` },
        { status: 400 }
      );
    }
    if (Number.isFinite(requestedCpu) && requestedCpu > host.availableCpuPercent) {
      return NextResponse.json(
        { error: `Batas CPU melebihi sisa kapasitas VPS (${host.availableCpuPercent}% tersedia).` },
        { status: 400 }
      );
    }
    if (Number.isFinite(requestedCpu) && requestedCpu > perServerMaxCpu) {
      return NextResponse.json(
        { error: `Batas CPU per server maksimal ${perServerMaxCpu}% agar resource VPS tetap merata.` },
        { status: 400 }
      );
    }

    const memoryLimitMb = Math.min(
      effectiveMaxMem,
      Math.max(512, Number.isFinite(requestedMem) && requestedMem > 0 ? requestedMem : defaultMemoryMb)
    );
    const cpuLimitPercent = Math.min(
      effectiveMaxCpu,
      Math.max(10, Number.isFinite(requestedCpu) && requestedCpu > 0 ? requestedCpu : defaultCpuPercent)
    );

    const usedPorts = listAllServers().map((s) => s.port);
    const hasCustomPort =
      body.port !== undefined && body.port !== null && String(body.port).trim() !== '';
    const port = hasCustomPort
      ? validateServerPort(body.port, usedPorts)
      : allocateNextPort(usedPorts);

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
