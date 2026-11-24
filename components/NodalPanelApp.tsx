'use client';

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowLeft,
  Cpu,
  FolderOpen,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Server,
  Settings,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import { apiFetch, setAuthToken } from './api-client';
import AuthScreen from './AuthScreen';
import CreateServerModal from './CreateServerModal';
import ServerConsoleTab from './ServerConsoleTab';
import ServerFilesTab from './ServerFilesTab';
import ServerSettingsTab from './ServerSettingsTab';
import type {
  HostVpsInfo,
  PublicUser,
  ServerRuntimeMetrics,
  ServerWithMetrics,
} from '@/lib/types';

type ServerTab = 'console' | 'files' | 'settings';
type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'nodal_theme';
const THEME_EVENT = 'nodal-theme-change';

function subscribeTheme(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

function getThemeSnapshot(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'dark';
}

function getThemeServerSnapshot(): ThemeMode {
  return 'dark';
}

function saveThemeMode(nextMode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    window.dispatchEvent(new Event(THEME_EVENT));
  } catch {
    // ignore storage errors
  }
}

export default function NodalPanelApp() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [servers, setServers] = useState<ServerWithMetrics[]>([]);
  const [hostInfo, setHostInfo] = useState<HostVpsInfo | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [serverTab, setServerTab] = useState<ServerTab>('console');

  const [searchQuery, setSearchQuery] = useState('');
  const [runtimeFilter, setRuntimeFilter] = useState<'all' | 'nodejs' | 'python'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const themeMode = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [srvRes, hostRes] = await Promise.all([
        apiFetch<{ servers: ServerWithMetrics[] }>('/api/servers'),
        apiFetch<{ host: HostVpsInfo }>('/api/host'),
      ]);
      setServers(srvRes.servers);
      setHostInfo(hostRes.host);
    } catch {
      // ignore transient error
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function checkSession() {
      try {
        const res = await apiFetch<{ user: PublicUser | null }>('/api/auth/me');
        if (mounted && res.user) {
          setUser(res.user);
          setLoadingData(true);
        }
      } catch {
        // unauthenticated
      } finally {
        if (mounted) setCheckingAuth(false);
      }
    }
    checkSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const runFetch = async () => {
      if (!active) return;
      await loadWorkspaceData();
    };
    void runFetch();
    const timer = setInterval(() => {
      void runFetch();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user, loadWorkspaceData]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const shouldUseDark =
        themeMode === 'dark' || (themeMode === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', shouldUseDark);
    };

    applyTheme();

    if (themeMode === 'system') {
      media.addEventListener('change', applyTheme);
      return () => media.removeEventListener('change', applyTheme);
    }
    return undefined;
  }, [themeMode]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setServers([]);
    setActiveServerId(null);
  }

  const activeServer = useMemo(
    () => servers.find((s) => s.id === activeServerId) || null,
    [servers, activeServerId]
  );

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

  const handleMetricsUpdate = useCallback(
    (serverId: string, metrics: ServerRuntimeMetrics) => {
      setServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, metrics } : s))
      );
    },
    []
  );

  function handleServerUpdated(updated: ServerWithMetrics) {
    setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function handleServerDeleted(serverId: string) {
    setServers((prev) => prev.filter((s) => s.id !== serverId));
    if (activeServerId === serverId) {
      setActiveServerId(null);
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#09090B] flex items-center justify-center text-xs font-mono text-zinc-500">
        Memuat...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={(u) => setUser(u)} />;
  }

  const serverTabs: { id: ServerTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'console', label: 'Console', icon: Terminal },
    { id: 'files', label: 'File Manager', icon: FolderOpen },
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ];

  const activeTabLabel =
    serverTabs.find((t) => t.id === serverTab)?.label || 'Console';

  return (
    <div className="min-h-screen bg-white dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100 flex">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-zinc-50 dark:bg-[#0C0C0E] border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-150 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-14 px-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setActiveServerId(null);
              setMobileNavOpen(false);
            }}
            className="text-sm font-bold tracking-tight uppercase cursor-pointer"
          >
            Nodal Panel
          </button>

          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Tutup menu"
            className="lg:hidden w-8 h-8 rounded flex items-center justify-center text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-6 overflow-y-auto" aria-label="Navigasi utama">
          <div className="space-y-1">
            <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              Navigasi Utama
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveServerId(null);
                setMobileNavOpen(false);
              }}
              className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                !activeServer
                  ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Server className="w-4 h-4 shrink-0" />
              <span>Daftar Server</span>
            </button>
          </div>

          {activeServer && (
            <div className="space-y-1 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase truncate">
                Server: {activeServer.name}
              </div>
              {serverTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = serverTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setServerTab(tab.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div
            role="radiogroup"
            aria-label="Pilih tema tampilan"
            className="grid grid-cols-3 gap-1 p-1 rounded bg-zinc-200/60 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
          >
            {(
              [
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'system', label: 'System', icon: Monitor },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = themeMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Tema ${opt.label}`}
                  title={opt.label}
                  onClick={() => saveThemeMode(opt.id)}
                  className={`h-7 rounded flex items-center justify-center transition-colors cursor-pointer ${
                    active
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{user.name}</div>
              <div className="text-[11px] text-zinc-500 truncate font-mono">
                {user.email}
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Keluar dari akun"
              title="Keluar"
              className="w-8 h-8 rounded flex items-center justify-center text-zinc-500 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 px-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Buka menu"
              className="lg:hidden w-8 h-8 rounded flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Menu className="w-4 h-4" />
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs min-w-0">
              <button
                type="button"
                onClick={() => {
                  setActiveServerId(null);
                }}
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                Panel
              </button>
              <span className="text-zinc-400">/</span>
              {activeServer ? (
                <>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate max-w-[160px] sm:max-w-xs">
                    {activeServer.name}
                  </span>
                  <span className="text-zinc-400">/</span>
                  <span className="text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    {activeTabLabel}
                  </span>
                </>
              ) : (
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  Daftar Server
                </span>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeServer ? (
              <button
                type="button"
                onClick={() => {
                  setActiveServerId(null);
                }}
                className="h-8 px-3 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Semua Server</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-8 px-3.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 text-xs font-medium inline-flex items-center gap-1.5 transition-opacity cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buat Server</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 max-w-6xl w-full mx-auto">
          {activeServer ? (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                    <span className="uppercase">{activeServer.runtime}</span>
                    <span>·</span>
                    <span>Port :{activeServer.port}</span>
                  </div>
                  <h1 className="text-xl font-bold tracking-tight mt-0.5 text-zinc-900 dark:text-zinc-100">
                    {activeServer.name}
                  </h1>
                </div>

                <div className="flex lg:hidden items-center gap-1 overflow-x-auto pb-1">
                  {serverTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setServerTab(tab.id)}
                      className={`h-7 px-3 rounded text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                        serverTab === tab.id
                          ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {serverTab === 'console' && (
                <ServerConsoleTab
                  key={activeServer.id}
                  server={activeServer}
                  onMetricsUpdate={(m) => handleMetricsUpdate(activeServer.id, m)}
                />
              )}
              {serverTab === 'files' && (
                <ServerFilesTab key={activeServer.id} serverId={activeServer.id} />
              )}
              {serverTab === 'settings' && (
                <ServerSettingsTab
                  key={activeServer.id}
                  server={activeServer}
                  onUpdated={handleServerUpdated}
                  onDeleted={handleServerDeleted}
                />
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Host VPS Stats Bar (No Refresh Button) */}
              <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                    <Cpu className="w-4 h-4 text-zinc-500" />
                    <span>Resource VPS Host</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <div className="text-zinc-500 text-[11px]">Hostname</div>
                    <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate">
                      {hostInfo ? hostInfo.hostname : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-[11px]">CPU &amp; Load</div>
                    <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {hostInfo ? `${hostInfo.cpuCores} Cores (Load ${hostInfo.loadAvg[0]})` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-[11px]">Memori Terpakai</div>
                    <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                      {hostInfo ? `${hostInfo.usedMemoryMb} / ${hostInfo.totalMemoryMb} MB` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-[11px]">Runtime Aktif</div>
                    <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate">
                      {hostInfo ? `Node ${hostInfo.nodeVersion} · Py ${hostInfo.pythonVersion || '—'}` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
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
                  className="inline-flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded"
                  role="group"
                  aria-label="Filter runtime server"
                >
                  {(['all', 'nodejs', 'python'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setRuntimeFilter(item)}
                      className={`h-7 px-3 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
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
              {loadingData && servers.length === 0 ? (
                <div className="py-12 text-center text-xs font-mono text-zinc-500">
                  Memuat daftar server...
                </div>
              ) : filteredServers.length === 0 ? (
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
                        onClick={() => setCreateOpen(true)}
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
                    const statusText =
                      srv.metrics.status === 'running'
                        ? 'Running'
                        : srv.metrics.status === 'installing'
                        ? 'Installing'
                        : srv.metrics.status === 'starting'
                        ? 'Starting'
                        : srv.metrics.status === 'error'
                        ? 'Error'
                        : 'Stopped';

                    const statusBadgeClass =
                      srv.metrics.status === 'running'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : srv.metrics.status === 'error'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                        : srv.metrics.status === 'installing' ||
                          srv.metrics.status === 'starting'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                        : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30';

                    return (
                      <div
                        key={srv.id}
                        onClick={() => {
                          setActiveServerId(srv.id);
                          setServerTab('console');
                        }}
                        className="group bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 rounded-lg p-4 flex flex-col justify-between transition-all cursor-pointer shadow-xs hover:shadow-md"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-mono text-zinc-500 uppercase">
                                {srv.runtime === 'nodejs' ? 'Node.js' : 'Python'} · :{srv.port}
                              </div>
                              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-zinc-950 dark:group-hover:text-white mt-0.5 truncate">
                                {srv.name}
                              </h3>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border shrink-0 ${statusBadgeClass}`}
                            >
                              {srv.metrics.status === 'running' && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              )}
                              <span>{statusText}</span>
                            </span>
                          </div>

                          <div className="p-2 rounded bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                            {srv.startupCommand}
                          </div>
                        </div>

                        <div className="pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
                          <div className="font-mono text-zinc-500 text-[11px] space-x-2">
                            <span>CPU: {srv.metrics.cpuPercent.toFixed(1)}%</span>
                            <span>·</span>
                            <span>RAM: {srv.metrics.memoryMb.toFixed(1)}MB</span>
                          </div>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:underline text-xs">
                            Kelola &rarr;
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <CreateServerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setServers((prev) => [created, ...prev]);
          setActiveServerId(created.id);
          setServerTab('console');
        }}
      />
    </div>
  );
}
