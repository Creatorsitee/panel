'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightLeft,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Server,
  Shield,
  Skull,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, buildAuthHeaders } from '@/lib/api';
import CreateServerModal from './create-server-modal';
import { AdminTableSkeleton, ShimmerBlock } from './skeletons';
import { connectSseStream } from '@/lib/sse';
import {
  computeAdminOverview,
  filterAdminServers,
  filterAdminUsers,
  getAdminUserDeleteBlockReason,
  isBusyServerStatus,
  type AdminStatusFilter,
} from '@/lib/admin';
import {
  showConfirmDialog,
  showErrorAlert,
  showErrorToast,
  showInfoToast,
  showSuccessToast,
} from '@/lib/alerts';
import type {
  AdminServerSummary,
  AdminUserSummary,
  HostInfo,
  PublicUser,
  UserRole,
} from '@/lib/types';

interface AdminPanelTabProps {
  section: 'users' | 'servers';
  currentUser: PublicUser;
  onOpenServer: (serverId: string) => void;
  onWorkspaceRefresh: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function AdminPanelTab({
  section,
  currentUser,
  onOpenServer,
  onWorkspaceRefresh,
}: AdminPanelTabProps) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [servers, setServers] = useState<AdminServerSummary[]>([]);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  const [serverSearch, setServerSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdminStatusFilter>('all');

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [savingUser, setSavingUser] = useState(false);

  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editPassword, setEditPassword] = useState('');

  const [createServerOpen, setCreateServerOpen] = useState(false);

  const [transferServer, setTransferServer] = useState<AdminServerSummary | null>(null);
  const [transferOwnerId, setTransferOwnerId] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const hasSnapshotRef = useRef(false);
  const onWorkspaceRefreshRef = useRef(onWorkspaceRefresh);

  useEffect(() => {
    onWorkspaceRefreshRef.current = onWorkspaceRefresh;
  }, [onWorkspaceRefresh]);

  useEffect(() => {
    let active = true;

    const disconnect = connectSseStream({
      url: '/api/stream?scope=admin',
      getHeaders: buildAuthHeaders,
      onEvent: (eventName, payload) => {
        if (!active) return;
        if (eventName === 'auth-error') {
          setLoading(false);
          onWorkspaceRefreshRef.current();
          return;
        }
        if (eventName === 'snapshot' && payload && typeof payload === 'object') {
          const data = payload as {
            users?: AdminUserSummary[];
            servers?: AdminServerSummary[];
            host?: HostInfo;
          };
          if (Array.isArray(data.users)) {
            setUsers(data.users);
          }
          if (Array.isArray(data.servers)) {
            setServers(data.servers);
          }
          if (data.host) {
            setHostInfo(data.host);
          }
          hasSnapshotRef.current = true;
          setLoading(false);
        }
      },
      onHttpError: (status) => {
        if (!active) return;
        setLoading(false);
        if (status === 401 || status === 403) {
          onWorkspaceRefreshRef.current();
        } else if (!hasSnapshotRef.current) {
          void showErrorToast(
            'Gagal Memuat Data Admin',
            'Terjadi kesalahan saat menghubungkan stream data admin.'
          );
        }
      },
    });

    return () => {
      active = false;
      disconnect();
    };
  }, []);

  useEffect(() => {
    const hasOpenModal = createUserOpen || Boolean(editingUser) || Boolean(transferServer);
    if (!hasOpenModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (createUserOpen && !savingUser) setCreateUserOpen(false);
      if (editingUser && !savingUser) setEditingUser(null);
      if (transferServer && !transferring) setTransferServer(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createUserOpen, editingUser, transferServer, savingUser, transferring]);

  const filteredUsers = useMemo(
    () => filterAdminUsers(users, { search: userSearch, roleFilter }),
    [users, roleFilter, userSearch]
  );

  const filteredServers = useMemo(
    () => filterAdminServers(servers, { search: serverSearch, statusFilter }),
    [servers, statusFilter, serverSearch]
  );

  const stats = useMemo(
    () => computeAdminOverview(users, servers),
    [users, servers]
  );

  function openCreateUserModal() {
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setNewRole('user');
    setCreateUserOpen(true);
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    try {
      const res = await apiFetch<{ user: AdminUserSummary }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
          role: newRole,
        }),
      });
      setUsers((prev) =>
        prev.some((u) => u.id === res.user.id)
          ? prev.map((u) => (u.id === res.user.id ? res.user : u))
          : [...prev, res.user]
      );
      setCreateUserOpen(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      void showSuccessToast('User ditambahkan', res.user.email);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menambah User',
        err instanceof Error ? err.message : 'Gagal membuat akun user.'
      );
    } finally {
      setSavingUser(false);
    }
  }

  function openEditUser(user: AdminUserSummary) {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditPassword('');
  }

  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setSavingUser(true);
    try {
      const res = await apiFetch<{ user: AdminUserSummary }>(
        `/api/admin/users/${editingUser.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editName,
            email: editEmail,
            role: editRole,
            ...(editPassword.trim() ? { password: editPassword } : {}),
          }),
        }
      );
      setUsers((prev) => prev.map((u) => (u.id === res.user.id ? res.user : u)));
      const editedSelf = editingUser.id === currentUser.id;
      setEditingUser(null);
      void showSuccessToast('User diperbarui', res.user.email);
      if (editedSelf) {
        onWorkspaceRefresh();
      }
    } catch (err) {
      await showErrorAlert(
        'Gagal Memperbarui User',
        err instanceof Error ? err.message : 'Gagal menyimpan perubahan user.'
      );
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser(user: AdminUserSummary) {
    const blockReason = getAdminUserDeleteBlockReason(
      user,
      currentUser.id,
      stats.adminCount
    );
    if (blockReason) {
      await showErrorAlert('Tidak Dapat Menghapus User', blockReason);
      return;
    }

    const confirmed = await showConfirmDialog({
      title: `Hapus user "${user.name}"?`,
      text:
        user.serverCount > 0
          ? `Akun "${user.email}" memiliki ${user.serverCount} server. Seluruh server milik user ini akan dihentikan dan dihapus permanen.`
          : `Akun "${user.email}" akan dihapus secara permanen.`,
      confirmText: 'Ya, Hapus User',
      cancelText: 'Batal',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      void showSuccessToast('User dihapus', user.email);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus User',
        err instanceof Error ? err.message : 'Gagal menghapus user.'
      );
    }
  }

  async function handlePowerAction(
    serverId: string,
    action: 'start' | 'restart' | 'stop' | 'kill'
  ) {
    setBusyServerId(serverId);
    try {
      await apiFetch(`/api/servers/${serverId}/power`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const toastText =
        action === 'start'
          ? 'Server dijalankan'
          : action === 'restart'
          ? 'Server di-restart'
          : action === 'stop'
          ? 'Server dihentikan'
          : 'Proses dihentikan paksa';
      if (action === 'start' || action === 'restart') {
        void showSuccessToast(toastText);
      } else {
        void showInfoToast(toastText);
      }
    } catch (err) {
      void showErrorToast(
        'Gagal Menjalankan Aksi',
        err instanceof Error ? err.message : 'Terjadi kesalahan pada proses server.'
      );
    } finally {
      setBusyServerId(null);
    }
  }

  async function handleDeleteServer(srv: AdminServerSummary) {
    const confirmed = await showConfirmDialog({
      title: `Hapus server "${srv.name}"?`,
      text: `Server milik ${srv.ownerName} (${srv.ownerEmail}) akan dihentikan dan seluruh filenya dihapus permanen.`,
      confirmText: 'Ya, Hapus Server',
      cancelText: 'Batal',
      destructive: true,
    });
    if (!confirmed) return;

    setBusyServerId(srv.id);
    try {
      await apiFetch(`/api/servers/${srv.id}`, { method: 'DELETE' });
      setServers((prev) => prev.filter((item) => item.id !== srv.id));
      void showSuccessToast('Server dihapus', srv.name);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus Server',
        err instanceof Error ? err.message : 'Gagal menghapus server.'
      );
    } finally {
      setBusyServerId(null);
    }
  }

  async function handleTransferServer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferServer || !transferOwnerId || transferOwnerId === transferServer.ownerId) {
      return;
    }
    setTransferring(true);
    try {
      await apiFetch(`/api/servers/${transferServer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ownerId: transferOwnerId }),
      });
      setTransferServer(null);
      void showSuccessToast('Kepemilikan dipindahkan');
    } catch (err) {
      await showErrorAlert(
        'Gagal Memindahkan Server',
        err instanceof Error ? err.message : 'Gagal memindahkan kepemilikan server.'
      );
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {section === 'users' ? 'Kelola User' : 'Kelola Server'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div
            className="flex-1 sm:flex-initial flex items-center gap-1 p-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
            role="tablist"
            aria-label="Bagian Manajemen"
          >
            <Link
              href="/admin/user"
              role="tab"
              aria-selected={section === 'users'}
              className={`flex-1 sm:flex-initial justify-center h-8 px-2.5 sm:px-3 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                section === 'users'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>User ({stats.totalUsers})</span>
            </Link>
            <Link
              href="/admin/server"
              role="tab"
              aria-selected={section === 'servers'}
              className={`flex-1 sm:flex-initial justify-center h-8 px-2.5 sm:px-3 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                section === 'servers'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Server className="w-3.5 h-3.5 shrink-0" />
              <span>Server ({stats.totalServers})</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Total Akun</div>
          {loading ? (
            <div className="space-y-1.5 mt-1.5">
              <ShimmerBlock className="h-6 w-12" />
              <ShimmerBlock className="h-3 w-28" />
            </div>
          ) : (
            <>
              <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
                {stats.totalUsers}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {stats.adminCount} Admin · {stats.regularUserCount} User
              </div>
            </>
          )}
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Total Server</div>
          {loading ? (
            <div className="space-y-1.5 mt-1.5">
              <ShimmerBlock className="h-6 w-12" />
              <ShimmerBlock className="h-3 w-24" />
            </div>
          ) : (
            <>
              <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
                {stats.totalServers}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {stats.runningCount} Berjalan
                {stats.errorCount > 0 ? ` · ${stats.errorCount} Error` : ''}
              </div>
            </>
          )}
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Alokasi Memori Aktif</div>
          {loading && !hostInfo ? (
            <div className="space-y-1.5 mt-1.5">
              <ShimmerBlock className="h-6 w-20" />
              <ShimmerBlock className="h-3 w-28" />
            </div>
          ) : (
            <>
              <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
                {hostInfo ? `${hostInfo.allocatedMemoryMb} MB` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {hostInfo ? `Tersedia ${hostInfo.availableMemoryMb} MB` : '—'}
              </div>
            </>
          )}
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Alokasi CPU Aktif</div>
          {loading && !hostInfo ? (
            <div className="space-y-1.5 mt-1.5">
              <ShimmerBlock className="h-6 w-16" />
              <ShimmerBlock className="h-3 w-24" />
            </div>
          ) : (
            <>
              <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
                {hostInfo ? `${hostInfo.allocatedCpuPercent}%` : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {hostInfo ? `Tersedia ${hostInfo.availableCpuPercent}%` : '—'}
              </div>
            </>
          )}
        </div>
      </div>

      {section === 'users' ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 min-w-0">
              <div className="relative w-full sm:flex-1 sm:min-w-[200px] sm:max-w-sm">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Cari user"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Cari nama atau email user..."
                  className="w-full h-9 pl-8 pr-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="w-full sm:w-auto flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded">
                {(['all', 'admin', 'user'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoleFilter(r)}
                    className={`flex-1 sm:flex-initial h-7 px-2.5 text-xs font-medium rounded transition-colors cursor-pointer text-center ${
                      roleFilter === r
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {r === 'all' ? 'Semua' : r === 'admin' ? 'Admin' : 'User'}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={openCreateUserModal}
              className="w-full sm:w-auto h-9 px-3.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Tambah User</span>
            </button>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0C0C0E]">
            {loading ? (
              <AdminTableSkeleton section="users" />
            ) : filteredUsers.length === 0 ? (
              <div className="p-10 text-center text-xs text-zinc-500">
                Tidak ada user yang cocok dengan filter.
              </div>
            ) : (
              <>
                <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    const deleteBlockReason = getAdminUserDeleteBlockReason(
                      u,
                      currentUser.id,
                      stats.adminCount
                    );
                    return (
                      <div key={u.id} className="p-3.5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{u.name}</span>
                              {isSelf && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                                  Anda
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                              {u.email}
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase border shrink-0 ${
                              u.role === 'admin'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30'
                            }`}
                          >
                            {u.role}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/70 text-[11px] text-zinc-500">
                          <div className="font-mono">
                            {u.serverCount} server · {formatDate(u.createdAt)}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              aria-label={`Edit ${u.name}`}
                              className="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(deleteBlockReason)}
                              onClick={() => handleDeleteUser(u)}
                              title={deleteBlockReason || 'Hapus user beserta server miliknya'}
                              aria-label={`Hapus ${u.name}`}
                              className="h-7 px-2.5 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-35 disabled:cursor-not-allowed text-xs inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Hapus</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-[11px] uppercase tracking-wider text-zinc-500">
                        <th className="py-2.5 px-4 font-semibold">User</th>
                        <th className="py-2.5 px-4 font-semibold">Role</th>
                        <th className="py-2.5 px-4 font-semibold">Server</th>
                        <th className="py-2.5 px-4 font-semibold">Terdaftar</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                      {filteredUsers.map((u) => {
                        const isSelf = u.id === currentUser.id;
                        const deleteBlockReason = getAdminUserDeleteBlockReason(
                          u,
                          currentUser.id,
                          stats.adminCount
                        );
                        return (
                          <tr
                            key={u.id}
                            className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                                <span>{u.name}</span>
                                {isSelf && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                                    Anda
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-zinc-500">{u.email}</div>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase border ${
                                  u.role === 'admin'
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                    : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30'
                                }`}
                              >
                                {u.role}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-700 dark:text-zinc-300">
                              {u.serverCount}
                            </td>
                            <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                              {formatDate(u.createdAt)}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditUser(u)}
                                  title="Edit user"
                                  aria-label={`Edit ${u.name}`}
                                  className="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Pencil className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(deleteBlockReason)}
                                  onClick={() => handleDeleteUser(u)}
                                  title={deleteBlockReason || 'Hapus user beserta server miliknya'}
                                  aria-label={`Hapus ${u.name}`}
                                  className="h-7 px-2.5 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-35 disabled:cursor-not-allowed inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Hapus</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 min-w-0">
              <div className="relative w-full sm:flex-1 sm:max-w-sm">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Cari semua server"
                  value={serverSearch}
                  onChange={(e) => setServerSearch(e.target.value)}
                  placeholder="Cari server, pemilik, atau port..."
                  className="w-full h-9 pl-8 pr-3 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="w-full sm:w-auto flex flex-wrap items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded">
                {(
                  [
                    { id: 'all', label: 'Semua' },
                    { id: 'running', label: 'Running' },
                    { id: 'busy', label: 'Starting' },
                    { id: 'stopped', label: 'Stopped' },
                    { id: 'error', label: 'Error' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`flex-1 sm:flex-initial h-7 px-2.5 text-xs font-medium rounded transition-colors cursor-pointer text-center whitespace-nowrap ${
                      statusFilter === st.id
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCreateServerOpen(true)}
              className="w-full lg:w-auto h-9 px-3.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Buat Server</span>
            </button>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0C0C0E]">
            {loading ? (
              <AdminTableSkeleton section="servers" />
            ) : filteredServers.length === 0 ? (
              <div className="p-10 text-center text-xs text-zinc-500">
                Tidak ada server yang ditemukan.
              </div>
            ) : (
              <>
                <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {filteredServers.map((srv) => {
                    const isRunning = srv.metrics.status === 'running';
                    const isBusy = isBusyServerStatus(srv.metrics.status);
                    const rowBusy = busyServerId === srv.id;
                    const serverHref = `/server/${encodeURIComponent(srv.id)}`;

                    return (
                      <div key={srv.id} className="p-3.5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              href={serverHref}
                              onClick={() => onOpenServer(srv.id)}
                              className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 hover:underline text-left cursor-pointer truncate block max-w-full"
                            >
                              {srv.name}
                            </Link>
                            <div className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                              {srv.runtime} · :{srv.port} · {srv.startupCommand}
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase border shrink-0 ${
                              isRunning
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                : srv.metrics.status === 'error'
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                                : isBusy
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30'
                            }`}
                          >
                            {srv.metrics.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/80 dark:border-zinc-800/80 rounded p-2">
                          <div className="min-w-0">
                            <div className="text-zinc-500">Pemilik</div>
                            <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                              {srv.ownerName}
                            </div>
                            <div className="font-mono text-zinc-500 truncate">{srv.ownerEmail}</div>
                          </div>
                          <div className="min-w-0 font-mono text-zinc-600 dark:text-zinc-400">
                            <div className="font-sans text-zinc-500">Resource</div>
                            <div className="truncate">
                              {srv.metrics.memoryMb.toFixed(0)} / {srv.memoryLimitMb} MB
                            </div>
                            <div className="truncate">
                              CPU {srv.metrics.cpuPercent.toFixed(1)}% / {srv.cpuLimitPercent}%
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {!isRunning && !isBusy ? (
                            <button
                              type="button"
                              disabled={rowBusy}
                              onClick={() => handlePowerAction(srv.id, 'start')}
                              title="Start server"
                              aria-label={`Start ${srv.name}`}
                              className="h-7 px-2.5 rounded border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 text-xs inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Play className="w-3 h-3" />
                              <span>Start</span>
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={rowBusy || isBusy}
                                onClick={() => handlePowerAction(srv.id, 'restart')}
                                title="Restart server"
                                aria-label={`Restart ${srv.name}`}
                                className="w-7 h-7 rounded border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                              >
                                <RotateCw className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={rowBusy || srv.metrics.status === 'stopping'}
                                onClick={() => handlePowerAction(srv.id, 'stop')}
                                title="Stop server"
                                aria-label={`Stop ${srv.name}`}
                                className="h-7 px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-xs inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Square className="w-3 h-3" />
                                <span>Stop</span>
                              </button>
                              <button
                                type="button"
                                disabled={rowBusy}
                                onClick={() => handlePowerAction(srv.id, 'kill')}
                                title="Kill paksa"
                                aria-label={`Kill ${srv.name}`}
                                className="w-7 h-7 rounded border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                              >
                                <Skull className="w-3 h-3" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => {
                              setTransferServer(srv);
                              setTransferOwnerId(srv.ownerId);
                            }}
                            title="Pindah pemilik"
                            aria-label={`Pindah pemilik ${srv.name}`}
                            className="w-7 h-7 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3 h-3" />
                          </button>
                          <Link
                            href={serverHref}
                            onClick={() => onOpenServer(srv.id)}
                            className="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-medium inline-flex items-center"
                          >
                            Kelola
                          </Link>
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => handleDeleteServer(srv)}
                            title="Hapus server"
                            aria-label={`Hapus ${srv.name}`}
                            className="w-7 h-7 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-[11px] uppercase tracking-wider text-zinc-500">
                        <th className="py-2.5 px-4 font-semibold">Server</th>
                        <th className="py-2.5 px-4 font-semibold">Pemilik</th>
                        <th className="py-2.5 px-4 font-semibold">Resource</th>
                        <th className="py-2.5 px-4 font-semibold">Status</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                      {filteredServers.map((srv) => {
                        const isRunning = srv.metrics.status === 'running';
                        const isBusy = isBusyServerStatus(srv.metrics.status);
                        const rowBusy = busyServerId === srv.id;
                        const serverHref = `/server/${encodeURIComponent(srv.id)}`;

                        return (
                          <tr
                            key={srv.id}
                            className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <Link
                                href={serverHref}
                                onClick={() => onOpenServer(srv.id)}
                                className="font-semibold text-zinc-900 dark:text-zinc-100 hover:underline text-left cursor-pointer"
                              >
                                {srv.name}
                              </Link>
                              <div className="text-[11px] font-mono text-zinc-500 max-w-[240px] lg:max-w-sm truncate">
                                {srv.runtime} · :{srv.port} · {srv.startupCommand}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-zinc-800 dark:text-zinc-200">
                                {srv.ownerName}
                              </div>
                              <div className="text-[11px] font-mono text-zinc-500">
                                {srv.ownerEmail}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                              <div>
                                {srv.metrics.memoryMb.toFixed(0)} / {srv.memoryLimitMb} MB
                              </div>
                              <div>
                                CPU {srv.metrics.cpuPercent.toFixed(1)}% / {srv.cpuLimitPercent}%
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase border ${
                                  isRunning
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                    : srv.metrics.status === 'error'
                                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                                    : isBusy
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                    : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30'
                                }`}
                              >
                                {srv.metrics.status}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-end gap-1">
                                {!isRunning && !isBusy ? (
                                  <button
                                    type="button"
                                    disabled={rowBusy}
                                    onClick={() => handlePowerAction(srv.id, 'start')}
                                    title="Start server"
                                    aria-label={`Start ${srv.name}`}
                                    className="w-7 h-7 rounded border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                  >
                                    <Play className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={rowBusy || isBusy}
                                      onClick={() => handlePowerAction(srv.id, 'restart')}
                                      title="Restart server"
                                      aria-label={`Restart ${srv.name}`}
                                      className="w-7 h-7 rounded border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                    >
                                      <RotateCw className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={rowBusy || srv.metrics.status === 'stopping'}
                                      onClick={() => handlePowerAction(srv.id, 'stop')}
                                      title="Stop server"
                                      aria-label={`Stop ${srv.name}`}
                                      className="w-7 h-7 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                    >
                                      <Square className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={rowBusy}
                                      onClick={() => handlePowerAction(srv.id, 'kill')}
                                      title="Kill paksa"
                                      aria-label={`Kill ${srv.name}`}
                                      className="w-7 h-7 rounded border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                    >
                                      <Skull className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  disabled={rowBusy}
                                  onClick={() => {
                                    setTransferServer(srv);
                                    setTransferOwnerId(srv.ownerId);
                                  }}
                                  title="Pindah pemilik"
                                  aria-label={`Pindah pemilik ${srv.name}`}
                                  className="w-7 h-7 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                >
                                  <ArrowRightLeft className="w-3 h-3" />
                                </button>
                                <Link
                                  href={serverHref}
                                  onClick={() => onOpenServer(srv.id)}
                                  className="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-medium inline-flex items-center"
                                >
                                  Kelola
                                </Link>
                                <button
                                  type="button"
                                  disabled={rowBusy}
                                  onClick={() => handleDeleteServer(srv)}
                                  title="Hapus server"
                                  aria-label={`Hapus ${srv.name}`}
                                  className="w-7 h-7 rounded border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <CreateServerModal
        open={createServerOpen}
        hostInfo={hostInfo}
        isAdmin
        currentUserId={currentUser.id}
        users={users}
        onClose={() => setCreateServerOpen(false)}
        onCreated={() => {
          setCreateServerOpen(false);
        }}
      />

      {createUserOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-create-user-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingUser) setCreateUserOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
              <h2 id="admin-create-user-title" className="text-sm font-semibold truncate">
                Tambah User Baru
              </h2>
              <button
                type="button"
                disabled={savingUser}
                onClick={() => setCreateUserOpen(false)}
                aria-label="Tutup modal tambah user"
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label htmlFor="adm-new-name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nama Lengkap
                </label>
                <input
                  id="adm-new-name"
                  type="text"
                  required
                  minLength={2}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-new-email" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Email
                </label>
                <input
                  id="adm-new-email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-new-pass" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Password
                </label>
                <input
                  id="adm-new-pass"
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-new-role" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Role
                </label>
                <select
                  id="adm-new-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-zinc-500"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={savingUser}
                  onClick={() => setCreateUserOpen(false)}
                  className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="h-9 px-4 rounded-md bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingUser ? 'Menyimpan...' : 'Simpan User'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-edit-user-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingUser) setEditingUser(null);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
              <h2 id="admin-edit-user-title" className="text-sm font-semibold truncate">
                Edit User: {editingUser.name}
              </h2>
              <button
                type="button"
                disabled={savingUser}
                onClick={() => setEditingUser(null)}
                aria-label="Tutup modal edit user"
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label htmlFor="adm-edit-name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Nama Lengkap
                </label>
                <input
                  id="adm-edit-name"
                  type="text"
                  required
                  minLength={2}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-edit-email" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Email
                </label>
                <input
                  id="adm-edit-email"
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-edit-role" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Role
                </label>
                <select
                  id="adm-edit-role"
                  value={editRole}
                  disabled={editingUser.id === currentUser.id}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-edit-pass" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Reset Password (Opsional)
                </label>
                <input
                  id="adm-edit-pass"
                  type="password"
                  minLength={6}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Kosongkan jika tidak diubah"
                  className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={savingUser}
                  onClick={() => setEditingUser(null)}
                  className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="h-9 px-4 rounded-md bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-medium disabled:opacity-50 cursor-pointer"
                >
                  {savingUser ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {transferServer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-transfer-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !transferring) setTransferServer(null);
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 shrink-0">
              <h2 id="admin-transfer-title" className="text-sm font-semibold truncate">
                Pindahkan Pemilik: {transferServer.name}
              </h2>
              <button
                type="button"
                disabled={transferring}
                onClick={() => setTransferServer(null)}
                aria-label="Tutup modal pindah pemilik"
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleTransferServer} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div className="text-xs text-zinc-500">
                Pemilik saat ini:{' '}
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {transferServer.ownerName} ({transferServer.ownerEmail})
                </span>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-transfer-owner" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Pemilik Baru
                </label>
                <select
                  id="adm-transfer-owner"
                  value={transferOwnerId}
                  onChange={(e) => setTransferOwnerId(e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-zinc-500"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email}) — {u.role}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={transferring}
                  onClick={() => setTransferServer(null)}
                  className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={
                    transferring ||
                    !transferOwnerId ||
                    transferOwnerId === transferServer.ownerId
                  }
                  className="h-9 px-4 rounded-md bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-medium disabled:opacity-50 cursor-pointer"
                >
                  {transferring ? 'Memindahkan...' : 'Pindahkan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
