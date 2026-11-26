import { NextRequest, NextResponse } from 'next/server';
import {
  clearConsoleHistory,
  getConsoleHistory,
  getServerMetrics,
  sendCommandToServer,
  subscribeConsole,
} from '@/lib/processes';
import { requireServerAccess } from '@/lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let metricsTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (metricsTimer) {
      clearInterval(metricsTimer);
      metricsTimer = null;
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

      sendRaw('retry: 1000\n: connected\n\n');
      sendEvent('history', getConsoleHistory(id));
      sendEvent('metrics', getServerMetrics(id));

      unsubscribe = subscribeConsole(
        id,
        (line) => sendEvent('log', line),
        (metrics) => sendEvent('metrics', metrics),
        () => sendEvent('clear', { clearedAt: Date.now() })
      );

      let tickCount = 0;
      metricsTimer = setInterval(() => {
        tickCount += 1;
        if (tickCount % 30 === 0) {
          sendRaw(': ping\n\n');
        }
        sendEvent('metrics', getServerMetrics(id));
      }, 500);

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

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const body = (await req.json()) as {
      command?: string;
      action?: 'clear';
    };
    if (body.action === 'clear') {
      clearConsoleHistory(id);
      return NextResponse.json({ ok: true });
    }

    if (body.command === undefined || body.command === null) {
      return NextResponse.json({ error: 'Perintah tidak boleh kosong.' }, { status: 400 });
    }

    const command = typeof body.command === 'string' ? body.command : String(body.command);
    const result = await sendCommandToServer(id, command);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengirim perintah.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
