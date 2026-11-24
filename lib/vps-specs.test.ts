import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCpuLabel,
  formatMemoryLabel,
  getAvailableCpuPercent,
  getAvailableMemoryMb,
  getDefaultCpuPercent,
  getDefaultMemoryMb,
  getPerServerMaxCpuPercent,
  getPerServerMaxMemoryMb,
  getVpsCpuOptions,
  getVpsMemoryOptions,
} from './vps-specs';

test('formatCpuLabel and formatMemoryLabel format fractional and gigabyte values cleanly', () => {
  assert.equal(formatCpuLabel(10), '10% (0.1 Cores)');
  assert.equal(formatCpuLabel(50), '50% (0.5 Cores)');
  assert.equal(formatCpuLabel(100), '100% (1 Core)');

  assert.equal(formatMemoryLabel(512), '512 MB');
  assert.equal(formatMemoryLabel(1024), '1024 MB (1 GB)');
  assert.equal(formatMemoryLabel(1536), '1536 MB (1.5 GB)');
});

test('resource options enforce fair-share per-server caps (minimum 512 MB) and default to smallest tier', () => {
  const host = {
    totalMemoryMb: 12288,
    availableMemoryMb: 8192,
    cpuCores: 4,
    availableCpuPercent: 400,
  };

  assert.equal(getPerServerMaxMemoryMb(host), 4096);
  assert.equal(getPerServerMaxCpuPercent(host), 100);

  const memOpts = getVpsMemoryOptions(host, 0);
  const cpuOpts = getVpsCpuOptions(host, 0);

  assert.deepEqual(
    memOpts.map((o) => o.value),
    [512, 768, 1024, 1536, 2048, 4096]
  );
  assert.deepEqual(
    cpuOpts.map((o) => o.value),
    [10, 15, 25, 50, 75, 100]
  );
  assert.equal(getDefaultMemoryMb(host), 512);
  assert.equal(getDefaultCpuPercent(host), 10);
});

test('small NAT VPS caps per-server allocation with minimum 512 MB memory', () => {
  const natVps = {
    totalMemoryMb: 1024,
    availableMemoryMb: 900,
    cpuCores: 1,
    availableCpuPercent: 100,
  };

  assert.equal(getPerServerMaxMemoryMb(natVps), 512);
  assert.equal(getPerServerMaxCpuPercent(natVps), 35);

  assert.deepEqual(
    getVpsMemoryOptions(natVps, 0).map((o) => o.value),
    [512]
  );
  assert.deepEqual(
    getVpsCpuOptions(natVps, 0).map((o) => o.value),
    [10, 15, 25]
  );
});

test('resource options return empty when capacity is exhausted and preserve current allocation when editing', () => {
  const fullHost = {
    totalMemoryMb: 12288,
    availableMemoryMb: 0,
    cpuCores: 4,
    availableCpuPercent: 0,
  };

  assert.equal(getAvailableMemoryMb(fullHost, 0), 0);
  assert.equal(getAvailableCpuPercent(fullHost, 0), 0);
  assert.equal(getVpsMemoryOptions(fullHost, 0).length, 0);
  assert.equal(getVpsCpuOptions(fullHost, 0).length, 0);

  assert.deepEqual(
    getVpsMemoryOptions(fullHost, 1024).map((o) => o.value),
    [512, 768, 1024]
  );
  assert.deepEqual(
    getVpsCpuOptions(fullHost, 50).map((o) => o.value),
    [10, 15, 25, 50]
  );
});
