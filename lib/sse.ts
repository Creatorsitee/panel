export interface ParsedSseFrame {
  event: string;
  data: string;
  isComment: boolean;
}

export function parseSseBuffer(rawBuffer: string): {
  frames: ParsedSseFrame[];
  remainder: string;
} {
  const normalized = rawBuffer.replace(/\r\n/g, '\n');
  const rawFrames = normalized.split('\n\n');
  const remainder = rawFrames.pop() ?? '';
  const frames: ParsedSseFrame[] = [];

  for (const rawFrame of rawFrames) {
    if (!rawFrame.trim()) continue;
    const lines = rawFrame.split('\n');
    let event = 'message';
    const dataParts: string[] = [];
    let hasComment = false;

    for (const line of lines) {
      if (line.startsWith(':')) {
        hasComment = true;
        continue;
      }
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || 'message';
      } else if (line.startsWith('data:')) {
        const val = line.slice(5);
        dataParts.push(val.startsWith(' ') ? val.slice(1) : val);
      }
    }

    if (dataParts.length > 0) {
      frames.push({
        event,
        data: dataParts.join('\n'),
        isComment: false,
      });
    } else if (hasComment) {
      frames.push({
        event: 'ping',
        data: '',
        isComment: true,
      });
    }
  }

  return { frames, remainder };
}

export interface ConnectSseOptions {
  url: string;
  getHeaders?: () => Record<string, string>;
  onEvent: (event: string, data: unknown) => void;
  onActivity?: () => void;
  onHttpError?: (status: number) => void;
  onConnectionError?: () => void;
  reconnectDelayMs?: number;
  staleTimeoutMs?: number;
}

export function connectSseStream(options: ConnectSseOptions): () => void {
  const {
    url,
    getHeaders,
    onEvent,
    onActivity,
    onHttpError,
    onConnectionError,
    reconnectDelayMs = 1500,
    staleTimeoutMs = 15000,
  } = options;

  let active = true;
  let controller = new AbortController();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStaleTimer = () => {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (!active) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (active) void connect();
    }, reconnectDelayMs);
  };

  async function connect() {
    controller = new AbortController();
    let timedOut = false;

    const resetStaleTimer = () => {
      clearStaleTimer();
      if (!active || staleTimeoutMs <= 0) return;
      staleTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, staleTimeoutMs);
    };

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: getHeaders ? getHeaders() : undefined,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        if (!active) return;
        onHttpError?.(res.status);
        if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
          scheduleReconnect();
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      resetStaleTimer();

      while (active) {
        const { value, done } = await reader.read();
        if (done) break;
        resetStaleTimer();
        buffer += decoder.decode(value, { stream: true });

        const parsed = parseSseBuffer(buffer);
        buffer = parsed.remainder;

        for (const frame of parsed.frames) {
          onActivity?.();
          if (frame.isComment || !frame.data) continue;
          try {
            const payload = JSON.parse(frame.data);
            onEvent(frame.event, payload);
          } catch {

          }
        }
      }

      clearStaleTimer();
      scheduleReconnect();
    } catch {
      clearStaleTimer();
      if (active && (timedOut || !controller.signal.aborted)) {
        onConnectionError?.();
        scheduleReconnect();
      }
    }
  }

  void connect();

  return () => {
    active = false;
    clearStaleTimer();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    controller.abort();
  };
}
