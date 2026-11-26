import ServerWorkspaceView from '@/components/server-workspace';

export default async function ServerFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ServerWorkspaceView serverId={decodeURIComponent(id)} activeTab="files" />;
}
