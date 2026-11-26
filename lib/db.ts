import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth';
import { emitWorkspaceChanged } from './events';
import type { ServerConfig, UserRecord, UserRole } from './types';

interface DatabaseState {
  users: UserRecord[];
  servers: ServerConfig[];
}

export const DATA_ROOT = process.env.PANEL_DATA_DIR?.trim()
  ? path.resolve(process.env.PANEL_DATA_DIR.trim())
  : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_ROOT, 'panel-db.json');
export const SERVERS_ROOT = path.join(DATA_ROOT, 'servers');

const globalForDb = globalThis as unknown as {
  __nodalDbLock?: Promise<void>;
  __cmntyEnvAdminSig?: string;
};

function readEnvAdminConfig(): { name: string; email: string; password: string } | null {
  const email = (process.env.ADMIN_EMAIL ?? process.env.admin_email ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? process.env.admin_password ?? '';
  const rawName = (process.env.ADMIN_USER ?? process.env.admin_user ?? '').trim();

  if (!email || !password) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  if (password.length < 6 || password.length > 128) {
    return null;
  }
  const name = rawName.length >= 2 && rawName.length <= 60 ? rawName : 'Admin';
  return { name, email, password };
}

function syncEnvAdminOnState(state: DatabaseState): void {
  const cfg = readEnvAdminConfig();
  if (!cfg) {
    globalForDb.__cmntyEnvAdminSig = undefined;
    return;
  }

  const sig = crypto
    .createHash('sha256')
    .update(`${DATA_ROOT}|${cfg.name}|${cfg.email}|${cfg.password}`)
    .digest('hex');

  const existingIdx = state.users.findIndex(
    (u) => u.email.toLowerCase() === cfg.email
  );

  if (globalForDb.__cmntyEnvAdminSig === sig && existingIdx !== -1) {
    return;
  }

  let dirty = false;
  if (existingIdx === -1) {
    state.users.push({
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      name: cfg.name,
      email: cfg.email,
      passwordHash: hashPassword(cfg.password),
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    dirty = true;
  } else {
    const existing = state.users[existingIdx];
    const needsRole = existing.role !== 'admin';
    const needsName = existing.name !== cfg.name;
    const needsPassword = !verifyPassword(cfg.password, existing.passwordHash);
    if (needsRole || needsName || needsPassword) {
      state.users[existingIdx] = {
        ...existing,
        name: cfg.name,
        role: 'admin',
        passwordHash: needsPassword ? hashPassword(cfg.password) : existing.passwordHash,
      };
      dirty = true;
    }
  }

  if (dirty) {
    writeDbSync(state);
  }
  globalForDb.__cmntyEnvAdminSig = sig;
}

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
    const initial: DatabaseState = { users: [], servers: [] };
    writeDbSync(initial);
    syncEnvAdminOnState(initial);
    return initial;
  }

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DatabaseState>;
    const state: DatabaseState = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
    };
    syncEnvAdminOnState(state);
    return state;
  } catch {
    const fallback: DatabaseState = { users: [], servers: [] };
    syncEnvAdminOnState(fallback);
    return fallback;
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

export function listAllUsers(): UserRecord[] {
  return readDbSync().users;
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
    emitWorkspaceChanged('user:create');
    return user;
  });
}

export async function createUserByAdmin(input: {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}): Promise<UserRecord> {
  return withWriteLock(() => {
    const db = readDbSync();
    if (db.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error('Email sudah terdaftar.');
    }

    const user: UserRecord = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    writeDbSync(db);
    emitWorkspaceChanged('user:create');
    return user;
  });
}

export async function updateUserRecord(
  userId: string,
  patch: Partial<Pick<UserRecord, 'name' | 'email' | 'role' | 'passwordHash'>>
): Promise<UserRecord> {
  return withWriteLock(() => {
    const db = readDbSync();
    const idx = db.users.findIndex((u) => u.id === userId);
    if (idx === -1) {
      throw new Error('User tidak ditemukan.');
    }

    if (patch.email) {
      const normalized = patch.email.toLowerCase();
      if (db.users.some((u) => u.id !== userId && u.email.toLowerCase() === normalized)) {
        throw new Error('Email sudah digunakan oleh akun lain.');
      }
    }

    const current = db.users[idx];
    if (current.role === 'admin' && patch.role === 'user') {
      const adminCount = db.users.filter((u) => u.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('Minimal harus ada satu admin aktif di sistem.');
      }
    }

    const updated: UserRecord = {
      ...current,
      ...patch,
      email: patch.email ? patch.email.toLowerCase() : current.email,
    };
    db.users[idx] = updated;
    writeDbSync(db);
    emitWorkspaceChanged('user:update');
    return updated;
  });
}

export async function deleteUserRecord(userId: string): Promise<void> {
  return withWriteLock(() => {
    const db = readDbSync();
    const target = db.users.find((u) => u.id === userId);
    if (!target) {
      throw new Error('User tidak ditemukan.');
    }
    if (target.role === 'admin') {
      const adminCount = db.users.filter((u) => u.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('Tidak dapat menghapus satu-satunya akun admin.');
      }
    }
    db.users = db.users.filter((u) => u.id !== userId);
    writeDbSync(db);
    emitWorkspaceChanged('user:delete');
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
    let generatedId = crypto.randomBytes(4).toString('hex');
    while (db.servers.some((s) => s.id === generatedId)) {
      generatedId = crypto.randomBytes(4).toString('hex');
    }
    const server: ServerConfig = {
      ...config,
      id: generatedId,
      createdAt: now,
      updatedAt: now,
    };
    db.servers.push(server);
    writeDbSync(db);

    const dir = getServerDirectory(server.id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    emitWorkspaceChanged('server:create');
    return server;
  });
}

export async function updateServerRecord(
  serverId: string,
  patch: Partial<
    Pick<
      ServerConfig,
      | 'ownerId'
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
    emitWorkspaceChanged('server:update');
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
    emitWorkspaceChanged('server:delete');
  });
}
