export interface PidNetworkCounters {
  lastRxTotal: number;
  lastTxTotal: number;
  updatedAtMs: number;
}

export interface NetworkRateBucket {
  timestampMs: number;
  rxDelta: number;
  txDelta: number;
}

export interface NetworkTrafficState {
  byPid: Map<number, PidNetworkCounters>;
  buckets: NetworkRateBucket[];
  totalRxBytes: number;
  totalTxBytes: number;
}

export function createNetworkTrafficState(): NetworkTrafficState {
  return {
    byPid: new Map(),
    buckets: [],
    totalRxBytes: 0,
    totalTxBytes: 0,
  };
}

export function resetNetworkTrafficState(state: NetworkTrafficState): void {
  state.byPid.clear();
  state.buckets = [];
  state.totalRxBytes = 0;
  state.totalTxBytes = 0;
}

function pruneOldBuckets(state: NetworkTrafficState, nowMs: number, windowMs = 2500): void {
  const cutoff = nowMs - windowMs;
  while (state.buckets.length > 0 && state.buckets[0].timestampMs < cutoff) {
    state.buckets.shift();
  }
}

export function recordProcessNetworkSample(
  state: NetworkTrafficState,
  pid: number,
  cumulativeRxBytes: number,
  cumulativeTxBytes: number,
  nowMs: number
): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  const rx = Math.max(0, Math.floor(Number.isFinite(cumulativeRxBytes) ? cumulativeRxBytes : 0));
  const tx = Math.max(0, Math.floor(Number.isFinite(cumulativeTxBytes) ? cumulativeTxBytes : 0));

  const prev = state.byPid.get(pid);
  let rxDelta = 0;
  let txDelta = 0;

  if (!prev) {
    rxDelta = rx;
    txDelta = tx;
  } else {
    rxDelta = rx >= prev.lastRxTotal ? rx - prev.lastRxTotal : rx;
    txDelta = tx >= prev.lastTxTotal ? tx - prev.lastTxTotal : tx;
  }

  state.byPid.set(pid, {
    lastRxTotal: rx,
    lastTxTotal: tx,
    updatedAtMs: nowMs,
  });

  if (rxDelta > 0 || txDelta > 0) {
    state.totalRxBytes += rxDelta;
    state.totalTxBytes += txDelta;
    state.buckets.push({
      timestampMs: nowMs,
      rxDelta,
      txDelta,
    });
  }

  pruneOldBuckets(state, nowMs);
}

export function sampleNetworkRates(
  state: NetworkTrafficState,
  nowMs: number,
  windowMs = 2000
): {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxTotalBytes: number;
  txTotalBytes: number;
} {
  pruneOldBuckets(state, nowMs, windowMs);

  let rxSum = 0;
  let txSum = 0;
  let earliestMs = nowMs;

  for (const b of state.buckets) {
    rxSum += b.rxDelta;
    txSum += b.txDelta;
    if (b.timestampMs < earliestMs) {
      earliestMs = b.timestampMs;
    }
  }

  const spanSec = Math.max(1, (nowMs - earliestMs) / 1000);
  const effectiveDivisor = state.buckets.length === 0 ? 1 : Math.max(1, Math.min(windowMs / 1000, spanSec));

  return {
    rxBytesPerSec: Math.round(rxSum / effectiveDivisor),
    txBytesPerSec: Math.round(txSum / effectiveDivisor),
    rxTotalBytes: state.totalRxBytes,
    txTotalBytes: state.totalTxBytes,
  };
}

export function formatNetworkAxisBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
  if (bytes < 1024) return `${Math.round(bytes)} Bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatNetworkRateLabel(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}
