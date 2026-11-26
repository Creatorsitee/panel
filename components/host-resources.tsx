'use client';

import React, { useEffect, useRef } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  Terminal,
} from 'lucide-react';
import { usePanel } from './panel-shell';
import { HostRouteSkeleton } from './skeletons';

function formatHostUptime(totalSec: number): string {
  if (totalSec <= 0) return '0m';
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}h ${hrs}j ${mins}m`;
  if (hrs > 0) return `${hrs}j ${mins}m`;
  return `${mins}m`;
}

function clampPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

export default function HostResourcesView() {
  const { hostInfo, loadingData, lastHostSnapshotAt, refreshHostInfo } = usePanel();
  const lastSnapshotRef = useRef(lastHostSnapshotAt);

  useEffect(() => {
    lastSnapshotRef.current = lastHostSnapshotAt;
  }, [lastHostSnapshotAt]);

  useEffect(() => {
    if (Date.now() - lastSnapshotRef.current >= 2500) {
      void refreshHostInfo();
    }
    const timer = setInterval(() => {
      if (Date.now() - lastSnapshotRef.current >= 3000) {
        void refreshHostInfo();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshHostInfo]);

  if (loadingData && !hostInfo) {
    return <HostRouteSkeleton />;
  }

  const memPct = hostInfo ? clampPct(hostInfo.usedMemoryMb, hostInfo.totalMemoryMb) : 0;
  const swapPct = hostInfo && hostInfo.swapTotalMb > 0 ? clampPct(hostInfo.swapUsedMb, hostInfo.swapTotalMb) : 0;
  const diskPct = hostInfo ? clampPct(hostInfo.diskUsedGb, hostInfo.diskTotalGb) : 0;
  const cpuPct = hostInfo ? Math.max(0, Math.min(100, Math.round(hostInfo.hostCpuPercent))) : 0;
  const totalCpuLimit = hostInfo ? Math.max(100, hostInfo.cpuCores * 100) : 100;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Resource Host
          </h1>
        </div>
        {hostInfo && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono text-zinc-500">
            <span className="text-zinc-700 dark:text-zinc-300 font-medium">{hostInfo.hostname}</span>
            {hostInfo.primaryIp && (
              <>
                <span>·</span>
                <span>IP {hostInfo.primaryIp}</span>
              </>
            )}
            <span>·</span>
            <span>Uptime {formatHostUptime(hostInfo.uptimeSeconds)}</span>
          </div>
        )}
      </div>

      <section
        aria-label="Resource Host"
        className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 space-y-4"
      >
        <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
          <Cpu className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>Ringkasan Sistem &amp; Resource</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="bg-white dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800/80 rounded-md p-3 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-200 shrink-0" />
                <span>Penggunaan CPU</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                {hostInfo ? `${hostInfo.hostCpuPercent.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-zinc-900 dark:bg-white transition-all duration-300"
                style={{ width: `${cpuPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
              <span className="truncate">{hostInfo ? `${hostInfo.cpuCores} Cores` : '—'}</span>
              <span className="truncate tabular-nums">
                Load {hostInfo ? `${hostInfo.loadAvg[0]} / ${hostInfo.loadAvg[1]} / ${hostInfo.loadAvg[2]}` : '—'}
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800/80 rounded-md p-3 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <MemoryStick className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-200 shrink-0" />
                <span>Memori RAM</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                {hostInfo ? `${memPct}%` : '—'}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-zinc-900 dark:bg-white transition-all duration-300"
                style={{ width: `${memPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
              <span className="truncate tabular-nums">
                {hostInfo ? `${hostInfo.usedMemoryMb} / ${hostInfo.totalMemoryMb} MB` : '—'}
              </span>
              <span className="truncate tabular-nums">
                Bebas {hostInfo ? `${hostInfo.freeMemoryMb} MB` : '—'}
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800/80 rounded-md p-3 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <MemoryStick className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-200 shrink-0" />
                <span>Swap Memori</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                {hostInfo ? (hostInfo.swapTotalMb > 0 ? `${swapPct}%` : '0%') : '—'}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-zinc-900 dark:bg-white transition-all duration-300"
                style={{ width: `${swapPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
              <span className="truncate tabular-nums">
                {hostInfo
                  ? hostInfo.swapTotalMb > 0
                    ? `${hostInfo.swapUsedMb} / ${hostInfo.swapTotalMb} MB`
                    : 'Tidak aktif'
                  : '—'}
              </span>
              {hostInfo && hostInfo.swapTotalMb > 0 && (
                <span className="truncate tabular-nums">Bebas {hostInfo.swapFreeMb} MB</span>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800/80 rounded-md p-3 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-200 shrink-0" />
                <span>Penyimpanan Disk</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                {hostInfo ? `${diskPct}%` : '—'}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-zinc-900 dark:bg-white transition-all duration-300"
                style={{ width: `${diskPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
              <span className="truncate tabular-nums">
                {hostInfo ? `${hostInfo.diskUsedGb} / ${hostInfo.diskTotalGb} GB` : '—'}
              </span>
              <span className="truncate tabular-nums">
                Bebas {hostInfo ? `${hostInfo.diskFreeGb} GB` : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
          <div className="bg-white/70 dark:bg-zinc-950/40 border border-zinc-200/70 dark:border-zinc-800/70 rounded-md p-3 space-y-1.5 min-w-0">
            <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Sistem &amp; Prosesor</span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">OS</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? hostInfo.osDistro : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Kernel / Arch</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? `${hostInfo.kernel} (${hostInfo.arch})` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Prosesor</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right" title={hostInfo?.cpuModel}>
                {hostInfo ? hostInfo.cpuModel : '—'}
              </span>
            </div>
          </div>

          <div className="bg-white/70 dark:bg-zinc-950/40 border border-zinc-200/70 dark:border-zinc-800/70 rounded-md p-3 space-y-1.5 min-w-0">
            <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Alokasi Kuota Panel</span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Memori Aktif</span>
              <span
                className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums truncate text-right"
                title={
                  hostInfo
                    ? `${hostInfo.allocatedMemoryMb} MB aktif (${hostInfo.panelMemoryUsedMb.toFixed(1)} MB RSS) · Sisa ${hostInfo.availableMemoryMb} MB`
                    : undefined
                }
              >
                {hostInfo
                  ? `${hostInfo.panelMemoryUsedMb.toFixed(1)} / ${hostInfo.allocatedMemoryMb} MB · Sisa ${hostInfo.availableMemoryMb} MB`
                  : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">CPU Aktif</span>
              <span
                className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums truncate text-right"
                title={
                  hostInfo
                    ? `${hostInfo.allocatedCpuPercent}% / ${totalCpuLimit}% kuota (${hostInfo.panelCpuPercent.toFixed(1)}% terpakai) · Sisa ${hostInfo.availableCpuPercent}%`
                    : undefined
                }
              >
                {hostInfo
                  ? `${hostInfo.allocatedCpuPercent}% / ${totalCpuLimit}% (${hostInfo.panelCpuPercent.toFixed(1)}%) · Sisa ${hostInfo.availableCpuPercent}%`
                  : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Kuota Terdaftar</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums truncate text-right">
                {hostInfo
                  ? `${hostInfo.totalAllocatedMemoryMb} MB RAM · ${hostInfo.totalAllocatedCpuPercent}% CPU`
                  : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Instance Aktif</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums truncate text-right">
                {hostInfo ? `${hostInfo.activeServersCount} berjalan / ${hostInfo.totalServersCount} total` : '—'}
              </span>
            </div>
          </div>

          <div className="bg-white/70 dark:bg-zinc-950/40 border border-zinc-200/70 dark:border-zinc-800/70 rounded-md p-3 space-y-1.5 min-w-0">
            <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Lingkungan Runtime</span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Node.js / npm</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? `${hostInfo.nodeVersion} · npm ${hostInfo.npmVersion || '—'}` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Python / pip</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? `${hostInfo.pythonVersion || '—'} · pip ${hostInfo.pipVersion || '—'}` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2">
              <span className="shrink-0 whitespace-nowrap">Platform Host</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? hostInfo.platform : '—'}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
