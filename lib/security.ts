import path from 'node:path';
import type { ServerRuntime } from './types';

const NODE_ALLOWED_BINARIES = new Set(['node', 'npm', 'npx', 'tsx', 'ts-node', 'nodemon']);
const PYTHON_DIRECT_BINARIES = new Set(['python3', 'python']);
const PYTHON_RUNNER_BINARIES = new Set([
  'uvicorn',
  'gunicorn',
  'flask',
  'fastapi',
  'celery',
  'hypercorn',
  'streamlit',
  'pytest',
]);
const PYTHON_ALLOWED_BINARIES = new Set([
  ...PYTHON_DIRECT_BINARIES,
  ...PYTHON_RUNNER_BINARIES,
]);
const ALL_ALLOWED_BINARIES = new Set([...NODE_ALLOWED_BINARIES, ...PYTHON_ALLOWED_BINARIES]);

const FORBIDDEN_SHELL_TOKENS = /[;&|`$><\r\n\0]/;

const FORBIDDEN_NODE_FLAGS = new Set([
  '-e',
  '--eval',
  '-p',
  '--print',
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--input-type',
  '-c',
  '--check',
]);

const FORBIDDEN_NPX_FLAGS = new Set(['-c', '--call']);
const FORBIDDEN_PYTHON_FLAGS = new Set(['-c']);

const PYTHON_FLAGS_WITH_VALUE = new Set(['-W', '-X', '-Q', '-b']);

export interface ParsedCommand {
  executable: string;
  args: string[];
  scriptArg: string | null;
  pythonModule: string | null;
  npmScriptName: string | null;
}

/**
 * Resolves a relative user path inside a base directory and rejects path traversal.
 */
export function resolveSafePath(baseDir: string, relativePath: string): string {
  const normalizedBase = path.resolve(baseDir);
  const cleaned = (relativePath || '').replace(/^\/+/, '');
  const target = path.resolve(normalizedBase, cleaned);

  if (target !== normalizedBase && !target.startsWith(normalizedBase + path.sep)) {
    throw new Error('Akses path di luar direktori server ditolak.');
  }

  return target;
}

function assertRelativeWorkspaceArg(arg: string): void {
  if (!arg) return;
  if (arg.startsWith('/') || arg.startsWith('\\') || arg.startsWith('~')) {
    throw new Error(`Path absolut "${arg}" tidak diizinkan. Gunakan file di dalam direktori server ini.`);
  }
  const normalized = arg.replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../') || normalized.endsWith('/..')) {
    throw new Error(`Path traversal "${arg}" ditolak. Server hanya boleh menjalankan file di direktori sendiri.`);
  }
}

/**
 * Tokenizes a startup command cleanly without invoking a shell, enforces runtime matching,
 * blocks inline eval/shell escape flags, and prevents path traversal outside the server directory.
 */
export function parseSafeStartupCommand(command: string, expectedRuntime?: ServerRuntime): ParsedCommand {
  const trimmed = (command || '').trim();
  if (!trimmed) {
    throw new Error('Perintah startup tidak boleh kosong.');
  }
  if (FORBIDDEN_SHELL_TOKENS.test(trimmed)) {
    throw new Error('Perintah startup tidak boleh mengandung operator shell (;&|`$><).');
  }

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (quote) {
    throw new Error('Tanda kutip pada perintah startup tidak seimbang.');
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error('Perintah startup tidak valid.');
  }

  if (tokens[0].includes('/') || tokens[0].includes('\\')) {
    throw new Error('Gunakan nama binary langsung (mis. node, npm, python3, uvicorn), bukan path.');
  }

  const executable = path.basename(tokens[0]);
  if (!ALL_ALLOWED_BINARIES.has(executable)) {
    throw new Error(
      `Executable "${executable}" tidak diizinkan. Gunakan binary Node.js (node, npm, npx, tsx) atau Python (python3, python, uvicorn, gunicorn, flask, fastapi).`
    );
  }

  if (expectedRuntime === 'nodejs' && !NODE_ALLOWED_BINARIES.has(executable)) {
    throw new Error('Server Node.js hanya dapat menjalankan binary Node.js (node, npm, npx, tsx, ts-node, nodemon).');
  }
  if (expectedRuntime === 'python' && !PYTHON_ALLOWED_BINARIES.has(executable)) {
    throw new Error('Server Python hanya dapat menjalankan binary Python (python3, python, uvicorn, gunicorn, flask, fastapi, celery, hypercorn, streamlit, pytest).');
  }

  const args = tokens.slice(1);
  if (args.length === 0 && executable !== 'pytest') {
    throw new Error('Sertakan file script, modul, atau subcommand (mis. node index.js atau python3 main.py).');
  }

  for (const arg of args) {
    if (arg.startsWith('-')) {
      const flagName = arg.split('=')[0];
      const flagVal = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : '';
      if (NODE_ALLOWED_BINARIES.has(executable) && FORBIDDEN_NODE_FLAGS.has(flagName)) {
        throw new Error(`Flag "${flagName}" tidak diizinkan pada perintah startup. Gunakan file script di server ini.`);
      }
      if (executable === 'npx' && FORBIDDEN_NPX_FLAGS.has(flagName)) {
        throw new Error(`Flag "${flagName}" tidak diizinkan pada npx.`);
      }
      if (PYTHON_ALLOWED_BINARIES.has(executable) && FORBIDDEN_PYTHON_FLAGS.has(flagName)) {
        throw new Error(`Flag "${flagName}" tidak diizinkan pada perintah startup. Gunakan file script di server ini.`);
      }
      if (flagVal) {
        assertRelativeWorkspaceArg(flagVal);
      }
    } else {
      assertRelativeWorkspaceArg(arg);
    }
  }

  if (executable === 'npm') {
    if (args[0] === 'start' && (args.length === 1 || args[1] === '--')) {
      return { executable, args, scriptArg: null, pythonModule: null, npmScriptName: 'start' };
    }
    if (args[0] === 'test' && (args.length === 1 || args[1] === '--')) {
      return { executable, args, scriptArg: null, pythonModule: null, npmScriptName: 'test' };
    }
    if (
      args[0] === 'run' &&
      args.length >= 2 &&
      /^[a-zA-Z0-9:_-]+$/.test(args[1]) &&
      (args.length === 2 || args[2] === '--')
    ) {
      return { executable, args, scriptArg: null, pythonModule: null, npmScriptName: args[1] };
    }
    throw new Error('Untuk npm, gunakan "npm start", "npm test", atau "npm run <script>".');
  }

  if (executable === 'npx') {
    const positionalArgs = args.filter((a) => !a.startsWith('-'));
    if (positionalArgs.length === 0) {
      throw new Error('Sertakan tool/script untuk npx (mis. npx tsx src/index.ts).');
    }
    const runnerTool = positionalArgs[0];
    if (!/^[a-zA-Z0-9@._/-]+$/.test(runnerTool)) {
      throw new Error('Nama tool npx tidak valid.');
    }
    const maybeFile = positionalArgs.slice(1).find((a) => /\.(m|c)?(j|t)sx?$/i.test(a)) || null;
    return { executable, args, scriptArg: maybeFile, pythonModule: null, npmScriptName: null };
  }

  if (PYTHON_DIRECT_BINARIES.has(executable)) {
    const mIdx = args.indexOf('-m');
    if (mIdx !== -1) {
      const moduleName = args[mIdx + 1];
      if (!moduleName || !/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(moduleName)) {
        throw new Error('Nama modul Python setelah -m tidak valid (mis. python3 -m uvicorn main:app atau python3 -m app).');
      }
      const trailingPositional = args.slice(mIdx + 2).find((a) => !a.startsWith('-')) || null;
      return {
        executable,
        args,
        scriptArg: trailingPositional,
        pythonModule: moduleName,
        npmScriptName: null,
      };
    }

    let scriptArg: string | null = null;
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (a.startsWith('-')) {
        if (PYTHON_FLAGS_WITH_VALUE.has(a)) {
          i += 1;
        }
        continue;
      }
      scriptArg = a;
      break;
    }

    if (!scriptArg) {
      throw new Error('Tentukan nama file script atau modul di direktori server (mis. python3 main.py atau python3 -m app).');
    }

    return { executable, args, scriptArg, pythonModule: null, npmScriptName: null };
  }

  if (PYTHON_RUNNER_BINARIES.has(executable)) {
    const firstTarget = args.find((a) => !a.startsWith('-')) || null;
    return {
      executable,
      args,
      scriptArg: firstTarget,
      pythonModule: executable,
      npmScriptName: null,
    };
  }

  // Remaining Node binaries: node, tsx, ts-node, nodemon
  const scriptArg = args.find((a) => !a.startsWith('-')) || null;
  if (!scriptArg) {
    throw new Error(`Tentukan file script di direktori server (mis. ${executable} index.js).`);
  }

  return { executable, args, scriptArg, pythonModule: null, npmScriptName: null };
}

/**
 * Validates environment variable keys.
 */
export function isValidEnvKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

/**
 * Parses a .env file from disk safely, skipping comments and reserved process variables.
 */
export function parseDotEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!isValidEnvKey(key)) continue;
    if (key === 'PATH' || key === 'HOME' || key === 'LD_PRELOAD' || key === 'LD_LIBRARY_PATH' || key === 'PYTHONPATH') {
      continue;
    }
    let val = trimmed.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * Allocates the next available TCP port for a server.
 */
export function allocateNextPort(usedPorts: number[], startPort = 4001, maxPort = 4999): number {
  const used = new Set(usedPorts);
  for (let port = startPort; port <= maxPort; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  throw new Error('Tidak ada port yang tersedia pada rentang alokasi.');
}

/**
 * Validates email and server name inputs.
 */
export function validateEmail(email: string): string {
  const normalized = (email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 120) {
    throw new Error('Format email tidak valid.');
  }
  return normalized;
}

export function validateServerName(name: string): string {
  const trimmed = (name || '').trim();
  if (trimmed.length < 2 || trimmed.length > 48) {
    throw new Error('Nama server harus antara 2 hingga 48 karakter.');
  }
  if (!/^[a-zA-Z0-9 _.-]+$/.test(trimmed)) {
    throw new Error('Nama server hanya boleh berisi huruf, angka, spasi, titik, strip, atau underscore.');
  }
  return trimmed;
}
