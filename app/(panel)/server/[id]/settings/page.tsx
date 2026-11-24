import ServerWorkspaceView from '@/components/ServerWorkspaceView';

export default async function ServerSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ServerWorkspaceView serverId={decodeURIComponent(id)} activeTab="settings" />;
}
