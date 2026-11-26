import { NextRequest, NextResponse } from 'next/server';
import {
  getServerMetrics,
  restartServerProcess,
  startServerProcess,
  stopServerProcess,
} from '@/lib/processes';
import { requireServerAccess } from '@/lib/guards';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const body = (await req.json()) as {
      action?: 'start' | 'stop' | 'restart' | 'kill';
    };

    switch (body.action) {
      case 'start':
        await startServerProcess(id);
        break;
      case 'stop':
        await stopServerProcess(id, false);
        break;
      case 'kill':
        await stopServerProcess(id, true);
        break;
      case 'restart':
        await restartServerProcess(id);
        break;
      default:
        return NextResponse.json({ error: 'Aksi power tidak valid.' }, { status: 400 });
    }

    return NextResponse.json({ metrics: getServerMetrics(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menjalankan aksi server.';
    return NextResponse.json({ error: message, metrics: getServerMetrics(id) }, { status: 400 });
  }
}
