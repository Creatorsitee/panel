'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCw,
  Square,
  Skull,
  Trash2,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from 'recharts';
import { apiFetch, buildAuthHeaders } from './api-client';
import { ConsoleLinesSkeleton } from './Skeletons';
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

function renderHighlightedLogText(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  const regex = /(\[?(?:INFO|WARN|ERROR|FATAL|DEBUG|SUCCESS|OK|daemon)\]?|\b(?:GET|POST|PUT|DELETE|PATCH)\b|\b[1-5]\d{2}\b|\b[a-zA-Z0-9_/.-]+\.(?:js|ts|py|json|html|css|txt|log)\b)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchStr = match[0];
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      parts.push(text.slice(lastIndex, startIndex));
    }

    const upper = matchStr.toUpperCase();
    if (upper.includes('ERROR') || upper.includes('FATAL')) {
      parts.push(
        <span key={`${startIndex}-err`} className="text-red-400 font-semibold bg-red-500/10 px-1 rounded">
          {matchStr}
        </span>
      );
    } else if (upper.includes('WARN')) {
      parts.push(
        <span key={`${startIndex}-warn`} className="text-amber-400 font-semibold">
          {matchStr}
        </span>
      );
    } else if (upper.includes('INFO') || upper.includes('SUCCESS') || upper.includes('OK') || upper.includes('DAEMON')) {
      parts.push(
        <span key={`${startIndex}-info`} className="text-cyan-400 font-semibold">
          {matchStr}
        </span>
      );
    } else if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(upper)) {
      parts.push(
        <span key={`${startIndex}-http`} className="text-emerald-400 font-bold px-1 bg-emerald-500/10 rounded">
          {matchStr}
        </span>
      );
    } else if (/^[1-5]\d{2}$/.test(matchStr)) {
      const code = Number(matchStr);
      const colorClass = code < 300 ? 'text-emerald-400 font-bold' : code < 400 ? 'text-amber-400 font-bold' : 'text-red-400 font-bold';
      parts.push(
        <span key={`${startIndex}-status`} className={colorClass}>
          {matchStr}
        </span>
      );
    } else if (/\.(?:js|ts|py|json|html|css|txt|log)$/.test(matchStr)) {
      parts.push(
        <span key={`${startIndex}-file`} className="text-purple-300 underline underline-offset-2">
          {matchStr}
        </span>
      );
    } else {
      parts.push(matchStr);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
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
  const [powerLoading, setPowerLoading] = useState<string | null>(null);
  const [connectingStream, setConnectingStream] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const onMetricsRef = useRef(onMetricsUpdate);

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

        if (!res.ok || !res.body) {
          if (active) setConnectingStream(false);
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
                setStreamMetrics(nextMetrics);
                appendMetricSample(nextMetrics);
                onMetricsRef.current(nextMetrics);
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      } catch {
        // aborted
      } finally {
        if (active) setConnectingStream(false);
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
    try {
      await apiFetch(`/api/servers/${server.id}/console`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
      setCommand('');
    } catch (err) {
      void showErrorToast(
        'Gagal Mengirim Perintah',
        err instanceof Error ? err.message : 'Gagal mengirim perintah ke stdin.'
      );
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
    }
  }

  const isRunning = metrics.status === 'running';
  const isBusy = metrics.status === 'installing' || metrics.status === 'starting';

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
    if (peak <= 0) return 2;
    return Number(Math.max(2, peak * 1.25).toFixed(2));
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
      {/* Top Power Actions Bar - Original Button Design, Full-Width Horizontal Layout */}
      <div className="bg-[#181b22] border border-zinc-800 rounded-lg p-3 grid grid-cols-4 gap-2 text-xs text-zinc-300">
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
          disabled={!isRunning || powerLoading !== null}
          onClick={() => runPowerAction('stop')}
          className="h-8 w-full px-3 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <Square className="w-3 h-3 shrink-0" />
          <span>Stop</span>
        </button>
        <button
          type="button"
          disabled={!isRunning || powerLoading !== null}
          onClick={() => runPowerAction('kill')}
          className="h-8 w-full px-3 rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
          title="Kill paksa proses (SIGKILL)"
        >
          <Skull className="w-3 h-3 shrink-0" />
          <span>Kill</span>
        </button>
      </div>

      {/* Console Window */}
      <div className="bg-[#141920] border border-[#2c3746] rounded-md overflow-hidden shadow-xl flex flex-col">
        <div className="px-4 py-2.5 bg-[#1b222c] border-b border-[#2c3746] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span
              className={`inline-flex items-center gap-1.5 font-semibold uppercase px-2.5 py-0.5 rounded text-[11px] border ${
                isRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : metrics.status === 'error'
                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                  : isBusy
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-[#262f3b] text-slate-400 border-[#344050]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRunning
                    ? 'bg-emerald-400 animate-pulse'
                    : metrics.status === 'error'
                    ? 'bg-red-400'
                    : isBusy
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-500'
                }`}
              />
              <span>{metrics.status}</span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-3 h-3 rounded border-slate-600 bg-slate-900 accent-cyan-500"
              />
              <span>Auto-scroll</span>
            </label>
            <button
              type="button"
              onClick={handleClearConsole}
              className="text-slate-400 hover:text-slate-100 inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div
          ref={terminalRef}
          className="h-[420px] overflow-y-auto p-4 font-mono text-[12px] leading-5 space-y-0.5 text-slate-200 bg-[#12161c]"
        >
          {connectingStream && logs.length === 0 ? (
            <ConsoleLinesSkeleton />
          ) : logs.length === 0 ? (
            <div className="font-mono break-words">
              <span className="text-amber-400/90 select-none">[cmnty Daemon]: </span>
              <span className="text-slate-400">
                Server sedang offline. Tekan Start untuk menjalankan proses.
              </span>
            </div>
          ) : (
            logs.map((line) => {
              if (line.stream === 'system') {
                return (
                  <div key={line.id} className="break-words">
                    <span className="text-amber-400/90 select-none">[cmnty Daemon]: </span>
                    <span className="text-slate-300">{renderHighlightedLogText(line.text)}</span>
                  </div>
                );
              }
              if (line.stream === 'stdin') {
                return (
                  <div key={line.id} className="break-words text-cyan-300">
                    <span className="select-none text-cyan-500 mr-1.5 font-semibold">$</span>
                    {renderHighlightedLogText(line.text)}
                  </div>
                );
              }
              if (line.stream === 'stderr') {
                return (
                  <div key={line.id} className="break-words text-red-400 bg-red-500/5 px-1.5 py-0.5 rounded border-l-2 border-red-500">
                    {renderHighlightedLogText(line.text)}
                  </div>
                );
              }
              return (
                <div key={line.id} className="break-words text-slate-200">
                  {renderHighlightedLogText(line.text)}
                </div>
              );
            })
          )}
        </div>

        {/* Pterodactyl-style Professional Terminal Command Input Footer */}
        <form
          onSubmit={handleSendCommand}
          className="border-t border-[#1f2937] bg-[#0c1017] px-4 py-2.5 flex items-center gap-3 font-mono text-xs shadow-inner"
        >
          <span className="text-cyan-400 select-none font-semibold tracking-tight">container@cmnty~ $</span>
          <input
            type="text"
            aria-label="Kirim input stdin ke proses server"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={isRunning ? 'Type a command and press Enter...' : 'Server offline (tekan Start)...'}
            disabled={!isRunning}
            className="flex-1 bg-transparent text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-40"
          />
          {isRunning && command.trim().length > 0 && (
            <button
              type="submit"
              className="h-7 px-3.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shadow-sm"
            >
              Kirim
            </button>
          )}
        </form>
      </div>

      {/* Pterodactyl-style Server Metrics & Real-Time Area Charts */}
      <div className="space-y-3">
        {/* Compact 4-Tile Resource Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              Address
            </div>
            <div className="text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              :{server.port}
            </div>
          </div>

          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              Uptime
            </div>
            <div className="text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              {formatDuration(metrics.uptimeSeconds)}
            </div>
          </div>

          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              CPU Load
            </div>
            <div className="text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
              {metrics.cpuPercent.toFixed(2)}%{' '}
              <span className="text-xs font-normal text-slate-400">
                / {server.cpuLimitPercent}%
              </span>
            </div>
          </div>

          <div className="bg-[#262f3b] border border-[#344050] rounded-md px-3.5 py-2.5 min-w-0">
            <div className="text-xs font-medium text-slate-400 truncate">
              Memory
            </div>
            <div className="text-[15px] font-medium text-slate-100 tabular-nums mt-1 truncate">
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
          <div className="bg-[#262f3b] border border-[#344050] rounded-md p-4 flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-slate-300">CPU Load</h3>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 6, left: -4, bottom: 2 }}
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
                  <YAxis
                    domain={[0, cpuChartMax]}
                    ticks={[Number((cpuChartMax / 2).toFixed(2)), cpuChartMax]}
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
                    fill={`url(#cpuGrad-${server.id})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Memory Chart Card */}
          <div className="bg-[#262f3b] border border-[#344050] rounded-md p-4 flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-slate-300">Memory</h3>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 6, left: -4, bottom: 2 }}
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
                  <YAxis
                    domain={[0, ramChartMax]}
                    ticks={[Math.round(ramChartMax / 2), ramChartMax]}
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
