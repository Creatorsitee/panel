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

  const positionalNodeArgs = args.filter((a) => !a.startsWith('-'));
  const scriptArg =
    executable === 'tsx' && positionalNodeArgs[0] === 'watch'
      ? positionalNodeArgs[1] || null
      : positionalNodeArgs[0] || null;
  if (!scriptArg) {
    throw new Error(`Tentukan file script di direktori server (mis. ${executable} index.js).`);
  }

  return { executable, args, scriptArg, pythonModule: null, npmScriptName: null };
}

export function isValidEnvKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

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

export function allocateNextPort(usedPorts: number[], startPort = 4001, maxPort = 4999): number {
  const used = new Set(usedPorts);
  for (let port = startPort; port <= maxPort; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  throw new Error('Tidak ada port yang tersedia pada rentang alokasi.');
}

export function validateServerPort(
  portInput: unknown,
  usedPorts: number[],
  panelPort = Number(process.env.PORT) || 3000
): number {
  const parsed = Number(portInput);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error('Port internal harus berupa angka bulat antara 1024 hingga 65535.');
  }
  if (parsed === panelPort) {
    throw new Error(`Port ${parsed} sedang digunakan oleh panel cmnty.`);
  }
  if (usedPorts.includes(parsed)) {
    throw new Error(`Port ${parsed} sudah digunakan oleh server lain.`);
  }
  return parsed;
}

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

const CONSOLE_PIP_BINARIES = new Set(['pip', 'pip3']);
const ALL_CONSOLE_RUNTIME_BINARIES = new Set([
  ...ALL_ALLOWED_BINARIES,
  ...CONSOLE_PIP_BINARIES,
]);

const FORBIDDEN_CONSOLE_SHELL_CHARS = /[;|`$><\r\n\0]/;
const ALLOWED_NPM_CONSOLE_SUBCOMMANDS = new Set([
  'install',
  'i',
  'add',
  'uninstall',
  'remove',
  'rm',
  'un',
  'update',
  'up',
  'ci',
  'list',
  'ls',
  'outdated',
  'run',
  'start',
  'test',
  'init',
  'pkg',
  'view',
  'info',
  'audit',
  'version',
  'exec',
  'prune',
  'dedupe',
  'rebuild',
]);
const ALLOWED_PIP_CONSOLE_SUBCOMMANDS = new Set([
  'install',
  'uninstall',
  'list',
  'show',
  'freeze',
  'check',
]);

export interface ParsedConsoleRuntimeCommand {
  executable: string;
  args: string[];
  kind: 'nodejs' | 'python' | 'pip';
  isMutating: boolean;
}

export function splitChainedConsoleCommands(command: string): string[] {
  const trimmed = (command || '').trim();
  if (!trimmed) return [];
  if (FORBIDDEN_CONSOLE_SHELL_CHARS.test(trimmed)) {
    throw new Error('Operator shell (;|`$><) tidak diizinkan di console container.');
  }

  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < trimmed.length) {
        current += ch + trimmed[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '&') {
      if (trimmed[i + 1] === '&') {
        const seg = current.trim();
        if (!seg) {
          throw new Error('Sintaks operator "&&" tidak valid.');
        }
        segments.push(seg);
        current = '';
        i += 1;
        continue;
      }
      throw new Error('Operator background "&" tidak didukung. Gunakan "&&" untuk merangkai perintah.');
    }

    current += ch;
  }

  if (quote) {
    throw new Error('Tanda kutip pada perintah tidak seimbang.');
  }

  const tail = current.trim();
  if (!tail) {
    throw new Error('Sintaks operator "&&" tidak lengkap.');
  }
  segments.push(tail);
  return segments;
}

export function tokenizeConsoleCommand(segment: string): string[] {
  const trimmed = (segment || '').trim();
  if (!trimmed) return [];
  if (FORBIDDEN_CONSOLE_SHELL_CHARS.test(trimmed)) {
    throw new Error('Operator shell (;|`$><) tidak diizinkan.');
  }

  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < trimmed.length) {
        current += trimmed[i + 1];
        i += 1;
        hasToken = true;
      } else if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }

  if (quote) {
    throw new Error('Tanda kutip pada perintah tidak seimbang.');
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

export function assertSafeConsolePathArg(arg: string): void {
  if (!arg) return;
  if (arg === '~' || arg.startsWith('~/')) {
    throw new Error(`Path "${arg}" berada di luar direktori container.`);
  }
  if (arg.startsWith('/home/container/') || arg === '/home/container') {
    return;
  }
  assertRelativeWorkspaceArg(arg);
}

export function parseSafeConsoleRuntimeCommand(tokens: string[]): ParsedConsoleRuntimeCommand | null {
  if (tokens.length === 0) return null;
  const rawExec = tokens[0];
  if (rawExec.includes('/') || rawExec.includes('\\')) {
    throw new Error('Gunakan nama binary langsung (mis. npm, node, python3, pip), bukan path.');
  }

  const executable = path.basename(rawExec);
  if (!ALL_CONSOLE_RUNTIME_BINARIES.has(executable)) {
    return null;
  }

  const args = tokens.slice(1);

  for (const arg of args) {
    if (arg.startsWith('-')) {
      const eqIdx = arg.indexOf('=');
      const flagName = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
      const flagVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : '';

      if (NODE_ALLOWED_BINARIES.has(executable) && FORBIDDEN_NODE_FLAGS.has(flagName)) {
        throw new Error(`Flag "${flagName}" tidak diizinkan di console.`);
      }
      if (executable === 'npx' && FORBIDDEN_NPX_FLAGS.has(flagName)) {
        throw new Error(`Flag "${flagName}" tidak diizinkan pada npx.`);
      }
      if (PYTHON_DIRECT_BINARIES.has(executable) && FORBIDDEN_PYTHON_FLAGS.has(flagName)) {
        throw new Error(`Flag "${flagName}" tidak diizinkan di console.`);
      }
      if (executable === 'npm' && (flagName === '-g' || flagName === '--global' || flagName === '--prefix')) {
        throw new Error(`Flag "${flagName}" tidak diizinkan; instalasi hanya berlaku di direktori server ini.`);
      }
      if (CONSOLE_PIP_BINARIES.has(executable) && (flagName === '--root' || flagName === '--prefix' || flagName === '--user')) {
        throw new Error(`Flag "${flagName}" tidak diizinkan pada ${executable}.`);
      }
      if (flagVal) {
        assertRelativeWorkspaceArg(flagVal);
      }
    } else {
      assertRelativeWorkspaceArg(arg);
    }
  }

  if (executable === 'npm') {
    if (args.length === 0) {
      throw new Error('Sertakan subcommand npm (mis. npm install <paket>, npm list, npm -v).');
    }
    const first = args[0];
    const isMetaFlag = first === '-v' || first === '--version' || first === '-h' || first === '--help';
    if (!isMetaFlag && !ALLOWED_NPM_CONSOLE_SUBCOMMANDS.has(first)) {
      throw new Error(`Subcommand npm "${first}" tidak didukung di console.`);
    }
    const mutatingSet = new Set(['install', 'i', 'add', 'uninstall', 'remove', 'rm', 'un', 'update', 'up', 'ci', 'init', 'prune', 'dedupe', 'rebuild']);
    return {
      executable,
      args,
      kind: 'nodejs',
      isMutating: mutatingSet.has(first),
    };
  }

  if (CONSOLE_PIP_BINARIES.has(executable)) {
    if (args.length === 0) {
      throw new Error(`Sertakan subcommand ${executable} (mis. ${executable} install <paket>, ${executable} list).`);
    }
    const first = args[0];
    const isMetaFlag = first === '-V' || first === '--version' || first === '-h' || first === '--help';
    if (!isMetaFlag && !ALLOWED_PIP_CONSOLE_SUBCOMMANDS.has(first)) {
      throw new Error(`Subcommand ${executable} "${first}" tidak didukung di console.`);
    }
    return {
      executable,
      args,
      kind: 'pip',
      isMutating: first === 'install' || first === 'uninstall',
    };
  }

  if (PYTHON_ALLOWED_BINARIES.has(executable)) {
    const mIdx = args.indexOf('-m');
    const isPipModule = mIdx !== -1 && args[mIdx + 1] === 'pip';
    return {
      executable,
      args,
      kind: isPipModule ? 'pip' : 'python',
      isMutating: isPipModule && (args.includes('install') || args.includes('uninstall')),
    };
  }

  return {
    executable,
    args,
    kind: 'nodejs',
    isMutating: false,
  };
}

