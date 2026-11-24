'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  RotateCw,
  Send,
  Square,
  Skull,
  Trash2,
  Cpu,
  Activity,
  Clock,
  Radio,
} from 'lucide-react';
import { apiFetch, buildAuthHeaders } from './api-client';
import type {
  ConsoleLine,
  ServerRuntimeMetrics,
  ServerWithMetrics,
} from '@/lib/types';

interface ServerConsoleTabProps {
  server: ServerWithMetrics;
  onMetricsUpdate: (metrics: ServerRuntimeMetrics) => void;
}

function formatDuration(totalSec: number): string {
  if (totalSec <= 0) return '0s';
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function ServerConsoleTab({
  server,
  onMetricsUpdate,
}: ServerConsoleTabProps) {
  const [logs, setLogs] = useState<ConsoleLine[]>([]);
  const [streamMetrics, setStreamMetrics] = useState<ServerRuntimeMetrics | null>(null);
  const metrics = streamMetrics ?? server.metrics;
  const [command, setCommand] = useState('');
  const [powerLoading, setPowerLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const onMetricsRef = useRef(onMetricsUpdate);

  useEffect(() => {
    onMetricsRef.current = onMetricsUpdate;
  }, [onMetricsUpdate]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function connectStream() {
      try {
        const res = await fetch(`/api/servers/${server.id}/console`, {
          method: 'GET',
          headers: buildAuthHeaders(),
          credentials: 'include',
          signal: controller.signal,
        });

        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const lines = frame.split('\n');
            let eventName = 'message';
            let dataStr = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                dataStr += line.slice(6);
              }
            }
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (eventName === 'history' && Array.isArray(parsed)) {
                setLogs(parsed);
              } else if (eventName === 'log') {
                setLogs((prev) => [...prev.slice(-399), parsed as ConsoleLine]);
              } else if (eventName === 'metrics') {
                const nextMetrics = parsed as ServerRuntimeMetrics;
                setStreamMetrics(nextMetrics);
                onMetricsRef.current(nextMetrics);
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      } catch {
        // aborted
      }
    }

    connectStream();
    return () => {
      active = false;
      controller.abort();
    };
  }, [server.id]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  async function runPowerAction(
    action: 'start' | 'stop' | 'restart' | 'kill'
  ) {
    setError(null);
    setPowerLoading(action);
    try {
      const res = await apiFetch<{ metrics: ServerRuntimeMetrics }>(
        `/api/servers/${server.id}/power`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      setStreamMetrics(res.metrics);
      onMetricsUpdate(res.metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menjalankan aksi.');
    } finally {
      setPowerLoading(null);
    }
  }

  async function handleSendCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    setError(null);
    try {
      await apiFetch(`/api/servers/${server.id}/console`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
      setCommand('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim perintah.');
    }
  }

  async function handleClearConsole() {
    try {
      await apiFetch(`/api/servers/${server.id}/console`, {
        method: 'POST',
        body: JSON.stringify({ action: 'clear' }),
      });
    } catch {
      // ignore
    }
  }

  const isRunning = metrics.status === 'running';
  const isBusy = metrics.status === 'installing' || metrics.status === 'starting';

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      {/* Pterodactyl Top Power Actions Bar */}
      <div className="bg-[#181b22] border border-zinc-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-300">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-zinc-400">Kontrol Daya:</span>
          <span
            className={`font-semibold uppercase px-2 py-0.5 rounded text-[11px] ${
              isRunning
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : metrics.status === 'error'
                ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            {metrics.status}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isRunning || isBusy || powerLoading !== null}
            onClick={() => runPowerAction('start')}
            className="h-8 px-3 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Play className="w-3 h-3" />
            <span>Start</span>
          </button>
          <button
            type="button"
            disabled={isBusy || powerLoading !== null}
            onClick={() => runPowerAction('restart')}
            className="h-8 px-3 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            <span>Restart</span>
          </button>
          <button
            type="button"
            disabled={!isRunning || powerLoading !== null}
            onClick={() => runPowerAction('stop')}
            className="h-8 px-3 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Square className="w-3 h-3" />
            <span>Stop</span>
          </button>
          <button
            type="button"
            disabled={!isRunning || powerLoading !== null}
            onClick={() => runPowerAction('kill')}
            className="h-8 px-2.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
            title="Kill paksa proses (SIGKILL)"
          >
            <Skull className="w-3 h-3" />
            <span>Kill</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-medium"
        >
          {error}
        </div>
      )}

      {/* Authentic Pterodactyl Console Window */}
      <div className="bg-[#0e1116] border border-zinc-800 rounded-lg overflow-hidden shadow-2xl flex flex-col">
        <div className="px-4 py-2.5 bg-[#141820] border-b border-zinc-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Terminal Console</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
              />
              <span>Auto-scroll</span>
            </label>
            <button
              type="button"
              onClick={handleClearConsole}
              className="text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div
          ref={terminalRef}
          className="h-[420px] overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-1 text-zinc-200 bg-[#0b0e13]"
        >
          {logs.length === 0 ? (
            <div className="text-zinc-600 font-mono">
              [nodal@daemon ~]$ Menunggu output proses. Klik tombol Start di atas untuk menjalankan aplikasi.
            </div>
          ) : (
            logs.map((line) => {
              const time = new Date(line.timestamp).toLocaleTimeString('id-ID', {
                hour12: false,
              });
              const lineColor =
                line.stream === 'stderr'
                  ? 'text-red-400'
                  : line.stream === 'system'
                  ? 'text-zinc-400'
                  : line.stream === 'stdin'
                  ? 'text-emerald-400'
                  : 'text-zinc-200';

              return (
                <div key={line.id} className="flex items-start gap-3 break-all">
                  <span className="text-zinc-600 select-none shrink-0 tabular-nums">
                    [{time}]
                  </span>
                  <span className={lineColor}>{line.text}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Pterodactyl Terminal Command Input Footer */}
        <form
          onSubmit={handleSendCommand}
          className="border-t border-zinc-800 bg-[#141820] px-4 py-2.5 flex items-center gap-3"
        >
          <span className="text-emerald-400 font-mono font-bold text-xs select-none">&gt;</span>
          <input
            type="text"
            aria-label="Kirim input stdin ke proses server"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={isRunning ? 'Kirim perintah atau input stdin ke server...' : 'Start server untuk mengirim input...'}
            disabled={!isRunning}
            className="flex-1 h-8 bg-transparent text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isRunning || !command.trim()}
            className="h-7 px-3 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap font-mono"
          >
            <Send className="w-3 h-3" />
            <span>Kirim</span>
          </button>
        </form>
      </div>

      {/* Pterodactyl-Style Server Metrics Below Console */}
      <div className="bg-[#181b22] border border-zinc-800 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono text-zinc-300">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-emerald-400 shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">CPU Usage</span>
            <span className="text-zinc-100 font-semibold">
              {metrics.cpuPercent.toFixed(1)}% <span className="text-zinc-500">/ {server.cpuLimitPercent}%</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-blue-400 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">RAM Usage</span>
            <span className="text-zinc-100 font-semibold">
              {metrics.memoryMb.toFixed(1)} MB <span className="text-zinc-500">/ {server.memoryLimitMb} MB</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">Uptime</span>
            <span className="text-zinc-100 font-semibold">
              {formatDuration(metrics.uptimeSeconds)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-purple-400 shrink-0">
            <Radio className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] uppercase block">Alamat Port</span>
            <span className="text-zinc-100 font-semibold">
              :{server.port} {metrics.pid ? `(PID ${metrics.pid})` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
