'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { usePanel, type ServerTab } from './panel-shell';
import ServerConsoleTab from './server-console';
import ServerFilesTab from './server-files';
import ServerSettingsTab from './server-settings';
import { ServerWorkspaceSkeleton } from './skeletons';
import type { ServerWithMetrics } from '@/lib/types';

interface ServerWorkspaceViewProps {
  serverId: string;
  activeTab: ServerTab;
}

export default function ServerWorkspaceView({
  serverId,
  activeTab,
}: ServerWorkspaceViewProps) {
  const {
    user,
    servers,
    loadingData,
    deletedServerIds,
    handleMetricsUpdate,
    handleServerUpdated,
    handleServerDeleted,
    upsertServer,
  } = usePanel();

  const server = servers.find((s) => s.id === serverId) || null;
  const isDeleted = deletedServerIds.includes(serverId);
  const [checkedServerId, setCheckedServerId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (server || isDeleted || loadingData || checkedServerId === serverId) return;

    let active = true;

    async function fetchSingleServer() {
      try {
        const res = await apiFetch<{ server: ServerWithMetrics }>(
          `/api/servers/${encodeURIComponent(serverId)}`
        );
        if (!active) return;
        if (res.server) {
          upsertServer(res.server);
        } else {
          setNotFound(true);
        }
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setCheckedServerId(serverId);
      }
    }

    void fetchSingleServer();
    return () => {
      active = false;
    };
  }, [server, isDeleted, loadingData, serverId, checkedServerId, upsertServer]);

  if (!server) {
    if (isDeleted || loadingData || checkedServerId !== serverId) {
      return <ServerWorkspaceSkeleton tab={activeTab} />;
    }

    return (
      <div className="py-16 px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 text-center space-y-3 bg-zinc-50/40 dark:bg-zinc-900/20 max-w-xl mx-auto mt-8">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {notFound ? 'Server tidak ditemukan' : 'Tidak dapat memuat server'}
        </div>
        <p className="text-xs text-zinc-500">
          Server mungkin sudah dihapus atau Anda tidak memiliki akses ke instance ini.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="h-8 px-4 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Daftar Server</span>
          </Link>
        </div>
      </div>
    );
  }

  const encodedId = encodeURIComponent(server.id);
  const mobileTabs: { id: ServerTab; href: string; label: string }[] = [
    { id: 'console', href: `/server/${encodedId}`, label: 'Console' },
    { id: 'files', href: `/server/${encodedId}/files`, label: 'File Manager' },
    { id: 'settings', href: `/server/${encodedId}/settings`, label: 'Pengaturan' },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
            <span className="uppercase">{server.runtime}</span>
            <span>·</span>
            <span>Port :{server.port}</span>
          </div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
            {server.name}
          </h1>
        </div>

        <div className="flex lg:hidden items-center gap-1 overflow-x-auto pb-1">
          {mobileTabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              className={`h-7 px-3 rounded text-xs font-medium whitespace-nowrap shrink-0 inline-flex items-center ${
                activeTab === tab.id
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {activeTab === 'console' && (
        <ServerConsoleTab
          key={server.id}
          server={server}
          onMetricsUpdate={(m) => handleMetricsUpdate(server.id, m)}
        />
      )}
      {activeTab === 'files' && (
        <ServerFilesTab key={server.id} serverId={server.id} />
      )}
      {activeTab === 'settings' && (
        <ServerSettingsTab
          key={server.id}
          server={server}
          isAdmin={user.role === 'admin'}
          onUpdated={handleServerUpdated}
          onDeleted={handleServerDeleted}
        />
      )}
    </div>
  );
}
