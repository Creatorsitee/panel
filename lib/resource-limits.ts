import type { HostInfo } from './types';

export interface ResourceOption {
  value: number;
  label: string;
}

export const MIN_MEMORY_MB = 512;
export const MIN_CPU_PERCENT = 10;
export const MIN_PREFERRED_MEMORY_MB = 1024;
export const MIN_PREFERRED_CPU_PERCENT = 50;

export const MEMORY_PRESETS_MB = [
  512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 16384,
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

export function getHostMaxMemoryMb(
  host?: Pick<HostInfo, 'totalMemoryMb'> | null
): number {
  if (!host || !host.totalMemoryMb || host.totalMemoryMb <= 0) {
    return 1024;
  }
  return Math.max(MIN_MEMORY_MB, Math.round(host.totalMemoryMb));
}

export function getHostMaxCpuPercent(
  host?: Pick<HostInfo, 'cpuCores'> | null
): number {
  if (!host || !host.cpuCores || host.cpuCores <= 0) {
    return 100;
  }
  return Math.max(100, Math.round(host.cpuCores * 100));
}

export function getPerServerMaxMemoryMb(
  host?: Pick<HostInfo, 'totalMemoryMb'> | null
): number {
  const totalMemoryMb = getHostMaxMemoryMb(host);
  if (totalMemoryMb < MIN_PREFERRED_MEMORY_MB) {
    return Math.max(MIN_MEMORY_MB, Math.floor(totalMemoryMb / 128) * 128 || MIN_MEMORY_MB);
  }
  const fairShare = Math.floor((totalMemoryMb * 0.5) / 256) * 256;
  return Math.max(MIN_PREFERRED_MEMORY_MB, Math.min(4096, fairShare));
}

export function getPerServerMaxCpuPercent(
  host?: Pick<HostInfo, 'cpuCores'> | null
): number {
  const totalCpu = getHostMaxCpuPercent(host);
  const fairShare = Math.floor((totalCpu * 0.5) / 25) * 25;
  return Math.max(MIN_PREFERRED_CPU_PERCENT, Math.min(100, fairShare));
}

export function getEffectiveMinMemoryMb(_effectiveMaxMem?: number): number {
  return MIN_MEMORY_MB;
}

export function getEffectiveMinCpuPercent(_effectiveMaxCpu?: number): number {
  return MIN_CPU_PERCENT;
}

export function getAvailableMemoryMb(
  host?: Pick<HostInfo, 'totalMemoryMb' | 'availableMemoryMb'> | null,
  currentServerMemoryMb = 0
): number {
  if (!host) {
    return Math.max(MIN_PREFERRED_MEMORY_MB, currentServerMemoryMb);
  }
  const maxTotal = getHostMaxMemoryMb(host);
  const available = Math.max(0, Math.round(host.availableMemoryMb)) + currentServerMemoryMb;
  return Math.min(maxTotal, available);
}

export function getAvailableCpuPercent(
  host?: Pick<HostInfo, 'cpuCores' | 'availableCpuPercent'> | null,
  currentServerCpuPercent = 0
): number {
  if (!host) {
    return Math.max(100, currentServerCpuPercent);
  }
  const maxTotal = getHostMaxCpuPercent(host);
  const available = Math.max(0, Math.round(host.availableCpuPercent)) + currentServerCpuPercent;
  return Math.min(maxTotal, available);
}

export function getHostMemoryOptions(
  host?: Pick<HostInfo, 'totalMemoryMb' | 'availableMemoryMb'> | null,
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

  if (currentServerMemoryMb >= MIN_MEMORY_MB) {
    values.add(currentServerMemoryMb);
  }

  return Array.from(values)
    .sort((a, b) => a - b)
    .map((val) => ({
      value: val,
      label: formatMemoryLabel(val),
    }));
}

export function getHostCpuOptions(
  host?: Pick<HostInfo, 'cpuCores' | 'availableCpuPercent'> | null,
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

  if (currentServerCpuPercent >= MIN_CPU_PERCENT) {
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
  host?: Pick<HostInfo, 'totalMemoryMb' | 'availableMemoryMb'> | null
): number {
  const options = getHostMemoryOptions(host, 0);
  return options[0]?.value ?? MIN_MEMORY_MB;
}

export function getDefaultCpuPercent(
  host?: Pick<HostInfo, 'cpuCores' | 'availableCpuPercent'> | null
): number {
  const options = getHostCpuOptions(host, 0);
  return options[0]?.value ?? MIN_CPU_PERCENT;
}
