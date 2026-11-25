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
  computePanelQuotaSummary,
  parseMeminfoSwapMb,
  parseOsPrettyName,
  parseProcStatCpuSnapshot,
  sampleHostCpuPercent,
  type HostCpuSamplerState,
  type ServerQuotaSample,
} from './host-stats-utils';
import {
  createNetworkTrafficState,
  recordProcessNetworkSample,
  resetNetworkTrafficState,
  sampleNetworkRates,
  type NetworkTrafficState,
} from './network-stats-utils';
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
  netSockServer: net.Server | null;
  netSockPath: string | null;
  logs: ConsoleLine[];
  partialBuffers: {
    stdout: PartialStreamBuffer;
    stderr: PartialStreamBuffer;
  };
  lastCpuJiffies?: number;
  lastSampleTimeMs?: number;
  cpuPercent: number;
  memoryMb: number;
  networkState: NetworkTrafficState;
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
  __nodalHostCpuSampler?: HostCpuSamplerState;
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
      netSockServer: null,
      netSockPath: null,
      logs: [],
      partialBuffers: {
        stdout: { text: '', timer: null },
        stderr: { text: '', timer: null },
      },
      cpuPercent: 0,
      memoryMb: 0,
      networkState: createNetworkTrafficState(),
    };
    map.set(serverId, state);
  }
  return state;
}

const RUNTIME_HOOKS_DIR = path.join(os.tmpdir(), 'cmnty-runtime-hooks');
const NODE_NET_HOOK_PATH = path.join(RUNTIME_HOOKS_DIR, 'node-net-hook.cjs');
const PYTHON_HOOK_DIR = path.join(RUNTIME_HOOKS_DIR, 'python');
const PYTHON_SITECUSTOMIZE_PATH = path.join(PYTHON_HOOK_DIR, 'sitecustomize.py');

const NODE_NET_HOOK_SOURCE = `'use strict';
const net = require('net');

const sockPath = process.env.CMNTY_NET_SOCK;
const scriptPath = process.argv[1] || '';
const isPackageRunner = /(?:^|[\\/\\\\])(?:npm|npx)-cli\\.js$|(?:^|[\\/\\\\])(?:yarn|pnpm)\\.(?:c?js|mjs)$/i.test(scriptPath);

if (sockPath && !isPackageRunner) {
  try {
    const dgram = require('dgram');
    const trackedSockets = new Set();
    let closedRxBytes = 0;
    let closedTxBytes = 0;
    let udpRxBytes = 0;
    let udpTxBytes = 0;
    let lastSentRx = -1;
    let lastSentTx = -1;
    let netTimer = null;

    function sendNetCounters(rx, tx) {
      if (rx === lastSentRx && tx === lastSentTx) return;
      lastSentRx = rx;
      lastSentTx = tx;
      try {
        const conn = net.createConnection(sockPath, () => {
          conn.end(JSON.stringify({ pid: process.pid, netRxBytes: rx, netTxBytes: tx }) + '\\n');
        });
        conn.on('error', () => {});
        conn.unref();
      } catch {}
    }

    function flushNetSample() {
      let rx = closedRxBytes + udpRxBytes;
      let tx = closedTxBytes + udpTxBytes;
      for (const sock of trackedSockets) {
        try {
          rx += Math.max(0, Number(sock.bytesRead) || 0);
          tx += Math.max(0, Number(sock.bytesWritten) || 0);
        } catch {}
      }
      sendNetCounters(rx, tx);
    }

    function ensureNetTimer() {
      if (netTimer) return;
      netTimer = setInterval(flushNetSample, 800);
      if (netTimer.unref) netTimer.unref();
    }

    function trackTcpSocket(sock) {
      if (!sock || sock._cmntyNetTracked || sock._parent) return;
      sock._cmntyNetTracked = true;
      trackedSockets.add(sock);
      ensureNetTimer();
      sock.once('close', () => {
        try {
          closedRxBytes += Math.max(0, Number(sock.bytesRead) || 0);
          closedTxBytes += Math.max(0, Number(sock.bytesWritten) || 0);
        } catch {}
        trackedSockets.delete(sock);
        flushNetSample();
      });
    }

    const origConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const first = args[0];
      const isUnix =
        typeof first === 'string' ||
        (first && typeof first === 'object' && typeof first.path === 'string' && !first.port && !first.host);
      if (!isUnix) {
        trackTcpSocket(this);
      }
      return origConnect.apply(this, args);
    };

    const origServerEmit = net.Server.prototype.emit;
    net.Server.prototype.emit = function (ev, ...args) {
      if (ev === 'connection' && args[0] && !this._pipeName) {
        trackTcpSocket(args[0]);
      }
      return origServerEmit.apply(this, [ev, ...args]);
    };

    const origDgramEmit = dgram.Socket.prototype.emit;
    dgram.Socket.prototype.emit = function (ev, ...args) {
      if (ev === 'message' && args[0] && typeof args[0].length === 'number') {
        udpRxBytes += args[0].length;
        ensureNetTimer();
      }
      return origDgramEmit.apply(this, [ev, ...args]);
    };

    const origDgramSend = dgram.Socket.prototype.send;
    dgram.Socket.prototype.send = function (msg, ...rest) {
      try {
        if (typeof msg === 'string' || Buffer.isBuffer(msg) || ArrayBuffer.isView(msg)) {
          const offset = typeof rest[0] === 'number' && typeof rest[1] === 'number' ? rest[1] : msg.byteLength ?? msg.length;
          udpTxBytes += Math.max(0, Number(offset) || 0);
          ensureNetTimer();
        }
      } catch {}
      return origDgramSend.apply(this, [msg, ...rest]);
    };
  } catch {}
}
`;

const PYTHON_SITECUSTOMIZE_SOURCE = `import json
import os

_sock_path = os.environ.get("CMNTY_NET_SOCK")

if _sock_path:
    try:
        import threading
        import _socket
        import socket as _stdlib_socket

        _orig_c_socket = _socket.socket
        _orig_stdlib_socket = _stdlib_socket.socket
        _net_lock = threading.Lock()
        _net_rx = 0
        _net_tx = 0
        _net_started = False
        _inet_families = tuple(
            getattr(_socket, name) for name in ("AF_INET", "AF_INET6") if hasattr(_socket, name)
        )

        def _net_reporter():
            import time
            last_rx = -1
            last_tx = -1
            while True:
                time.sleep(0.8)
                with _net_lock:
                    rx = _net_rx
                    tx = _net_tx
                if rx != last_rx or tx != last_tx:
                    last_rx = rx
                    last_tx = tx
                    try:
                        c = _orig_c_socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
                        c.connect(_sock_path)
                        c.sendall((json.dumps({"pid": os.getpid(), "netRxBytes": rx, "netTxBytes": tx}) + "\\n").encode("utf-8"))
                        c.close()
                    except Exception:
                        pass

        def _ensure_net_thread():
            global _net_started
            if _net_started:
                return
            _net_started = True
            t = threading.Thread(target=_net_reporter, daemon=True)
            t.start()

        def _add_rx(n):
            global _net_rx
            if n and n > 0:
                with _net_lock:
                    _net_rx += int(n)
                _ensure_net_thread()

        def _add_tx(n):
            global _net_tx
            if n and n > 0:
                with _net_lock:
                    _net_tx += int(n)
                _ensure_net_thread()

        class _CmntyTrackedSocket(_orig_stdlib_socket):
            def _is_inet(self):
                try:
                    return self.family in _inet_families
                except Exception:
                    return False

            def recv(self, bufsize, flags=0):
                data = super().recv(bufsize, flags)
                if self._is_inet():
                    _add_rx(len(data))
                return data

            def recv_into(self, buffer, nbytes=0, flags=0):
                n = super().recv_into(buffer, nbytes, flags)
                if self._is_inet():
                    _add_rx(n)
                return n

            def recvfrom(self, bufsize, flags=0):
                data, addr = super().recvfrom(bufsize, flags)
                if self._is_inet():
                    _add_rx(len(data))
                return data, addr

            def recvfrom_into(self, buffer, nbytes=0, flags=0):
                n, addr = super().recvfrom_into(buffer, nbytes, flags)
                if self._is_inet():
                    _add_rx(n)
                return n, addr

            def send(self, data, flags=0):
                n = super().send(data, flags)
                if self._is_inet():
                    _add_tx(n)
                return n

            def sendall(self, data, flags=0):
                res = super().sendall(data, flags)
                if self._is_inet():
                    try:
                        _add_tx(len(data))
                    except Exception:
                        pass
                return res

            def sendto(self, data, *args):
                n = super().sendto(data, *args)
                if self._is_inet():
                    _add_tx(n)
                return n

        _stdlib_socket.socket = _CmntyTrackedSocket
    except Exception:
        pass
`;

function ensureRuntimeHooks(): void {
  if (!fs.existsSync(PYTHON_HOOK_DIR)) {
    fs.mkdirSync(PYTHON_HOOK_DIR, { recursive: true });
  }
  if (!fs.existsSync(NODE_NET_HOOK_PATH) || fs.readFileSync(NODE_NET_HOOK_PATH, 'utf8') !== NODE_NET_HOOK_SOURCE) {
    fs.writeFileSync(NODE_NET_HOOK_PATH, NODE_NET_HOOK_SOURCE, 'utf8');
  }
  if (!fs.existsSync(PYTHON_SITECUSTOMIZE_PATH) || fs.readFileSync(PYTHON_SITECUSTOMIZE_PATH, 'utf8') !== PYTHON_SITECUSTOMIZE_SOURCE) {
    fs.writeFileSync(PYTHON_SITECUSTOMIZE_PATH, PYTHON_SITECUSTOMIZE_SOURCE, 'utf8');
  }
}

function cleanupNetMonitor(state: ManagedProcess): void {
  if (state.netSockServer) {
    try {
      state.netSockServer.close();
    } catch {
      // ignore
    }
    state.netSockServer = null;
  }
  if (state.netSockPath) {
    try {
      fs.rmSync(state.netSockPath, { force: true });
    } catch {
      // ignore
    }
    state.netSockPath = null;
  }
}

async function setupNetMonitor(serverId: string, state: ManagedProcess): Promise<{
  sockPath: string;
}> {
  cleanupNetMonitor(state);
  ensureRuntimeHooks();

  const token = crypto.randomBytes(5).toString('hex');
  const sockPath = path.join(os.tmpdir(), `cmnty-net-${serverId}-${token}.sock`);

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
            const msg = JSON.parse(rawLine) as {
              pid?: number;
              netRxBytes?: number;
              netTxBytes?: number;
            };
            if (
              typeof msg.netRxBytes === 'number' ||
              typeof msg.netTxBytes === 'number'
            ) {
              const samplePid = Number(msg.pid || state.pid || 1);
              recordProcessNetworkSample(
                state.networkState,
                samplePid,
                Number(msg.netRxBytes || 0),
                Number(msg.netTxBytes || 0),
                Date.now()
              );
            }
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

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.once('listening', finish);
    server.on('error', () => {
      // ignore transient socket errors and avoid hanging startup
      finish();
    });
    server.listen(sockPath);
  });

  state.netSockServer = server;
  state.netSockPath = sockPath;

  return { sockPath };
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
    const childrenByParent = new Map<number, number[]>();
    const pgrpMembers = new Map<number, number[]>();

    for (const entry of procEntries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen === -1) continue;
        const fields = stat.slice(closeParen + 2).split(' ');
        const ppid = Number(fields[1] || 0);
        const pgrp = Number(fields[2] || 0);
        if (ppid > 0) {
          const list = childrenByParent.get(ppid);
          if (list) list.push(pid);
          else childrenByParent.set(ppid, [pid]);
        }
        if (pgrp > 0) {
          const grp = pgrpMembers.get(pgrp);
          if (grp) grp.push(pid);
          else pgrpMembers.set(pgrp, [pid]);
        }
      } catch {
        // process may have exited while scanning
      }
    }

    const queue: number[] = [rootPid];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const directChildren = childrenByParent.get(current);
      if (directChildren) {
        for (const childPid of directChildren) {
          if (!pids.has(childPid)) {
            pids.add(childPid);
            queue.push(childPid);
          }
        }
      }
      const sameGroup = pgrpMembers.get(current);
      if (sameGroup) {
        for (const grpPid of sameGroup) {
          if (!pids.has(grpPid)) {
            pids.add(grpPid);
            queue.push(grpPid);
          }
        }
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
      cleanupNetMonitor(state);
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
  const netRates = isActive
    ? sampleNetworkRates(state.networkState, Date.now())
    : { rxBytesPerSec: 0, txBytesPerSec: 0 };

  return {
    status: state.status,
    pid: state.pid,
    cpuPercent,
    memoryMb,
    networkRxBytesPerSec: netRates.rxBytesPerSec,
    networkTxBytesPerSec: netRates.txBytesPerSec,
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
  netMonitor?: { sockPath: string }
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
    if (netMonitor) {
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

  if (server.runtime === 'nodejs' && netMonitor) {
    const requireFlag = NODE_NET_HOOK_PATH.includes(' ')
      ? `--require "${NODE_NET_HOOK_PATH}"`
      : `--require ${NODE_NET_HOOK_PATH}`;
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
    ...(netMonitor
      ? {
          CMNTY_NET_SOCK: netMonitor.sockPath,
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

function needsDependencyInstall(server: ServerConfig, cwd: string): boolean {
  if (server.runtime === 'nodejs') {
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return (
        Object.keys(pkgJson.dependencies || {}).length +
          Object.keys(pkgJson.devDependencies || {}).length >
        0
      );
    } catch {
      return true;
    }
  }

  const reqPath = path.join(cwd, 'requirements.txt');
  if (!fs.existsSync(reqPath)) return false;
  const reqLines = fs
    .readFileSync(reqPath, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return reqLines.length > 0;
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
      state.startedAtMs = null;
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
      if (state.manualStop) {
        state.status = 'stopped';
        state.pid = null;
        state.startedAtMs = null;
        state.cpuPercent = 0;
        state.memoryMb = 0;
        emitStatus(server.id);
        throw err;
      }
      state.status = 'error';
      state.pid = null;
      state.startedAtMs = null;
      state.cpuPercent = 0;
      state.memoryMb = 0;
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
      try {
        await runProcessCommand(server.id, cwd, 'python3', ['-m', 'venv', '.venv']);
      } catch (venvErr) {
        if (state.manualStop) throw venvErr;
        if (fs.existsSync(path.join(cwd, '.venv'))) {
          fs.rmSync(path.join(cwd, '.venv'), { recursive: true, force: true });
        }
      }
    }

    if (state.manualStop) {
      throw new Error('Installation aborted by user.');
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
    if (state.manualStop) {
      state.status = 'stopped';
      state.pid = null;
      state.startedAtMs = null;
      state.cpuPercent = 0;
      state.memoryMb = 0;
      emitStatus(server.id);
      throw err;
    }
    state.status = 'error';
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
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

async function launchServerProcess(
  server: ServerConfig,
  cwd: string,
  parsed: ReturnType<typeof parseSafeStartupCommand>,
  skipInstallCheck: boolean
): Promise<void> {
  const serverId = server.id;
  const state = getOrCreateState(serverId);

  if (!skipInstallCheck) {
    try {
      await ensureServerDependencies(server, cwd);
    } catch {
      return;
    }
  }

  if (state.manualStop) {
    state.status = 'stopped';
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    emitStatus(serverId);
    return;
  }

  const launchExecutable =
    server.runtime === 'python'
      ? resolvePythonExecutable(cwd, parsed.executable)
      : resolveNodeExecutable(cwd, parsed.executable);

  state.status = 'starting';
  emitStatus(serverId);

  const netMonitor = await setupNetMonitor(serverId, state);

  if (state.manualStop) {
    cleanupNetMonitor(state);
    state.status = 'stopped';
    state.pid = null;
    state.startedAtMs = null;
    emitStatus(serverId);
    return;
  }

  appendLog(serverId, 'system', `container@cmnty~ ${server.startupCommand}`);

  const child = spawn(launchExecutable, parsed.args, {
    cwd,
    env: buildSafeEnv(serverId, netMonitor),
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
    cleanupNetMonitor(state);
    appendLog(serverId, 'system', `Failed to start container process: ${err.message}`);
    state.status = 'error';
    state.child = null;
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    resetNetworkTrafficState(state.networkState);
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
  });

  child.on('close', (code) => {
    flushStreamBuffer(serverId, 'stdout');
    flushStreamBuffer(serverId, 'stderr');
    cleanupNetMonitor(state);
    state.child = null;
    state.pid = null;
    state.exitCode = code;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    resetNetworkTrafficState(state.networkState);
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
  resetNetworkTrafficState(state.networkState);
  emitStatus(serverId);

  appendLog(serverId, 'system', 'Server marked as starting...');
  appendLog(serverId, 'system', 'Checking server disk space usage, this could take a few seconds...');
  appendLog(serverId, 'system', 'Updating process configuration files...');
  appendLog(serverId, 'system', 'Ensuring file permissions are set correctly, this could take a few seconds...');

  let cwd: string;
  let parsed: ReturnType<typeof parseSafeStartupCommand>;
  try {
    cwd = ensureServerDir(serverId);
    parsed = parseSafeStartupCommand(server.startupCommand, server.runtime);

    if (parsed.npmScriptName) {
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        throw new Error(
          `Entrypoint file "package.json" was not found in this server directory.`
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
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    const msg = err instanceof Error ? err.message : 'Invalid startup script configuration.';
    appendLog(serverId, 'system', `Failed to start server: ${msg}`);
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
    throw err;
  }

  const requiresInstall = needsDependencyInstall(server, cwd);
  state.status = requiresInstall ? 'installing' : 'starting';
  emitStatus(serverId);

  if (requiresInstall) {
    // Run dependency installation and process launch asynchronously so power API does not time out
    void launchServerProcess(server, cwd, parsed, false);
    return getServerMetrics(serverId);
  }

  await launchServerProcess(server, cwd, parsed, true);
  return getServerMetrics(serverId);
}

export async function stopServerProcess(serverId: string, forceKill = false): Promise<ServerRuntimeMetrics> {
  const state = getOrCreateState(serverId);
  if (state.installChild) {
    state.manualStop = true;
    state.status = 'stopping';
    emitStatus(serverId);
    const installChild = state.installChild;

    if (forceKill) {
      appendLog(serverId, 'system', 'Server marked as killing (SIGKILL)...');
      killProcessTree(installChild, 'SIGKILL');
    } else {
      appendLog(serverId, 'system', 'Server marked as stopping...');
      killProcessTree(installChild, 'SIGTERM');
    }

    await new Promise<void>((resolve) => {
      if (!state.installChild) {
        resolve();
        return;
      }
      let settled = false;
      let killGraceTimer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killGraceTimer) clearTimeout(killGraceTimer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (state.installChild) {
          appendLog(serverId, 'system', 'Installer did not respond to stop signal; sending SIGKILL...');
          killProcessTree(state.installChild, 'SIGKILL');
          killGraceTimer = setTimeout(done, 1200);
        } else {
          done();
        }
      }, forceKill ? 1200 : 3500);

      installChild.once('close', done);
    });

    state.installChild = null;
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    state.status = 'stopped';
    resetNetworkTrafficState(state.networkState);
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
    return getServerMetrics(serverId);
  }

  if (!state.child || !state.pid) {
    state.manualStop = true;
    state.status = 'stopped';
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    resetNetworkTrafficState(state.networkState);
    emitStatus(serverId);
    return getServerMetrics(serverId);
  }

  state.manualStop = true;
  state.status = 'stopping';
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
    let settled = false;
    let killGraceTimer: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killGraceTimer) clearTimeout(killGraceTimer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (state.child) {
        appendLog(serverId, 'system', 'Server did not respond to stop signal; sending SIGKILL...');
        killProcessTree(state.child, 'SIGKILL');
        killGraceTimer = setTimeout(done, 1200);
      } else {
        done();
      }
    }, forceKill ? 1200 : 3500);

    child.once('close', done);
  });

  cleanupNetMonitor(state);
  if (state.child === child || state.status === 'stopping') {
    state.child = null;
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    state.status = 'stopped';
    resetNetworkTrafficState(state.networkState);
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
  }
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
    throw new Error('Server is offline. Start the server first before sending commands.');
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
  if (globalForPm.__nodalHostCpuSampler?.lastSnapshot) return;
  try {
    if (fs.existsSync('/proc/stat')) {
      const stat = fs.readFileSync('/proc/stat', 'utf8');
      const snap = parseProcStatCpuSnapshot(stat);
      if (snap) {
        globalForPm.__nodalHostCpuSampler = {
          lastSnapshot: snap,
          lastSampleAtMs: Date.now(),
          lastPercent: null,
        };
      }
    }
  } catch {
    // ignore
  }
}

primeHostCpuBaseline();

function detectHostCpuPercent(load1m: number, cpuCores: number): number {
  const fallback = Number(Math.min(100, (load1m / Math.max(1, cpuCores)) * 100).toFixed(1));
  const currentSampler: HostCpuSamplerState = globalForPm.__nodalHostCpuSampler ?? {
    lastSnapshot: null,
    lastSampleAtMs: 0,
    lastPercent: null,
  };

  try {
    if (fs.existsSync('/proc/stat')) {
      const stat = fs.readFileSync('/proc/stat', 'utf8');
      const current = parseProcStatCpuSnapshot(stat);
      const result = sampleHostCpuPercent(currentSampler, current, Date.now(), fallback, 900);
      globalForPm.__nodalHostCpuSampler = result.nextState;
      return result.percent;
    }
  } catch {
    // fallback below
  }
  return currentSampler.lastPercent ?? fallback;
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
