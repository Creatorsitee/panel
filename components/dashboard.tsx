'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
} from 'lucide-react';
import { usePanel } from './panel-shell';
import { DashboardContentSkeleton } from './skeletons';
import { getStatusDisplayLabel } from '@/lib/console-state';

export default function ServersDashboardView() {
  const { servers, loadingData, openCreateModal } = usePanel();
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

  return (
    <div className="space-y-6">

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
