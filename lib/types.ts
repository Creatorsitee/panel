export type ServerRuntime = 'nodejs' | 'python';

export type ServerStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'installing'
  | 'error';

export type UserRole = 'admin' | 'user';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface ServerConfig {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  runtime: ServerRuntime;
  startupCommand: string;
  port: number;
  memoryLimitMb: number;
  cpuLimitPercent: number;
  autoRestart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerRuntimeMetrics {
  status: ServerStatus;
  pid: number | null;
  cpuPercent: number;
  memoryMb: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  uptimeSeconds: number;
  exitCode: number | null;
  startedAt: string | null;
  awaitingInput: boolean;
}

export interface ServerWithMetrics extends ServerConfig {
  metrics: ServerRuntimeMetrics;
}

export interface ConsoleLine {
  id: string;
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system' | 'stdin';
  text: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  updatedAt: string;
}

export interface HostInfo {
  hostname: string;
  platform: string;
  osDistro: string;
  kernel: string;
  arch: string;
  primaryIp: string | null;
  cpuModel: string;
  cpuCores: number;
  hostCpuPercent: number;
  loadAvg: [number, number, number];
  totalMemoryMb: number;
  freeMemoryMb: number;
  usedMemoryMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
  swapFreeMb: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskFreeGb: number;
  allocatedMemoryMb: number;
  allocatedCpuPercent: number;
  totalAllocatedMemoryMb: number;
  totalAllocatedCpuPercent: number;
  panelMemoryUsedMb: number;
  panelCpuPercent: number;
  availableMemoryMb: number;
  availableCpuPercent: number;
  uptimeSeconds: number;
  nodeVersion: string;
  npmVersion: string | null;
  pythonVersion: string | null;
  pipVersion: string | null;
  activeServersCount: number;
  totalServersCount: number;
}

export interface AdminUserSummary extends PublicUser {
  serverCount: number;
}

export interface AdminServerSummary extends ServerWithMetrics {
  ownerName: string;
  ownerEmail: string;
}

