import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAdminOverview,
  filterAdminServers,
  filterAdminUsers,
  getAdminUserDeleteBlockReason,
  isBusyServerStatus,
} from './admin-utils.ts';
import type { AdminServerSummary, AdminUserSummary } from './types.ts';

const sampleUsers: AdminUserSummary[] = [
  {
    id: 'usr_1',
    name: 'Admin Utama',
    email: 'admin@cmnty.local',
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    serverCount: 1,
  },
  {
    id: 'usr_2',
    name: 'Budi Santoso',
    email: 'budi@example.com',
    role: 'user',
    createdAt: '2026-01-02T00:00:00.000Z',
    serverCount: 2,
  },
];

function makeServer(
  overrides: Partial<AdminServerSummary> & { id: string; status?: AdminServerSummary['metrics']['status'] }
): AdminServerSummary {
  const { status = 'stopped', ...rest } = overrides;
  return {
    ownerId: 'usr_2',
    ownerName: 'Budi Santoso',
    ownerEmail: 'budi@example.com',
    name: 'bot-api',
    description: '',
    runtime: 'nodejs',
    startupCommand: 'node index.js',
    port: 4001,
    memoryLimitMb: 512,
    cpuLimitPercent: 25,
    autoRestart: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      status,
      pid: status === 'running' ? 1234 : null,
      cpuPercent: status === 'running' ? 2.5 : 0,
      memoryMb: status === 'running' ? 42 : 0,
      uptimeSeconds: status === 'running' ? 60 : 0,
      exitCode: null,
      startedAt: null,
    },
    ...rest,
  };
}

test('filterAdminUsers filters by role and search across name, email, and id', () => {
  assert.equal(filterAdminUsers(sampleUsers, { search: '', roleFilter: 'all' }).length, 2);
  assert.equal(filterAdminUsers(sampleUsers, { search: '', roleFilter: 'admin' }).length, 1);
  assert.deepEqual(
    filterAdminUsers(sampleUsers, { search: 'budi@example', roleFilter: 'user' }).map((u) => u.id),
    ['usr_2']
  );
  assert.deepEqual(
    filterAdminUsers(sampleUsers, { search: 'usr_1', roleFilter: 'all' }).map((u) => u.id),
    ['usr_1']
  );
});

test('filterAdminServers handles all statuses including busy (starting/installing/stopping) and search fields', () => {
  const servers: AdminServerSummary[] = [
    makeServer({ id: 'a1b2c3d4', name: 'web-node', port: 4001, status: 'running' }),
    makeServer({ id: 'b2c3d4e5', name: 'py-worker', runtime: 'python', port: 4002, status: 'installing', ownerName: 'Admin Utama', ownerEmail: 'admin@cmnty.local', ownerId: 'usr_1' }),
    makeServer({ id: 'c3d4e5f6', name: 'crash-bot', port: 4003, status: 'error' }),
    makeServer({ id: 'd4e5f6a7', name: 'idle-app', port: 4004, status: 'stopped' }),
  ];

  assert.equal(isBusyServerStatus('installing'), true);
  assert.equal(isBusyServerStatus('starting'), true);
  assert.equal(isBusyServerStatus('stopping'), true);
  assert.equal(isBusyServerStatus('running'), false);

  assert.deepEqual(
    filterAdminServers(servers, { search: '', statusFilter: 'busy' }).map((s) => s.id),
    ['b2c3d4e5']
  );
  assert.deepEqual(
    filterAdminServers(servers, { search: '4003', statusFilter: 'error' }).map((s) => s.id),
    ['c3d4e5f6']
  );
  assert.deepEqual(
    filterAdminServers(servers, { search: 'python', statusFilter: 'all' }).map((s) => s.id),
    ['b2c3d4e5']
  );
});

test('computeAdminOverview calculates accurate user and server status breakdowns', () => {
  const servers: AdminServerSummary[] = [
    makeServer({ id: 'a1b2c3d4', status: 'running' }),
    makeServer({ id: 'b2c3d4e5', status: 'starting' }),
    makeServer({ id: 'c3d4e5f6', status: 'error' }),
    makeServer({ id: 'd4e5f6a7', status: 'stopped' }),
  ];
  assert.deepEqual(computeAdminOverview(sampleUsers, servers), {
    totalUsers: 2,
    adminCount: 1,
    regularUserCount: 1,
    totalServers: 4,
    runningCount: 1,
    busyCount: 1,
    errorCount: 1,
    stoppedCount: 1,
  });
});

test('getAdminUserDeleteBlockReason protects self and last admin', () => {
  assert.ok(getAdminUserDeleteBlockReason(sampleUsers[0], 'usr_1', 2));
  assert.ok(getAdminUserDeleteBlockReason(sampleUsers[0], 'usr_9', 1));
  assert.equal(getAdminUserDeleteBlockReason(sampleUsers[0], 'usr_9', 2), null);
  assert.equal(getAdminUserDeleteBlockReason(sampleUsers[1], 'usr_1', 1), null);
});
