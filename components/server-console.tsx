'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ChevronsRight,
  CloudDownload,
  CloudUpload,
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
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, buildAuthHeaders } from '@/lib/api';
import { ConsoleLinesSkeleton } from './skeletons';
import JqueryHighlightedText from './console-jquery-highlight';
import { upsertConsoleLineList } from '@/lib/console-stream';
import { connectSseStream } from '@/lib/sse';
import {
  formatNetworkAxisBytes,
  formatNetworkRateLabel,
} from '@/lib/network-stats';
import {
  getConsolePowerPermissions,
  getStatusDisplayLabel,
} from '@/lib/console-state';
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/alerts';
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
  idx: number;
  time: string;
  cpu: number;
  ram: number;
  rx: number;
  tx: number;
}

function useMeasuredChartWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 260): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 40) {
        setWidth(next);
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateWidth();
      });
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [ref]);

  return width;
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
  return <JqueryHighlightedText text={text} defaultClass={defaultClass} />;
}

const ConsoleLineRow = React.memo(function ConsoleLineRow({ line }: { line: ConsoleLine }) {
  if (line.stream === 'system') {
    const isCrashBanner =
      line.text.includes('crashed state') ||
      line.text.startsWith('Failed ') ||
      line.text.includes('exceeded allocated memory limit');
    return (
      <div className="whitespace-pre-wrap break-words min-h-5">
        <span className="text-amber-400/90 select-none font-medium">[cmnty Daemon]: </span>
        {isCrashBanner ? (
          <JqueryHighlightedText text={line.text} defaultClass="text-red-400 font-medium" />
        ) : (
          renderHighlightedLogText(line.text, 'text-zinc-300')
        )}
      </div>
    );
  }
  if (line.stream === 'stdin') {
    return (
      <div className="whitespace-pre-wrap break-words min-h-5 text-zinc-300">
        <span className="select-none text-emerald-400 font-semibold mr-1.5">&gt;</span>
        {renderHighlightedLogText(line.text.replace(/^>\s*/, ''), 'text-zinc-200')}
      </div>
    );
  }
  if (line.stream === 'stderr') {
    if (/^\[cmnty Daemon\]:?\s*/.test(line.text)) {
      const rest = line.text.replace(/^\[cmnty Daemon\]:?\s*/, '');
      return (
        <div className="whitespace-pre-wrap break-words min-h-5">
          <span className="text-amber-400/90 select-none font-medium">[cmnty Daemon]: </span>
          {renderHighlightedLogText(rest, 'text-zinc-300')}
        </div>
      );
    }
    return (
      <div className="whitespace-pre-wrap break-words min-h-5">
        {renderHighlightedLogText(line.text, 'text-zinc-200')}
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap break-words min-h-5">
      {renderHighlightedLogText(line.text, 'text-zinc-200')}
    </div>
  );
});

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
  const sampleIndexRef = useRef(1);
  const [metricsHistory, setMetricsHistory] = useState<MetricSample[]>(() => [
    {
      idx: 0,
      time: formatTimeLabel(),
      cpu: Number(server.metrics.cpuPercent.toFixed(2)),
      ram: Number(server.metrics.memoryMb.toFixed(1)),
      rx: Math.max(0, Math.round(server.metrics.networkRxBytesPerSec || 0)),
      tx: Math.max(0, Math.round(server.metrics.networkTxBytesPerSec || 0)),
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
  const cpuChartWrapRef = useRef<HTMLDivElement>(null);
  const ramChartWrapRef = useRef<HTMLDivElement>(null);
  const netChartWrapRef = useRef<HTMLDivElement>(null);
  const cpuChartWidth = useMeasuredChartWidth(cpuChartWrapRef);
  const ramChartWidth = useMeasuredChartWidth(ramChartWrapRef);
  const netChartWidth = useMeasuredChartWidth(netChartWrapRef);
  const draftCommandRef = useRef('');
  const onMetricsRef = useRef(onMetricsUpdate);
  const lastStreamMetricsAtRef = useRef<number>(0);
  const [fallbackAnchorMs, setFallbackAnchorMs] = useState<number>(
    () => Date.now() - Math.max(0, server.metrics.uptimeSeconds) * 1000
  );
  const [liveNowMs, setLiveNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    onMetricsRef.current = onMetricsUpdate;
  }, [onMetricsUpdate]);

  const appendMetricSample = (nextMetrics: ServerRuntimeMetrics) => {
    const nextIdx = sampleIndexRef.current;
    sampleIndexRef.current += 1;
    const sample: MetricSample = {
      idx: nextIdx,
      time: formatTimeLabel(),
      cpu: Number((Number.isFinite(nextMetrics.cpuPercent) ? nextMetrics.cpuPercent : 0).toFixed(2)),
      ram: Number((Number.isFinite(nextMetrics.memoryMb) ? nextMetrics.memoryMb : 0).toFixed(1)),
      rx: Math.max(0, Math.round(Number.isFinite(nextMetrics.networkRxBytesPerSec) ? nextMetrics.networkRxBytesPerSec : 0)),
      tx: Math.max(0, Math.round(Number.isFinite(nextMetrics.networkTxBytesPerSec) ? nextMetrics.networkTxBytesPerSec : 0)),
    };
    setMetricsHistory((prev) => [...prev.slice(-29), sample]);
  };

  useEffect(() => {
    let active = true;
    lastStreamMetricsAtRef.current = Date.now();

    const disconnect = connectSseStream({
      url: `/api/servers/${server.id}/console`,
      getHeaders: buildAuthHeaders,
      onActivity: () => {
        if (active) {
          lastStreamMetricsAtRef.current = Date.now();
        }
      },
      onEvent: (eventName, parsed) => {
        if (!active) return;
        lastStreamMetricsAtRef.current = Date.now();
        if (eventName === 'history' && Array.isArray(parsed)) {
          const seen = new Set<string>();
          const unique = (parsed as ConsoleLine[]).filter((item) => {
            if (!item?.id || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
          setLogs(unique);
          setConnectingStream(false);
        } else if (eventName === 'log' || eventName === 'log-update') {
          const nextLine = parsed as ConsoleLine;
          setConnectingStream(false);
          setLogs((prev) => upsertConsoleLineList(prev, nextLine, 400));
        } else if (eventName === 'clear') {
          setLogs([]);
        } else if (eventName === 'metrics') {
          const nextMetrics = parsed as ServerRuntimeMetrics;
          setStreamMetrics(nextMetrics);
          appendMetricSample(nextMetrics);
          onMetricsRef.current(nextMetrics);
        }
      },
      onHttpError: () => {
        if (active) setConnectingStream(false);
      },
      onConnectionError: () => {
        if (active) setConnectingStream(false);
      },
    });

    const fallbackTimer = setInterval(async () => {
      if (!active) return;
      if (Date.now() - lastStreamMetricsAtRef.current < 2500) return;
      try {
        const res = await apiFetch<{ server: ServerWithMetrics }>(`/api/servers/${server.id}`);
        if (!active || !res.server?.metrics) return;
        setStreamMetrics(res.server.metrics);
        appendMetricSample(res.server.metrics);
        onMetricsRef.current(res.server.metrics);
      } catch {
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(fallbackTimer);
      disconnect();
    };
  }, [server.id]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const powerPerms = getConsolePowerPermissions(metrics.status, Boolean(metrics.awaitingInput));
  const statusDisplayLabel = getStatusDisplayLabel(metrics.status);
  const canSendInput = powerPerms.canSendInput;
  const isMetricsActive =
    metrics.status === 'starting' ||
    metrics.status === 'installing' ||
    metrics.status === 'running' ||
    metrics.status === 'stopping';

  const latestMetricsRef = useRef(metrics);
  useEffect(() => {
    latestMetricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    if (!isMetricsActive) return;
    const tickTimer = setInterval(() => {
      const now = Date.now();
      setLiveNowMs(now);
      if (now - lastStreamMetricsAtRef.current >= 950) {
        lastStreamMetricsAtRef.current = now;
        appendMetricSample(latestMetricsRef.current);
      }
    }, 500);
    return () => clearInterval(tickTimer);
  }, [isMetricsActive]);

  const displayedUptimeSeconds = useMemo(() => {
    if (!isMetricsActive) return 0;
    const anchor =
      metrics.startedAt && Number.isFinite(Date.parse(metrics.startedAt))
        ? Date.parse(metrics.startedAt)
        : fallbackAnchorMs;
    return Math.max(metrics.uptimeSeconds, Math.floor((liveNowMs - anchor) / 1000));
  }, [isMetricsActive, metrics.startedAt, metrics.uptimeSeconds, liveNowMs, fallbackAnchorMs]);

  useEffect(() => {
    if (canSendInput) {
      commandInputRef.current?.focus();
    }
  }, [server.id, canSendInput]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!canSendInput) return;
      const isPasteShortcut =
        (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v';
      if ((e.ctrlKey || e.metaKey || e.altKey) && !isPasteShortcut) return;
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

      if (isPasteShortcut || e.key.length === 1 || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        commandInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [canSendInput]);

  async function runPowerAction(
    action: 'start' | 'stop' | 'restart' | 'kill'
  ) {
    setPowerLoading(action);
    const previousMetrics = streamMetrics;
    if (action === 'start' || action === 'restart') {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      setFallbackAnchorMs(now);
      setLiveNowMs(now);
      const optimisticStarting: ServerRuntimeMetrics = {
        ...metrics,
        status: 'starting',
        uptimeSeconds: 0,
        startedAt: nowIso,
        networkRxBytesPerSec: 0,
        networkTxBytesPerSec: 0,
        awaitingInput: false,
      };
      setStreamMetrics(optimisticStarting);
      appendMetricSample(optimisticStarting);
      onMetricsRef.current(optimisticStarting);
      lastStreamMetricsAtRef.current = 0;
    }
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
        start: res.metrics.status === 'installing' ? 'Memasang dependensi server...' : 'Server dijalankan',
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
      setStreamMetrics(previousMetrics);
      try {
        const fresh = await apiFetch<{ server: ServerWithMetrics }>(`/api/servers/${server.id}`);
        if (fresh.server?.metrics) {
          setStreamMetrics(fresh.server.metrics);
          onMetricsRef.current(fresh.server.metrics);
        }
      } catch {
      }
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
    if (!canSendInput) return;

    const isEmptySubmit = !command.trim();
    const cmdToSend = command;
    setCommand('');
    draftCommandRef.current = '';
    setHistoryIndex(-1);
    setAutoScroll(true);

    if (!isEmptySubmit) {
      setCommandHistory((prev) => {
        const next = [cmdToSend, ...prev.filter((item) => item !== cmdToSend)].slice(0, 50);
        try {
          window.localStorage.setItem(`cmnty_cmd_history_${server.id}`, JSON.stringify(next));
        } catch {
        }
        return next;
      });
    }

    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }

    try {
      await apiFetch(`/api/servers/${server.id}/console`, {
        method: 'POST',
        body: JSON.stringify({ command: cmdToSend }),
      });
    } catch (err) {
      void showErrorToast(
        'Gagal Mengirim Perintah',
        err instanceof Error ? err.message : 'Gagal mengirim perintah ke console.'
      );
    } finally {
      commandInputRef.current?.focus();
    }
  }

  function moveCaretToEnd(value: string) {
    requestAnimationFrame(() => {
      const input = commandInputRef.current;
      if (input) {
        const len = value.length;
        input.setSelectionRange(len, len);
      }
    });
  }

  function handleCommandKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp') {
      if (commandHistory.length === 0) return;
      e.preventDefault();
      if (historyIndex === -1) {
        draftCommandRef.current = command;
      }
      const nextIdx = Math.min(commandHistory.length - 1, historyIndex + 1);
      const nextVal = commandHistory[nextIdx];
      setHistoryIndex(nextIdx);
      setCommand(nextVal);
      moveCaretToEnd(nextVal);
    } else if (e.key === 'ArrowDown') {
      if (historyIndex <= -1) return;
      e.preventDefault();
      const nextIdx = historyIndex - 1;
      const nextVal = nextIdx >= 0 ? commandHistory[nextIdx] : draftCommandRef.current;
      setHistoryIndex(nextIdx);
      setCommand(nextVal);
      moveCaretToEnd(nextVal);
    } else if (e.key === 'Escape') {
      setHistoryIndex(-1);
      draftCommandRef.current = '';
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
      return [
        metricsHistory[0],
        { ...metricsHistory[0], idx: metricsHistory[0].idx + 1 },
      ];
    }
    return metricsHistory;
  }, [metricsHistory]);

  const cpuChartMax = useMemo(() => {
    const peak = Math.max(
      ...chartData.map((d) => (Number.isFinite(d.cpu) ? d.cpu : 0)),
      Number.isFinite(metrics.cpuPercent) ? metrics.cpuPercent : 0,
      0
    );
    if (peak <= 0) return 1;
    if (peak < 1) return Number(Math.max(0.5, peak * 1.5).toFixed(2));
    return Number((peak * 1.25).toFixed(2));
  }, [chartData, metrics.cpuPercent]);

  const cpuChartTicks = useMemo(
    () => Array.from(new Set([0, Number((cpuChartMax / 2).toFixed(2)), cpuChartMax])).sort((a, b) => a - b),
    [cpuChartMax]
  );

  const ramChartMax = useMemo(() => {
    const peak = Math.max(
      ...chartData.map((d) => (Number.isFinite(d.ram) ? d.ram : 0)),
      Number.isFinite(metrics.memoryMb) ? metrics.memoryMb : 0,
      0
    );
    if (peak <= 0) return Math.max(2, server.memoryLimitMb);
    const padded = Math.ceil(peak * 1.2);
    if (peak <= server.memoryLimitMb) {
      return Math.max(2, Math.min(server.memoryLimitMb, Math.max(32, padded)));
    }
    return Math.max(2, padded);
  }, [chartData, metrics.memoryMb, server.memoryLimitMb]);

  const ramChartTicks = useMemo(
    () => Array.from(new Set([0, Math.round(ramChartMax / 2), ramChartMax])).sort((a, b) => a - b),
    [ramChartMax]
  );

  const netChartMax = useMemo(() => {
    const peak = Math.max(
      ...chartData.map((d) => Math.max(Number.isFinite(d.rx) ? d.rx : 0, Number.isFinite(d.tx) ? d.tx : 0)),
      Number.isFinite(metrics.networkRxBytesPerSec) ? metrics.networkRxBytesPerSec : 0,
      Number.isFinite(metrics.networkTxBytesPerSec) ? metrics.networkTxBytesPerSec : 0,
      0
    );
    if (peak <= 0) return 100;
    return Math.max(100, Math.ceil(peak * 1.25));
  }, [chartData, metrics.networkRxBytesPerSec, metrics.networkTxBytesPerSec]);

  const netChartTicks = useMemo(
    () => Array.from(new Set([0, Math.round(netChartMax / 2), netChartMax])).sort((a, b) => a - b),
    [netChartMax]
  );

  function handleTerminalScroll() {
    const el = terminalRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= 24;
    if (atBottom && !autoScroll) {
      setAutoScroll(true);
    } else if (!atBottom && autoScroll) {
      setAutoScroll(false);
    }
  }

  function jumpToBottom() {
    setAutoScroll(true);
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 sm:p-3 grid grid-cols-4 gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
        <button
          type="button"
          disabled={!powerPerms.canStart || powerLoading !== null}
          onClick={() => runPowerAction('start')}
          className="h-8 w-full px-1.5 sm:px-3 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <Play className="w-3 h-3 shrink-0 fill-white text-white" />
          <span>Start</span>
        </button>
        <button
          type="button"
          disabled={!powerPerms.canRestart || powerLoading !== null}
          onClick={() => runPowerAction('restart')}
          className="h-8 w-full px-1.5 sm:px-3 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <RotateCw className="w-3 h-3 shrink-0" />
          <span>Restart</span>
        </button>
        <button
          type="button"
          disabled={!powerPerms.canStop || powerLoading === 'stop' || powerLoading === 'kill'}
          onClick={() => runPowerAction('stop')}
          className="h-8 w-full px-1.5 sm:px-3 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
        >
          <Square className="w-3 h-3 shrink-0" />
          <span>Stop</span>
        </button>
        <button
          type="button"
          disabled={!powerPerms.canKill || powerLoading === 'kill'}
          onClick={() => runPowerAction('kill')}
          className="h-8 w-full px-1.5 sm:px-3 rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-medium inline-flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:cursor-not-allowed"
          title="Kill paksa proses (SIGKILL)"
        >
          <Skull className="w-3 h-3 shrink-0" />
          <span>Kill</span>
        </button>
      </div>

      <div className="bg-[#09090B] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden flex flex-col">
        <div className="px-3 sm:px-4 py-2 bg-[#111114] border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span
              className={`inline-flex items-center font-medium uppercase px-2 py-0.5 rounded text-[11px] border ${
                metrics.status === 'running'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : metrics.status === 'error'
                  ? 'bg-red-500/10 text-red-400 border-red-500/25'
                  : powerPerms.isBusy
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/80'
              }`}
            >
              <span>{statusDisplayLabel}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 text-xs">
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

        <div className="relative">
          <div
            ref={terminalRef}
            onScroll={handleTerminalScroll}
            onClick={() => {
              if (!canSendInput) return;
              const selected = window.getSelection()?.toString();
              if (!selected) {
                commandInputRef.current?.focus();
              }
            }}
            className="h-[340px] sm:h-[420px] overflow-y-auto overflow-x-hidden p-3 sm:p-4 font-mono text-[12px] leading-5 space-y-0.5 text-zinc-200 bg-[#09090B] cursor-text"
          >
            {connectingStream && logs.length === 0 ? (
              <ConsoleLinesSkeleton />
            ) : logs.length === 0 ? (
              <div className="font-mono whitespace-pre-wrap break-words min-h-5 text-zinc-500">
                <span className="text-amber-400/90 select-none font-medium">[cmnty Daemon]: </span>
                <span>
                  {metrics.status === 'running'
                    ? 'Server marked as running...'
                    : metrics.status === 'installing'
                    ? 'Installing server dependencies...'
                    : metrics.status === 'starting'
                    ? 'Server marked as starting...'
                    : metrics.status === 'stopping'
                    ? 'Server marked as stopping...'
                    : 'Server marked as offline...'}
                </span>
              </div>
            ) : (
              logs.map((line) => <ConsoleLineRow key={line.id} line={line} />)
            )}
          </div>

          {!autoScroll && logs.length > 0 && (
            <button
              type="button"
              onClick={jumpToBottom}
              aria-label="Scroll console to bottom"
              className="absolute bottom-3 right-3 h-7 px-2.5 rounded bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-[11px] font-medium inline-flex items-center gap-1 shadow-md cursor-pointer transition-colors"
            >
              <ArrowDown className="w-3 h-3" />
              <span>Scroll to bottom</span>
            </button>
          )}
        </div>

        <form
          onSubmit={handleSendCommand}
          onClick={() => {
            if (canSendInput) commandInputRef.current?.focus();
          }}
          className={`group border-t border-zinc-800/90 bg-[#0C0C0E] px-3 sm:px-3.5 h-10 flex items-center gap-2 font-mono text-xs transition-colors ${
            canSendInput ? 'focus-within:bg-[#111114] cursor-text' : 'opacity-60 cursor-not-allowed'
          }`}
        >
          <ChevronsRight
            className={`w-3.5 h-3.5 shrink-0 transition-colors ${
              canSendInput
                ? 'text-zinc-400 group-focus-within:text-amber-400'
                : 'text-zinc-600'
            }`}
          />
          <input
            ref={commandInputRef}
            type="text"
            enterKeyHint="send"
            disabled={!canSendInput}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Input a command"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              if (historyIndex !== -1) {
                setHistoryIndex(-1);
              }
              draftCommandRef.current = e.target.value;
            }}
            onKeyDown={handleCommandKeyDown}
            placeholder="Input a command..."
            className="flex-1 min-w-0 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
          />
        </form>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3.5 py-2.5 min-w-0">
            <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
              Address
            </div>
            <div className="text-sm sm:text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums mt-0.5 truncate">
              :{server.port}
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3.5 py-2.5 min-w-0">
            <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
              Uptime
            </div>
            <div className="text-sm sm:text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums mt-0.5 truncate">
              {formatDuration(displayedUptimeSeconds)}
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3.5 py-2.5 min-w-0">
            <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
              CPU Load
            </div>
            <div className="text-sm sm:text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums mt-0.5 truncate">
              {metrics.cpuPercent.toFixed(2)}%{' '}
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                / {server.cpuLimitPercent}%
              </span>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3.5 py-2.5 min-w-0">
            <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
              Memory
            </div>
            <div className="text-sm sm:text-[15px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums mt-0.5 truncate">
              {formatMemoryValue(metrics.memoryMb)}{' '}
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                / {formatMemoryLimit(server.memoryLimitMb)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 flex flex-col gap-2 min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              CPU Load
            </h3>
            <div
              ref={cpuChartWrapRef}
              className="h-[176px] w-full min-w-0 overflow-hidden pointer-events-none select-none"
            >
              <AreaChart
                width={cpuChartWidth}
                height={176}
                data={chartData}
                accessibilityLayer={false}
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
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="idx" type="number" domain={['dataMin', 'dataMax']} hide />
                <YAxis
                  domain={[0, cpuChartMax]}
                  ticks={cpuChartTicks}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  tickFormatter={(val: number) => `${val.toFixed(2)}%`}
                />
                <Area
                  type="monotone"
                  dataKey="cpu"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  fill={`url(#cpuGrad-${server.id})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 flex flex-col gap-2 min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Memory
            </h3>
            <div
              ref={ramChartWrapRef}
              className="h-[176px] w-full min-w-0 overflow-hidden pointer-events-none select-none"
            >
              <AreaChart
                width={ramChartWidth}
                height={176}
                data={chartData}
                accessibilityLayer={false}
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
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="idx" type="number" domain={['dataMin', 'dataMax']} hide />
                <YAxis
                  domain={[0, ramChartMax]}
                  ticks={ramChartTicks}
                  axisLine={false}
                  tickLine={false}
                  width={58}
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  tickFormatter={(val: number) => `${Math.round(val)}MiB`}
                />
                <Area
                  type="monotone"
                  dataKey="ram"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  fill={`url(#ramGrad-${server.id})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 flex flex-col gap-2 min-w-0 md:col-span-2 lg:col-span-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Network
              </h3>
              <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                <span
                  className="inline-flex items-center gap-1 text-amber-500 dark:text-amber-400"
                  title="Inbound (Download)"
                >
                  <CloudDownload className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatNetworkRateLabel(metrics.networkRxBytesPerSec || 0)}</span>
                </span>
                <span
                  className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400"
                  title="Outbound (Upload)"
                >
                  <CloudUpload className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatNetworkRateLabel(metrics.networkTxBytesPerSec || 0)}</span>
                </span>
              </div>
            </div>
            <div
              ref={netChartWrapRef}
              className="h-[176px] w-full min-w-0 overflow-hidden pointer-events-none select-none"
            >
              <AreaChart
                width={netChartWidth}
                height={176}
                data={chartData}
                accessibilityLayer={false}
                margin={{ top: 10, right: 8, left: 4, bottom: 6 }}
              >
                <defs>
                  <linearGradient
                    id={`netRxGrad-${server.id}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#eab308" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#eab308" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient
                    id={`netTxGrad-${server.id}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="idx" type="number" domain={['dataMin', 'dataMax']} hide />
                <YAxis
                  domain={[0, netChartMax]}
                  ticks={netChartTicks}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  tickFormatter={(val: number) => formatNetworkAxisBytes(val)}
                />
                <Area
                  type="monotone"
                  dataKey="rx"
                  stroke="#eab308"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  fill={`url(#netRxGrad-${server.id})`}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  fill={`url(#netTxGrad-${server.id})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
