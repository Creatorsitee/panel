export type ServerRuntime = 'nodejs' | 'python';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'installing' | 'error';

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
  uptimeSeconds: number;
  exitCode: number | null;
  startedAt: string | null;
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

export interface HostVpsInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  loadAvg: [number, number, number];
  totalMemoryMb: number;
  freeMemoryMb: number;
  usedMemoryMb: number;
  allocatedMemoryMb: number;
  allocatedCpuPercent: number;
  availableMemoryMb: number;
  availableCpuPercent: number;
  uptimeSeconds: number;
  nodeVersion: string;
  pythonVersion: string | null;
  activeServersCount: number;
}
