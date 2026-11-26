import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { getServerDirectory } from './db';
import { isEditableTextFile } from './file-types';
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
    throw new Error(`Entrypoint file "${relPath}" was not found in this server directory.`);
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error(`Target "${relPath}" is not an executable file.`);
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
        `Python module "${moduleName}" was not found in this server directory.`
      );
    }
    return;
  }

  const ignoredSubcommands = new Set(['run', 'dev', 'worker', 'beat', 'flower']);
  const candidateTargets: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '-m') {
      i += 1;
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
        `Python application target "${target}" was not found in this server directory.`
      );
    }
  }
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

export function updateServerDotEnvPort(serverId: string, port: number): void {
  const baseDir = ensureServerDir(serverId);
  const envPath = resolveSafePath(baseDir, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  assertRealContainment(baseDir, envPath);
  const raw = fs.readFileSync(envPath, 'utf8');
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (/^\s*PORT\s*=/.test(line)) {
      replaced = true;
      return `PORT=${port}`;
    }
    return line;
  });
  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.splice(nextLines.length - 1, 0, `PORT=${port}`);
    } else {
      nextLines.push(`PORT=${port}`);
    }
  }
  fs.writeFileSync(envPath, nextLines.join('\n'), 'utf8');
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
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '__pycache__' ||
      entry.name === '.venv' ||
      entry.name === '.py_packages'
    ) {
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
    let entryStat: fs.Stats;
    try {
      entryStat = fs.statSync(fullPath);
    } catch {
      try {
        entryStat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
    }
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
  if (!isEditableTextFile(relPath)) {
    throw new Error('Format file ini bukan teks (arsip/foto/biner) dan tidak dapat diedit.');
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error('Ukuran file melebihi batas editor (2 MB).');
  }

  const buf = fs.readFileSync(target);
  const sampleLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sampleLen; i += 1) {
    if (buf[i] === 0) {
      throw new Error('File biner tidak dapat diedit sebagai teks.');
    }
  }

  return {
    content: buf.toString('utf8'),
    size: stat.size,
  };
}

export function writeServerFile(
  serverId: string,
  relPath: string,
  content: string,
  encoding: 'utf8' | 'base64' = 'utf8'
): void {
  const baseDir = ensureServerDir(serverId);
  const target = resolveSafePath(baseDir, relPath);
  assertRealContainment(baseDir, target);

  const parent = path.dirname(target);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  if (encoding === 'base64') {
    fs.writeFileSync(target, Buffer.from(content, 'base64'));
  } else {
    fs.writeFileSync(target, content, 'utf8');
  }
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
  if (
    !oldRelPath ||
    oldRelPath === '/' ||
    oldRelPath === '.' ||
    !newRelPath ||
    newRelPath === '/' ||
    newRelPath === '.'
  ) {
    throw new Error('Path asal dan nama baru wajib diisi.');
  }
  const oldTarget = resolveSafePath(baseDir, oldRelPath);
  const newTarget = resolveSafePath(baseDir, newRelPath);
  assertRealContainment(baseDir, oldTarget);
  assertRealContainment(baseDir, newTarget);

  if (!fs.existsSync(oldTarget)) {
    throw new Error('File asal tidak ditemukan.');
  }
  if (oldTarget === newTarget) {
    return;
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
  const entries = zip.getEntries();

  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (!entryName || entryName === '.' || entryName === './') continue;

    const destPath = resolveSafePath(parentDir, entryName);
    resolveSafePath(baseDir, path.relative(baseDir, destPath));
    assertRealContainment(baseDir, destPath);

    if (entry.isDirectory) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      continue;
    }

    const destParent = path.dirname(destPath);
    if (!fs.existsSync(destParent)) {
      fs.mkdirSync(destParent, { recursive: true });
    }
    fs.writeFileSync(destPath, entry.getData());
  }
}

export function moveServerEntry(serverId: string, oldRelPath: string, newRelPath: string): void {
  const baseDir = ensureServerDir(serverId);
  if (!oldRelPath || oldRelPath === '/' || oldRelPath === '.') {
    throw new Error('Tidak dapat memindahkan direktori root server.');
  }
  const oldTarget = resolveSafePath(baseDir, oldRelPath);
  const newTarget = resolveSafePath(baseDir, newRelPath);
  assertRealContainment(baseDir, oldTarget);
  assertRealContainment(baseDir, newTarget);

  if (!fs.existsSync(oldTarget)) {
    throw new Error('Sumber file/folder tidak ditemukan.');
  }
  if (oldTarget === newTarget) {
    throw new Error('Path tujuan sama dengan path asal.');
  }
  if (newTarget.startsWith(oldTarget + path.sep)) {
    throw new Error('Tidak dapat memindahkan folder ke dalam dirinya sendiri.');
  }
  if (fs.existsSync(newTarget)) {
    throw new Error('Nama atau path tujuan sudah ada.');
  }

  const parent = path.dirname(newTarget);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.renameSync(oldTarget, newTarget);
}

export function archiveServerEntries(
  serverId: string,
  relPaths: string[],
  currentDir = ''
): string {
  const baseDir = ensureServerDir(serverId);
  const cleanPaths = Array.from(
    new Set(relPaths.map((p) => p.trim()).filter((p) => p && p !== '/' && p !== '.'))
  );
  if (cleanPaths.length === 0) {
    throw new Error('Pilih minimal satu file atau folder untuk diarsipkan.');
  }

  const targetDir = resolveSafePath(baseDir, currentDir);
  assertRealContainment(baseDir, targetDir);

  const zip = new AdmZip();

  for (const relPath of cleanPaths) {
    const absPath = resolveSafePath(baseDir, relPath);
    assertRealContainment(baseDir, absPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Item "${relPath}" tidak ditemukan.`);
    }
    const stat = fs.statSync(absPath);
    const entryBaseName = path.basename(absPath);
    if (stat.isDirectory()) {
      zip.addLocalFolder(absPath, entryBaseName);
    } else {
      zip.addLocalFile(absPath, '');
    }
  }

  const baseLabel =
    cleanPaths.length === 1
      ? path.basename(cleanPaths[0]).replace(/\.zip$/i, '') || 'archive'
      : `archive-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  let candidateName = `${baseLabel}.zip`;
  let counter = 1;
  while (fs.existsSync(resolveSafePath(targetDir, candidateName))) {
    candidateName = `${baseLabel}-${counter}.zip`;
    counter += 1;
  }

  const outRelPath = currentDir
    ? `${currentDir.replace(/\/+$/, '')}/${candidateName}`
    : candidateName;
  const outAbsPath = resolveSafePath(baseDir, outRelPath);
  assertRealContainment(baseDir, outAbsPath);
  zip.writeZip(outAbsPath);
  return outRelPath;
}
