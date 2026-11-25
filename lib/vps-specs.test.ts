import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCpuLabel,
  formatMemoryLabel,
  getAvailableCpuPercent,
  getAvailableMemoryMb,
  getDefaultCpuPercent,
  getDefaultMemoryMb,
  getEffectiveMinCpuPercent,
  getEffectiveMinMemoryMb,
  getHostCpuOptions,
  getHostMemoryOptions,
  getPerServerMaxCpuPercent,
  getPerServerMaxMemoryMb,
} from './vps-specs.ts';

test('formatCpuLabel and formatMemoryLabel format fractional and gigabyte values cleanly', () => {
  assert.equal(formatCpuLabel(10), '10% (0.1 Cores)');
  assert.equal(formatCpuLabel(50), '50% (0.5 Cores)');
  assert.equal(formatCpuLabel(100), '100% (1 Core)');

  assert.equal(formatMemoryLabel(512), '512 MB');
  assert.equal(formatMemoryLabel(768), '768 MB');
  assert.equal(formatMemoryLabel(1024), '1024 MB (1 GB)');
  assert.equal(formatMemoryLabel(1536), '1536 MB (1.5 GB)');
});

test('standard host keeps 512/768 MB and 10/15/25% options and defaults to smallest option (512 MB and 10%)', () => {
  const host = {
    totalMemoryMb: 12288,
    availableMemoryMb: 8192,
    cpuCores: 4,
    availableCpuPercent: 400,
  };

  assert.equal(getPerServerMaxMemoryMb(host), 4096);
  assert.equal(getPerServerMaxCpuPercent(host), 100);
  assert.equal(getEffectiveMinMemoryMb(4096), 512);
  assert.equal(getEffectiveMinCpuPercent(100), 10);

  const memOpts = getHostMemoryOptions(host, 0);
  const cpuOpts = getHostCpuOptions(host, 0);

  assert.deepEqual(
    memOpts.map((o) => o.value),
    [512, 768, 1024, 1536, 2048, 3072, 4096]
  );
  assert.deepEqual(
    cpuOpts.map((o) => o.value),
    [10, 15, 25, 50, 75, 100]
  );
  assert.equal(getDefaultMemoryMb(host), 512);
  assert.equal(getDefaultCpuPercent(host), 10);
});

test('1 GB / 1 Core and 1.5 GB / 1 Core host keep smaller options, surface 1 GB / 50%, and default to smallest', () => {
  const host1Gb = {
    totalMemoryMb: 1024,
    availableMemoryMb: 1024,
    cpuCores: 1,
    availableCpuPercent: 100,
  };

  assert.equal(getPerServerMaxMemoryMb(host1Gb), 1024);
  assert.equal(getPerServerMaxCpuPercent(host1Gb), 50);

  assert.deepEqual(
    getHostMemoryOptions(host1Gb, 0).map((o) => o.value),
    [512, 768, 1024]
  );
  assert.deepEqual(
    getHostCpuOptions(host1Gb, 0).map((o) => o.value),
    [10, 15, 25, 50]
  );
  assert.equal(getDefaultMemoryMb(host1Gb), 512);
  assert.equal(getDefaultCpuPercent(host1Gb), 10);

  const host15Gb = {
    totalMemoryMb: 1536,
    availableMemoryMb: 1536,
    cpuCores: 1,
    availableCpuPercent: 100,
  };

  assert.deepEqual(
    getHostMemoryOptions(host15Gb, 0).map((o) => o.value),
    [512, 768, 1024]
  );
  assert.equal(getDefaultMemoryMb(host15Gb), 512);
});

test('small or partially utilized host falls back cleanly below 1 GB / 50% and defaults to smallest option', () => {
  const constrainedHost = {
    totalMemoryMb: 1024,
    availableMemoryMb: 768,
    cpuCores: 1,
    availableCpuPercent: 25,
  };

  assert.deepEqual(
    getHostMemoryOptions(constrainedHost, 0).map((o) => o.value),
    [512, 768]
  );
  assert.deepEqual(
    getHostCpuOptions(constrainedHost, 0).map((o) => o.value),
    [10, 15, 25]
  );
  assert.equal(getDefaultMemoryMb(constrainedHost), 512);
  assert.equal(getDefaultCpuPercent(constrainedHost), 10);
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
  assert.equal(getHostMemoryOptions(fullHost, 0).length, 0);
  assert.equal(getHostCpuOptions(fullHost, 0).length, 0);

  assert.deepEqual(
    getHostMemoryOptions(fullHost, 1024).map((o) => o.value),
    [512, 768, 1024]
  );
  assert.deepEqual(
    getHostCpuOptions(fullHost, 50).map((o) => o.value),
    [10, 15, 25, 50]
  );
  assert.deepEqual(
    getHostCpuOptions(fullHost, 10).map((o) => o.value),
    [10]
  );
});
