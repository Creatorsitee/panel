import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
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
import {
  computeCpuPercentDelta,
  computePanelQuotaSummary,
  parseMeminfoSwapMb,
  parseOsPrettyName,
  parseProcStatCpuSnapshot,
  type ProcCpuSnapshot,
  type ServerQuotaSample,
} from './host-stats-utils';
import { parseSafeStartupCommand } from './security';
import { emitWorkspaceChanged } from './realtime-bus';
import type { ConsoleLine, HostInfo, ServerConfig, ServerRuntimeMetrics, ServerStatus } from './types';

interface PartialStreamBuffer {
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ManagedProcess {
  serverId: string;
  status: ServerStatus;
  child: ChildProcessWithoutNullStreams | null;
  installChild: ChildProcessWithoutNullStreams | null;
  pid: number | null;
  startedAtMs: number | null;
  exitCode: number | null;
  manualStop: boolean;
  oomKilled: boolean;
  awaitingInput: boolean;
  stdinSockServer: net.Server | null;
  stdinSockPath: string | null;
  stdinSyncFile: string | null;
  stdinSyncWatcher: fs.FSWatcher | null;
  logs: ConsoleLine[];
  partialBuffers: {
    stdout: PartialStreamBuffer;
    stderr: PartialStreamBuffer;
  };
  lastCpuJiffies?: number;
  lastSampleTimeMs?: number;
  cpuPercent: number;
  memoryMb: number;
}

const MAX_LOG_LINES = 400;

const globalForPm = globalThis as unknown as {
  __nodalProcesses?: Map<string, ManagedProcess>;
  __nodalEvents?: EventEmitter;
  __nodalSystemVersions?: {
    osDistro: string;
    npmVersion: string | null;
    pythonVersion: string | null;
    pipVersion: string | null;
  };
  __nodalHostCpuSample?: ProcCpuSnapshot | null;
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
      oomKilled: false,
      awaitingInput: false,
      stdinSockServer: null,
      stdinSockPath: null,
      stdinSyncFile: null,
      stdinSyncWatcher: null,
      logs: [],
      partialBuffers: {
        stdout: { text: '', timer: null },
        stderr: { text: '', timer: null },
      },
      cpuPercent: 0,
      memoryMb: 0,
    };
    map.set(serverId, state);
  }
  return state;
}

const RUNTIME_HOOKS_DIR = path.join(os.tmpdir(), 'cmnty-runtime-hooks');
const NODE_STDIN_HOOK_PATH = path.join(RUNTIME_HOOKS_DIR, 'node-stdin-hook.cjs');
const PYTHON_HOOK_DIR = path.join(RUNTIME_HOOKS_DIR, 'python');
const PYTHON_SITECUSTOMIZE_PATH = path.join(PYTHON_HOOK_DIR, 'sitecustomize.py');

const NODE_STDIN_HOOK_SOURCE = `'use strict';
const net = require('net');
const fs = require('fs');

const sockPath = process.env.CMNTY_STDIN_SOCK;
const syncFile = process.env.CMNTY_STDIN_SYNC_FILE;
const scriptPath = process.argv[1] || '';
const isPackageRunner = /(?:^|[\\/\\\\])(?:npm|npx)-cli\\.js$|(?:^|[\\/\\\\])(?:yarn|pnpm)\\.(?:c?js|mjs)$/i.test(scriptPath);

if (sockPath && !isPackageRunner) {
  let lastAsync = null;
  let syncDepth = 0;

  function sendState(awaiting) {
    try {
      const conn = net.createConnection(sockPath, () => {
        conn.end(JSON.stringify({ pid: process.pid, awaiting: Boolean(awaiting) }) + '\\n');
      });
      conn.on('error', () => {});
      conn.unref();
    } catch {}
  }

  function updateAsyncState(active) {
    const next = Boolean(active) || syncDepth > 0;
    if (lastAsync === next) return;
    lastAsync = next;
    sendState(next);
  }

  function hasStdinListeners() {
    try {
      return (
        process.stdin.listenerCount('data') > 0 ||
        process.stdin.listenerCount('readable') > 0 ||
        Boolean(process.stdin.readableFlowing)
      );
    } catch {
      return false;
    }
  }

  const stdin = process.stdin;
  const origOn = stdin.on.bind(stdin);
  const origAdd = stdin.addListener.bind(stdin);
  const origOnce = stdin.once.bind(stdin);
  const origPrepend = stdin.prependListener.bind(stdin);
  const origPrependOnce = stdin.prependOnceListener.bind(stdin);
  const origOff = stdin.off.bind(stdin);
  const origRemove = stdin.removeListener.bind(stdin);
  const origRemoveAll = stdin.removeAllListeners.bind(stdin);
  const origResume = stdin.resume.bind(stdin);
  const origPause = stdin.pause.bind(stdin);
  const origPipe = stdin.pipe.bind(stdin);
  const origUnpipe = stdin.unpipe.bind(stdin);
  const origAsyncIter = stdin[Symbol.asyncIterator].bind(stdin);

  stdin.on = function (ev, fn) {
    const res = origOn(ev, fn);
    if (ev === 'data' || ev === 'readable') updateAsyncState(true);
    return res;
  };
  stdin.addListener = function (ev, fn) {
    const res = origAdd(ev, fn);
    if (ev === 'data' || ev === 'readable') updateAsyncState(true);
    return res;
  };
  stdin.once = function (ev, fn) {
    const res = origOnce(ev, fn);
    if (ev === 'data' || ev === 'readable') updateAsyncState(true);
    return res;
  };
  stdin.prependListener = function (ev, fn) {
    const res = origPrepend(ev, fn);
    if (ev === 'data' || ev === 'readable') updateAsyncState(true);
    return res;
  };
  stdin.prependOnceListener = function (ev, fn) {
    const res = origPrependOnce(ev, fn);
    if (ev === 'data' || ev === 'readable') updateAsyncState(true);
    return res;
  };
  stdin.off = function (ev, fn) {
    const res = origOff(ev, fn);
    updateAsyncState(hasStdinListeners());
    return res;
  };
  stdin.removeListener = function (ev, fn) {
    const res = origRemove(ev, fn);
    updateAsyncState(hasStdinListeners());
    return res;
  };
  stdin.removeAllListeners = function (ev) {
    const res = origRemoveAll(ev);
    updateAsyncState(hasStdinListeners());
    return res;
  };
  stdin.resume = function () {
    const res = origResume();
    updateAsyncState(true);
    return res;
  };
  stdin.pause = function () {
    const res = origPause();
    updateAsyncState(false);
    return res;
  };
  stdin.pipe = function (...args) {
    updateAsyncState(true);
    return origPipe(...args);
  };
  stdin.unpipe = function (...args) {
    const res = origUnpipe(...args);
    updateAsyncState(hasStdinListeners());
    return res;
  };
  stdin[Symbol.asyncIterator] = async function* () {
    updateAsyncState(true);
    try {
      for await (const chunk of origAsyncIter()) {
        yield chunk;
      }
    } finally {
      updateAsyncState(hasStdinListeners());
    }
  };

  if (syncFile) {
    const writeSyncState = (val) => {
      try {
        fs.writeFileSync(syncFile, val, 'utf8');
      } catch {}
    };
    const origReadSync = fs.readSync.bind(fs);
    fs.readSync = function (fd, ...args) {
      if (fd === 0) {
        syncDepth += 1;
        writeSyncState('1');
        try {
          return origReadSync(fd, ...args);
        } finally {
          syncDepth = Math.max(0, syncDepth - 1);
          if (syncDepth === 0) writeSyncState('0');
        }
      }
      return origReadSync(fd, ...args);
    };
    const origReadFileSync = fs.readFileSync.bind(fs);
    fs.readFileSync = function (fileOrFd, ...args) {
      if (fileOrFd === 0) {
        syncDepth += 1;
        writeSyncState('1');
        try {
          return origReadFileSync(fileOrFd, ...args);
        } finally {
          syncDepth = Math.max(0, syncDepth - 1);
          if (syncDepth === 0) writeSyncState('0');
        }
      }
      return origReadFileSync(fileOrFd, ...args);
    };
  }
}
`;

const PYTHON_SITECUSTOMIZE_SOURCE = `import builtins
import json
import os
import socket
import sys

_sock_path = os.environ.get("CMNTY_STDIN_SOCK")

if _sock_path:
    _depth = 0

    def _report(awaiting):
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.connect(_sock_path)
            s.sendall((json.dumps({"pid": os.getpid(), "awaiting": bool(awaiting)}) + "\\n").encode("utf-8"))
            s.close()
        except Exception:
            pass

    def _enter_stdin():
        global _depth
        _depth += 1
        if _depth == 1:
            _report(True)

    def _exit_stdin():
        global _depth
        _depth = max(0, _depth - 1)
        if _depth == 0:
            _report(False)

    _orig_input = builtins.input

    def _cmnty_input(prompt=""):
        _enter_stdin()
        try:
            return _orig_input(prompt)
        finally:
            _exit_stdin()

    builtins.input = _cmnty_input

    class _CmntyStdinWrapper:
        def __init__(self, inner):
            self._inner = inner

        def readline(self, *args, **kwargs):
            _enter_stdin()
            try:
                return self._inner.readline(*args, **kwargs)
            finally:
                _exit_stdin()

        def read(self, *args, **kwargs):
            _enter_stdin()
            try:
                return self._inner.read(*args, **kwargs)
            finally:
                _exit_stdin()

        def readlines(self, *args, **kwargs):
            _enter_stdin()
            try:
                return self._inner.readlines(*args, **kwargs)
            finally:
                _exit_stdin()

        def __iter__(self):
            return self

        def __next__(self):
            _enter_stdin()
            try:
                return next(self._inner)
            finally:
                _exit_stdin()

        def __getattr__(self, name):
            return getattr(self._inner, name)

    if sys.stdin is not None:
        sys.stdin = _CmntyStdinWrapper(sys.stdin)
`;

function ensureRuntimeHooks(): void {
  if (!fs.existsSync(PYTHON_HOOK_DIR)) {
    fs.mkdirSync(PYTHON_HOOK_DIR, { recursive: true });
  }
  if (!fs.existsSync(NODE_STDIN_HOOK_PATH) || fs.readFileSync(NODE_STDIN_HOOK_PATH, 'utf8') !== NODE_STDIN_HOOK_SOURCE) {
    fs.writeFileSync(NODE_STDIN_HOOK_PATH, NODE_STDIN_HOOK_SOURCE, 'utf8');
  }
  if (!fs.existsSync(PYTHON_SITECUSTOMIZE_PATH) || fs.readFileSync(PYTHON_SITECUSTOMIZE_PATH, 'utf8') !== PYTHON_SITECUSTOMIZE_SOURCE) {
    fs.writeFileSync(PYTHON_SITECUSTOMIZE_PATH, PYTHON_SITECUSTOMIZE_SOURCE, 'utf8');
  }
}

function cleanupStdinMonitor(state: ManagedProcess): void {
  state.awaitingInput = false;
  if (state.stdinSyncWatcher) {
    try {
      state.stdinSyncWatcher.close();
    } catch {
      // ignore
    }
    state.stdinSyncWatcher = null;
  }
  if (state.stdinSockServer) {
    try {
      state.stdinSockServer.close();
    } catch {
      // ignore
    }
    state.stdinSockServer = null;
  }
  if (state.stdinSockPath) {
    try {
      fs.rmSync(state.stdinSockPath, { force: true });
    } catch {
      // ignore
    }
    state.stdinSockPath = null;
  }
  if (state.stdinSyncFile) {
    try {
      fs.rmSync(state.stdinSyncFile, { force: true });
    } catch {
      // ignore
    }
    state.stdinSyncFile = null;
  }
}

function setupStdinMonitor(serverId: string, state: ManagedProcess): {
  sockPath: string;
  syncFile: string;
} {
  cleanupStdinMonitor(state);
  ensureRuntimeHooks();

  const token = crypto.randomBytes(5).toString('hex');
  const sockPath = path.join(os.tmpdir(), `cmnty-stdin-${serverId}-${token}.sock`);
  const syncFile = path.join(os.tmpdir(), `cmnty-stdin-${serverId}-${token}.sync`);
  fs.writeFileSync(syncFile, '0', 'utf8');

  const applyAwaitingState = (nextAwaiting: boolean) => {
    if (state.status !== 'running' && nextAwaiting) return;
    if (state.awaitingInput === nextAwaiting) return;
    state.awaitingInput = nextAwaiting;
    emitStatus(serverId);
  };

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const rawLine = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (rawLine) {
          try {
            const msg = JSON.parse(rawLine) as { awaiting?: boolean };
            applyAwaitingState(Boolean(msg.awaiting));
          } catch {
            // ignore malformed frame
          }
        }
        nl = buf.indexOf('\n');
      }
    });
    conn.on('error', () => {
      // ignore client disconnect
    });
  });

  server.on('error', () => {
    // ignore transient socket errors
  });
  server.listen(sockPath);

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(syncFile, () => {
      try {
        const val = fs.readFileSync(syncFile, 'utf8').trim();
        applyAwaitingState(val === '1');
      } catch {
        // ignore
      }
    });
  } catch {
    watcher = null;
  }

  state.stdinSockServer = server;
  state.stdinSockPath = sockPath;
  state.stdinSyncFile = syncFile;
  state.stdinSyncWatcher = watcher;

  return { sockPath, syncFile };
}

function pushConsoleLine(
  serverId: string,
  stream: ConsoleLine['stream'],
  text: string
): void {
  const state = getOrCreateState(serverId);
  const entry: ConsoleLine = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    stream,
    text,
  };
  state.logs.push(entry);
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.shift();
  }
  getEmitter().emit(`log:${serverId}`, entry);
}

function flushStreamBuffer(
  serverId: string,
  stream: 'stdout' | 'stderr'
): void {
  const state = getOrCreateState(serverId);
  const buf = state.partialBuffers[stream];
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  if (buf.text.length > 0) {
    const text = buf.text;
    buf.text = '';
    pushConsoleLine(serverId, stream, text);
  }
}

function appendStreamChunk(
  serverId: string,
  stream: 'stdout' | 'stderr',
  rawText: string
): void {
  const state = getOrCreateState(serverId);
  const buf = state.partialBuffers[stream];
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }

  let current = buf.text + rawText.replace(/\r\n/g, '\n');
  let newlineIdx = current.indexOf('\n');

  while (newlineIdx !== -1) {
    const rawLine = current.slice(0, newlineIdx);
    current = current.slice(newlineIdx + 1);
    // Handle carriage return overwrites on a single line (e.g. progress bars)
    const crParts = rawLine.split('\r');
    const finalLine = crParts[crParts.length - 1] ?? '';
    pushConsoleLine(serverId, stream, finalLine);
    newlineIdx = current.indexOf('\n');
  }

  if (current.includes('\r')) {
    const crParts = current.split('\r');
    current = crParts[crParts.length - 1] ?? '';
  }

  buf.text = current;
  if (buf.text.length > 0) {
    buf.timer = setTimeout(() => {
      flushStreamBuffer(serverId, stream);
    }, 45);
  }
}

function appendLog(
  serverId: string,
  stream: ConsoleLine['stream'],
  rawText: string
): void {
  if (stream === 'stdout' || stream === 'stderr') {
    appendStreamChunk(serverId, stream, rawText);
    return;
  }
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === lines.length - 1 && line === '') continue;
    pushConsoleLine(serverId, stream, line);
  }
}

function emitStatus(serverId: string): void {
  getEmitter().emit(`status:${serverId}`, getServerMetrics(serverId));
  emitWorkspaceChanged(`status:${serverId}`);
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
  const isActiveState =
    state.status === 'running' ||
    state.status === 'starting' ||
    state.status === 'installing' ||
    state.status === 'stopping';
  if (!state.pid || !isActiveState) {
    return { cpuPercent: 0, memoryMb: 0 };
  }

  try {
    process.kill(state.pid, 0);
  } catch {
    if (state.status === 'running') {
      cleanupStdinMonitor(state);
      state.status = 'stopped';
      state.pid = null;
      state.child = null;
      state.startedAtMs = null;
      state.cpuPercent = 0;
      state.memoryMb = 0;
    } else if (!state.child) {
      state.pid = null;
    }
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
      state.oomKilled = true;
      state.status = 'stopping';
      appendLog(
        state.serverId,
        'system',
        `Process exceeded allocated memory limit (${memoryMb} MiB / ${server.memoryLimitMb} MiB). Terminating...`
      );
      emitStatus(state.serverId);
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
  const isActive =
    state.status === 'running' ||
    state.status === 'starting' ||
    state.status === 'installing' ||
    state.status === 'stopping';
  const uptimeSeconds =
    isActive && state.startedAtMs
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
    awaitingInput:
      state.status === 'running' || state.status === 'starting'
        ? state.awaitingInput
        : false,
  };
}

export function getConsoleHistory(serverId: string): ConsoleLine[] {
  return [...getOrCreateState(serverId).logs];
}

export function clearConsoleHistory(serverId: string): void {
  const state = getOrCreateState(serverId);
  if (state.partialBuffers.stdout.timer) {
    clearTimeout(state.partialBuffers.stdout.timer);
    state.partialBuffers.stdout.timer = null;
  }
  if (state.partialBuffers.stderr.timer) {
    clearTimeout(state.partialBuffers.stderr.timer);
    state.partialBuffers.stderr.timer = null;
  }
  state.partialBuffers.stdout.text = '';
  state.partialBuffers.stderr.text = '';
  state.logs = [];
  getEmitter().emit(`clear:${serverId}`);
}

export function subscribeConsole(
  serverId: string,
  onLog: (line: ConsoleLine) => void,
  onStatus: (metrics: ServerRuntimeMetrics) => void,
  onClear?: () => void
): () => void {
  const emitter = getEmitter();
  emitter.on(`log:${serverId}`, onLog);
  emitter.on(`status:${serverId}`, onStatus);
  if (onClear) emitter.on(`clear:${serverId}`, onClear);
  return () => {
    emitter.off(`log:${serverId}`, onLog);
    emitter.off(`status:${serverId}`, onStatus);
    if (onClear) emitter.off(`clear:${serverId}`, onClear);
  };
}

function buildSafeEnv(
  serverId: string,
  stdinMonitor?: { sockPath: string; syncFile: string }
): NodeJS.ProcessEnv {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error('Server tidak ditemukan.');
  }

  const cwd = ensureServerDir(serverId);
  const diskEnv = readServerDotEnv(serverId);
  const existingNodeOpts = diskEnv.NODE_OPTIONS ? `${diskEnv.NODE_OPTIONS} ` : '';
  let nodeOptions =
    server.runtime === 'nodejs' && !existingNodeOpts.includes('--max-old-space-size')
      ? `${existingNodeOpts}--max-old-space-size=${server.memoryLimitMb}`.trim()
      : diskEnv.NODE_OPTIONS;

  const pyPackagesDir = path.join(cwd, '.py_packages');
  const pythonPaths: string[] = [];
  if (server.runtime === 'python') {
    if (stdinMonitor) {
      pythonPaths.push(PYTHON_HOOK_DIR);
    }
    if (fs.existsSync(pyPackagesDir)) {
      pythonPaths.push(pyPackagesDir);
    }
  }
  if (diskEnv.PYTHONPATH) {
    pythonPaths.push(diskEnv.PYTHONPATH);
  }
  const pythonPath = pythonPaths.length > 0 ? pythonPaths.join(path.delimiter) : undefined;

  if (server.runtime === 'nodejs' && stdinMonitor) {
    const requireFlag = NODE_STDIN_HOOK_PATH.includes(' ')
      ? `--require "${NODE_STDIN_HOOK_PATH}"`
      : `--require ${NODE_STDIN_HOOK_PATH}`;
    nodeOptions = nodeOptions ? `${nodeOptions} ${requireFlag}`.trim() : requireFlag;
  }

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
    ...(stdinMonitor
      ? {
          CMNTY_STDIN_SOCK: stdinMonitor.sockPath,
          CMNTY_STDIN_SYNC_FILE: stdinMonitor.syncFile,
        }
      : {}),
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
    state.pid = child.pid ?? null;
    emitStatus(serverId);
    child.stdin.on('error', () => {
      // ignore EPIPE if process exits mid-write
    });

    child.stdout.on('data', (chunk: Buffer) => appendLog(serverId, 'stdout', chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => appendLog(serverId, 'stderr', chunk.toString('utf8')));
    child.on('error', (err) => {
      flushStreamBuffer(serverId, 'stdout');
      flushStreamBuffer(serverId, 'stderr');
      if (state.installChild === child) {
        state.installChild = null;
        if (!state.child) state.pid = null;
      }
      reject(new Error(`Failed to execute ${executable}: ${err.message}`));
    });
    child.on('close', (code) => {
      flushStreamBuffer(serverId, 'stdout');
      flushStreamBuffer(serverId, 'stderr');
      if (state.installChild === child) {
        state.installChild = null;
        if (!state.child) state.pid = null;
      }
      if (state.manualStop) {
        reject(new Error('Installation aborted by user.'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process ${executable} exited with status code ${code ?? 'null'}.`));
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
      const msg = 'Invalid package.json file (malformed JSON syntax).';
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
    appendLog(server.id, 'system', 'Installing dependencies from package.json (npm install)...');

    try {
      await runProcessCommand(server.id, cwd, 'npm', ['install', '--no-audit', '--no-fund']);
      appendLog(server.id, 'system', 'Dependencies from package.json installed successfully.');
    } catch (err) {
      state.status = 'error';
      emitStatus(server.id);
      const msg = err instanceof Error ? err.message : 'Failed to install dependencies from package.json.';
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
  appendLog(server.id, 'system', 'Installing dependencies from requirements.txt...');

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
      appendLog(server.id, 'system', 'Dependencies from requirements.txt installed into .venv.');
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
      appendLog(server.id, 'system', 'Dependencies from requirements.txt installed successfully.');
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
      appendLog(server.id, 'system', 'Dependencies from requirements.txt installed successfully.');
      return;
    }

    throw new Error(
      'Found requirements.txt, but neither pip3 nor python3-venv is available on the host system.'
    );
  } catch (err) {
    state.status = 'error';
    emitStatus(server.id);
    const msg = err instanceof Error ? err.message : 'Failed to install dependencies from requirements.txt.';
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
  if (
    state.status === 'running' ||
    state.status === 'starting' ||
    state.status === 'installing' ||
    state.status === 'stopping'
  ) {
    throw new Error(`Server sedang dalam status "${state.status}".`);
  }

  state.status = 'starting';
  state.startedAtMs = Date.now();
  state.manualStop = false;
  state.oomKilled = false;
  state.exitCode = null;
  state.lastCpuJiffies = undefined;
  state.lastSampleTimeMs = undefined;
  emitStatus(serverId);

  appendLog(serverId, 'system', 'Checking server disk space usage, this could take a few seconds...');
  appendLog(serverId, 'system', 'Updating process configuration files...');
  appendLog(serverId, 'system', 'Ensuring file permissions are set correctly, this could take a few seconds...');
  appendLog(serverId, 'system', 'Server marked as starting...');

  let cwd: string;
  let parsed: ReturnType<typeof parseSafeStartupCommand>;
  try {
    cwd = ensureServerDir(serverId);
    parsed = parseSafeStartupCommand(server.startupCommand, server.runtime);

    if (parsed.npmScriptName) {
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        throw new Error(
          `package.json was not found in this server directory for "${server.startupCommand}".`
        );
      }
      let pkgJson: { scripts?: Record<string, string> };
      try {
        pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch {
        throw new Error('Invalid package.json file.');
      }
      const scriptCmd = pkgJson.scripts?.[parsed.npmScriptName];
      if (!scriptCmd) {
        throw new Error(`Script "${parsed.npmScriptName}" was not found in package.json.`);
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
    const msg = err instanceof Error ? err.message : 'Invalid startup script configuration.';
    appendLog(serverId, 'system', `Failed to start server: ${msg}`);
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
    throw err;
  }

  // Automatically install package.json or requirements.txt before launching
  await ensureServerDependencies(server, cwd);

  const launchExecutable =
    server.runtime === 'python'
      ? resolvePythonExecutable(cwd, parsed.executable)
      : resolveNodeExecutable(cwd, parsed.executable);

  state.status = 'starting';
  state.awaitingInput = false;
  emitStatus(serverId);

  appendLog(serverId, 'system', `container@cmnty~ ${server.startupCommand}`);

  const stdinMonitor = setupStdinMonitor(serverId, state);

  const child = spawn(launchExecutable, parsed.args, {
    cwd,
    env: buildSafeEnv(serverId, stdinMonitor),
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  state.child = child;
  state.pid = child.pid ?? null;
  state.startedAtMs = Date.now();
  state.status = 'running';
  appendLog(serverId, 'system', 'Server marked as running...');
  emitStatus(serverId);

  child.stdin.on('error', () => {
    // ignore EPIPE if process exits mid-write
  });

  child.stdout.on('data', (chunk: Buffer) => {
    appendLog(serverId, 'stdout', chunk.toString('utf8'));
  });

  child.stderr.on('data', (chunk: Buffer) => {
    appendLog(serverId, 'stderr', chunk.toString('utf8'));
  });

  child.on('error', (err) => {
    flushStreamBuffer(serverId, 'stdout');
    flushStreamBuffer(serverId, 'stderr');
    cleanupStdinMonitor(state);
    appendLog(serverId, 'system', `Failed to start container process: ${err.message}`);
    state.status = 'error';
    state.child = null;
    state.pid = null;
    state.startedAtMs = null;
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
  });

  child.on('close', (code) => {
    flushStreamBuffer(serverId, 'stdout');
    flushStreamBuffer(serverId, 'stderr');
    cleanupStdinMonitor(state);
    state.child = null;
    state.pid = null;
    state.exitCode = code;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    const wasManual = state.manualStop;
    const wasOom = state.oomKilled;
    state.oomKilled = false;
    state.status = (code === 0 || wasManual) && !wasOom ? 'stopped' : 'error';
    state.startedAtMs = null;

    if (wasOom || (!wasManual && code !== 0)) {
      appendLog(serverId, 'system', '---------- Detected server process in a crashed state! ----------');
      appendLog(serverId, 'system', `Exit code: ${code ?? 'null'}`);
      appendLog(serverId, 'system', `Out of memory: ${wasOom ? 'true' : 'false'}`);
    }
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);

    const latestConfig = getServerById(serverId);
    if (!wasManual && latestConfig?.autoRestart && (code !== 0 || wasOom)) {
      appendLog(serverId, 'system', 'Auto-restart enabled: rebooting server in 2 seconds...');
      setTimeout(() => {
        const current = getOrCreateState(serverId);
        if (current.status === 'error' || current.status === 'stopped') {
          startServerProcess(serverId).catch((err) => {
            appendLog(serverId, 'system', `Auto-restart failed: ${err.message}`);
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
    state.status = 'stopping';
    emitStatus(serverId);
    appendLog(serverId, 'system', 'Server marked as stopping...');
    killProcessTree(state.installChild, forceKill ? 'SIGKILL' : 'SIGTERM');
    state.installChild = null;
    state.status = 'stopped';
    appendLog(serverId, 'system', 'Server marked as offline...');
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
  state.status = 'stopping';
  state.awaitingInput = false;
  emitStatus(serverId);
  const child = state.child;

  if (forceKill) {
    appendLog(serverId, 'system', 'Server marked as killing (SIGKILL)...');
    killProcessTree(child, 'SIGKILL');
  } else {
    appendLog(serverId, 'system', 'Server marked as stopping...');
    killProcessTree(child, 'SIGTERM');
  }

  await new Promise<void>((resolve) => {
    if (!state.child) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (state.child) {
        appendLog(serverId, 'system', 'Server did not respond to stop signal; sending SIGKILL...');
        killProcessTree(state.child, 'SIGKILL');
      }
      resolve();
    }, 3500);

    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  cleanupStdinMonitor(state);
  return getServerMetrics(serverId);
}

export async function restartServerProcess(serverId: string): Promise<ServerRuntimeMetrics> {
  const state = getOrCreateState(serverId);
  if (state.child || state.installChild) {
    await stopServerProcess(serverId, false);
  }
  return startServerProcess(serverId);
}

export function sendStdinToServer(serverId: string, input: string): void {
  const state = getOrCreateState(serverId);
  const targetChild =
    state.status === 'running' || state.status === 'starting' ? state.child : null;

  if (!targetChild || !targetChild.stdin || targetChild.stdin.destroyed || !targetChild.stdin.writable) {
    throw new Error('Server tidak sedang berjalan. Start server terlebih dahulu untuk mengirim input.');
  }
  if (!state.awaitingInput) {
    throw new Error('Program tidak sedang meminta input (stdin).');
  }
  appendLog(serverId, 'stdin', `> ${input}`);
  targetChild.stdin.write(`${input}\n`);
}

function getSystemVersions(): {
  osDistro: string;
  npmVersion: string | null;
  pythonVersion: string | null;
  pipVersion: string | null;
} {
  if (!globalForPm.__nodalSystemVersions) {
    let osDistro = `${os.type()} ${os.release()}`;
    try {
      if (fs.existsSync('/etc/os-release')) {
        const content = fs.readFileSync('/etc/os-release', 'utf8');
        osDistro = parseOsPrettyName(content, osDistro);
      }
    } catch {
      // fallback to os.type() + os.release()
    }

    let npmVersion: string | null = null;
    try {
      const npm = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: false });
      if (npm.status === 0) {
        npmVersion = (npm.stdout || '').trim() || null;
      }
    } catch {
      npmVersion = null;
    }

    let pythonVersion: string | null = null;
    try {
      const py = spawnSync('python3', ['--version'], { encoding: 'utf8', shell: false });
      if (py.status === 0) {
        pythonVersion = (py.stdout || py.stderr || '').trim().replace(/^Python\s+/i, '') || null;
      }
    } catch {
      pythonVersion = null;
    }

    let pipVersion: string | null = null;
    try {
      const pip = spawnSync('pip3', ['--version'], { encoding: 'utf8', shell: false });
      if (pip.status === 0) {
        const match = /pip\s+([^\s]+)/i.exec(pip.stdout || pip.stderr || '');
        pipVersion = match ? match[1] : null;
      } else {
        const pyPip = spawnSync('python3', ['-m', 'pip', '--version'], {
          encoding: 'utf8',
          shell: false,
        });
        if (pyPip.status === 0) {
          const match = /pip\s+([^\s]+)/i.exec(pyPip.stdout || pyPip.stderr || '');
          pipVersion = match ? match[1] : null;
        }
      }
    } catch {
      pipVersion = null;
    }

    globalForPm.__nodalSystemVersions = {
      osDistro,
      npmVersion,
      pythonVersion,
      pipVersion,
    };
  }
  return globalForPm.__nodalSystemVersions;
}

function getPrimaryIpv4Address(): string | null {
  try {
    const nets = os.networkInterfaces();
    for (const ifaceList of Object.values(nets)) {
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal && iface.address) {
          return iface.address;
        }
      }
    }
  } catch {
    // ignore network interface lookup failures
  }
  return null;
}

function detectDiskStatsGb(): { diskTotalGb: number; diskUsedGb: number; diskFreeGb: number } {
  try {
    const stats = fs.statfsSync(process.cwd());
    const bsize = Number(stats.bsize || 0);
    const blocks = Number(stats.blocks || 0);
    const bfree = Number(stats.bfree || 0);
    const bavail = Number(stats.bavail || 0);
    const gbDiv = 1024 * 1024 * 1024;
    const totalGb = Number(((blocks * bsize) / gbDiv).toFixed(1));
    const freeGb = Number(((bavail * bsize) / gbDiv).toFixed(1));
    const usedGb = Number(Math.max(0, ((blocks - bfree) * bsize) / gbDiv).toFixed(1));
    return {
      diskTotalGb: totalGb,
      diskUsedGb: usedGb,
      diskFreeGb: freeGb,
    };
  } catch {
    return { diskTotalGb: 0, diskUsedGb: 0, diskFreeGb: 0 };
  }
}

function primeHostCpuBaseline(): void {
  if (globalForPm.__nodalHostCpuSample) return;
  try {
    if (fs.existsSync('/proc/stat')) {
      const stat = fs.readFileSync('/proc/stat', 'utf8');
      const snap = parseProcStatCpuSnapshot(stat);
      if (snap) {
        globalForPm.__nodalHostCpuSample = snap;
      }
    }
  } catch {
    // ignore
  }
}

primeHostCpuBaseline();

function detectHostCpuPercent(load1m: number, cpuCores: number): number {
  try {
    if (fs.existsSync('/proc/stat')) {
      const stat = fs.readFileSync('/proc/stat', 'utf8');
      const current = parseProcStatCpuSnapshot(stat);
      const prev = globalForPm.__nodalHostCpuSample ?? null;
      if (current) {
        globalForPm.__nodalHostCpuSample = current;
        const deltaPct = computeCpuPercentDelta(prev, current);
        if (deltaPct !== null) {
          return deltaPct;
        }
      }
    }
  } catch {
    // fallback below
  }
  return Number(Math.min(100, (load1m / Math.max(1, cpuCores)) * 100).toFixed(1));
}

function detectSwapMb(): { swapTotalMb: number; swapUsedMb: number; swapFreeMb: number } {
  try {
    if (fs.existsSync('/proc/meminfo')) {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      return parseMeminfoSwapMb(meminfo);
    }
  } catch {
    // ignore
  }
  return { swapTotalMb: 0, swapUsedMb: 0, swapFreeMb: 0 };
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
              let inactiveFileBytes = 0;
              if (fs.existsSync('/sys/fs/cgroup/memory.stat')) {
                const memStat = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
                const inactiveMatch = /^inactive_file\s+(\d+)/m.exec(memStat);
                if (inactiveMatch) {
                  inactiveFileBytes = Number(inactiveMatch[1]) || 0;
                }
              }
              usedMb = Math.max(0, Math.round((rawCur - inactiveFileBytes) / 1024 / 1024));
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
              let inactiveFileBytes = 0;
              if (fs.existsSync('/sys/fs/cgroup/memory/memory.stat')) {
                const memStat = fs.readFileSync('/sys/fs/cgroup/memory/memory.stat', 'utf8');
                const inactiveMatch = /^total_inactive_file\s+(\d+)/m.exec(memStat);
                if (inactiveMatch) {
                  inactiveFileBytes = Number(inactiveMatch[1]) || 0;
                }
              }
              usedMb = Math.max(0, Math.round((rawCur - inactiveFileBytes) / 1024 / 1024));
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
        if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
          return Math.max(1, Math.min(baseCores, Math.round(quota / period)));
        }
      }
    }
    if (
      fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') &&
      fs.existsSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
    ) {
      const quota = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim());
      const period = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim());
      if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
        return Math.max(1, Math.min(baseCores, Math.round(quota / period)));
      }
    }
  } catch {
    // fallback to os.cpus()
  }
  return baseCores;
}

function resolveCpuModel(rawModel: string | undefined, arch: string): string {
  const cleaned = (rawModel || '').trim();
  if (cleaned && cleaned.toLowerCase() !== 'unknown') {
    return cleaned;
  }
  try {
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const match = /^model name\s*:\s*(.+)$/m.exec(cpuinfo);
      const parsed = match?.[1]?.trim();
      if (parsed && parsed.toLowerCase() !== 'unknown') {
        return parsed;
      }
    }
  } catch {
    // fallback below
  }
  return `Virtual CPU (${arch})`;
}

export function getHostInfo(): HostInfo {
  const { totalMemMb, freeMemMb } = detectEffectiveMemoryMb();
  const swap = detectSwapMb();
  const disk = detectDiskStatsGb();
  const cpus = os.cpus();
  const cpuCores = detectEffectiveCpuCores(cpus.length);
  const loadAvg = os.loadavg().map((n) => Number(n.toFixed(2))) as [number, number, number];
  const hostCpuPercent = detectHostCpuPercent(loadAvg[0], cpuCores);
  const versions = getSystemVersions();

  const processMap = getProcessMap();
  const allServers = listAllServers();
  const quotaSamples: ServerQuotaSample[] = allServers.map((srv) => {
    const proc = processMap.get(srv.id);
    const isActive = Boolean(
      proc &&
        (proc.status === 'running' ||
          proc.status === 'starting' ||
          proc.status === 'stopping' ||
          proc.status === 'installing')
    );
    const stats = isActive && proc ? readLinuxProcStats(proc) : { cpuPercent: 0, memoryMb: 0 };
    return {
      memoryLimitMb: srv.memoryLimitMb,
      cpuLimitPercent: srv.cpuLimitPercent,
      isActive,
      isRunning: isActive && proc?.status !== 'stopping',
      usedMemoryMb: stats.memoryMb,
      usedCpuPercent: stats.cpuPercent,
    };
  });

  const totalCpuPercent = Math.max(100, cpuCores * 100);
  const quotaSummary = computePanelQuotaSummary(
    quotaSamples,
    totalMemMb,
    freeMemMb,
    totalCpuPercent
  );

  const arch = os.arch();

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    osDistro: versions.osDistro,
    kernel: os.release(),
    arch,
    primaryIp: getPrimaryIpv4Address(),
    cpuModel: resolveCpuModel(cpus[0]?.model, arch),
    cpuCores,
    hostCpuPercent,
    loadAvg,
    totalMemoryMb: totalMemMb,
    freeMemoryMb: freeMemMb,
    usedMemoryMb: Math.max(0, totalMemMb - freeMemMb),
    swapTotalMb: swap.swapTotalMb,
    swapUsedMb: swap.swapUsedMb,
    swapFreeMb: swap.swapFreeMb,
    diskTotalGb: disk.diskTotalGb,
    diskUsedGb: disk.diskUsedGb,
    diskFreeGb: disk.diskFreeGb,
    allocatedMemoryMb: quotaSummary.allocatedMemoryMb,
    allocatedCpuPercent: quotaSummary.allocatedCpuPercent,
    totalAllocatedMemoryMb: quotaSummary.totalAllocatedMemoryMb,
    totalAllocatedCpuPercent: quotaSummary.totalAllocatedCpuPercent,
    panelMemoryUsedMb: quotaSummary.panelMemoryUsedMb,
    panelCpuPercent: quotaSummary.panelCpuPercent,
    availableMemoryMb: quotaSummary.availableMemoryMb,
    availableCpuPercent: quotaSummary.availableCpuPercent,
    uptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version,
    npmVersion: versions.npmVersion,
    pythonVersion: versions.pythonVersion,
    pipVersion: versions.pipVersion,
    activeServersCount: quotaSummary.activeServersCount,
    totalServersCount: quotaSummary.totalServersCount,
  };
}
