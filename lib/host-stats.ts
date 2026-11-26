export interface ProcCpuSnapshot {
  idle: number;
  total: number;
}

export interface SwapMemoryStatsMb {
  swapTotalMb: number;
  swapUsedMb: number;
  swapFreeMb: number;
}

export function parseOsPrettyName(
  osReleaseContent: string,
  fallback: string
): string {
  const prettyMatch = /^PRETTY_NAME=(?:"([^"\n]+)"|'([^'\n]+)'|([^\n]+))/m.exec(
    osReleaseContent
  );
  if (prettyMatch) {
    const val = (prettyMatch[1] || prettyMatch[2] || prettyMatch[3] || '').trim();
    if (val) return val;
  }

  const nameMatch = /^NAME=(?:"([^"\n]+)"|'([^'\n]+)'|([^\n]+))/m.exec(
    osReleaseContent
  );
  const verMatch = /^VERSION_ID=(?:"([^"\n]+)"|'([^'\n]+)'|([^\n]+))/m.exec(
    osReleaseContent
  );
  const name = (nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || '').trim();
  const ver = (verMatch?.[1] || verMatch?.[2] || verMatch?.[3] || '').trim();
  if (name) {
    return ver ? `${name} ${ver}` : name;
  }
  return fallback;
}

export function parseMeminfoSwapMb(meminfoContent: string): SwapMemoryStatsMb {
  const totalMatch = /^SwapTotal:\s+(\d+)\s+kB/m.exec(meminfoContent);
  const freeMatch = /^SwapFree:\s+(\d+)\s+kB/m.exec(meminfoContent);
  const totalMb = totalMatch ? Math.round(Number(totalMatch[1]) / 1024) : 0;
  const freeMb = freeMatch ? Math.round(Number(freeMatch[1]) / 1024) : 0;
  const clampedFree = Math.min(totalMb, Math.max(0, freeMb));
  return {
    swapTotalMb: totalMb,
    swapUsedMb: Math.max(0, totalMb - clampedFree),
    swapFreeMb: clampedFree,
  };
}

export function parseProcStatCpuSnapshot(
  statContent: string
): ProcCpuSnapshot | null {
  const line = statContent
    .split('\n')
    .find((entry) => entry.startsWith('cpu '));
  if (!line) return null;

  const parts = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((val) => Number(val));
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }

  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return null;
  return { idle, total };
}

export function computeCpuPercentDelta(
  prev: ProcCpuSnapshot | null,
  curr: ProcCpuSnapshot | null
): number | null {
  if (!prev || !curr) return null;
  const deltaTotal = curr.total - prev.total;
  const deltaIdle = curr.idle - prev.idle;
  if (deltaTotal <= 0) return null;
  const busy = Math.max(0, deltaTotal - Math.max(0, deltaIdle));
  return Number(Math.min(100, (busy / deltaTotal) * 100).toFixed(1));
}

export interface HostCpuSamplerState {
  lastSnapshot: ProcCpuSnapshot | null;
  lastSampleAtMs: number;
  lastPercent: number | null;
}

export function sampleHostCpuPercent(
  state: HostCpuSamplerState,
  currentSnapshot: ProcCpuSnapshot | null,
  nowMs: number,
  fallbackPercent: number,
  minIntervalMs = 900
): { percent: number; nextState: HostCpuSamplerState } {
  if (!currentSnapshot) {
    return {
      percent: state.lastPercent ?? fallbackPercent,
      nextState: state,
    };
  }

  if (!state.lastSnapshot) {
    return {
      percent: state.lastPercent ?? fallbackPercent,
      nextState: {
        lastSnapshot: currentSnapshot,
        lastSampleAtMs: nowMs,
        lastPercent: state.lastPercent,
      },
    };
  }

  const elapsed = nowMs - state.lastSampleAtMs;
  if (elapsed < minIntervalMs && state.lastPercent !== null) {
    return {
      percent: state.lastPercent,
      nextState: state,
    };
  }

  const deltaPct = computeCpuPercentDelta(state.lastSnapshot, currentSnapshot);
  if (deltaPct === null) {
    return {
      percent: state.lastPercent ?? fallbackPercent,
      nextState: {
        lastSnapshot: currentSnapshot,
        lastSampleAtMs: nowMs,
        lastPercent: state.lastPercent,
      },
    };
  }

  return {
    percent: deltaPct,
    nextState: {
      lastSnapshot: currentSnapshot,
      lastSampleAtMs: nowMs,
      lastPercent: deltaPct,
    },
  };
}

export interface ServerQuotaSample {
  memoryLimitMb: number;
  cpuLimitPercent: number;
  isActive: boolean;
  isRunning: boolean;
  usedMemoryMb: number;
  usedCpuPercent: number;
}

export interface PanelQuotaSummary {
  activeServersCount: number;
  totalServersCount: number;
  allocatedMemoryMb: number;
  allocatedCpuPercent: number;
  totalAllocatedMemoryMb: number;
  totalAllocatedCpuPercent: number;
  panelMemoryUsedMb: number;
  panelCpuPercent: number;
  availableMemoryMb: number;
  availableCpuPercent: number;
}

export function computePanelQuotaSummary(
  servers: ServerQuotaSample[],
  totalMemMb: number,
  freeMemMb: number,
  totalCpuPercent: number
): PanelQuotaSummary {
  let activeServersCount = 0;
  let allocatedMemoryMb = 0;
  let allocatedCpuPercent = 0;
  let totalAllocatedMemoryMb = 0;
  let totalAllocatedCpuPercent = 0;
  let panelMemoryUsedMb = 0;
  let panelCpuPercent = 0;

  for (const srv of servers) {
    const memLimit = Number.isFinite(srv.memoryLimitMb) ? Math.max(0, srv.memoryLimitMb) : 0;
    const cpuLimit = Number.isFinite(srv.cpuLimitPercent) ? Math.max(0, srv.cpuLimitPercent) : 0;
    totalAllocatedMemoryMb += memLimit;
    totalAllocatedCpuPercent += cpuLimit;

    if (srv.isActive) {
      if (srv.isRunning) {
        activeServersCount += 1;
      }
      allocatedMemoryMb += memLimit;
      allocatedCpuPercent += cpuLimit;
      panelMemoryUsedMb += Number.isFinite(srv.usedMemoryMb) ? Math.max(0, srv.usedMemoryMb) : 0;
      panelCpuPercent += Number.isFinite(srv.usedCpuPercent) ? Math.max(0, srv.usedCpuPercent) : 0;
    }
  }

  const activeExtraReservedMb = Math.max(0, allocatedMemoryMb - Math.round(panelMemoryUsedMb));
  const availableMemoryMb = Math.max(
    0,
    Math.min(totalMemMb - allocatedMemoryMb, freeMemMb - activeExtraReservedMb)
  );
  const availableCpuPercent = Math.max(0, totalCpuPercent - allocatedCpuPercent);

  return {
    activeServersCount,
    totalServersCount: servers.length,
    allocatedMemoryMb,
    allocatedCpuPercent,
    totalAllocatedMemoryMb,
    totalAllocatedCpuPercent,
    panelMemoryUsedMb: Number(panelMemoryUsedMb.toFixed(1)),
    panelCpuPercent: Number(panelCpuPercent.toFixed(2)),
    availableMemoryMb,
    availableCpuPercent,
  };
}
