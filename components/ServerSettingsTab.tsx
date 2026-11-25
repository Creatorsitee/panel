'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Terminal, ShieldAlert } from 'lucide-react';
import { apiFetch } from './api-client';
import { showConfirmDialog, showErrorAlert } from '@/lib/swal';
import {
  getHostCpuOptions,
  getHostMemoryOptions,
} from '@/lib/vps-specs';
import type { HostInfo, ServerWithMetrics } from '@/lib/types';

interface ServerSettingsTabProps {
  server: ServerWithMetrics;
  hostInfo: HostInfo | null;
  isAdmin: boolean;
  onUpdated: (server: ServerWithMetrics) => void;
  onDeleted: (serverId: string) => void;
}

export default function ServerSettingsTab({
  server,
  hostInfo,
  isAdmin,
  onUpdated,
  onDeleted,
}: ServerSettingsTabProps) {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [startupCommand, setStartupCommand] = useState(server.startupCommand);
  const [autoRestart, setAutoRestart] = useState(server.autoRestart);
  const [portInput, setPortInput] = useState(String(server.port));
  const [memoryLimitMb, setMemoryLimitMb] = useState(server.memoryLimitMb);
  const [cpuLimitPercent, setCpuLimitPercent] = useState(server.cpuLimitPercent);

  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const lastSavedRef = useRef({
    name: server.name,
    description: server.description,
    startupCommand: server.startupCommand,
    autoRestart: server.autoRestart,
    port: server.port,
    memoryLimitMb: server.memoryLimitMb,
    cpuLimitPercent: server.cpuLimitPercent,
  });

  const isServerActive =
    server.metrics.status === 'running' ||
    server.metrics.status === 'starting' ||
    server.metrics.status === 'installing';

  const memoryOptions = useMemo(() => {
    const opts = getHostMemoryOptions(hostInfo, isServerActive ? server.memoryLimitMb : 0);
    if (!opts.some((o) => o.value === server.memoryLimitMb)) {
      return [
        ...opts,
        {
          value: server.memoryLimitMb,
          label:
            server.memoryLimitMb >= 1024
              ? `${server.memoryLimitMb} MB (${Number((server.memoryLimitMb / 1024).toFixed(1))} GB)`
              : `${server.memoryLimitMb} MB`,
        },
      ].sort((a, b) => a.value - b.value);
    }
    return opts;
  }, [hostInfo, isServerActive, server.memoryLimitMb]);

  const cpuOptions = useMemo(() => {
    const opts = getHostCpuOptions(hostInfo, isServerActive ? server.cpuLimitPercent : 0);
    if (!opts.some((o) => o.value === server.cpuLimitPercent)) {
      const cores = Number((server.cpuLimitPercent / 100).toFixed(2));
      return [
        ...opts,
        {
          value: server.cpuLimitPercent,
          label: `${server.cpuLimitPercent}% (${cores} ${cores === 1 ? 'Core' : 'Cores'})`,
        },
      ].sort((a, b) => a.value - b.value);
    }
    return opts;
  }, [hostInfo, isServerActive, server.cpuLimitPercent]);

  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  }, [onUpdated]);

  const trimmedPort = portInput.trim();
  const parsedPort = trimmedPort ? Number(trimmedPort) : server.port;
  const portError =
    isAdmin &&
    trimmedPort !== '' &&
    (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535)
      ? 'Port harus berupa angka antara 1024 hingga 65535.'
      : null;

  // Silent auto-save only when values are valid and actually differ from last saved state
  useEffect(() => {
    const saved = lastSavedRef.current;
    const trimmedName = name.trim();
    const trimmedCmd = startupCommand.trim();
    if (trimmedName.length < 2 || trimmedCmd.length === 0 || portError) {
      return;
    }

    const portChanged = isAdmin && trimmedPort !== '' && parsedPort !== saved.port;

    const isDirty =
      trimmedName !== saved.name ||
      description !== saved.description ||
      trimmedCmd !== saved.startupCommand ||
      autoRestart !== saved.autoRestart ||
      portChanged ||
      memoryLimitMb !== saved.memoryLimitMb ||
      cpuLimitPercent !== saved.cpuLimitPercent;

    if (!isDirty) return;

    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ server: ServerWithMetrics }>(
          `/api/servers/${server.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: trimmedName,
              description,
              startupCommand: trimmedCmd,
              autoRestart,
              ...(portChanged ? { port: parsedPort } : {}),
              memoryLimitMb,
              cpuLimitPercent,
            }),
          }
        );
        lastSavedRef.current = {
          name: res.server.name,
          description: res.server.description,
          startupCommand: res.server.startupCommand,
          autoRestart: res.server.autoRestart,
          port: res.server.port,
          memoryLimitMb: res.server.memoryLimitMb,
          cpuLimitPercent: res.server.cpuLimitPercent,
        };
        setSaveError(null);
        onUpdatedRef.current(res.server);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan.');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [name, description, startupCommand, autoRestart, isAdmin, trimmedPort, parsedPort, portError, memoryLimitMb, cpuLimitPercent, server.id]);

  async function handleDelete() {
    const confirmed = await showConfirmDialog({
      title: `Hapus server "${server.name}"?`,
      text: 'Tindakan ini permanen dan akan menghapus seluruh file server serta menghentikan proses yang berjalan.',
      confirmText: 'Ya, Hapus Server',
      cancelText: 'Batal',
      destructive: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await apiFetch(`/api/servers/${server.id}`, { method: 'DELETE' });
      onDeleted(server.id);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus Server',
        err instanceof Error ? err.message : 'Gagal menghapus server.'
      );
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl pb-12">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
          Pengaturan Server
        </h2>
      </div>

      <div className="space-y-6">
        <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <Terminal className="w-4 h-4 text-zinc-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
              Startup &amp; Perintah Eksekusi
            </h3>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="startup-input" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Perintah Startup
            </label>
            <input
              id="startup-input"
              type="text"
              required
              value={startupCommand}
              onChange={(e) => {
                setStartupCommand(e.target.value);
                if (saveError) setSaveError(null);
              }}
              placeholder={server.runtime === 'nodejs' ? 'node index.js' : 'python3 -u main.py'}
              className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
            {saveError && (
              <p className="text-[11px] text-red-500" role="status">
                {saveError}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={autoRestart}
              onChange={(e) => setAutoRestart(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100 shrink-0"
            />
            <span>Auto-restart otomatis saat proses berhenti</span>
          </label>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
              Detail &amp; Alokasi Resource
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="srv-name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Nama Server
              </label>
              <input
                id="srv-name"
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (saveError) setSaveError(null);
                }}
                className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="srv-desc" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Catatan
              </label>
              <input
                id="srv-desc"
                type="text"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (saveError) setSaveError(null);
                }}
                placeholder="Deskripsi singkat"
                className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="sm:col-span-2 grid grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1.5 min-w-0">
                <label htmlFor="srv-mem" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                  Alokasi Memori
                </label>
                <select
                  id="srv-mem"
                  value={memoryLimitMb}
                  onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                  className="w-full h-9 px-2.5 sm:px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                >
                  {memoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 min-w-0">
                <label htmlFor="srv-cpu" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                  Batas CPU
                </label>
                <select
                  id="srv-cpu"
                  value={cpuLimitPercent}
                  onChange={(e) => setCpuLimitPercent(Number(e.target.value))}
                  className="w-full h-9 px-2.5 sm:px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                >
                  {cpuOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="srv-port-edit" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Port Internal
              </label>
              <input
                id="srv-port-edit"
                type="number"
                min={1024}
                max={65535}
                value={isAdmin ? portInput : String(server.port)}
                readOnly={!isAdmin}
                aria-readonly={!isAdmin}
                onChange={(e) => {
                  if (isAdmin) setPortInput(e.target.value);
                }}
                className={
                  isAdmin
                    ? 'w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500'
                    : 'w-full h-9 px-3 rounded bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-500 dark:text-zinc-400 cursor-default focus:outline-none'
                }
              />
              {isAdmin && portError && (
                <p className="text-[11px] text-red-500">{portError}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-red-500/20">
          <ShieldAlert className="w-4 h-4 text-red-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
            Hapus Server
          </h3>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Tindakan ini permanen dan akan menghapus seluruh file server serta menghentikan proses yang berjalan.
        </p>

        <button
          type="button"
          disabled={deleting}
          onClick={handleDelete}
          className="h-8 px-3.5 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{deleting ? 'Menghapus...' : 'Hapus Server Ini'}</span>
        </button>
      </div>
    </div>
  );
}
