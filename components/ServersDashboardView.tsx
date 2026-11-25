'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  Search,
  Server,
  Terminal,
} from 'lucide-react';
import { usePanel } from './PanelContext';
import { DashboardContentSkeleton } from './Skeletons';
import { getStatusDisplayLabel } from '@/lib/console-state';

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

export default function ServersDashboardView() {
  const { servers, hostInfo, loadingData, openCreateModal } = usePanel();
  const [searchQuery, setSearchQuery] = useState('');
  const [runtimeFilter, setRuntimeFilter] = useState<'all' | 'nodejs' | 'python'>('all');

  const filteredServers = useMemo(() => {
    return servers.filter((srv) => {
      if (runtimeFilter !== 'all' && srv.runtime !== runtimeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          srv.name.toLowerCase().includes(q) ||
          srv.description.toLowerCase().includes(q) ||
          String(srv.port).includes(q)
        );
      }
      return true;
    });
  }, [servers, runtimeFilter, searchQuery]);

  if (loadingData && servers.length === 0) {
    return <DashboardContentSkeleton />;
  }

  const memPct = hostInfo ? clampPct(hostInfo.usedMemoryMb, hostInfo.totalMemoryMb) : 0;
  const swapPct = hostInfo && hostInfo.swapTotalMb > 0 ? clampPct(hostInfo.swapUsedMb, hostInfo.swapTotalMb) : 0;
  const diskPct = hostInfo ? clampPct(hostInfo.diskUsedGb, hostInfo.diskTotalGb) : 0;
  const cpuPct = hostInfo ? Math.max(0, Math.min(100, Math.round(hostInfo.hostCpuPercent))) : 0;
  const totalCpuLimit = hostInfo ? Math.max(100, hostInfo.cpuCores * 100) : 100;

  return (
    <div className="space-y-6">
      {/* Comprehensive Resource VPS Host Panel */}
      <section
        aria-label="Resource VPS Host"
        className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
            <Cpu className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>Resource VPS Host</span>
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

        {/* Row 1: Primary Hardware Utilization Meters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* CPU Utilization */}
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

          {/* RAM Utilization */}
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

          {/* Swap Memory */}
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

          {/* Disk Storage */}
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

        {/* Row 2: Detailed Host Hardware, Panel Quota Allocation & Runtime Stack */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
          <div className="bg-white/70 dark:bg-zinc-950/40 border border-zinc-200/70 dark:border-zinc-800/70 rounded-md p-3 space-y-1.5 min-w-0">
            <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Sistem &amp; Prosesor</span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>OS</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? hostInfo.osDistro : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Kernel / Arch</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? `${hostInfo.kernel} (${hostInfo.arch})` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Prosesor</span>
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
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Memori Terpakai</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums truncate text-right">
                {hostInfo ? `${hostInfo.allocatedMemoryMb} MB (Sisa ${hostInfo.availableMemoryMb} MB)` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>CPU Terpakai</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums truncate text-right">
                {hostInfo ? `${hostInfo.allocatedCpuPercent}% / ${totalCpuLimit}% (Sisa ${hostInfo.availableCpuPercent}%)` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Instance Aktif</span>
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
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Node.js / npm</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? `${hostInfo.nodeVersion} · npm ${hostInfo.npmVersion || '—'}` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Python / pip</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? `${hostInfo.pythonVersion || '—'} · pip ${hostInfo.pipVersion || '—'}` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 flex justify-between gap-2">
              <span>Platform Host</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate text-right">
                {hostInfo ? hostInfo.platform : '—'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Cari server"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau port server..."
            className="w-full h-9 pl-8 pr-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div
          className="w-full sm:w-auto flex flex-wrap items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded"
          role="group"
          aria-label="Filter runtime server"
        >
          {(['all', 'nodejs', 'python'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setRuntimeFilter(item)}
              className={`flex-1 sm:flex-initial h-7 px-2.5 sm:px-3 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap text-center ${
                runtimeFilter === item
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {item === 'all' ? 'Semua Runtime' : item === 'nodejs' ? 'Node.js' : 'Python'}
            </button>
          ))}
        </div>
      </div>

      {/* Server Cards Grid */}
      {filteredServers.length === 0 ? (
        <div className="py-16 px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 text-center space-y-3 bg-zinc-50/40 dark:bg-zinc-900/20">
          <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {servers.length === 0 ? 'Belum ada server yang dibuat' : 'Tidak ada server yang cocok'}
          </div>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Buat server Node.js atau Python baru untuk menjalankan aplikasi dan bot secara real-time.
          </p>
          {servers.length === 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={openCreateModal}
                className="h-8 px-4 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buat Server</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map((srv) => {
            const statusText = getStatusDisplayLabel(srv.metrics.status);

            const statusBadgeClass =
              srv.metrics.status === 'running'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : srv.metrics.status === 'error'
                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                : srv.metrics.status === 'installing' ||
                  srv.metrics.status === 'starting' ||
                  srv.metrics.status === 'stopping'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30';

            return (
              <Link
                key={srv.id}
                href={`/server/${encodeURIComponent(srv.id)}`}
                className="group bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 rounded-lg p-4 flex flex-col justify-between transition-all shadow-xs hover:shadow-md"
              >
                <div className="space-y-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-zinc-500 uppercase truncate">
                        {srv.runtime === 'nodejs' ? 'Node.js' : 'Python'} · :{srv.port}
                      </div>
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-zinc-950 dark:group-hover:text-white mt-0.5 truncate">
                        {srv.name}
                      </h3>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border shrink-0 ${statusBadgeClass}`}
                    >
                      <span>{statusText}</span>
                    </span>
                  </div>

                  <div className="p-2 rounded bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                    {srv.startupCommand}
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-mono text-zinc-500 text-[11px] flex items-center gap-2 min-w-0">
                    <span>CPU: {srv.metrics.cpuPercent.toFixed(1)}%</span>
                    <span>·</span>
                    <span>RAM: {srv.metrics.memoryMb.toFixed(1)}MB</span>
                  </div>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:underline text-xs shrink-0">
                    Kelola &rarr;
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
