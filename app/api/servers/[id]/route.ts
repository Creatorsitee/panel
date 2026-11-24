import { NextRequest, NextResponse } from 'next/server';
import { deleteServerRecord, updateServerRecord } from '@/lib/db';
import { getServerMetrics, stopServerProcess } from '@/lib/process-manager';
import { requireServerAccess } from '@/lib/route-guard';
import {
  parseSafeStartupCommand,
  validateServerName,
} from '@/lib/security';

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
      name?: string;
      description?: string;
      startupCommand?: string;
      memoryLimitMb?: number;
      cpuLimitPercent?: number;
      autoRestart?: boolean;
    };

    const patch: Parameters<typeof updateServerRecord>[1] = {};

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
    if (body.memoryLimitMb !== undefined) {
      patch.memoryLimitMb = Math.min(8192, Math.max(128, Number(body.memoryLimitMb) || 512));
    }
    if (body.cpuLimitPercent !== undefined) {
      patch.cpuLimitPercent = Math.min(400, Math.max(25, Number(body.cpuLimitPercent) || 100));
    }
    if (body.autoRestart !== undefined) {
      patch.autoRestart = Boolean(body.autoRestart);
    }

    const updated = await updateServerRecord(id, patch);

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
