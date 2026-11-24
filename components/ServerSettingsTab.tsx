'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Trash2, Terminal, ShieldAlert } from 'lucide-react';
import { apiFetch } from './api-client';
import type { ServerWithMetrics } from '@/lib/types';

interface ServerSettingsTabProps {
  server: ServerWithMetrics;
  onUpdated: (server: ServerWithMetrics) => void;
  onDeleted: (serverId: string) => void;
}

export default function ServerSettingsTab({
  server,
  onUpdated,
  onDeleted,
}: ServerSettingsTabProps) {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [startupCommand, setStartupCommand] = useState(server.startupCommand);
  const [autoRestart, setAutoRestart] = useState(server.autoRestart);
  const [memoryLimitMb, setMemoryLimitMb] = useState(server.memoryLimitMb);
  const [cpuLimitPercent, setCpuLimitPercent] = useState(server.cpuLimitPercent);

  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInitialMount = useRef(true);

  // Auto-save on changes with debounce
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const timer = setTimeout(async () => {
      setSavingStatus('Menyimpan otomatis...');
      setError(null);
      try {
        const res = await apiFetch<{ server: ServerWithMetrics }>(
          `/api/servers/${server.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              description,
              startupCommand,
              autoRestart,
              memoryLimitMb,
              cpuLimitPercent,
            }),
          }
        );
        onUpdated(res.server);
        setSavingStatus('Tersimpan otomatis');
        const clearTimer = setTimeout(() => setSavingStatus(null), 2000);
        return () => clearTimeout(clearTimer);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan.');
        setSavingStatus(null);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [name, description, startupCommand, autoRestart, memoryLimitMb, cpuLimitPercent, server.id, onUpdated]);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/servers/${server.id}`, { method: 'DELETE' });
      onDeleted(server.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus server.');
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
          Pengaturan Server
        </h2>
        {savingStatus && (
          <span className="text-xs font-mono text-emerald-500 animate-pulse">
            {savingStatus}
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-500 font-medium"
        >
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
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
              onChange={(e) => setStartupCommand(e.target.value)}
              placeholder={server.runtime === 'nodejs' ? 'node index.js' : 'python3 -u main.py'}
              className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={autoRestart}
              onChange={(e) => setAutoRestart(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
            />
            <span>Auto-restart otomatis saat proses berhenti karena error</span>
          </label>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
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
                onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Deskripsi singkat"
                className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="srv-mem" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Alokasi Memori
              </label>
              <select
                id="srv-mem"
                value={memoryLimitMb}
                onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
              >
                <option value={256}>256 MB</option>
                <option value={512}>512 MB</option>
                <option value={1024}>1024 MB (1 GB)</option>
                <option value={2048}>2048 MB (2 GB)</option>
                <option value={4096}>4096 MB (4 GB)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="srv-cpu" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Batas CPU
              </label>
              <select
                id="srv-cpu"
                value={cpuLimitPercent}
                onChange={(e) => setCpuLimitPercent(Number(e.target.value))}
                className="w-full h-9 px-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
              >
                <option value={50}>50% (0.5 Core)</option>
                <option value={100}>100% (1 Core)</option>
                <option value={200}>200% (2 Cores)</option>
                <option value={400}>400% (4 Cores)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-red-500/20">
          <ShieldAlert className="w-4 h-4 text-red-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
            Hapus Server
          </h3>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Tindakan ini permanen dan akan menghapus seluruh file server serta menghentikan proses yang berjalan.
        </p>

        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-8 px-3.5 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Hapus Server Ini</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="h-8 px-3.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
            >
              {deleting ? 'Menghapus...' : `Konfirmasi Hapus "${server.name}"`}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-8 px-3 rounded border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              Batal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
