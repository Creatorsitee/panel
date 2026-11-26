import { NextRequest, NextResponse } from 'next/server';
import { deleteServerRecord, getUserById, listAllServers, updateServerRecord } from '@/lib/db';
import { updateServerDotEnvPort } from '@/lib/files';
import { getHostInfo, getServerMetrics, stopServerProcess } from '@/lib/processes';
import { requireServerAccess } from '@/lib/guards';
import {
  parseSafeStartupCommand,
  validateServerName,
  validateServerPort,
} from '@/lib/security';
import {
  getAvailableCpuPercent,
  getAvailableMemoryMb,
  getEffectiveMinCpuPercent,
  getEffectiveMinMemoryMb,
  getPerServerMaxCpuPercent,
  getPerServerMaxMemoryMb,
} from '@/lib/resource-limits';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  return NextResponse.json({
    server: {
      ...access.server,
      metrics: getServerMetrics(id),
    },
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const body = (await req.json()) as {
      ownerId?: string;
      name?: string;
      description?: string;
      startupCommand?: string;
      port?: number | string;
      memoryLimitMb?: number;
      cpuLimitPercent?: number;
      autoRestart?: boolean;
    };

    const host = getHostInfo();
    const currentMetrics = getServerMetrics(id);
    const isServerActive =
      currentMetrics.status === 'running' ||
      currentMetrics.status === 'starting' ||
      currentMetrics.status === 'stopping' ||
      currentMetrics.status === 'installing';
    const perServerMaxMem = getPerServerMaxMemoryMb(host);
    const perServerMaxCpu = getPerServerMaxCpuPercent(host);
    const maxMemoryForServer = Math.max(
      access.server.memoryLimitMb,
      Math.min(
        perServerMaxMem,
        getAvailableMemoryMb(host, isServerActive ? access.server.memoryLimitMb : 0)
      )
    );
    const maxCpuForServer = Math.max(
      access.server.cpuLimitPercent,
      Math.min(
        perServerMaxCpu,
        getAvailableCpuPercent(host, isServerActive ? access.server.cpuLimitPercent : 0)
      )
    );

    const patch: Parameters<typeof updateServerRecord>[1] = {};
    const actor = access.user;

    if (body.ownerId !== undefined) {
      if (actor.role !== 'admin') {
        return NextResponse.json(
          { error: 'Hanya administrator yang dapat memindahkan kepemilikan server.' },
          { status: 403 }
        );
      }
      const targetUser = getUserById(body.ownerId);
      if (!targetUser) {
        return NextResponse.json({ error: 'User pemilik baru tidak ditemukan.' }, { status: 400 });
      }
      patch.ownerId = targetUser.id;
    }
    if (body.name !== undefined) {
      patch.name = validateServerName(body.name);
    }
    if (body.description !== undefined) {
      patch.description = String(body.description).trim().slice(0, 160);
    }
    if (body.startupCommand !== undefined) {
      parseSafeStartupCommand(body.startupCommand, access.server.runtime);
      patch.startupCommand = body.startupCommand.trim();
    }
    if (body.port !== undefined && body.port !== null && String(body.port).trim() !== '') {
      const usedPorts = listAllServers()
        .filter((s) => s.id !== id)
        .map((s) => s.port);
      const nextPort = validateServerPort(body.port, usedPorts);
      if (nextPort !== access.server.port) {
        if (actor.role !== 'admin') {
          return NextResponse.json(
            { error: 'Anda tidak memiliki izin untuk mengubah port server.' },
            { status: 403 }
          );
        }
        patch.port = nextPort;
      }
    }
    if (body.memoryLimitMb !== undefined) {
      const requestedMem = Number(body.memoryLimitMb);
      if (Number.isFinite(requestedMem) && requestedMem !== access.server.memoryLimitMb) {
        if (requestedMem > maxMemoryForServer) {
          return NextResponse.json(
            { error: `Alokasi memori melebihi batas per server atau sisa kapasitas host (${maxMemoryForServer} MB).` },
            { status: 400 }
          );
        }
        const minMemForServer = getEffectiveMinMemoryMb(maxMemoryForServer);
        patch.memoryLimitMb = Math.min(
          maxMemoryForServer,
          Math.max(minMemForServer, requestedMem || access.server.memoryLimitMb)
        );
      }
    }
    if (body.cpuLimitPercent !== undefined) {
      const requestedCpu = Number(body.cpuLimitPercent);
      if (Number.isFinite(requestedCpu) && requestedCpu !== access.server.cpuLimitPercent) {
        if (requestedCpu > maxCpuForServer) {
          return NextResponse.json(
            { error: `Batas CPU melebihi batas per server atau sisa kapasitas host (${maxCpuForServer}%).` },
            { status: 400 }
          );
        }
        const minCpuForServer = getEffectiveMinCpuPercent(maxCpuForServer);
        patch.cpuLimitPercent = Math.min(
          maxCpuForServer,
          Math.max(minCpuForServer, requestedCpu || access.server.cpuLimitPercent)
        );
      }
    }
    if (body.autoRestart !== undefined) {
      patch.autoRestart = Boolean(body.autoRestart);
    }

    const updated = await updateServerRecord(id, patch);
    if (patch.port !== undefined) {
      updateServerDotEnvPort(id, patch.port);
    }

    return NextResponse.json({
      server: {
        ...updated,
        metrics: getServerMetrics(id),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memperbarui server.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  await stopServerProcess(id, true);
  await deleteServerRecord(id);

  return NextResponse.json({ ok: true });
}
