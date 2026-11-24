import type { HostVpsInfo } from './types';

export interface ResourceOption {
  value: number;
  label: string;
}

export const MEMORY_PRESETS_MB = [
  512, 768, 1024, 1536, 2048, 4096, 8192, 16384,
];

export const CPU_PRESETS_PERCENT = [
  10, 15, 25, 50, 75, 100,
];

export function formatMemoryLabel(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) {
    return `${mb} MB (${mb / 1024} GB)`;
  }
  if (mb >= 1024) {
    return `${mb} MB (${Number((mb / 1024).toFixed(1))} GB)`;
  }
  return `${mb} MB`;
}

export function formatCpuLabel(percent: number): string {
  const cores = percent / 100;
  const coreStr = String(Number(cores.toFixed(2)));
  return `${percent}% (${coreStr} ${cores === 1 ? 'Core' : 'Cores'})`;
}

export function getVpsMaxMemoryMb(
  host?: Pick<HostVpsInfo, 'totalMemoryMb'> | null
): number {
  if (!host || !host.totalMemoryMb || host.totalMemoryMb <= 0) {
    return 1024;
  }
  return Math.max(512, Math.round(host.totalMemoryMb));
}

export function getVpsMaxCpuPercent(
  host?: Pick<HostVpsInfo, 'cpuCores'> | null
): number {
  if (!host || !host.cpuCores || host.cpuCores <= 0) {
    return 100;
  }
  return Math.max(100, Math.round(host.cpuCores * 100));
}

/**
 * Fair-share per-server memory cap (minimum 512 MB) so one server cannot exhaust the entire VPS.
 */
export function getPerServerMaxMemoryMb(
  host?: Pick<HostVpsInfo, 'totalMemoryMb'> | null
): number {
  const totalMemoryMb = getVpsMaxMemoryMb(host);
  const fairShare = Math.floor((totalMemoryMb * 0.4) / 128) * 128;
  return Math.max(512, Math.min(4096, fairShare || 512));
}

/**
 * Fair-share per-server CPU cap so multiple users can run servers concurrently.
 */
export function getPerServerMaxCpuPercent(
  host?: Pick<HostVpsInfo, 'cpuCores'> | null
): number {
  const totalCpu = getVpsMaxCpuPercent(host);
  const fairShare = Math.floor((totalCpu * 0.35) / 5) * 5;
  return Math.max(15, Math.min(100, fairShare || 15));
}

export function getAvailableMemoryMb(
  host?: Pick<HostVpsInfo, 'totalMemoryMb' | 'availableMemoryMb'> | null,
  currentServerMemoryMb = 0
): number {
  if (!host) {
    return Math.max(512, currentServerMemoryMb);
  }
  const maxTotal = getVpsMaxMemoryMb(host);
  const available = Math.max(0, Math.round(host.availableMemoryMb)) + currentServerMemoryMb;
  return Math.min(maxTotal, available);
}

export function getAvailableCpuPercent(
  host?: Pick<HostVpsInfo, 'cpuCores' | 'availableCpuPercent'> | null,
  currentServerCpuPercent = 0
): number {
  if (!host) {
    return Math.max(100, currentServerCpuPercent);
  }
  const maxTotal = getVpsMaxCpuPercent(host);
  const available = Math.max(0, Math.round(host.availableCpuPercent)) + currentServerCpuPercent;
  return Math.min(maxTotal, available);
}

export function getVpsMemoryOptions(
  host?: Pick<HostVpsInfo, 'totalMemoryMb' | 'availableMemoryMb'> | null,
  currentServerMemoryMb = 0
): ResourceOption[] {
  const maxAvail = getAvailableMemoryMb(host, currentServerMemoryMb);
  const perServerCap = getPerServerMaxMemoryMb(host);
  const effectiveMax = Math.min(maxAvail, perServerCap);
  const values = new Set<number>();

  for (const preset of MEMORY_PRESETS_MB) {
    if (preset <= effectiveMax) {
      values.add(preset);
    }
  }
  if (currentServerMemoryMb >= 512) {
    values.add(currentServerMemoryMb);
  }

  return Array.from(values)
    .sort((a, b) => a - b)
    .map((val) => ({
      value: val,
      label: formatMemoryLabel(val),
    }));
}

export function getVpsCpuOptions(
  host?: Pick<HostVpsInfo, 'cpuCores' | 'availableCpuPercent'> | null,
  currentServerCpuPercent = 0
): ResourceOption[] {
  const maxAvail = getAvailableCpuPercent(host, currentServerCpuPercent);
  const perServerCap = getPerServerMaxCpuPercent(host);
  const effectiveMax = Math.min(maxAvail, perServerCap);
  const values = new Set<number>();

  for (const preset of CPU_PRESETS_PERCENT) {
    if (preset <= effectiveMax) {
      values.add(preset);
    }
  }
  if (currentServerCpuPercent >= 10) {
    values.add(currentServerCpuPercent);
  }

  return Array.from(values)
    .sort((a, b) => a - b)
    .map((val) => ({
      value: val,
      label: formatCpuLabel(val),
    }));
}

export function getDefaultMemoryMb(
  host?: Pick<HostVpsInfo, 'totalMemoryMb' | 'availableMemoryMb'> | null
): number {
  const options = getVpsMemoryOptions(host, 0);
  return options[0]?.value ?? 512;
}

export function getDefaultCpuPercent(
  host?: Pick<HostVpsInfo, 'cpuCores' | 'availableCpuPercent'> | null
): number {
  const options = getVpsCpuOptions(host, 0);
  return options[0]?.value ?? 10;
}
