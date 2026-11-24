'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AdminPanelTab from './AdminPanelTab';
import { usePanel } from './PanelContext';

export default function AdminRouteView() {
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
      currentUser={user}
      onOpenServer={(serverId) => {
        void loadWorkspaceData();
        router.push(`/server/${encodeURIComponent(serverId)}`);
      }}
      onWorkspaceRefresh={() => {
        void loadWorkspaceData();
      }}
    />
  );
}
