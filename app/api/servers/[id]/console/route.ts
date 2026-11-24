import { NextRequest, NextResponse } from 'next/server';
import {
  clearConsoleHistory,
  getConsoleHistory,
  getServerMetrics,
  sendStdinToServer,
  subscribeConsole,
} from '@/lib/process-manager';
import { requireServerAccess } from '@/lib/route-guard';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let metricsTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          cleanup?.();
        }
      };

      sendEvent('history', getConsoleHistory(id));
      sendEvent('metrics', getServerMetrics(id));

      const unsubscribe = subscribeConsole(
        id,
        (line) => sendEvent('log', line),
        (metrics) => sendEvent('metrics', metrics)
      );

      metricsTimer = setInterval(() => {
        sendEvent('metrics', getServerMetrics(id));
      }, 1000);

      cleanup = () => {
        closed = true;
        unsubscribe();
        if (metricsTimer) clearInterval(metricsTimer);
      };

      req.signal.addEventListener('abort', () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // ignore already closed
        }
      });
    },
    cancel() {
      cleanup?.();
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

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const body = (await req.json()) as { command?: string; action?: 'clear' };
    if (body.action === 'clear') {
      clearConsoleHistory(id);
      return NextResponse.json({ ok: true });
    }

    const command = typeof body.command === 'string' ? body.command : String(body.command ?? '');
    if (!command.trim()) {
      return NextResponse.json({ error: 'Perintah tidak boleh kosong.' }, { status: 400 });
    }

    sendStdinToServer(id, command);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengirim perintah.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
