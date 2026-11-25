import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getConsolePowerPermissions,
  getStatusDisplayLabel,
} from './console-state.ts';
import {
  computeCpuPercentDelta,
  parseMeminfoSwapMb,
  parseOsPrettyName,
  parseProcStatCpuSnapshot,
} from './host-stats-utils.ts';

test('getConsolePowerPermissions enforces Pterodactyl power button rules per status', () => {
  assert.deepEqual(getConsolePowerPermissions('stopped'), {
    canStart: true,
    canRestart: false,
    canStop: false,
    canKill: false,
    canSendInput: false,
    isBusy: false,
  });

  assert.deepEqual(getConsolePowerPermissions('error'), {
    canStart: true,
    canRestart: false,
    canStop: false,
    canKill: false,
    canSendInput: false,
    isBusy: false,
  });

  assert.deepEqual(getConsolePowerPermissions('starting'), {
    canStart: false,
    canRestart: false,
    canStop: true,
    canKill: true,
    canSendInput: true,
    isBusy: true,
  });

  assert.deepEqual(getConsolePowerPermissions('running'), {
    canStart: false,
    canRestart: true,
    canStop: true,
    canKill: true,
    canSendInput: true,
    isBusy: false,
  });

  assert.deepEqual(getConsolePowerPermissions('stopping'), {
    canStart: false,
    canRestart: false,
    canStop: false,
    canKill: true,
    canSendInput: false,
    isBusy: true,
  });
});

test('getStatusDisplayLabel maps stopped to Offline and preserves active states', () => {
  assert.equal(getStatusDisplayLabel('stopped'), 'Offline');
  assert.equal(getStatusDisplayLabel('starting'), 'Starting');
  assert.equal(getStatusDisplayLabel('installing'), 'Installing');
  assert.equal(getStatusDisplayLabel('running'), 'Running');
  assert.equal(getStatusDisplayLabel('stopping'), 'Stopping');
  assert.equal(getStatusDisplayLabel('error'), 'Error');
});

test('host-stats-utils parses /etc/os-release, /proc/meminfo swap, and /proc/stat CPU deltas', () => {
  const osRelease = `NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n`;
  assert.equal(parseOsPrettyName(osRelease, 'Linux'), 'Ubuntu 24.04.1 LTS');
  assert.equal(parseOsPrettyName('', 'Linux 6.8'), 'Linux 6.8');

  const meminfo = `MemTotal:       16384000 kB\nSwapTotal:       2097152 kB\nSwapFree:        1572864 kB\n`;
  assert.deepEqual(parseMeminfoSwapMb(meminfo), {
    swapTotalMb: 2048,
    swapUsedMb: 512,
    swapFreeMb: 1536,
  });

  const s1 = parseProcStatCpuSnapshot('cpu  100 0 50 850 0 0 0 0\ncpu0 50 0 25 425\n');
  const s2 = parseProcStatCpuSnapshot('cpu  200 0 100 1700 0 0 0 0\ncpu0 100 0 50 850\n');
  assert.deepEqual(s1, { idle: 850, total: 1000 });
  assert.equal(computeCpuPercentDelta(s1, s2), 15);
  assert.equal(computeCpuPercentDelta(null, s2), null);
});
