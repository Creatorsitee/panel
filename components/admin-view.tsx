'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AdminPanelTab from './admin-panel';
import { usePanel } from './panel-shell';

interface AdminRouteViewProps {
  section?: 'users' | 'servers';
}

export default function AdminRouteView({ section = 'users' }: AdminRouteViewProps) {
  const router = useRouter();
  const { user, loadWorkspaceData } = usePanel();

  useEffect(() => {
    if (user.role !== 'admin') {
      router.replace('/');
    }
  }, [user.role, router]);

  if (user.role !== 'admin') {
    return null;
  }

  return (
    <AdminPanelTab
      section={section}
      currentUser={user}
      onOpenServer={(serverId) => {
        void loadWorkspaceData();
        router.push(`/server/${encodeURIComponent(serverId)}`);
      }}
      onWorkspaceRefresh={loadWorkspaceData}
    />
  );
}
