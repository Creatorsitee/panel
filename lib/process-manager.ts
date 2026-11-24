import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getServerById, listAllServers } from './db';
import {
  ensureServerDir,
  readServerDotEnv,
  verifyServerPythonModule,
  verifyServerScriptFile,
} from './file-manager';
import { parseSafeStartupCommand } from './security';
import type { ConsoleLine, HostVpsInfo, ServerConfig, ServerRuntimeMetrics, ServerStatus } from './types';

interface ManagedProcess {
  serverId: string;
  status: ServerStatus;
  child: ChildProcessWithoutNullStreams | null;
  installChild: ChildProcessWithoutNullStreams | null;
  pid: number | null;
  startedAtMs: number | null;
  exitCode: number | null;
  manualStop: boolean;
  logs: ConsoleLine[];
  lastCpuJiffies?: number;
  lastSampleTimeMs?: number;
  cpuPercent: number;
  memoryMb: number;
}

const MAX_LOG_LINES = 400;

const globalForPm = globalThis as unknown as {
  __nodalProcesses?: Map<string, ManagedProcess>;
  __nodalEvents?: EventEmitter;
  __nodalSystemVersions?: { pythonVersion: string | null };
};

function getProcessMap(): Map<string, ManagedProcess> {
  if (!globalForPm.__nodalProcesses) {
    globalForPm.__nodalProcesses = new Map();
  }
  return globalForPm.__nodalProcesses;
}

function getEmitter(): EventEmitter {
  if (!globalForPm.__nodalEvents) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalForPm.__nodalEvents = emitter;
  }
  return globalForPm.__nodalEvents;
}

function getOrCreateState(serverId: string): ManagedProcess {
  const map = getProcessMap();
  let state = map.get(serverId);
  if (!state) {
    state = {
      serverId,
      status: 'stopped',
      child: null,
      installChild: null,
      pid: null,
      startedAtMs: null,
      exitCode: null,
      manualStop: false,
      logs: [],
      cpuPercent: 0,
      memoryMb: 0,
    };
    map.set(serverId, state);
  }
  return state;
}

function appendLog(serverId: string, stream: ConsoleLine['stream'], rawText: string): void {
  const state = getOrCreateState(serverId);
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === lines.length - 1 && line === '') continue;
    const entry: ConsoleLine = {
      id: crypto.randomBytes(4).toString('hex'),
      timestamp: new Date().toISOString(),
      stream,
      text: line,
    };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_LINES) {
      state.logs.shift();
    }
    getEmitter().emit(`log:${serverId}`, entry);
  }
}

function emitStatus(serverId: string): void {
  getEmitter().emit(`status:${serverId}`, getServerMetrics(serverId));
}

function collectProcessGroupPids(rootPid: number): number[] {
  const pids = new Set<number>([rootPid]);
  try {
    const procEntries = fs.readdirSync('/proc');
    for (const entry of procEntries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === rootPid) continue;
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen === -1) continue;
        const fields = stat.slice(closeParen + 2).split(' ');
        const ppid = Number(fields[1] || 0);
        const pgrp = Number(fields[2] || 0);
        if (pgrp === rootPid || ppid === rootPid) {
          pids.add(pid);
        }
      } catch {
        // process may have exited while scanning
      }
    }
  } catch {
    // fallback to rootPid only
  }
  return Array.from(pids);
}

function readLinuxProcStats(state: ManagedProcess): { cpuPercent: number; memoryMb: number } {
  if (!state.pid || state.status !== 'running') {
    return { cpuPercent: 0, memoryMb: 0 };
  }

  try {
    process.kill(state.pid, 0);
  } catch {
    state.status = 'stopped';
    state.pid = null;
    state.child = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    return { cpuPercent: 0, memoryMb: 0 };
  }

  const now = Date.now();
  if (state.lastSampleTimeMs !== undefined && now - state.lastSampleTimeMs < 800) {
    return { cpuPercent: state.cpuPercent, memoryMb: state.memoryMb };
  }

  try {
    const pids = collectProcessGroupPids(state.pid);
    let totalRssKb = 0;
    let hasRssSample = false;
    let totalJiffies = 0;
    let hasStatSample = false;

    for (const pid of pids) {
      try {
        const statusPath = `/proc/${pid}/status`;
        if (fs.existsSync(statusPath)) {
          const content = fs.readFileSync(statusPath, 'utf8');
          const match = /VmRSS:\s+(\d+)\s+kB/.exec(content);
          if (match) {
            totalRssKb += Number(match[1]);
            hasRssSample = true;
          }
        }
      } catch {
        // ignore transient pid exit
      }

      try {
        const statPath = `/proc/${pid}/stat`;
        if (fs.existsSync(statPath)) {
          const statContent = fs.readFileSync(statPath, 'utf8');
          const closeParen = statContent.lastIndexOf(')');
          if (closeParen !== -1) {
            const fields = statContent.slice(closeParen + 2).split(' ');
            const utime = Number(fields[11] || 0);
            const stime = Number(fields[12] || 0);
            totalJiffies += utime + stime;
            hasStatSample = true;
          }
        }
      } catch {
        // ignore transient pid exit
      }
    }

    const memoryMb = hasRssSample
      ? Number((totalRssKb / 1024).toFixed(1))
      : state.memoryMb;

    let cpuPercent = state.cpuPercent;
    if (hasStatSample) {
      if (state.lastCpuJiffies !== undefined && state.lastSampleTimeMs !== undefined) {
        const deltaMs = Math.max(100, now - state.lastSampleTimeMs);
        const deltaJiffies = Math.max(0, totalJiffies - state.lastCpuJiffies);
        const effectiveCores = detectEffectiveCpuCores(os.cpus().length);
        cpuPercent = Number(
          Math.min(100 * effectiveCores, ((deltaJiffies * 10) / deltaMs) * 100).toFixed(2)
        );
      }
      state.lastCpuJiffies = totalJiffies;
      state.lastSampleTimeMs = now;
    }

    state.cpuPercent = cpuPercent;
    state.memoryMb = memoryMb;

    const server = getServerById(state.serverId);
    if (server && memoryMb > server.memoryLimitMb && state.child) {
      state.manualStop = true;
      appendLog(
        state.serverId,
        'system',
        `Memori (${memoryMb} MB) melebihi batas ${server.memoryLimitMb} MB. Menghentikan proses...`
      );
      killProcessTree(state.child, 'SIGKILL');
    }

    return { cpuPercent, memoryMb };
  } catch {
    return { cpuPercent: state.cpuPercent, memoryMb: state.memoryMb };
  }
}

export function getServerMetrics(serverId: string): ServerRuntimeMetrics {
  const state = getOrCreateState(serverId);
  const { cpuPercent, memoryMb } = readLinuxProcStats(state);
  const uptimeSeconds =
    state.status === 'running' && state.startedAtMs
      ? Math.max(0, Math.floor((Date.now() - state.startedAtMs) / 1000))
      : 0;

  return {
    status: state.status,
    pid: state.pid,
    cpuPercent,
    memoryMb,
    uptimeSeconds,
    exitCode: state.exitCode,
    startedAt: state.startedAtMs ? new Date(state.startedAtMs).toISOString() : null,
  };
}

export function getConsoleHistory(serverId: string): ConsoleLine[] {
  return [...getOrCreateState(serverId).logs];
}

export function clearConsoleHistory(serverId: string): void {
  const state = getOrCreateState(serverId);
  state.logs = [];
  appendLog(serverId, 'system', 'Console dibersihkan.');
}

export function subscribeConsole(
  serverId: string,
  onLog: (line: ConsoleLine) => void,
  onStatus: (metrics: ServerRuntimeMetrics) => void
): () => void {
  const emitter = getEmitter();
  emitter.on(`log:${serverId}`, onLog);
  emitter.on(`status:${serverId}`, onStatus);
  return () => {
    emitter.off(`log:${serverId}`, onLog);
    emitter.off(`status:${serverId}`, onStatus);
  };
}

function buildSafeEnv(serverId: string): NodeJS.ProcessEnv {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error('Server tidak ditemukan.');
  }

  const cwd = ensureServerDir(serverId);
  const diskEnv = readServerDotEnv(serverId);
  const existingNodeOpts = diskEnv.NODE_OPTIONS ? `${diskEnv.NODE_OPTIONS} ` : '';
  const nodeOptions =
    server.runtime === 'nodejs' && !existingNodeOpts.includes('--max-old-space-size')
      ? `${existingNodeOpts}--max-old-space-size=${server.memoryLimitMb}`.trim()
      : diskEnv.NODE_OPTIONS;

  const pyPackagesDir = path.join(cwd, '.py_packages');
  const pythonPath =
    server.runtime === 'python' && fs.existsSync(pyPackagesDir) ? pyPackagesDir : undefined;

  const basePath =
    process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  const extraBinDirs: string[] = [];
  if (server.runtime === 'nodejs') {
    const nodeBin = path.join(cwd, 'node_modules', '.bin');
    if (fs.existsSync(nodeBin)) extraBinDirs.push(nodeBin);
  } else if (server.runtime === 'python') {
    const venvBin = path.join(cwd, '.venv', 'bin');
    if (fs.existsSync(venvBin)) extraBinDirs.push(venvBin);
  }
  const combinedPath = extraBinDirs.length
    ? `${extraBinDirs.join(path.delimiter)}${path.delimiter}${basePath}`
    : basePath;

  return {
    PATH: combinedPath,
    HOME: cwd,
    LANG: process.env.LANG || 'C.UTF-8',
    PYTHONUNBUFFERED: '1',
    NODE_ENV: diskEnv.NODE_ENV || 'production',
    PORT: String(server.port),
    ...diskEnv,
    ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
    ...(pythonPath ? { PYTHONPATH: pythonPath } : {}),
  } as unknown as NodeJS.ProcessEnv;
}

function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals
): void {
  const pid = child.pid;
  if (pid && process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // fallback to direct kill
    }
  }
  try {
    child.kill(signal);
  } catch {
    // ignore already exited
  }
}

function runProcessCommand(
  serverId: string,
  cwd: string,
  executable: string,
  args: string[]
): Promise<void> {
  const state = getOrCreateState(serverId);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: buildSafeEnv(serverId),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    state.installChild = child;

    child.stdout.on('data', (chunk: Buffer) => appendLog(serverId, 'stdout', chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => appendLog(serverId, 'stderr', chunk.toString('utf8')));
    child.on('error', (err) => {
      if (state.installChild === child) state.installChild = null;
      reject(new Error(`Gagal menjalankan ${executable}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (state.installChild === child) state.installChild = null;
      if (state.manualStop) {
        reject(new Error('Instalasi dihentikan oleh pengguna.'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Proses ${executable} berhenti dengan kode keluar ${code ?? 'null'}.`));
      }
    });
  });
}

function hasCommandOnSystem(cmd: string, args: string[]): boolean {
  try {
    const res = spawnSync(cmd, args, { stdio: 'ignore', shell: false });
    return res.status === 0;
  } catch {
    return false;
  }
}

async function ensureServerDependencies(server: ServerConfig, cwd: string): Promise<void> {
  const state = getOrCreateState(server.id);

  if (server.runtime === 'nodejs') {
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return;
    }

    let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      state.status = 'error';
      emitStatus(server.id);
      const msg = 'File package.json tidak valid (format JSON rusak).';
      appendLog(server.id, 'system', msg);
      throw new Error(msg);
    }

    const depCount =
      Object.keys(pkgJson.dependencies || {}).length +
      Object.keys(pkgJson.devDependencies || {}).length;
    if (depCount === 0) {
      return;
    }

    state.status = 'installing';
    emitStatus(server.id);
    appendLog(server.id, 'system', 'Otomatis menginstall dependensi dari package.json (npm install)...');

    try {
      await runProcessCommand(server.id, cwd, 'npm', ['install', '--no-audit', '--no-fund']);
      appendLog(server.id, 'system', 'Dependensi package.json berhasil dipasang.');
    } catch (err) {
      state.status = 'error';
      emitStatus(server.id);
      const msg = err instanceof Error ? err.message : 'Instalasi package.json gagal.';
      appendLog(server.id, 'system', msg);
      throw new Error(msg);
    }
    return;
  }

  // Python runtime auto-install from requirements.txt
  const reqPath = path.join(cwd, 'requirements.txt');
  if (!fs.existsSync(reqPath)) {
    return;
  }

  const reqLines = fs
    .readFileSync(reqPath, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (reqLines.length === 0) {
    return;
  }

  state.status = 'installing';
  emitStatus(server.id);
  appendLog(server.id, 'system', 'Otomatis menginstall dependensi dari requirements.txt...');

  const venvPip = path.join(cwd, '.venv', 'bin', 'pip');
  try {
    if (!fs.existsSync(venvPip)) {
      const venvCheck = spawnSync('python3', ['-m', 'venv', '.venv'], {
        cwd,
        env: buildSafeEnv(server.id),
        encoding: 'utf8',
        shell: false,
      });
      if (venvCheck.status !== 0 && fs.existsSync(path.join(cwd, '.venv'))) {
        fs.rmSync(path.join(cwd, '.venv'), { recursive: true, force: true });
      }
    }

    if (fs.existsSync(venvPip)) {
      await runProcessCommand(server.id, cwd, venvPip, [
        'install',
        '--no-cache-dir',
        '-r',
        'requirements.txt',
      ]);
      appendLog(server.id, 'system', 'Dependensi requirements.txt berhasil dipasang ke .venv.');
      return;
    }

    if (hasCommandOnSystem('pip3', ['--version'])) {
      await runProcessCommand(server.id, cwd, 'pip3', [
        'install',
        '--no-cache-dir',
        '--target',
        '.py_packages',
        '-r',
        'requirements.txt',
      ]);
      appendLog(server.id, 'system', 'Dependensi requirements.txt berhasil dipasang.');
      return;
    }

    if (hasCommandOnSystem('python3', ['-m', 'pip', '--version'])) {
      await runProcessCommand(server.id, cwd, 'python3', [
        '-m',
        'pip',
        'install',
        '--no-cache-dir',
        '--target',
        '.py_packages',
        '-r',
        'requirements.txt',
      ]);
      appendLog(server.id, 'system', 'Dependensi requirements.txt berhasil dipasang.');
      return;
    }

    throw new Error(
      'File requirements.txt ditemukan, tetapi pip3 / python3-venv tidak tersedia di sistem host.'
    );
  } catch (err) {
    state.status = 'error';
    emitStatus(server.id);
    const msg = err instanceof Error ? err.message : 'Instalasi requirements.txt gagal.';
    appendLog(server.id, 'system', msg);
    throw new Error(msg);
  }
}

function resolvePythonExecutable(cwd: string, requestedExecutable: string): string {
  const venvBin = path.join(cwd, '.venv', 'bin', requestedExecutable);
  if (fs.existsSync(venvBin)) {
    return venvBin;
  }
  const venvPy3 = path.join(cwd, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPy3) && (requestedExecutable === 'python' || requestedExecutable === 'python3')) {
    return venvPy3;
  }
  if (requestedExecutable === 'python' && !hasCommandOnSystem('python', ['--version'])) {
    if (hasCommandOnSystem('python3', ['--version'])) {
      return 'python3';
    }
  }
  return requestedExecutable;
}

function resolveNodeExecutable(cwd: string, requestedExecutable: string): string {
  if (requestedExecutable !== 'node' && requestedExecutable !== 'npm' && requestedExecutable !== 'npx') {
    const localBin = path.join(cwd, 'node_modules', '.bin', requestedExecutable);
    if (fs.existsSync(localBin)) {
      return localBin;
    }
  }
  return requestedExecutable;
}

export async function startServerProcess(serverId: string): Promise<ServerRuntimeMetrics> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error('Server tidak ditemukan.');
  }

  const state = getOrCreateState(serverId);
  if (state.status === 'running' || state.status === 'starting' || state.status === 'installing') {
    throw new Error(`Server sedang dalam status "${state.status}".`);
  }

  const cwd = ensureServerDir(serverId);
  const parsed = parseSafeStartupCommand(server.startupCommand, server.runtime);

  try {
    if (parsed.npmScriptName) {
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        throw new Error(
          `File package.json tidak ditemukan di direktori server ini untuk "${server.startupCommand}".`
        );
      }
      let pkgJson: { scripts?: Record<string, string> };
      try {
        pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch {
        throw new Error('File package.json tidak valid.');
      }
      const scriptCmd = pkgJson.scripts?.[parsed.npmScriptName];
      if (!scriptCmd) {
        throw new Error(`Script "${parsed.npmScriptName}" tidak ditemukan di package.json server ini.`);
      }
      const innerParsed = parseSafeStartupCommand(scriptCmd, 'nodejs');
      if (innerParsed.scriptArg) {
        verifyServerScriptFile(serverId, innerParsed.scriptArg);
      }
    } else if (parsed.pythonModule) {
      verifyServerPythonModule(serverId, parsed.pythonModule, parsed.args);
    } else if (parsed.scriptArg) {
      verifyServerScriptFile(serverId, parsed.scriptArg);
    }
  } catch (err) {
    state.status = 'error';
    emitStatus(serverId);
    const msg = err instanceof Error ? err.message : 'Script startup tidak valid.';
    appendLog(serverId, 'system', msg);
    throw err;
  }

  state.manualStop = false;
  state.exitCode = null;
  state.lastCpuJiffies = undefined;
  state.lastSampleTimeMs = undefined;

  // Automatically install package.json or requirements.txt before launching
  await ensureServerDependencies(server, cwd);

  const launchExecutable =
    server.runtime === 'python'
      ? resolvePythonExecutable(cwd, parsed.executable)
      : resolveNodeExecutable(cwd, parsed.executable);

  state.status = 'starting';
  emitStatus(serverId);

  appendLog(
    serverId,
    'system',
    `Menjalankan: ${parsed.executable} ${parsed.args.join(' ')} (Port :${server.port})`
  );

  const child = spawn(launchExecutable, parsed.args, {
    cwd,
    env: buildSafeEnv(serverId),
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.child = child;
  state.pid = child.pid ?? null;
  state.startedAtMs = Date.now();
  state.status = 'running';
  emitStatus(serverId);

  child.stdout.on('data', (chunk: Buffer) => {
    appendLog(serverId, 'stdout', chunk.toString('utf8'));
  });

  child.stderr.on('data', (chunk: Buffer) => {
    appendLog(serverId, 'stderr', chunk.toString('utf8'));
  });

  child.on('error', (err) => {
    appendLog(serverId, 'system', `Gagal menjalankan proses: ${err.message}`);
    state.status = 'error';
    state.child = null;
    state.pid = null;
    state.startedAtMs = null;
    emitStatus(serverId);
  });

  child.on('close', (code) => {
    state.child = null;
    state.pid = null;
    state.exitCode = code;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    const wasManual = state.manualStop;
    state.status = code === 0 || wasManual ? 'stopped' : 'error';
    state.startedAtMs = null;
    appendLog(
      serverId,
      'system',
      `Proses berhenti dengan kode keluar ${code ?? 'null'}.`
    );
    emitStatus(serverId);

    const latestConfig = getServerById(serverId);
    if (!wasManual && latestConfig?.autoRestart && code !== 0) {
      appendLog(serverId, 'system', 'Auto-restart aktif: memulai ulang dalam 2 detik...');
      setTimeout(() => {
        const current = getOrCreateState(serverId);
        if (current.status === 'error' || current.status === 'stopped') {
          startServerProcess(serverId).catch((err) => {
            appendLog(serverId, 'system', `Auto-restart gagal: ${err.message}`);
          });
        }
      }, 2000);
    }
  });

  return getServerMetrics(serverId);
}

export async function stopServerProcess(serverId: string, forceKill = false): Promise<ServerRuntimeMetrics> {
  const state = getOrCreateState(serverId);
  if (state.installChild) {
    state.manualStop = true;
    killProcessTree(state.installChild, forceKill ? 'SIGKILL' : 'SIGTERM');
    state.installChild = null;
    state.status = 'stopped';
    emitStatus(serverId);
    return getServerMetrics(serverId);
  }

  if (!state.child || !state.pid) {
    state.status = 'stopped';
    state.pid = null;
    state.startedAtMs = null;
    emitStatus(serverId);
    return getServerMetrics(serverId);
  }

  state.manualStop = true;
  const child = state.child;

  if (forceKill) {
    appendLog(serverId, 'system', 'Mengirim SIGKILL (Kill paksa)...');
    killProcessTree(child, 'SIGKILL');
  } else {
    appendLog(serverId, 'system', 'Mengirim SIGTERM (Menghentikan server secara aman)...');
    killProcessTree(child, 'SIGTERM');
  }

  await new Promise<void>((resolve) => {
    if (!state.child) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (state.child) {
        appendLog(serverId, 'system', 'Timeout shutdown tercapai, mengirim SIGKILL...');
        killProcessTree(state.child, 'SIGKILL');
      }
      resolve();
    }, 3500);

    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return getServerMetrics(serverId);
}

export async function restartServerProcess(serverId: string): Promise<ServerRuntimeMetrics> {
  const state = getOrCreateState(serverId);
  if (state.child) {
    await stopServerProcess(serverId, false);
  }
  return startServerProcess(serverId);
}

export function sendStdinToServer(serverId: string, input: string): void {
  const state = getOrCreateState(serverId);
  const targetChild =
    state.status === 'running' || state.status === 'starting'
      ? state.child
      : state.status === 'installing'
      ? state.installChild
      : null;

  if (!targetChild || targetChild.stdin.destroyed) {
    throw new Error('Server tidak sedang berjalan. Start server terlebih dahulu untuk mengirim input.');
  }
  appendLog(serverId, 'stdin', `> ${input}`);
  targetChild.stdin.write(`${input}\n`);
}

function getSystemVersions(): { pythonVersion: string | null } {
  if (!globalForPm.__nodalSystemVersions) {
    let pythonVersion: string | null = null;
    try {
      const py = spawnSync('python3', ['--version'], { encoding: 'utf8', shell: false });
      if (py.status === 0) {
        pythonVersion = (py.stdout || py.stderr || '').trim().replace(/^Python\s+/i, '');
      }
    } catch {
      pythonVersion = null;
    }

    globalForPm.__nodalSystemVersions = { pythonVersion };
  }
  return globalForPm.__nodalSystemVersions;
}

function detectEffectiveMemoryMb(): { totalMemMb: number; freeMemMb: number } {
  const osTotalMb = Math.round(os.totalmem() / 1024 / 1024);
  let osFreeMb = Math.round(os.freemem() / 1024 / 1024);

  try {
    if (fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const availMatch = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo);
      if (availMatch) {
        osFreeMb = Math.round(Number(availMatch[1]) / 1024);
      }
    }
  } catch {
    // fallback to os.freemem()
  }

  try {
    // cgroup v2 memory limit & usage
    if (fs.existsSync('/sys/fs/cgroup/memory.max')) {
      const rawMax = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
      const parsedMax = Number(rawMax);
      if (Number.isFinite(parsedMax) && parsedMax > 0) {
        const limitMb = Math.round(parsedMax / 1024 / 1024);
        if (limitMb > 0 && limitMb < osTotalMb) {
          let usedMb = osTotalMb - osFreeMb;
          if (fs.existsSync('/sys/fs/cgroup/memory.current')) {
            const rawCur = Number(
              fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim()
            );
            if (Number.isFinite(rawCur) && rawCur >= 0) {
              usedMb = Math.round(rawCur / 1024 / 1024);
            }
          }
          return {
            totalMemMb: limitMb,
            freeMemMb: Math.max(0, limitMb - usedMb),
          };
        }
      }
    }

    // cgroup v1 memory limit & usage
    if (fs.existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) {
      const rawMax = Number(
        fs
          .readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8')
          .trim()
      );
      if (Number.isFinite(rawMax) && rawMax > 0) {
        const limitMb = Math.round(rawMax / 1024 / 1024);
        if (limitMb > 0 && limitMb < osTotalMb) {
          let usedMb = osTotalMb - osFreeMb;
          if (fs.existsSync('/sys/fs/cgroup/memory/memory.usage_in_bytes')) {
            const rawCur = Number(
              fs
                .readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8')
                .trim()
            );
            if (Number.isFinite(rawCur) && rawCur >= 0) {
              usedMb = Math.round(rawCur / 1024 / 1024);
            }
          }
          return {
            totalMemMb: limitMb,
            freeMemMb: Math.max(0, limitMb - usedMb),
          };
        }
      }
    }
  } catch {
    // fallback to os.totalmem()
  }

  return { totalMemMb: osTotalMb, freeMemMb: osFreeMb };
}

function detectEffectiveCpuCores(hostCpuCount: number): number {
  const baseCores = hostCpuCount || 1;
  try {
    if (fs.existsSync('/sys/fs/cgroup/cpu.max')) {
      const parts = fs
        .readFileSync('/sys/fs/cgroup/cpu.max', 'utf8')
        .trim()
        .split(/\s+/);
      if (parts.length >= 2 && parts[0] !== 'max') {
        const quota = Number(parts[0]);
        const period = Number(parts[1]);
        if (Number.isFinite(quota) && Number.isFinite(period) && period > 0) {
          return Math.max(1, Math.min(baseCores, Math.round(quota / period)));
        }
      }
    }
  } catch {
    // fallback to os.cpus()
  }
  return baseCores;
}

export function getHostVpsInfo(): HostVpsInfo {
  const { totalMemMb, freeMemMb } = detectEffectiveMemoryMb();
  const cpus = os.cpus();
  const cpuCores = detectEffectiveCpuCores(cpus.length);
  const versions = getSystemVersions();

  const processMap = getProcessMap();
  let activeCount = 0;
  let activeAllocatedMemoryMb = 0;
  let activeUsedRssMb = 0;
  let activeAllocatedCpuPercent = 0;

  const allServers = listAllServers();
  for (const srv of allServers) {
    const proc = processMap.get(srv.id);
    const isActive =
      proc &&
      (proc.status === 'running' ||
        proc.status === 'starting' ||
        proc.status === 'installing');
    if (isActive) {
      if (proc.status === 'running') {
        activeCount += 1;
      }
      const { memoryMb } = readLinuxProcStats(proc);
      activeUsedRssMb += memoryMb;
      activeAllocatedMemoryMb += Number.isFinite(srv.memoryLimitMb) ? srv.memoryLimitMb : 0;
      activeAllocatedCpuPercent += Number.isFinite(srv.cpuLimitPercent) ? srv.cpuLimitPercent : 0;
    }
  }

  const totalCpuPercent = Math.max(100, cpuCores * 100);
  const activeExtraReservedMb = Math.max(0, activeAllocatedMemoryMb - Math.round(activeUsedRssMb));
  const availableMemoryMb = Math.max(
    0,
    Math.min(totalMemMb - activeAllocatedMemoryMb, freeMemMb - activeExtraReservedMb)
  );
  const availableCpuPercent = Math.max(0, totalCpuPercent - activeAllocatedCpuPercent);

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model || 'Virtual CPU',
    cpuCores,
    loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))) as [number, number, number],
    totalMemoryMb: totalMemMb,
    freeMemoryMb: freeMemMb,
    usedMemoryMb: Math.max(0, totalMemMb - freeMemMb),
    allocatedMemoryMb: activeAllocatedMemoryMb,
    allocatedCpuPercent: activeAllocatedCpuPercent,
    availableMemoryMb,
    availableCpuPercent,
    uptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version,
    pythonVersion: versions.pythonVersion,
    activeServersCount: activeCount,
  };
}
