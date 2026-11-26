'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { showErrorAlert, showSuccessToast, showWarningAlert } from '@/lib/alerts';
import {
  getDefaultCpuPercent,
  getDefaultMemoryMb,
  getHostCpuOptions,
  getHostMemoryOptions,
} from '@/lib/resource-limits';
import type {
  AdminUserSummary,
  HostInfo,
  ServerRuntime,
  ServerWithMetrics,
} from '@/lib/types';

interface CreateServerModalProps {
  open: boolean;
  hostInfo: HostInfo | null;
  isAdmin?: boolean;
  currentUserId?: string;
  users?: AdminUserSummary[];
  initialOwnerId?: string;
  onClose: () => void;
  onCreated: (server: ServerWithMetrics) => void;
}

export default function CreateServerModal({
  open,
  hostInfo,
  isAdmin = false,
  currentUserId = '',
  users,
  initialOwnerId,
  onClose,
  onCreated,
}: CreateServerModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [runtime, setRuntime] = useState<ServerRuntime>('nodejs');
  const [startupCommand, setStartupCommand] = useState('node index.js');
  const [selectedMemoryMb, setSelectedMemoryMb] = useState<number | null>(null);
  const [selectedCpuPercent, setSelectedCpuPercent] = useState<number | null>(null);
  const [autoRestart, setAutoRestart] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState(initialOwnerId || currentUserId);
  const [fetchedUsers, setFetchedUsers] = useState<AdminUserSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const ownerOptions = useMemo(() => {
    if (!isAdmin) return [];
    if (users && users.length > 0) return users;
    return fetchedUsers;
  }, [isAdmin, users, fetchedUsers]);

  const effectiveOwnerId = useMemo(() => {
    if (!isAdmin) return '';
    if (selectedOwnerId && ownerOptions.some((u) => u.id === selectedOwnerId)) {
      return selectedOwnerId;
    }
    if (initialOwnerId && ownerOptions.some((u) => u.id === initialOwnerId)) {
      return initialOwnerId;
    }
    if (currentUserId && ownerOptions.some((u) => u.id === currentUserId)) {
      return currentUserId;
    }
    return ownerOptions[0]?.id || currentUserId || '';
  }, [isAdmin, selectedOwnerId, initialOwnerId, currentUserId, ownerOptions]);

  const memoryOptions = useMemo(() => getHostMemoryOptions(hostInfo, 0), [hostInfo]);
  const cpuOptions = useMemo(() => getHostCpuOptions(hostInfo, 0), [hostInfo]);

  const defaultMemoryMb = getDefaultMemoryMb(hostInfo);
  const defaultCpuPercent = getDefaultCpuPercent(hostInfo);

  const memoryLimitMb =
    selectedMemoryMb !== null && memoryOptions.some((o) => o.value === selectedMemoryMb)
      ? selectedMemoryMb
      : defaultMemoryMb;
  const cpuLimitPercent =
    selectedCpuPercent !== null && cpuOptions.some((o) => o.value === selectedCpuPercent)
      ? selectedCpuPercent
      : defaultCpuPercent;

  const resourceUnavailable = memoryOptions.length === 0 || cpuOptions.length === 0;

  useEffect(() => {
    if (!open || !isAdmin || (users && users.length > 0)) return;
    let active = true;
    async function loadUsers() {
      try {
        const res = await apiFetch<{ users: AdminUserSummary[] }>('/api/admin/users');
        if (active) setFetchedUsers(res.users);
      } catch {

      }
    }
    void loadUsers();
    return () => {
      active = false;
    };
  }, [open, isAdmin, users]);

  useEffect(() => {
    if (open && resourceUnavailable) {
      void showWarningAlert(
        'Resource Host Penuh',
        'Sisa memori atau batas CPU host sudah habis digunakan oleh server aktif lainnya. Hentikan atau kurangi batas resource server lain terlebih dahulu.'
      );
    }
  }, [open, resourceUnavailable]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  function handleRuntimeChange(nextRuntime: ServerRuntime) {
    setRuntime(nextRuntime);
    setStartupCommand(nextRuntime === 'nodejs' ? 'node index.js' : 'python3 -u main.py');
  }

  function handleCloseModal() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (resourceUnavailable) {
      await showWarningAlert(
        'Resource Host Penuh',
        'Sisa memori atau batas CPU host sudah habis digunakan.'
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ server: ServerWithMetrics }>(
        '/api/servers',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(isAdmin && effectiveOwnerId ? { ownerId: effectiveOwnerId } : {}),
            name,
            description,
            runtime,
            startupCommand,
            memoryLimitMb,
            cpuLimitPercent,
            autoRestart,
          }),
        }
      );
      setName('');
      setDescription('');
      setRuntime('nodejs');
      setStartupCommand('node index.js');
      setSelectedMemoryMb(null);
      setSelectedCpuPercent(null);
      setAutoRestart(false);
      setSelectedOwnerId(initialOwnerId || currentUserId);
      void showSuccessToast(
        'Server berhasil dibuat',
        `${res.server.name} siap digunakan`
      );
      onCreated(res.server);
      onClose();
    } catch (err) {
      await showErrorAlert(
        'Gagal Membuat Server',
        err instanceof Error ? err.message : 'Gagal membuat server.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-server-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCloseModal();
      }}
    >
      <div className="w-full max-w-xl bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 id="create-server-title" className="text-sm font-semibold">
            Buat Server
          </h2>
          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Tutup modal buat server"
            className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {isAdmin && ownerOptions.length > 0 && (
            <div className="space-y-1.5">
              <label
                htmlFor="srv-owner"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Pemilik Server
              </label>
              <select
                id="srv-owner"
                value={effectiveOwnerId}
                onChange={(e) => setSelectedOwnerId(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
              >
                {ownerOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email}) — {u.role}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="srv-name"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate"
              >
                Nama Server
              </label>
              <input
                id="srv-name"
                type="text"
                required
                minLength={2}
                maxLength={48}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="bot-worker-01"
                className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                Runtime Server
              </span>
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-zinc-100 dark:bg-zinc-900 rounded-md border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => handleRuntimeChange('nodejs')}
                  className={`h-8 text-xs font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
                    runtime === 'nodejs'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  Node.js
                </button>
                <button
                  type="button"
                  onClick={() => handleRuntimeChange('python')}
                  className={`h-8 text-xs font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
                    runtime === 'python'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  Python
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="srv-startup"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Perintah Startup
            </label>
            <input
              id="srv-startup"
              type="text"
              required
              value={startupCommand}
              onChange={(e) => setStartupCommand(e.target.value)}
              placeholder={runtime === 'nodejs' ? 'node index.js' : 'python3 -u main.py'}
              className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-xs font-mono focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="srv-desc"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Catatan (Opsional)
            </label>
            <input
              id="srv-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="REST API atau worker"
              className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="srv-mem"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate"
              >
                Memori
              </label>
              <select
                id="srv-mem"
                value={memoryLimitMb}
                disabled={memoryOptions.length === 0}
                onChange={(e) => setSelectedMemoryMb(Number(e.target.value))}
                className="w-full h-9 px-2.5 sm:px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs font-mono focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400 disabled:opacity-50"
              >
                {memoryOptions.length === 0 ? (
                  <option value={0}>Memori tersedia habis</option>
                ) : (
                  memoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="srv-cpu"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate"
              >
                Batas CPU
              </label>
              <select
                id="srv-cpu"
                value={cpuLimitPercent}
                disabled={cpuOptions.length === 0}
                onChange={(e) => setSelectedCpuPercent(Number(e.target.value))}
                className="w-full h-9 px-2.5 sm:px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs font-mono focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400 disabled:opacity-50"
              >
                {cpuOptions.length === 0 ? (
                  <option value={0}>Batas CPU habis</option>
                ) : (
                  cpuOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={autoRestart}
              onChange={(e) => setAutoRestart(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            <span>Auto-restart saat proses berhenti</span>
          </label>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={handleCloseModal}
              disabled={submitting}
              className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || resourceUnavailable}
              className="h-9 px-4 rounded-md bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 text-xs font-medium transition-opacity cursor-pointer whitespace-nowrap"
            >
              {submitting ? 'Membuat...' : 'Buat Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
