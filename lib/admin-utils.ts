import type { AdminServerSummary, AdminUserSummary, ServerStatus, UserRole } from './types';

export type AdminStatusFilter = 'all' | 'running' | 'busy' | 'stopped' | 'error';

export function isBusyServerStatus(status: ServerStatus): boolean {
  return status === 'starting' || status === 'installing' || status === 'stopping';
}

export function filterAdminUsers(
  users: AdminUserSummary[],
  options: { search: string; roleFilter: 'all' | UserRole }
): AdminUserSummary[] {
  const query = options.search.trim().toLowerCase();
  return users.filter((u) => {
    if (options.roleFilter !== 'all' && u.role !== options.roleFilter) {
      return false;
    }
    if (query) {
      return (
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        u.id.toLowerCase().includes(query)
      );
    }
    return true;
  });
}

export function filterAdminServers(
  servers: AdminServerSummary[],
  options: { search: string; statusFilter: AdminStatusFilter }
): AdminServerSummary[] {
  const query = options.search.trim().toLowerCase();
  return servers.filter((srv) => {
    const status = srv.metrics.status;
    if (options.statusFilter === 'busy') {
      if (!isBusyServerStatus(status)) return false;
    } else if (options.statusFilter !== 'all' && status !== options.statusFilter) {
      return false;
    }

    if (query) {
      return (
        srv.name.toLowerCase().includes(query) ||
        srv.ownerName.toLowerCase().includes(query) ||
        srv.ownerEmail.toLowerCase().includes(query) ||
        srv.runtime.toLowerCase().includes(query) ||
        srv.id.toLowerCase().includes(query) ||
        String(srv.port).includes(query)
      );
    }
    return true;
  });
}

export function computeAdminOverview(
  users: AdminUserSummary[],
  servers: AdminServerSummary[]
): {
  totalUsers: number;
  adminCount: number;
  regularUserCount: number;
  totalServers: number;
  runningCount: number;
  busyCount: number;
  errorCount: number;
  stoppedCount: number;
} {
  let adminCount = 0;
  for (const u of users) {
    if (u.role === 'admin') adminCount += 1;
  }

  let runningCount = 0;
  let busyCount = 0;
  let errorCount = 0;
  let stoppedCount = 0;

  for (const srv of servers) {
    const status = srv.metrics.status;
    if (status === 'running') runningCount += 1;
    else if (isBusyServerStatus(status)) busyCount += 1;
    else if (status === 'error') errorCount += 1;
    else stoppedCount += 1;
  }

  return {
    totalUsers: users.length,
    adminCount,
    regularUserCount: Math.max(0, users.length - adminCount),
    totalServers: servers.length,
    runningCount,
    busyCount,
    errorCount,
    stoppedCount,
  };
}

export function getAdminUserDeleteBlockReason(
  targetUser: Pick<AdminUserSummary, 'id' | 'role'>,
  currentUserId: string,
  totalAdminCount: number
): string | null {
  if (targetUser.id === currentUserId) {
    return 'Tidak dapat menghapus akun sendiri.';
  }
  if (targetUser.role === 'admin' && totalAdminCount <= 1) {
    return 'Tidak dapat menghapus satu-satunya akun admin.';
  }
  return null;
}
