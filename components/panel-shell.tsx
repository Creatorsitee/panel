'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Cpu,
  FolderOpen,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Server,
  Settings,
  Shield,
  Sun,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { ApiError, apiFetch, buildAuthHeaders, setAuthToken } from '@/lib/api';
import CreateServerModal from './create-server-modal';
import { WorkspaceBootSkeleton } from './skeletons';
import { connectSseStream } from '@/lib/sse';
import { saveThemeMode, useThemeMode } from '@/lib/theme';
import { showInfoToast } from '@/lib/alerts';
import type {
  HostInfo,
  PublicUser,
  ServerRuntimeMetrics,
  ServerWithMetrics,
} from '@/lib/types';

export type ServerTab = 'console' | 'files' | 'settings';

interface PanelContextValue {
  user: PublicUser;
  servers: ServerWithMetrics[];
  hostInfo: HostInfo | null;
  loadingData: boolean;
  lastHostSnapshotAt: number;
  filesVersionByServer: Record<string, number>;
  deletedServerIds: string[];
  loadWorkspaceData: () => Promise<void>;
  refreshHostInfo: () => Promise<void>;
  openCreateModal: () => void;
  handleMetricsUpdate: (serverId: string, metrics: ServerRuntimeMetrics) => void;
  handleServerUpdated: (updated: ServerWithMetrics) => void;
  handleServerDeleted: (serverId: string) => void;
  upsertServer: (server: ServerWithMetrics) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error('usePanel harus digunakan di dalam PanelShell');
  }
  return ctx;
}

export default function PanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const themeMode = useThemeMode();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [servers, setServers] = useState<ServerWithMetrics[]>([]);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [lastHostSnapshotAt, setLastHostSnapshotAt] = useState(0);
  const [filesVersionByServer, setFilesVersionByServer] = useState<Record<string, number>>({});
  const [deletedServerIds, setDeletedServerIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const lastStreamAtRef = useRef<number>(0);

  const serverMatch = pathname.match(/^\/server\/([^/]+?)(?:\/(files|settings))?\/?$/);
  const activeServerId = serverMatch ? decodeURIComponent(serverMatch[1]) : null;
  const activeServerTab: ServerTab =
    serverMatch?.[2] === 'files'
      ? 'files'
      : serverMatch?.[2] === 'settings'
      ? 'settings'
      : 'console';
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isHostRoute = pathname === '/host' || pathname.startsWith('/host/');
  const activeAdminSection: 'users' | 'servers' | null =
    pathname.startsWith('/admin/server')
      ? 'servers'
      : isAdminRoute
      ? 'users'
      : null;

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [meRes, srvRes, hostRes] = await Promise.all([
        apiFetch<{ user: PublicUser | null }>('/api/auth/me'),
        apiFetch<{ servers: ServerWithMetrics[] }>('/api/servers'),
        apiFetch<{ host: HostInfo }>('/api/host'),
      ]);
      if (!meRes.user) {
        setAuthToken(null);
        setUser(null);
        setServers([]);
        const currentPath =
          typeof window !== 'undefined' ? window.location.pathname : '/';
        const nextQuery =
          currentPath && currentPath !== '/'
            ? `?next=${encodeURIComponent(currentPath)}`
            : '';
        router.replace(`/login${nextQuery}`);
        return;
      }
      const nextUser = meRes.user;
      setUser((prev) =>
        prev &&
        prev.id === nextUser.id &&
        prev.role === nextUser.role &&
        prev.name === nextUser.name &&
        prev.email === nextUser.email
          ? prev
          : nextUser
      );
      setServers(srvRes.servers);
      setHostInfo(hostRes.host);
      setLastHostSnapshotAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        setUser(null);
        setServers([]);
        const currentPath =
          typeof window !== 'undefined' ? window.location.pathname : '/';
        const nextQuery =
          currentPath && currentPath !== '/'
            ? `?next=${encodeURIComponent(currentPath)}`
            : '';
        router.replace(`/login${nextQuery}`);
      }
    } finally {
      setLoadingData(false);
    }
  }, [router]);

  useEffect(() => {
    let mounted = true;
    async function checkSession() {
      try {
        const res = await apiFetch<{ user: PublicUser | null }>('/api/auth/me');
        if (!mounted) return;
        if (res.user) {
          setUser(res.user);
          setLoadingData(true);
        } else {
          const currentPath =
            typeof window !== 'undefined' ? window.location.pathname : '/';
          const nextQuery =
            currentPath && currentPath !== '/'
              ? `?next=${encodeURIComponent(currentPath)}`
              : '';
          router.replace(`/login${nextQuery}`);
        }
      } catch {
        if (mounted) {
          const currentPath =
            typeof window !== 'undefined' ? window.location.pathname : '/';
          const nextQuery =
            currentPath && currentPath !== '/'
              ? `?next=${encodeURIComponent(currentPath)}`
              : '';
          router.replace(`/login${nextQuery}`);
        }
      } finally {
        if (mounted) setCheckingAuth(false);
      }
    }
    void checkSession();
    return () => {
      mounted = false;
    };
  }, [router]);

  const userId = user?.id ?? null;

  const refreshHostInfo = useCallback(async () => {
    try {
      const res = await apiFetch<{ host: HostInfo }>('/api/host');
      if (res.host) {
        setHostInfo(res.host);
        setLastHostSnapshotAt(Date.now());
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    if (lastHostSnapshotAt > 0) {
      lastStreamAtRef.current = lastHostSnapshotAt;
    }
  }, [lastHostSnapshotAt]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    lastStreamAtRef.current = Date.now();

    void Promise.resolve().then(() => {
      if (active) {
        void loadWorkspaceData();
      }
    });

    const handleUnauthorized = () => {
      setAuthToken(null);
      setUser(null);
      setServers([]);
      const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      const nextQuery =
        currentPath && currentPath !== '/'
          ? `?next=${encodeURIComponent(currentPath)}`
          : '';
      router.replace(`/login${nextQuery}`);
    };

    const disconnect = connectSseStream({
      url: '/api/stream',
      getHeaders: buildAuthHeaders,
      onActivity: () => {
        if (active) {
          lastStreamAtRef.current = Date.now();
        }
      },
      onEvent: (eventName, payload) => {
        if (!active) return;
        const now = Date.now();
        lastStreamAtRef.current = now;
        if (eventName === 'auth-error') {
          handleUnauthorized();
          return;
        }
        if (eventName === 'files-changed' && payload && typeof payload === 'object') {
          const serverId = (payload as { serverId?: string }).serverId;
          if (serverId) {
            setFilesVersionByServer((prev) => ({
              ...prev,
              [serverId]: (prev[serverId] || 0) + 1,
            }));
          }
          return;
        }
        if (eventName === 'snapshot' && payload && typeof payload === 'object') {
          const data = payload as {
            user?: PublicUser;
            servers?: ServerWithMetrics[];
            host?: HostInfo;
          };
          if (data.user) {
            const nextUser = data.user;
            setUser((prev) =>
              prev &&
              prev.id === nextUser.id &&
              prev.role === nextUser.role &&
              prev.name === nextUser.name &&
              prev.email === nextUser.email
                ? prev
                : nextUser
            );
          }
          if (Array.isArray(data.servers)) {
            setServers(data.servers);
          }
          if (data.host) {
            setHostInfo(data.host);
            setLastHostSnapshotAt(now);
          }
          setLoadingData(false);
        }
      },
      onHttpError: (status) => {
        if (!active) return;
        if (status === 401) {
          handleUnauthorized();
        }
        setLoadingData(false);
      },
    });

    const fallbackTimer = setInterval(() => {
      if (!active) return;
      if (Date.now() - lastStreamAtRef.current < 2500) return;
      void loadWorkspaceData();
    }, 2000);

    return () => {
      active = false;
      clearInterval(fallbackTimer);
      disconnect();
    };
  }, [userId, router, loadWorkspaceData]);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
    }
    setAuthToken(null);
    setUser(null);
    setServers([]);
    void showInfoToast('Berhasil keluar');
    router.replace('/login');
  }, [router]);

  const handleMetricsUpdate = useCallback(
    (serverId: string, metrics: ServerRuntimeMetrics) => {
      setServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, metrics } : s))
      );
    },
    []
  );

  const handleServerUpdated = useCallback(
    (updated: ServerWithMetrics) => {
      setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      void loadWorkspaceData();
    },
    [loadWorkspaceData]
  );

  const handleServerDeleted = useCallback(
    (serverId: string) => {
      setDeletedServerIds((prev) => (prev.includes(serverId) ? prev : [...prev, serverId]));
      setServers((prev) => prev.filter((s) => s.id !== serverId));
      void loadWorkspaceData();
      if (activeServerId === serverId) {
        router.replace('/');
      }
    },
    [activeServerId, loadWorkspaceData, router]
  );

  const upsertServer = useCallback((server: ServerWithMetrics) => {
    setServers((prev) => {
      const idx = prev.findIndex((s) => s.id === server.id);
      if (idx === -1) return [server, ...prev];
      const next = [...prev];
      next[idx] = server;
      return next;
    });
  }, []);

  const openCreateModal = useCallback(() => {
    setCreateOpen(true);
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  const activeServer = useMemo(
    () => (activeServerId ? servers.find((s) => s.id === activeServerId) || null : null),
    [servers, activeServerId]
  );

  const contextValue = useMemo<PanelContextValue | null>(
    () =>
      user
        ? {
            user,
            servers,
            hostInfo,
            loadingData,
            lastHostSnapshotAt,
            filesVersionByServer,
            deletedServerIds,
            loadWorkspaceData,
            refreshHostInfo,
            openCreateModal,
            handleMetricsUpdate,
            handleServerUpdated,
            handleServerDeleted,
            upsertServer,
          }
        : null,
    [
      user,
      servers,
      hostInfo,
      loadingData,
      lastHostSnapshotAt,
      filesVersionByServer,
      deletedServerIds,
      loadWorkspaceData,
      refreshHostInfo,
      openCreateModal,
      handleMetricsUpdate,
      handleServerUpdated,
      handleServerDeleted,
      upsertServer,
    ]
  );

  if (checkingAuth || !user || !contextValue) {
    return (
      <WorkspaceBootSkeleton
        routeKind={
          activeServerId
            ? 'server'
            : isAdminRoute
            ? 'admin'
            : isHostRoute
            ? 'host'
            : 'dashboard'
        }
        serverTab={activeServerTab}
        adminSection={activeAdminSection ?? 'users'}
      />
    );
  }

  const encodedServerId = activeServerId ? encodeURIComponent(activeServerId) : '';
  const serverTabs: {
    id: ServerTab;
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = activeServerId
    ? [
        { id: 'console', href: `/server/${encodedServerId}`, label: 'Console', icon: Terminal },
        {
          id: 'files',
          href: `/server/${encodedServerId}/files`,
          label: 'File Manager',
          icon: FolderOpen,
        },
        {
          id: 'settings',
          href: `/server/${encodedServerId}/settings`,
          label: 'Pengaturan',
          icon: Settings,
        },
      ]
    : [];

  const activeTabLabel =
    serverTabs.find((t) => t.id === activeServerTab)?.label || 'Console';

  return (
    <PanelContext.Provider value={contextValue}>
      <div className="min-h-screen bg-white dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100 flex overflow-x-clip">
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 w-60 shrink-0 lg:h-screen bg-zinc-50 dark:bg-[#0C0C0E] border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-150 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <div className="h-14 px-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <Link
              href="/"
              onClick={() => setMobileNavOpen(false)}
              className="text-sm font-bold tracking-tight uppercase cursor-pointer"
            >
              cmnty
            </Link>

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
              <Link
                href="/"
                onClick={() => setMobileNavOpen(false)}
                className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  !activeServerId && !isAdminRoute && !isHostRoute
                    ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Server className="w-4 h-4 shrink-0" />
                <span>Daftar Server</span>
              </Link>

              <Link
                href="/host"
                onClick={() => setMobileNavOpen(false)}
                className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  !activeServerId && isHostRoute
                    ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Cpu className="w-4 h-4 shrink-0" />
                <span>Resource Host</span>
              </Link>

              {user.role === 'admin' && (
                <>

                  <Link
                    href="/admin/user"
                    onClick={() => setMobileNavOpen(false)}
                    className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors ${
                      !activeServerId && activeAdminSection === 'users'
                        ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Users className="w-4 h-4 shrink-0" />
                    <span>Kelola User</span>
                  </Link>
                  <Link
                    href="/admin/server"
                    onClick={() => setMobileNavOpen(false)}
                    className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors ${
                      !activeServerId && activeAdminSection === 'servers'
                        ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Server className="w-4 h-4 shrink-0" />
                    <span>Kelola Server</span>
                  </Link>
                </>
              )}
            </div>

            {activeServerId && (
              <div className="space-y-1 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase truncate">
                  Server: {activeServer ? activeServer.name : activeServerId}
                </div>
                {serverTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeServerTab === tab.id;
                  return (
                    <Link
                      key={tab.id}
                      href={tab.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={`w-full h-9 px-3 rounded text-xs font-medium flex items-center gap-2.5 transition-colors ${
                        isActive
                          ? 'bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-100'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{tab.label}</span>
                    </Link>
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
                <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                  <span className="truncate">{user.name}</span>
                  {user.role === 'admin' && (
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                      admin
                    </span>
                  )}
                </div>
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

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Buka menu"
                className="lg:hidden w-8 h-8 rounded bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Menu className="w-4 h-4" />
              </button>

              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 sm:gap-2 text-xs min-w-0">
                <Link
                  href="/"
                  className={`text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0 ${
                    activeServerId || (isAdminRoute && user.role === 'admin') ? 'hidden sm:inline' : ''
                  }`}
                >
                  Panel
                </Link>
                <span
                  className={`text-zinc-400 shrink-0 ${
                    activeServerId || (isAdminRoute && user.role === 'admin') ? 'hidden sm:inline' : ''
                  }`}
                >
                  /
                </span>
                {activeServerId ? (
                  <>
                    <Link
                      href={`/server/${encodedServerId}`}
                      className="font-semibold text-zinc-900 dark:text-zinc-100 hover:underline truncate max-w-[130px] sm:max-w-xs"
                    >
                      {activeServer ? activeServer.name : activeServerId}
                    </Link>
                    <span className="text-zinc-400 shrink-0">/</span>
                    <span className="text-zinc-600 dark:text-zinc-400 whitespace-nowrap shrink-0">
                      {activeTabLabel}
                    </span>
                  </>
                ) : isAdminRoute && user.role === 'admin' ? (
                  <>
                    <Link
                      href="/admin/user"
                      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      Manajemen
                    </Link>
                    <span className="text-zinc-400 shrink-0">/</span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap truncate">
                      {activeAdminSection === 'servers' ? 'Server' : 'User'}
                    </span>
                  </>
                ) : isHostRoute ? (
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap truncate">
                    Resource Host
                  </span>
                ) : (
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap truncate">
                    Daftar Server
                  </span>
                )}
              </nav>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {activeServerId ? (
                <Link
                  href="/"
                  className="h-8 px-2.5 sm:px-3 rounded bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-100 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Semua Server</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="h-8 px-2.5 sm:px-3.5 rounded bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-100 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Server</span>
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 min-w-0 p-4 sm:p-6 max-w-6xl w-full mx-auto">
            {children}
          </main>
        </div>

        <CreateServerModal
          open={createOpen}
          hostInfo={hostInfo}
          isAdmin={user.role === 'admin'}
          currentUserId={user.id}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            upsertServer(created);
            void loadWorkspaceData();
            router.push(`/server/${encodeURIComponent(created.id)}`);
          }}
        />
      </div>
    </PanelContext.Provider>
  );
}
