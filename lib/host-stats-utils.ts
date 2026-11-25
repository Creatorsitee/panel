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
