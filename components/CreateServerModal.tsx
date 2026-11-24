'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from './api-client';
import type { ServerRuntime, ServerWithMetrics } from '@/lib/types';

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (server: ServerWithMetrics) => void;
}

export default function CreateServerModal({
  open,
  onClose,
  onCreated,
}: CreateServerModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [runtime, setRuntime] = useState<ServerRuntime>('nodejs');
  const [startupCommand, setStartupCommand] = useState('node index.js');
  const [memoryLimitMb, setMemoryLimitMb] = useState(512);
  const [cpuLimitPercent, setCpuLimitPercent] = useState(100);
  const [autoRestart, setAutoRestart] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function handleRuntimeChange(nextRuntime: ServerRuntime) {
    setRuntime(nextRuntime);
    setStartupCommand(nextRuntime === 'nodejs' ? 'node index.js' : 'python3 -u main.py');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ server: ServerWithMetrics }>(
        '/api/servers',
        {
          method: 'POST',
          body: JSON.stringify({
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
      setAutoRestart(false);
      onCreated(res.server);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat server.');
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
    >
      <div className="w-full max-w-xl bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 id="create-server-title" className="text-sm font-semibold">
            Buat Server
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal buat server"
            className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="srv-name"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
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

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="srv-mem"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Memori
              </label>
              <select
                id="srv-mem"
                value={memoryLimitMb}
                onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs font-mono focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
              >
                <option value={256}>256 MB</option>
                <option value={512}>512 MB</option>
                <option value={1024}>1024 MB</option>
                <option value={2048}>2048 MB</option>
                <option value={4096}>4096 MB</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="srv-cpu"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Batas CPU
              </label>
              <select
                id="srv-cpu"
                value={cpuLimitPercent}
                onChange={(e) => setCpuLimitPercent(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs font-mono focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
              >
                <option value={50}>50%</option>
                <option value={100}>100%</option>
                <option value={200}>200%</option>
                <option value={400}>400%</option>
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
            <span>Auto-restart saat proses berhenti dengan error</span>
          </label>

          {error && (
            <div
              role="alert"
              className="p-2.5 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-600 dark:text-red-400"
            >
              {error}
            </div>
          )}

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer whitespace-nowrap"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
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
