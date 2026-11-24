'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  CornerDownLeft,
  Play,
  RotateCw,
  Square,
  Skull,
  Trash2,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, buildAuthHeaders } from './api-client';
import { ConsoleLinesSkeleton } from './Skeletons';
import { tokenizeConsoleLine } from '@/lib/console-highlighter';
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/swal';
import type {
  ConsoleLine,
  ServerRuntimeMetrics,
  ServerWithMetrics,
} from '@/lib/types';

interface ServerConsoleTabProps {
  server: ServerWithMetrics;
  onMetricsUpdate: (metrics: ServerRuntimeMetrics) => void;
}

interface MetricSample {
  time: string;
  cpu: number;
  ram: number;
}

function formatDuration(totalSec: number): string {
  if (totalSec <= 0) return '0h 0m 0s';
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${hrs}h ${mins}m ${secs}s`;
}

function formatMemoryValue(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GiB`;
  }
  return `${mb.toFixed(mb > 0 ? 1 : 0)} MiB`;
}

function formatMemoryLimit(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) {
    return `${mb / 1024} GiB`;
  }
  return `${mb} MiB`;
}

function formatTimeLabel(date = new Date()): string {
  return date.toLocaleTimeString('id-ID', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function renderHighlightedLogText(text: string, defaultClass = ''): React.ReactNode {
  if (!text) return null;
  const tokens = tokenizeConsoleLine(text, defaultClass);
  return (
    <>
      {tokens.map((tok, idx) =>
        tok.className ? (
          <span key={idx} className={tok.className}>
            {tok.text}
          </span>
        ) : (
          <React.Fragment key={idx}>{tok.text}</React.Fragment>
        )
      )}
    </>
  );
}

function loadSavedHistory(serverId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`cmnty_cmd_history_${serverId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

export default function ServerConsoleTab({
  server,
  onMetricsUpdate,
}: ServerConsoleTabProps) {
  const [logs, setLogs] = useState<ConsoleLine[]>([]);
  const [streamMetrics, setStreamMetrics] = useState<ServerRuntimeMetrics | null>(null);
  const metrics = streamMetrics ?? server.metrics;
  const [metricsHistory, setMetricsHistory] = useState<MetricSample[]>(() => [
    {
      time: formatTimeLabel(),
      cpu: Number(server.metrics.cpuPercent.toFixed(2)),
      ram: Number(server.metrics.memoryMb.toFixed(1)),
    },
  ]);
  const [command, setCommand] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>(() =>
    typeof window !== 'undefined' ? loadSavedHistory(server.id) : []
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [powerLoading, setPowerLoading] = useState<string | null>(null);
  const [connectingStream, setConnectingStream] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const onMetricsRef = useRef(onMetricsUpdate);
  const lastStreamMetricsAtRef = useRef<number>(0);

  useEffect(() => {
    onMetricsRef.current = onMetricsUpdate;
  }, [onMetricsUpdate]);

  const appendMetricSample = (nextMetrics: ServerRuntimeMetrics) => {
    const sample: MetricSample = {
      time: formatTimeLabel(),
      cpu: Number(nextMetrics.cpuPercent.toFixed(2)),
      ram: Number(nextMetrics.memoryMb.toFixed(1)),
    };
    setMetricsHistory((prev) => [...prev.slice(-29), sample]);
  };

  useEffect(() => {
    let controller = new AbortController();
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connectStream() {
      controller = new AbortController();
      try {
        const res = await fetch(`/api/servers/${server.id}/console`, {
          method: 'GET',
          headers: buildAuthHeaders(),
          credentials: 'include',
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          if (active) {
            setConnectingStream(false);
            if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
              reconnectTimer = setTimeout(() => {
                if (active) void connectStream();
              }, 2000);
            }
          }
          return;
        }

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
                setConnectingStream(false);
              } else if (eventName === 'log') {
                setConnectingStream(false);
                setLogs((prev) => [...prev.slice(-399), parsed as ConsoleLine]);
              } else if (eventName === 'metrics') {
                const nextMetrics = parsed as ServerRuntimeMetrics;
                lastStreamMetricsAtRef.current = Date.now();
                setStreamMetrics(nextMetrics);
                appendMetricSample(nextMetrics);
                onMetricsRef.current(nextMetrics);
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }

        if (active && !controller.signal.aborted) {
          reconnectTimer = setTimeout(() => {
            if (active) void connectStream();
          }, 2000);
        }
      } catch {
        if (active && !controller.signal.aborted) {
          reconnectTimer = setTimeout(() => {
            if (active) void connectStream();
          }, 2000);
        }
      } finally {
        if (active) setConnectingStream(false);
      }
    }

    void connectStream();

    // Fallback polling in case SSE stream is buffered by a proxy
    const fallbackTimer = setInterval(async () => {
      if (!active) return;
      if (Date.now() - lastStreamMetricsAtRef.current < 1800) return;
      try {
        const res = await apiFetch<{ server: ServerWithMetrics }>(`/api/servers/${server.id}`);
        if (!active || !res.server?.metrics) return;
        setStreamMetrics(res.server.metrics);
        appendMetricSample(res.server.metrics);
        onMetricsRef.current(res.server.metrics);
      } catch {
        // ignore transient poll errors
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(fallbackTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller.abort();
    };
  }, [server.id]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const isRunning = metrics.status === 'running';
  const isBusy = metrics.status === 'installing' || metrics.status === 'starting';
  const canSendInput = isRunning || isBusy;

  useEffect(() => {
    commandInputRef.current?.focus();
  }, [server.id, isRunning]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          ((target.tagName === 'BUTTON' || target.tagName === 'A') && e.key === ' '))
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], .swal2-container')) {
        return;
      }
      const selection = window.getSelection()?.toString();
      if (selection && selection.length > 0) return;

      if (e.key.length === 1 || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        commandInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  async function runPowerAction(
    action: 'start' | 'stop' | 'restart' | 'kill'
  ) {
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
      appendMetricSample(res.metrics);
      onMetricsUpdate(res.metrics);
      const toastMap: Record<typeof action, string> = {
        start: 'Server dijalankan',
        restart: 'Server di-restart',
        stop: 'Server dihentikan',
        kill: 'Proses dihentikan paksa',
      };
      if (action === 'start' || action === 'restart') {
        void showSuccessToast(toastMap[action]);
        commandInputRef.current?.focus();
      } else {
        void showInfoToast(toastMap[action]);
      }
    } catch (err) {
      void showErrorToast(
        'Gagal Menjalankan Aksi',
        err instanceof Error ? err.message : 'Gagal menjalankan aksi power.'
      );
    } finally {
      setPowerLoading(null);
    }
  }

  async function handleSendCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    if (!canSendInput) {
      void showInfoToast('Server sedang offline', 'Tekan Start untuk menjalankan proses.');
      commandInputRef.current?.focus();
      return;
    }

    const cmdToSend = command;
    setCommand('');
    setHistoryIndex(-1);
    setCommandHistory((prev) => {
      const next = prev[0] === cmdToSend ? prev : [cmdToSend, ...prev.slice(0, 49)];
      try {
        window.localStorage.setItem(`cmnty_cmd_history_${server.id}`, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });

    try {
      await apiFetch(`/api/servers/${server.id}/console`, {
        method: 'POST',
        body: JSON.stringify({ command: cmdToSend }),
      });
    } catch (err) {
      void showErrorToast(
        'Gagal Mengirim Perintah',
        err instanceof Error ? err.message : 'Gagal mengirim perintah ke stdin.'
      );
    } finally {
      commandInputRef.current?.focus();
    }
  }

  function handleCommandKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp') {
      if (commandHistory.length === 0) return;
      e.preventDefault();
      const nextIdx = Math.min(commandHistory.length - 1, historyIndex + 1);
      setHistoryIndex(nextIdx);
      setCommand(commandHistory[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      if (historyIndex <= -1) return;
      e.preventDefault();
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setCommand(nextIdx >= 0 ? commandHistory[nextIdx] : '');
    } else if (e.key === 'Escape') {
      setHistoryIndex(-1);
      setCommand('');
    }
  }

  async function handleClearConsole() {
    setLogs([]);
    try {
      await apiFetch(`/api/servers/${server.id}/console`, {
        method: 'POST',
        body: JSON.stringify({ action: 'clear' }),
      });
      void showInfoToast('Console dibersihkan');
    } catch (err) {
      void showErrorToast(
        'Gagal Membersihkan Console',
        err instanceof Error ? err.message : 'Terjadi kesalahan saat membersihkan console.'
      );
    } finally {
      commandInputRef.current?.focus();
    }
  }

  const chartData = useMemo(() => {
    if (metricsHistory.length === 1) {
      return [metricsHistory[0], { ...metricsHistory[0] }];
    }
    return metricsHistory;
  }, [metricsHistory]);

  const cpuChartMax = useMemo(() => {
    const peak = Math.max(
      ...chartData.map((d) => d.cpu),
      metrics.cpuPercent,
      0
    );
    if (peak <= 0) return 1;
    if (peak < 1) return Number(Math.max(0.5, peak * 1.5).toFixed(2));
    return Number((peak * 1.25).toFixed(2));
  }, [chartData, metrics.cpuPercent]);

  const ramChartMax = useMemo(() => {
    const peak = Math.max(
      ...chartData.map((d) => d.ram),
      metrics.memoryMb,
      0
    );
    if (peak <= 0) return Math.max(1, server.memoryLimitMb);
    const padded = Math.ceil(peak * 1.2);
    if (peak <= server.memoryLimitMb) {
      return Math.min(server.memoryLimitMb, Math.max(32, padded));
    }
    return padded;
  }, [chartData, metrics.memoryMb, server.memoryLimitMb]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      {/* Top Power Actions Bar */}
      <div className="bg-[#181b22] border border-zinc-800 rounded-lg p-2.5 sm:p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-zinc-300">
        <button
          type="button"
          disabled={isRunning || isBusy || powerLoading !== null}
          onClick={() => runPowerAction('start')}
          className="h-8 w-full px-3 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <Play className="w-3 h-3 shrink-0 fill-white text-white" />
          <span>Start</span>
        </button>
        <button
          type="button"
          disabled={isBusy || powerLoading !== null}
          onClick={() => runPowerAction('restart')}
          className="h-8 w-full px-3 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <RotateCw className="w-3 h-3 shrink-0" />
          <span>Restart</span>
        </button>
        <button
          type="button"
          disabled={(!isRunning && !isBusy) || powerLoading !== null}
          onClick={() => runPowerAction('stop')}
          className="h-8 w-full px-3 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <Square className="w-3 h-3 shrink-0" />
          <span>Stop</span>
        </button>
        <button
          type="button"
          disabled={(!isRunning && !isBusy) || powerLoading !== null}
          onClick={() => runPowerAction('kill')}
          className="h-8 w-full px-3 rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
          title="Kill paksa proses (SIGKILL)"
        >
          <Skull className="w-3 h-3 shrink-0" />
          <span>Kill</span>
        </button>
      </div>

      {/* Console Window */}
      <div className="bg-[#12161e] border border-zinc-800 rounded-md overflow-hidden flex flex-col">
        <div className="px-3 sm:px-4 py-2 bg-[#171c26] border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span
              className={`inline-flex items-center font-medium uppercase px-2 py-0.5 rounded text-[11px] border ${
                isRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : metrics.status === 'error'
                  ? 'bg-red-500/10 text-red-400 border-red-500/25'
                  : isBusy
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/80'
              }`}
            >
              <span>{metrics.status}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-900 accent-zinc-400"
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
          onClick={() => {
            const selected = window.getSelection()?.toString();
            if (!selected) {
              commandInputRef.current?.focus();
            }
          }}
          className="h-[340px] sm:h-[420px] overflow-y-auto p-3 sm:p-4 font-mono text-[12px] leading-5 space-y-0.5 text-zinc-200 bg-[#12161e] cursor-text"
        >
          {connectingStream && logs.length === 0 ? (
            <ConsoleLinesSkeleton />
          ) : logs.length === 0 ? (
            <div className="font-mono break-words text-zinc-500">
              <span className="text-amber-400/90 select-none font-medium">[cmnty Daemon]: </span>
              <span>Server sedang offline. Tekan Start untuk menjalankan proses.</span>
            </div>
          ) : (
            logs.map((line) => {
              if (line.stream === 'system') {
                return (
                  <div key={line.id} className="break-words">
                    <span className="text-amber-400/90 select-none font-medium">[cmnty Daemon]: </span>
                    <span>{renderHighlightedLogText(line.text, 'text-zinc-300')}</span>
                  </div>
                );
              }
              if (line.stream === 'stdin') {
                return (
                  <div key={line.id} className="break-words text-zinc-400">
                    <span className="select-none text-zinc-500 mr-1.5">&gt;</span>
                    <span>{renderHighlightedLogText(line.text.replace(/^>\s*/, ''), 'text-zinc-300')}</span>
                  </div>
                );
              }
              if (line.stream === 'stderr') {
                if (/^\[cmnty Daemon\]:?\s*/.test(line.text)) {
                  const rest = line.text.replace(/^\[cmnty Daemon\]:?\s*/, '');
                  return (
                    <div key={line.id} className="break-words">
                      <span className="text-amber-400/90 select-none font-medium">[cmnty Daemon]: </span>
                      <span>{renderHighlightedLogText(rest, 'text-zinc-300')}</span>
                    </div>
                  );
                }
                return (
                  <div key={line.id} className="break-words">
                    {renderHighlightedLogText(line.text, 'text-red-400')}
                  </div>
                );
              }
              return (
                <div key={line.id} className="break-words">
                  {renderHighlightedLogText(line.text, 'text-zinc-200')}
                </div>
              );
            })
          )}
        </div>

        {/* Pterodactyl-style Integrated Terminal Command Input */}
        <form
          onSubmit={handleSendCommand}
          onClick={() => commandInputRef.current?.focus()}
          className="group border-t border-zinc-800/90 bg-[#0d1016] px-3 sm:px-3.5 h-10 flex items-center gap-2 font-mono text-xs transition-colors focus-within:bg-[#10141c] cursor-text"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 shrink-0 transition-colors ${
              canSendInput
                ? 'text-zinc-400 group-focus-within:text-amber-400'
                : 'text-zinc-600 group-focus-within:text-zinc-400'
            }`}
          />
          <input
            ref={commandInputRef}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Kirim input stdin ke proses server"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleCommandKeyDown}
            placeholder="Type a command..."
            className="flex-1 min-w-0 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={command.trim().length === 0}
            aria-label="Kirim perintah"
            title="Tekan Enter untuk mengirim"
            className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 disabled:opacity-0 disabled:pointer-events-none transition-opacity cursor-pointer shrink-0"
          >
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Pterodactyl-style Server Metrics & Real-Time Area Charts */}
      <div className="space-y-3">
        {/* Compact 4-Tile Resource Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3 sm:px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              Address
            </div>
            <div className="text-sm sm:text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              :{server.port}
            </div>
          </div>

          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3 sm:px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              Uptime
            </div>
            <div className="text-sm sm:text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              {formatDuration(metrics.uptimeSeconds)}
            </div>
          </div>

          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3 sm:px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              CPU Load
            </div>
            <div className="text-sm sm:text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              {metrics.cpuPercent.toFixed(2)}%{' '}
              <span className="text-xs font-normal text-slate-400">
                / {server.cpuLimitPercent}%
              </span>
            </div>
          </div>

          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3 sm:px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              Memory
            </div>
            <div className="text-sm sm:text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              {formatMemoryValue(metrics.memoryMb)}{' '}
              <span className="text-xs font-normal text-slate-400">
                / {formatMemoryLimit(server.memoryLimitMb)}
              </span>
            </div>
          </div>
        </div>

        {/* CPU Load & Memory Area Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* CPU Load Chart Card */}
          <div className="bg-[#262f3b] border border-[#344050] rounded-md p-3 sm:p-4 flex flex-col gap-2 min-w-0">
            <h3 className="text-xs font-medium tracking-wide text-slate-300">CPU Load</h3>
            <div className="h-[176px] w-full min-w-0">
              <ResponsiveContainer
                width="100%"
                height={176}
                minWidth={0}
                initialDimension={{ width: 420, height: 176 }}
              >
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 8, left: -4, bottom: 6 }}
                >
                  <defs>
                    <linearGradient
                      id={`cpuGrad-${server.id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis
                    domain={[0, cpuChartMax]}
                    ticks={[0, Number((cpuChartMax / 2).toFixed(2)), cpuChartMax]}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickFormatter={(val: number) => `${val.toFixed(2)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1b222c',
                      border: '1px solid #344050',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: '#e2e8f0',
                    }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(val) => [`${Number(val ?? 0).toFixed(2)}%`, 'CPU Load']}
                    labelFormatter={(_, payload) =>
                      (payload?.[0]?.payload as MetricSample | undefined)?.time ?? ''
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: '#22d3ee', strokeWidth: 0 }}
                    fill={`url(#cpuGrad-${server.id})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Memory Chart Card */}
          <div className="bg-[#262f3b] border border-[#344050] rounded-md p-3 sm:p-4 flex flex-col gap-2 min-w-0">
            <h3 className="text-xs font-medium tracking-wide text-slate-300">Memory</h3>
            <div className="h-[176px] w-full min-w-0">
              <ResponsiveContainer
                width="100%"
                height={176}
                minWidth={0}
                initialDimension={{ width: 420, height: 176 }}
              >
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 8, left: -4, bottom: 6 }}
                >
                  <defs>
                    <linearGradient
                      id={`ramGrad-${server.id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis
                    domain={[0, ramChartMax]}
                    ticks={[0, Math.round(ramChartMax / 2), ramChartMax]}
                    axisLine={false}
                    tickLine={false}
                    width={58}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickFormatter={(val: number) => `${Math.round(val)}MiB`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1b222c',
                      border: '1px solid #344050',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: '#e2e8f0',
                    }}
                    labelStyle={{ color: '#94a3b8' }}
                    formatter={(val) => [`${Number(val ?? 0).toFixed(1)} MiB`, 'Memory']}
                    labelFormatter={(_, payload) =>
                      (payload?.[0]?.payload as MetricSample | undefined)?.time ?? ''
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="ram"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: '#22d3ee', strokeWidth: 0 }}
                    fill={`url(#ramGrad-${server.id})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
