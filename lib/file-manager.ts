import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { getServerDirectory } from './db';
import { parseDotEnvContent, resolveSafePath } from './security';
import type { FileEntry } from './types';

function assertRealContainment(baseDir: string, targetPath: string): void {
  const realBase = fs.realpathSync(baseDir);
  if (fs.existsSync(targetPath)) {
    const realTarget = fs.realpathSync(targetPath);
    if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
      throw new Error('Symlink mengarah ke luar direktori server.');
    }
  }
}

export function ensureServerDir(serverId: string): string {
  const dir = getServerDirectory(serverId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function verifyServerScriptFile(serverId: string, relPath: string): string {
  const baseDir = ensureServerDir(serverId);
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  if (!fs.existsSync(target)) {
    throw new Error(`File script "${relPath}" tidak ditemukan di direktori server ini.`);
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error(`Target "${relPath}" bukan file yang dapat dijalankan.`);
  }
  return target;
}

const KNOWN_PYTHON_RUNNERS = new Set([
  'uvicorn',
  'gunicorn',
  'flask',
  'fastapi',
  'celery',
  'hypercorn',
  'streamlit',
  'aiohttp.web',
  'pytest',
]);

function resolvePythonModuleOrTarget(baseDir: string, spec: string): boolean {
  const withoutAttr = spec.split(':')[0];
  const candidates = withoutAttr.endsWith('.py')
    ? [withoutAttr]
    : [
        `${withoutAttr.replace(/\./g, '/')}.py`,
        `${withoutAttr.replace(/\./g, '/')}/__main__.py`,
        `${withoutAttr.replace(/\./g, '/')}/__init__.py`,
        withoutAttr,
      ];

  for (const rel of candidates) {
    const resolved = resolveSafePath(baseDir, rel);
    assertRealContainment(baseDir, resolved);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return true;
    }
  }
  return false;
}

export function verifyServerPythonModule(
  serverId: string,
  moduleName: string,
  args: string[]
): void {
  const baseDir = ensureServerDir(serverId);

  if (!KNOWN_PYTHON_RUNNERS.has(moduleName)) {
    if (!resolvePythonModuleOrTarget(baseDir, moduleName)) {
      throw new Error(
        `Modul Python "${moduleName}" tidak ditemukan di direktori server ini.`
      );
    }
    return;
  }

  // Known runner (uvicorn, gunicorn, flask, fastapi, celery, streamlit, pytest, etc.)
  const ignoredSubcommands = new Set(['run', 'dev', 'worker', 'beat', 'flower']);
  const candidateTargets: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '-m') {
      i += 1; // skip moduleName itself
      continue;
    }
    if ((token === '--app' || token === '-A') && args[i + 1]) {
      candidateTargets.push(args[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith('--app=')) {
      candidateTargets.push(token.slice(6));
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    if (ignoredSubcommands.has(token) || token === moduleName) {
      continue;
    }
    if (token.includes(':') || token.endsWith('.py')) {
      candidateTargets.push(token);
    }
  }

  for (const target of candidateTargets) {
    if (!resolvePythonModuleOrTarget(baseDir, target)) {
      throw new Error(
        `Target aplikasi Python "${target}" tidak ditemukan di direktori server ini.`
      );
    }
  }
}

export function writeInitialDotEnv(serverId: string, env: Record<string, string>): void {
  const baseDir = ensureServerDir(serverId);
  const envPath = resolveSafePath(baseDir, '.env');
  if (fs.existsSync(envPath)) return;
  const lines = Object.entries(env).map(([k, v]) => {
    const escaped = String(v).replace(/\r?\n/g, '\\n');
    return `${k}=${escaped}`;
  });
  fs.writeFileSync(envPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

export function readServerDotEnv(serverId: string): Record<string, string> {
  const baseDir = ensureServerDir(serverId);
  const envPath = resolveSafePath(baseDir, '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }
  assertRealContainment(baseDir, envPath);
  const content = fs.readFileSync(envPath, 'utf8');
  return parseDotEnvContent(content);
}

export function listServerFiles(serverId: string, relDir = ''): FileEntry[] {
  const baseDir = ensureServerDir(serverId);
  const targetDir = resolveSafePath(baseDir, relDir);
  assertRealContainment(baseDir, targetDir);

  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error('Path bukan direktori.');
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const results: FileEntry[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__' || entry.name === '.venv') {
      results.push({
        name: entry.name,
        path: relDir ? `${relDir.replace(/\/+$/, '')}/${entry.name}` : entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: 0,
        updatedAt: new Date().toISOString(),
      });
      continue;
    }

    const fullPath = path.join(targetDir, entry.name);
    const entryStat = fs.statSync(fullPath);
    const relPath = relDir ? `${relDir.replace(/\/+$/, '')}/${entry.name}` : entry.name;

    results.push({
      name: entry.name,
      path: relPath,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isDirectory() ? 0 : entryStat.size,
      updatedAt: entryStat.mtime.toISOString(),
    });
  }

  return results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function readServerFile(serverId: string, relPath: string): { content: string; size: number } {
  const baseDir = ensureServerDir(serverId);
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  if (!fs.existsSync(target)) {
    throw new Error('File tidak ditemukan.');
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    throw new Error('Tidak dapat membaca direktori sebagai file teks.');
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error('Ukuran file melebihi batas editor (2 MB).');
  }

  return {
    content: fs.readFileSync(target, 'utf8'),
    size: stat.size,
  };
}

export function writeServerFile(serverId: string, relPath: string, content: string): void {
  const baseDir = ensureServerDir(serverId);
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  const parent = path.dirname(target);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(target, content, 'utf8');
}

export function createServerEntry(serverId: string, relPath: string, type: 'file' | 'directory'): void {
  const baseDir = ensureServerDir(serverId);
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  if (fs.existsSync(target)) {
    throw new Error('File atau folder sudah ada.');
  }

  if (type === 'directory') {
    fs.mkdirSync(target, { recursive: true });
  } else {
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(target, '', 'utf8');
  }
}

export function deleteServerEntry(serverId: string, relPath: string): void {
  const baseDir = ensureServerDir(serverId);
  if (!relPath || relPath === '/' || relPath === '.') {
    throw new Error('Tidak dapat menghapus direktori root server.');
  }
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  if (!fs.existsSync(target)) {
    throw new Error('Target tidak ditemukan.');
  }

  fs.rmSync(target, { recursive: true, force: true });
}

export function renameServerEntry(serverId: string, oldRelPath: string, newRelPath: string): void {
  const baseDir = ensureServerDir(serverId);
  const oldTarget = resolveSafePath(baseDir, oldRelPath);
  const newTarget = resolveSafePath(baseDir, newRelPath);
  assertRealContainment(baseDir, oldTarget);
  assertRealContainment(baseDir, newTarget);

  if (!fs.existsSync(oldTarget)) {
    throw new Error('File asal tidak ditemukan.');
  }
  if (fs.existsSync(newTarget)) {
    throw new Error('Nama tujuan sudah digunakan.');
  }

  const parent = path.dirname(newTarget);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.renameSync(oldTarget, newTarget);
}

export function extractZipFile(serverId: string, relPath: string): void {
  const baseDir = ensureServerDir(serverId);
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  if (!fs.existsSync(target)) {
    throw new Error('File ZIP tidak ditemukan.');
  }

  const zip = new AdmZip(target);
  const parentDir = path.dirname(target);
  zip.extractAllTo(parentDir, true);
}

export function moveServerEntry(serverId: string, oldRelPath: string, newRelPath: string): void {
  const baseDir = ensureServerDir(serverId);
  const oldTarget = resolveSafePath(baseDir, oldRelPath);
  const newTarget = resolveSafePath(baseDir, newRelPath);
  assertRealContainment(baseDir, oldTarget);
  assertRealContainment(baseDir, newTarget);

  if (!fs.existsSync(oldTarget)) {
    throw new Error('Sumber file/folder tidak ditemukan.');
  }
  const parent = path.dirname(newTarget);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.renameSync(oldTarget, newTarget);
}
