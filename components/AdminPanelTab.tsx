'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Pencil,
  Play,
  Plus,
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
import { apiFetch } from './api-client';
import { ShimmerBlock } from './Skeletons';
import {
  showConfirmDialog,
  showErrorAlert,
  showErrorToast,
  showInfoToast,
  showSuccessToast,
} from '@/lib/swal';
import type {
  AdminServerSummary,
  AdminUserSummary,
  HostVpsInfo,
  PublicUser,
  UserRole,
} from '@/lib/types';

interface AdminPanelTabProps {
  currentUser: PublicUser;
  onOpenServer: (serverId: string) => void;
  onWorkspaceRefresh: () => void;
}

type AdminSection = 'users' | 'servers';

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
  currentUser,
  onOpenServer,
  onWorkspaceRefresh,
}: AdminPanelTabProps) {
  const [section, setSection] = useState<AdminSection>('users');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [servers, setServers] = useState<AdminServerSummary[]>([]);
  const [hostInfo, setHostInfo] = useState<HostVpsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  const [serverSearch, setServerSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped' | 'error'>('all');

  // Create User Modal
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [savingUser, setSavingUser] = useState(false);

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<AdminUserSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editPassword, setEditPassword] = useState('');

  // Transfer Server Ownership Modal
  const [transferServer, setTransferServer] = useState<AdminServerSummary | null>(null);
  const [transferOwnerId, setTransferOwnerId] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Per-server busy state for quick actions
  const [busyServerId, setBusyServerId] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    try {
      const [usersRes, serversRes] = await Promise.all([
        apiFetch<{ users: AdminUserSummary[] }>('/api/admin/users'),
        apiFetch<{ servers: AdminServerSummary[]; host: HostVpsInfo }>('/api/admin/servers'),
      ]);
      setUsers(usersRes.users);
      setServers(serversRes.servers);
      setHostInfo(serversRes.host);
    } catch (err) {
      void showErrorToast(
        'Gagal Memuat Data Admin',
        err instanceof Error ? err.message : 'Terjadi kesalahan saat mengambil data admin.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const runFetch = async () => {
      if (!active) return;
      await loadAdminData();
    };
    void runFetch();
    const timer = setInterval(() => {
      void runFetch();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadAdminData]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (userSearch.trim()) {
        const q = userSearch.toLowerCase();
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, roleFilter, userSearch]);

  const filteredServers = useMemo(() => {
    return servers.filter((srv) => {
      if (statusFilter !== 'all' && srv.metrics.status !== statusFilter) return false;
      if (serverSearch.trim()) {
        const q = serverSearch.toLowerCase();
        return (
          srv.name.toLowerCase().includes(q) ||
          srv.ownerName.toLowerCase().includes(q) ||
          srv.ownerEmail.toLowerCase().includes(q) ||
          String(srv.port).includes(q)
        );
      }
      return true;
    });
  }, [servers, statusFilter, serverSearch]);

  const stats = useMemo(() => {
    const adminCount = users.filter((u) => u.role === 'admin').length;
    const runningCount = servers.filter((s) => s.metrics.status === 'running').length;
    return {
      totalUsers: users.length,
      adminCount,
      totalServers: servers.length,
      runningCount,
    };
  }, [users, servers]);

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
      setUsers((prev) => [...prev, res.user]);
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
      setEditingUser(null);
      void showSuccessToast('User diperbarui', res.user.email);
      void loadAdminData();
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
      void showSuccessToast('User dihapus', user.email);
      await loadAdminData();
      onWorkspaceRefresh();
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus User',
        err instanceof Error ? err.message : 'Gagal menghapus user.'
      );
    }
  }

  async function handlePowerAction(
    serverId: string,
    action: 'start' | 'stop' | 'kill'
  ) {
    setBusyServerId(serverId);
    try {
      await apiFetch(`/api/servers/${serverId}/power`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      void showInfoToast(
        action === 'start'
          ? 'Server dijalankan'
          : action === 'stop'
          ? 'Server dihentikan'
          : 'Proses dihentikan paksa'
      );
      await loadAdminData();
      onWorkspaceRefresh();
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
      void showSuccessToast('Server dihapus', srv.name);
      await loadAdminData();
      onWorkspaceRefresh();
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
    if (!transferServer || !transferOwnerId) return;
    setTransferring(true);
    try {
      await apiFetch(`/api/servers/${transferServer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ownerId: transferOwnerId }),
      });
      setTransferServer(null);
      void showSuccessToast('Kepemilikan dipindahkan');
      await loadAdminData();
      onWorkspaceRefresh();
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase text-zinc-500">
            <Shield className="w-3.5 h-3.5" />
            <span>Administrator</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight mt-0.5 text-zinc-900 dark:text-zinc-100">
            Panel Admin
          </h1>
        </div>

        <div
          className="w-full sm:w-auto flex items-center gap-1 p-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800"
          role="tablist"
          aria-label="Bagian Panel Admin"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === 'users'}
            onClick={() => setSection('users')}
            className={`flex-1 sm:flex-initial justify-center h-8 px-2.5 sm:px-3 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              section === 'users'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span>User ({stats.totalUsers})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'servers'}
            onClick={() => setSection('servers')}
            className={`flex-1 sm:flex-initial justify-center h-8 px-2.5 sm:px-3 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              section === 'servers'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Server className="w-3.5 h-3.5 shrink-0" />
            <span>Server ({stats.totalServers})</span>
          </button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Total Akun</div>
          <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
            {loading ? '—' : stats.totalUsers}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {stats.adminCount} Admin · {Math.max(0, stats.totalUsers - stats.adminCount)} User
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Total Server</div>
          <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
            {loading ? '—' : stats.totalServers}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {stats.runningCount} Berjalan
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Alokasi Memori Aktif</div>
          <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
            {hostInfo ? `${hostInfo.allocatedMemoryMb} MB` : '—'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {hostInfo ? `Tersedia ${hostInfo.availableMemoryMb} MB` : '—'}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">Alokasi CPU Aktif</div>
          <div className="text-lg font-bold font-mono mt-0.5 text-zinc-900 dark:text-zinc-100 truncate">
            {hostInfo ? `${hostInfo.allocatedCpuPercent}%` : '—'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {hostInfo ? `Tersedia ${hostInfo.availableCpuPercent}%` : '—'}
          </div>
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
              onClick={() => setCreateUserOpen(true)}
              className="w-full sm:w-auto h-9 px-3.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Tambah User</span>
            </button>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0C0C0E]">
            {loading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2].map((i) => (
                  <ShimmerBlock key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-10 text-center text-xs text-zinc-500">
                Tidak ada user yang cocok dengan filter.
              </div>
            ) : (
              <>
                {/* Mobile User Cards */}
                <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser.id;
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
                              disabled={isSelf}
                              onClick={() => handleDeleteUser(u)}
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

                {/* Desktop User Table */}
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
                                  disabled={isSelf}
                                  onClick={() => handleDeleteUser(u)}
                                  title={
                                    isSelf
                                      ? 'Tidak dapat menghapus akun sendiri'
                                      : 'Hapus user beserta server miliknya'
                                  }
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
              {(['all', 'running', 'stopped', 'error'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`flex-1 sm:flex-initial h-7 px-2.5 text-xs font-medium rounded transition-colors cursor-pointer text-center ${
                    statusFilter === st
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {st === 'all'
                    ? 'Semua'
                    : st === 'running'
                    ? 'Running'
                    : st === 'stopped'
                    ? 'Stopped'
                    : 'Error'}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0C0C0E]">
            {loading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2].map((i) => (
                  <ShimmerBlock key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredServers.length === 0 ? (
              <div className="p-10 text-center text-xs text-zinc-500">
                Tidak ada server yang ditemukan.
              </div>
            ) : (
              <>
                {/* Mobile Server Cards */}
                <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {filteredServers.map((srv) => {
                    const isRunning = srv.metrics.status === 'running';
                    const isBusy =
                      srv.metrics.status === 'installing' ||
                      srv.metrics.status === 'starting';
                    const rowBusy = busyServerId === srv.id;

                    return (
                      <div key={srv.id} className="p-3.5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenServer(srv.id)}
                              className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 hover:underline text-left cursor-pointer truncate block max-w-full"
                            >
                              {srv.name}
                            </button>
                            <div className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                              {srv.runtime} · :{srv.port} · {srv.startupCommand}
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium uppercase border shrink-0 ${
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
                                disabled={rowBusy}
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
                            onClick={() => {
                              setTransferServer(srv);
                              setTransferOwnerId(srv.ownerId);
                            }}
                            title="Pindah pemilik"
                            aria-label={`Pindah pemilik ${srv.name}`}
                            className="w-7 h-7 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenServer(srv.id)}
                            className="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-medium cursor-pointer"
                          >
                            Kelola
                          </button>
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

                {/* Desktop Server Table */}
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
                      const isBusy =
                        srv.metrics.status === 'installing' ||
                        srv.metrics.status === 'starting';
                      const rowBusy = busyServerId === srv.id;

                      return (
                        <tr
                          key={srv.id}
                          className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() => onOpenServer(srv.id)}
                              className="font-semibold text-zinc-900 dark:text-zinc-100 hover:underline text-left cursor-pointer"
                            >
                              {srv.name}
                            </button>
                            <div className="text-[11px] font-mono text-zinc-500">
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
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium uppercase border ${
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
                                    disabled={rowBusy}
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
                                onClick={() => {
                                  setTransferServer(srv);
                                  setTransferOwnerId(srv.ownerId);
                                }}
                                title="Pindah pemilik"
                                aria-label={`Pindah pemilik ${srv.name}`}
                                className="w-7 h-7 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer"
                              >
                                <ArrowRightLeft className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenServer(srv.id)}
                                className="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-medium cursor-pointer"
                              >
                                Kelola
                              </button>
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

      {/* Create User Modal */}
      {createUserOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-create-user-title"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <h2 id="admin-create-user-title" className="text-sm font-semibold truncate">
                Tambah User Baru
              </h2>
              <button
                type="button"
                onClick={() => setCreateUserOpen(false)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-4 sm:p-5 space-y-4">
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
                  onClick={() => setCreateUserOpen(false)}
                  className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer"
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

      {/* Edit User Modal */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-edit-user-title"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <h2 id="admin-edit-user-title" className="text-sm font-semibold truncate">
                Edit User: {editingUser.name}
              </h2>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="p-4 sm:p-5 space-y-4">
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
                  onClick={() => setEditingUser(null)}
                  className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer"
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

      {/* Transfer Ownership Modal */}
      {transferServer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-transfer-title"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <h2 id="admin-transfer-title" className="text-sm font-semibold truncate">
                Pindahkan Pemilik: {transferServer.name}
              </h2>
              <button
                type="button"
                onClick={() => setTransferServer(null)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleTransferServer} className="p-4 sm:p-5 space-y-4">
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
                  onClick={() => setTransferServer(null)}
                  className="h-9 px-3.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={transferring}
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
