import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ServerConfig, UserRecord } from './types';

interface DatabaseState {
  users: UserRecord[];
  servers: ServerConfig[];
}

const DATA_ROOT = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_ROOT, 'panel-db.json');
export const SERVERS_ROOT = path.join(DATA_ROOT, 'servers');

const globalForDb = globalThis as unknown as {
  __nodalDbLock?: Promise<void>;
};

function ensureDirs(): void {
  if (!fs.existsSync(DATA_ROOT)) {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
  }
  if (!fs.existsSync(SERVERS_ROOT)) {
    fs.mkdirSync(SERVERS_ROOT, { recursive: true });
  }
}

function readDbSync(): DatabaseState {
  ensureDirs();
  if (!fs.existsSync(DB_PATH)) {
    const empty: DatabaseState = { users: [], servers: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseState>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    };
  } catch {
    return { users: [], servers: [] };
  }
}

function writeDbSync(state: DatabaseState): void {
  ensureDirs();
  const tmpPath = `${DB_PATH}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

async function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = globalForDb.__nodalDbLock || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalForDb.__nodalDbLock = prev.then(() => next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function getServerDirectory(serverId: string): string {
  ensureDirs();
  const safeId = serverId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId || safeId !== serverId) {
    throw new Error('Server ID tidak valid.');
  }
  return path.join(SERVERS_ROOT, safeId);
}

export function getUserByEmail(email: string): UserRecord | undefined {
  const db = readDbSync();
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function getUserById(id: string): UserRecord | undefined {
  const db = readDbSync();
  return db.users.find((u) => u.id === id);
}

export function getUserCount(): number {
  return readDbSync().users.length;
}

export async function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<UserRecord> {
  return withWriteLock(() => {
    const db = readDbSync();
    if (db.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error('Email sudah terdaftar. Silakan masuk.');
    }

    const isFirstUser = db.users.length === 0;
    const user: UserRecord = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: isFirstUser ? 'admin' : 'user',
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    writeDbSync(db);
    return user;
  });
}

export function listAllServers(): ServerConfig[] {
  return readDbSync().servers;
}

export function listServersForUser(userId: string, role: string): ServerConfig[] {
  const servers = readDbSync().servers;
  if (role === 'admin') {
    return servers;
  }
  return servers.filter((s) => s.ownerId === userId);
}

export function getServerById(serverId: string): ServerConfig | undefined {
  return readDbSync().servers.find((s) => s.id === serverId);
}

export async function createServerRecord(
  config: Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ServerConfig> {
  return withWriteLock(() => {
    const db = readDbSync();
    const now = new Date().toISOString();
    const server: ServerConfig = {
      ...config,
      id: `srv_${crypto.randomBytes(5).toString('hex')}`,
      createdAt: now,
      updatedAt: now,
    };
    db.servers.push(server);
    writeDbSync(db);

    const dir = getServerDirectory(server.id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return server;
  });
}

export async function updateServerRecord(
  serverId: string,
  patch: Partial<
    Pick<
      ServerConfig,
      | 'name'
      | 'description'
      | 'startupCommand'
      | 'port'
      | 'memoryLimitMb'
      | 'cpuLimitPercent'
      | 'autoRestart'
    >
  >
): Promise<ServerConfig> {
  return withWriteLock(() => {
    const db = readDbSync();
    const idx = db.servers.findIndex((s) => s.id === serverId);
    if (idx === -1) {
      throw new Error('Server tidak ditemukan.');
    }
    const updated: ServerConfig = {
      ...db.servers[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    db.servers[idx] = updated;
    writeDbSync(db);
    return updated;
  });
}

export async function deleteServerRecord(serverId: string): Promise<void> {
  return withWriteLock(() => {
    const db = readDbSync();
    db.servers = db.servers.filter((s) => s.id !== serverId);
    writeDbSync(db);

    const dir = getServerDirectory(serverId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
