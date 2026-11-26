import { NextRequest, NextResponse } from 'next/server';
import { listAllServers, listAllUsers } from '@/lib/db';
import { getHostInfo, getServerMetrics } from '@/lib/processes';
import { requireAdmin } from '@/lib/guards';
import type { AdminServerSummary } from '@/lib/types';

export async function GET(req: NextRequest) {
  const adminCheck = requireAdmin(req);
  if (adminCheck.error) return adminCheck.error;

  const users = listAllUsers();
  const userMap = new Map(users.map((u) => [u.id, u]));
  const servers = listAllServers();

  const enriched: AdminServerSummary[] = servers.map((srv) => {
    const owner = userMap.get(srv.ownerId);
    return {
      ...srv,
      metrics: getServerMetrics(srv.id),
      ownerName: owner?.name || 'User Terhapus',
      ownerEmail: owner?.email || '—',
    };
  });

  return NextResponse.json({
    servers: enriched,
    host: getHostInfo(),
  });
}
