import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { getServerById, listAllServers } from './db';
import {
  createStreamPartialState,
  processStreamChunk,
  sealStreamPartial,
  type StreamPartialState,
} from './console-stream';
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
import {
  assertSafeConsolePathArg,
  parseSafeConsoleRuntimeCommand,
  parseSafeStartupCommand,
  resolveSafePath,
  splitChainedConsoleCommands,
  tokenizeConsoleCommand,
} from './security';
import {
  normalizeConsoleInputMode,
  type ConsoleInputMode,
} from './console-state';
import { emitWorkspaceChanged } from './realtime-bus';
import type { ConsoleLine, HostInfo, ServerConfig, ServerRuntimeMetrics, ServerStatus } from './types';

interface ManagedProcess {
  serverId: string;
  status: ServerStatus;
  child: ChildProcessWithoutNullStreams | null;
  installChild: ChildProcessWithoutNullStreams | null;
  shellChild: ChildProcessWithoutNullStreams | null;
  shellRelDir: string;
  stdinActive: boolean;
  pid: number | null;
  startedAtMs: number | null;
  exitCode: number | null;
  manualStop: boolean;
  oomKilled: boolean;
  netSockServer: net.Server | null;
  netSockPath: string | null;
  logs: ConsoleLine[];
  partialStates: {
    stdout: StreamPartialState;
    stderr: StreamPartialState;
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
      shellChild: null,
      shellRelDir: '',
      stdinActive: false,
      pid: null,
      startedAtMs: null,
      exitCode: null,
      manualStop: false,
      oomKilled: false,
      netSockServer: null,
      netSockPath: null,
      logs: [],
      partialStates: {
        stdout: createStreamPartialState(),
        stderr: createStreamPartialState(),
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

    function sendHookPayload(payload) {
      try {
        const conn = net.createConnection(sockPath, () => {
          conn.end(JSON.stringify(payload) + '\\n');
        });
        conn.on('error', () => {});
        conn.unref();
      } catch {}
    }

    function sendNetCounters(rx, tx) {
      if (rx === lastSentRx && tx === lastSentTx) return;
      lastSentRx = rx;
      lastSentTx = tx;
      sendHookPayload({ pid: process.pid, netRxBytes: rx, netTxBytes: tx });
    }

    try {
      const fsMod = require('fs');
      let lastSentStdinActive = false;
      let stdinOffTimer = null;
      let stdinResumed = false;
      let fd0Reads = 0;

      function hasStdinListeners() {
        try {
          return (
            process.stdin.listenerCount('data') > 0 ||
            process.stdin.listenerCount('readable') > 0 ||
            process.stdin.listenerCount('keypress') > 0
          );
        } catch {
          return false;
        }
      }

      function publishStdinState(active) {
        if (active) {
          if (stdinOffTimer) {
            clearTimeout(stdinOffTimer);
            stdinOffTimer = null;
          }
          if (!lastSentStdinActive) {
            lastSentStdinActive = true;
            sendHookPayload({ pid: process.pid, stdinActive: true });
          }
          return;
        }
        if (!lastSentStdinActive || stdinOffTimer) return;
        stdinOffTimer = setTimeout(() => {
          stdinOffTimer = null;
          const stillActive = hasStdinListeners() || stdinResumed || fd0Reads > 0;
          if (!stillActive && lastSentStdinActive) {
            lastSentStdinActive = false;
            sendHookPayload({ pid: process.pid, stdinActive: false });
          }
        }, 140);
        if (stdinOffTimer.unref) stdinOffTimer.unref();
      }

      function evaluateStdinState() {
        publishStdinState(hasStdinListeners() || stdinResumed || fd0Reads > 0);
      }

      process.stdin.on('newListener', (ev) => {
        if (ev === 'data' || ev === 'readable' || ev === 'keypress') {
          publishStdinState(true);
        }
      });

      process.stdin.on('removeListener', (ev) => {
        if (ev === 'data' || ev === 'readable' || ev === 'keypress') {
          evaluateStdinState();
        }
      });

      const origResume = process.stdin.resume;
      process.stdin.resume = function (...args) {
        stdinResumed = true;
        publishStdinState(true);
        return origResume.apply(this, args);
      };

      const origPause = process.stdin.pause;
      process.stdin.pause = function (...args) {
        stdinResumed = false;
        const res = origPause.apply(this, args);
        evaluateStdinState();
        return res;
      };

      const origReadSync = fsMod.readSync;
      fsMod.readSync = function (fd, ...rest) {
        if (fd === 0) {
          fd0Reads += 1;
          publishStdinState(true);
          try {
            return origReadSync.apply(this, [fd, ...rest]);
          } finally {
            fd0Reads = Math.max(0, fd0Reads - 1);
            evaluateStdinState();
          }
        }
        return origReadSync.apply(this, [fd, ...rest]);
      };

      const origRead = fsMod.read;
      fsMod.read = function (fd, ...rest) {
        if (fd === 0 && typeof rest[rest.length - 1] === 'function') {
          const origCb = rest[rest.length - 1];
          fd0Reads += 1;
          publishStdinState(true);
          rest[rest.length - 1] = function (...cbArgs) {
            fd0Reads = Math.max(0, fd0Reads - 1);
            evaluateStdinState();
            return origCb.apply(this, cbArgs);
          };
        }
        return origRead.apply(this, [fd, ...rest]);
      };
    } catch {}

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

        try:
            import builtins as _builtins
            import sys as _sys

            _stdin_lock = threading.Lock()
            _stdin_depth = 0
            _stdin_active = False
            _stdin_off_timer = None

            def _send_stdin_active(val):
                try:
                    c = _orig_c_socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
                    c.connect(_sock_path)
                    c.sendall((json.dumps({"pid": os.getpid(), "stdinActive": bool(val)}) + "\\n").encode("utf-8"))
                    c.close()
                except Exception:
                    pass

            def _stdin_off_check():
                global _stdin_active, _stdin_off_timer
                with _stdin_lock:
                    _stdin_off_timer = None
                    if _stdin_depth == 0 and _stdin_active:
                        _stdin_active = False
                        _send_stdin_active(False)

            def _stdin_enter():
                global _stdin_depth, _stdin_active, _stdin_off_timer
                should_send = False
                with _stdin_lock:
                    _stdin_depth += 1
                    if _stdin_off_timer is not None:
                        _stdin_off_timer.cancel()
                        _stdin_off_timer = None
                    if not _stdin_active:
                        _stdin_active = True
                        should_send = True
                if should_send:
                    _send_stdin_active(True)

            def _stdin_exit():
                global _stdin_depth, _stdin_off_timer
                with _stdin_lock:
                    _stdin_depth = max(0, _stdin_depth - 1)
                    if _stdin_depth == 0 and _stdin_active and _stdin_off_timer is None:
                        t = threading.Timer(0.15, _stdin_off_check)
                        t.daemon = True
                        t.start()
                        _stdin_off_timer = t

            _orig_input = _builtins.input
            def _cmnty_input(*args, **kwargs):
                _stdin_enter()
                try:
                    return _orig_input(*args, **kwargs)
                finally:
                    _stdin_exit()
            _builtins.input = _cmnty_input

            _orig_os_read = os.read
            def _cmnty_os_read(fd, n):
                if fd == 0:
                    _stdin_enter()
                    try:
                        return _orig_os_read(fd, n)
                    finally:
                        _stdin_exit()
                return _orig_os_read(fd, n)
            os.read = _cmnty_os_read

            _orig_stdin = _sys.stdin
            if _orig_stdin is not None:
                class _CmntyStdinProxy:
                    def __init__(self, inner):
                        self._inner = inner
                    def read(self, *args, **kwargs):
                        _stdin_enter()
                        try:
                            return self._inner.read(*args, **kwargs)
                        finally:
                            _stdin_exit()
                    def readline(self, *args, **kwargs):
                        _stdin_enter()
                        try:
                            return self._inner.readline(*args, **kwargs)
                        finally:
                            _stdin_exit()
                    def readlines(self, *args, **kwargs):
                        _stdin_enter()
                        try:
                            return self._inner.readlines(*args, **kwargs)
                        finally:
                            _stdin_exit()
                    def __iter__(self):
                        return self
                    def __next__(self):
                        _stdin_enter()
                        try:
                            line = self._inner.readline()
                            if line == "":
                                raise StopIteration
                            return line
                        finally:
                            _stdin_exit()
                    def __getattr__(self, name):
                        return getattr(self._inner, name)
                _sys.stdin = _CmntyStdinProxy(_orig_stdin)
        except Exception:
            pass
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
              stdinActive?: boolean;
            };
            if (typeof msg.stdinActive === 'boolean') {
              state.stdinActive = msg.stdinActive;
            }
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
  sealStreamPartial(state.partialStates.stdout);
  sealStreamPartial(state.partialStates.stderr);
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
  sealStreamPartial(state.partialStates[stream]);
}

function appendStreamChunk(
  serverId: string,
  stream: 'stdout' | 'stderr',
  rawText: string
): void {
  const state = getOrCreateState(serverId);
  const emitted = processStreamChunk({
    logs: state.logs,
    partial: state.partialStates[stream],
    stream,
    rawText,
    maxLines: MAX_LOG_LINES,
    createId: () => crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
  const emitter = getEmitter();
  for (const entry of emitted) {
    emitter.emit(`log:${serverId}`, entry);
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
  sealStreamPartial(state.partialStates.stdout);
  sealStreamPartial(state.partialStates.stderr);
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
    TERM: 'xterm-256color',
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
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

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    child.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (text) appendLog(serverId, 'stdout', text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) appendLog(serverId, 'stderr', text);
    });
    child.on('error', (err) => {
      const remOut = stdoutDecoder.end();
      if (remOut) appendLog(serverId, 'stdout', remOut);
      const remErr = stderrDecoder.end();
      if (remErr) appendLog(serverId, 'stderr', remErr);
      flushStreamBuffer(serverId, 'stdout');
      flushStreamBuffer(serverId, 'stderr');
      if (state.installChild === child) {
        state.installChild = null;
        if (!state.child) state.pid = null;
      }
      reject(new Error(`Failed to execute ${executable}: ${err.message}`));
    });
    child.on('close', (code) => {
      const remOut = stdoutDecoder.end();
      if (remOut) appendLog(serverId, 'stdout', remOut);
      const remErr = stderrDecoder.end();
      if (remErr) appendLog(serverId, 'stderr', remErr);
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
  state.stdinActive = false;
  state.pid = child.pid ?? null;
  state.startedAtMs = Date.now();
  state.status = 'running';
  appendLog(serverId, 'system', 'Server marked as running...');
  emitStatus(serverId);

  child.stdin.on('error', () => {
    // ignore EPIPE if process exits mid-write
  });

  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  child.stdout.on('data', (chunk: Buffer) => {
    const text = stdoutDecoder.write(chunk);
    if (text) appendLog(serverId, 'stdout', text);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    const text = stderrDecoder.write(chunk);
    if (text) appendLog(serverId, 'stderr', text);
  });

  child.on('error', (err) => {
    const remOut = stdoutDecoder.end();
    if (remOut) appendLog(serverId, 'stdout', remOut);
    const remErr = stderrDecoder.end();
    if (remErr) appendLog(serverId, 'stderr', remErr);
    flushStreamBuffer(serverId, 'stdout');
    flushStreamBuffer(serverId, 'stderr');
    cleanupNetMonitor(state);
    appendLog(serverId, 'system', `Failed to start container process: ${err.message}`);
    state.status = 'error';
    state.child = null;
    state.stdinActive = false;
    state.pid = null;
    state.startedAtMs = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    resetNetworkTrafficState(state.networkState);
    appendLog(serverId, 'system', 'Server marked as offline...');
    emitStatus(serverId);
  });

  child.on('close', (code) => {
    const remOut = stdoutDecoder.end();
    if (remOut) appendLog(serverId, 'stdout', remOut);
    const remErr = stderrDecoder.end();
    if (remErr) appendLog(serverId, 'stderr', remErr);
    flushStreamBuffer(serverId, 'stdout');
    flushStreamBuffer(serverId, 'stderr');
    cleanupNetMonitor(state);
    state.child = null;
    state.stdinActive = false;
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
  if (state.shellChild) {
    try {
      killProcessTree(state.shellChild, forceKill ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // ignore already exited
    }
    if (!state.child && !state.installChild) {
      appendLog(serverId, 'system', 'Perintah container shell dihentikan.');
      state.shellChild = null;
      return getServerMetrics(serverId);
    }
  }

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
    state.stdinActive = false;
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
    state.stdinActive = false;
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
  if (state.child || state.installChild || state.shellChild) {
    await stopServerProcess(serverId, false);
  }
  return startServerProcess(serverId);
}

function assertConsoleTargetRealContainment(baseDir: string, targetPath: string): void {
  const realBase = fs.realpathSync(baseDir);
  if (fs.existsSync(targetPath)) {
    const realTarget = fs.realpathSync(targetPath);
    if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
      throw new Error('Akses symlink ke luar direktori container ditolak.');
    }
    return;
  }
  let probe = path.dirname(targetPath);
  while (probe && probe.length >= baseDir.length) {
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync(probe);
      if (realProbe !== realBase && !realProbe.startsWith(realBase + path.sep)) {
        throw new Error('Path berada di luar direktori container.');
      }
      break;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
}

function resolveContainerArgPath(baseDir: string, currentRelDir: string, rawArg: string): string {
  assertSafeConsolePathArg(rawArg);
  let relInput = rawArg;
  if (relInput === '/home/container') {
    relInput = '';
  } else if (relInput.startsWith('/home/container/')) {
    relInput = relInput.slice('/home/container/'.length);
  } else if (currentRelDir) {
    relInput = path.posix.join(currentRelDir.replace(/\\/g, '/'), relInput);
  }
  const target = resolveSafePath(baseDir, relInput);
  assertConsoleTargetRealContainment(baseDir, target);
  return target;
}

function getShellWorkingDir(baseDir: string, state: ManagedProcess): string {
  if (!state.shellRelDir) return baseDir;
  try {
    const dir = resolveSafePath(baseDir, state.shellRelDir);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      assertConsoleTargetRealContainment(baseDir, dir);
      return dir;
    }
  } catch {
    // reset invalid working dir back to container root
  }
  state.shellRelDir = '';
  return baseDir;
}

function formatByteSizeCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function spawnShellRuntimeCommand(
  serverId: string,
  state: ManagedProcess,
  cwd: string,
  workDir: string,
  executable: string,
  args: string[],
  isMutating: boolean
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workDir,
      env: buildSafeEnv(serverId),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    state.shellChild = child;
    child.stdin.on('error', () => {
      // ignore EPIPE
    });

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    child.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (text) appendLog(serverId, 'stdout', text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) appendLog(serverId, 'stderr', text);
    });
    child.on('error', (err) => {
      const remOut = stdoutDecoder.end();
      if (remOut) appendLog(serverId, 'stdout', remOut);
      const remErr = stderrDecoder.end();
      if (remErr) appendLog(serverId, 'stderr', remErr);
      flushStreamBuffer(serverId, 'stdout');
      flushStreamBuffer(serverId, 'stderr');
      if (state.shellChild === child) {
        state.shellChild = null;
      }
      reject(new Error(`Gagal menjalankan ${executable}: ${err.message}`));
    });
    child.on('close', (code) => {
      const remOut = stdoutDecoder.end();
      if (remOut) appendLog(serverId, 'stdout', remOut);
      const remErr = stderrDecoder.end();
      if (remErr) appendLog(serverId, 'stderr', remErr);
      flushStreamBuffer(serverId, 'stdout');
      flushStreamBuffer(serverId, 'stderr');
      if (state.shellChild === child) {
        state.shellChild = null;
      }
      if (isMutating) {
        emitWorkspaceChanged(`files:${serverId}`);
      }
      resolve(code ?? 1);
    });
  });
}

function resolveConsolePipInvocation(
  cwd: string,
  requestedExec: string,
  rawArgs: string[]
): { executable: string; args: string[] } {
  const venvPip = path.join(cwd, '.venv', 'bin', 'pip');
  if (fs.existsSync(venvPip)) {
    return { executable: venvPip, args: rawArgs };
  }

  const subcommand = rawArgs[0] || '';
  const hasTargetFlag = rawArgs.some((a) => a === '-t' || a === '--target' || a.startsWith('--target='));
  const hasPip3 = hasCommandOnSystem('pip3', ['--version']);
  const hasPyPip = hasCommandOnSystem('python3', ['-m', 'pip', '--version']);

  const extraArgs =
    subcommand === 'install' && !hasTargetFlag && !fs.existsSync(venvPip)
      ? ['--no-cache-dir', '--target', '.py_packages', ...rawArgs.slice(1)]
      : rawArgs.slice(1);

  if (hasPip3) {
    return {
      executable: 'pip3',
      args: subcommand ? [subcommand, ...extraArgs] : rawArgs,
    };
  }
  if (hasPyPip) {
    return {
      executable: 'python3',
      args: ['-m', 'pip', ...(subcommand ? [subcommand, ...extraArgs] : rawArgs)],
    };
  }
  throw new Error(
    `${requestedExec} tidak tersedia di sistem host (pip3 / python3-venv tidak ditemukan).`
  );
}

async function executeConsoleShellSegment(
  server: ServerConfig,
  state: ManagedProcess,
  cwd: string,
  segment: string
): Promise<number> {
  const tokens = tokenizeConsoleCommand(segment);
  if (tokens.length === 0) return 0;

  const cmd = tokens[0];
  const args = tokens.slice(1);
  const workDir = getShellWorkingDir(cwd, state);
  const virtualPwd = state.shellRelDir ? `/home/container/${state.shellRelDir}` : '/home/container';

  switch (cmd) {
    case 'clear':
    case 'cls': {
      clearConsoleHistory(server.id);
      return 0;
    }
    case 'help': {
      appendLog(
        server.id,
        'stdout',
        [
          'Perintah Container & Panel:',
          '  Power      : start | stop | restart | kill | clear',
          '  Navigasi   : pwd | ls [-la] [dir] | cd [dir]',
          '  Berkas     : cat <file> | head [-n N] <file> | tail [-n N] <file>',
          '  Kelola     : mkdir [-p] <dir> | touch <file> | rm [-rf] <path> | mv <src> <dst> | cp [-r] <src> <dst>',
          '  Runtime    : npm <cmd> | npx <cmd> | node <args> | python3 <args> | pip <cmd>',
          '  Tips       : Gunakan awalan "!<cmd>" atau mode Shell untuk menjalankan perintah saat proses meminta stdin.',
          '',
        ].join('\n')
      );
      return 0;
    }
    case 'start': {
      if (state.status === 'running' || state.status === 'starting' || state.status === 'installing') {
        appendLog(server.id, 'system', `Server sudah dalam status ${state.status}.`);
        return 0;
      }
      await startServerProcess(server.id);
      return 0;
    }
    case 'stop': {
      if (state.shellChild) {
        killProcessTree(state.shellChild, 'SIGTERM');
        return 0;
      }
      if (state.status === 'stopped' || state.status === 'error') {
        appendLog(server.id, 'system', 'Server sudah dalam status offline.');
        return 0;
      }
      await stopServerProcess(server.id, false);
      return 0;
    }
    case 'restart': {
      await restartServerProcess(server.id);
      return 0;
    }
    case 'kill': {
      if (state.shellChild) {
        killProcessTree(state.shellChild, 'SIGKILL');
        return 0;
      }
      await stopServerProcess(server.id, true);
      return 0;
    }
    case 'pwd': {
      appendLog(server.id, 'stdout', `${virtualPwd}\n`);
      return 0;
    }
    case 'whoami': {
      appendLog(server.id, 'stdout', 'container\n');
      return 0;
    }
    case 'uname': {
      appendLog(server.id, 'stdout', `${os.type()} container ${os.release()} ${os.arch()}\n`);
      return 0;
    }
    case 'echo': {
      appendLog(server.id, 'stdout', `${args.join(' ')}\n`);
      return 0;
    }
    case 'env': {
      const safeEnv = buildSafeEnv(server.id);
      const hiddenKeys = new Set(['PATH', 'CMNTY_NET_SOCK', 'NODE_OPTIONS', 'PYTHONPATH']);
      const lines = Object.entries(safeEnv)
        .filter(([key, val]) => val !== undefined && !hiddenKeys.has(key))
        .map(([key, val]) => `${key}=${key === 'HOME' ? '/home/container' : val}`);
      appendLog(server.id, 'stdout', `${lines.join('\n')}\n`);
      return 0;
    }
    case 'which': {
      if (args.length === 0) {
        appendLog(server.id, 'stderr', 'which: sertakan nama perintah (mis. which node)\n');
        return 1;
      }
      for (const binName of args) {
        if (binName.includes('/') || binName.includes('\\')) {
          appendLog(server.id, 'stderr', `which: nama binary tidak valid: ${binName}\n`);
          return 1;
        }
        const safeExec = path.basename(binName);
        if (hasCommandOnSystem('which', [safeExec])) {
          const found = spawnSync('which', [safeExec], { encoding: 'utf8', shell: false });
          appendLog(server.id, 'stdout', `${(found.stdout || '').trim() || safeExec}\n`);
        } else {
          appendLog(server.id, 'stderr', `${safeExec} not found\n`);
        }
      }
      return 0;
    }
    case 'cd': {
      const targetArg = args[0] || '~';
      if (targetArg === '~' || targetArg === '/home/container') {
        state.shellRelDir = '';
        return 0;
      }
      if (targetArg === '-') {
        return 0;
      }
      let nextTarget: string;
      if (targetArg === '..' || targetArg.startsWith('../') || targetArg.includes('/../') || targetArg.endsWith('/..')) {
        const joined = path.posix.normalize(
          path.posix.join('/', state.shellRelDir.replace(/\\/g, '/'), targetArg)
        );
        const rel = joined.replace(/^\/+/, '');
        nextTarget = resolveSafePath(cwd, rel);
        assertConsoleTargetRealContainment(cwd, nextTarget);
      } else {
        nextTarget = resolveContainerArgPath(cwd, state.shellRelDir, targetArg);
      }
      if (!fs.existsSync(nextTarget)) {
        appendLog(server.id, 'stderr', `cd: ${targetArg}: No such file or directory\n`);
        return 1;
      }
      if (!fs.statSync(nextTarget).isDirectory()) {
        appendLog(server.id, 'stderr', `cd: ${targetArg}: Not a directory\n`);
        return 1;
      }
      const nextRel = path.relative(cwd, nextTarget).replace(/\\/g, '/');
      state.shellRelDir = nextRel === '.' ? '' : nextRel;
      return 0;
    }
    case 'ls':
    case 'll':
    case 'dir': {
      let showAll = cmd === 'll';
      let longFormat = cmd === 'll';
      let targetArg = '';
      for (const a of args) {
        if (a.startsWith('-')) {
          if (a.includes('a') || a.includes('A')) showAll = true;
          if (a.includes('l')) longFormat = true;
        } else if (!targetArg) {
          targetArg = a;
        }
      }
      const targetPath = targetArg
        ? resolveContainerArgPath(cwd, state.shellRelDir, targetArg)
        : workDir;
      if (!fs.existsSync(targetPath)) {
        appendLog(server.id, 'stderr', `${cmd}: cannot access '${targetArg}': No such file or directory\n`);
        return 1;
      }
      const st = fs.statSync(targetPath);
      if (!st.isDirectory()) {
        appendLog(
          server.id,
          'stdout',
          longFormat
            ? `-rw-r--r--  ${formatByteSizeCompact(st.size).padStart(7)}  ${path.basename(targetPath)}\n`
            : `${path.basename(targetPath)}\n`
        );
        return 0;
      }
      const entries = fs
        .readdirSync(targetPath, { withFileTypes: true })
        .filter((e) => showAll || !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      if (entries.length === 0) {
        appendLog(server.id, 'stdout', '(empty directory)\n');
        return 0;
      }
      if (longFormat) {
        const rows = entries.map((entry) => {
          let sizeLabel = '-';
          try {
            const est = fs.statSync(path.join(targetPath, entry.name));
            sizeLabel = entry.isDirectory() ? 'dir' : formatByteSizeCompact(est.size);
          } catch {
            sizeLabel = '-';
          }
          const prefix = entry.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--';
          const suffix = entry.isDirectory() ? '/' : '';
          return `${prefix}  ${sizeLabel.padStart(7)}  ${entry.name}${suffix}`;
        });
        appendLog(server.id, 'stdout', `${rows.join('\n')}\n`);
      } else {
        const names = entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
        appendLog(server.id, 'stdout', `${names.join('  ')}\n`);
      }
      return 0;
    }
    case 'cat':
    case 'head':
    case 'tail': {
      let lineLimit = cmd === 'cat' ? Infinity : 20;
      const fileArgs: string[] = [];
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if ((cmd === 'head' || cmd === 'tail') && a === '-n' && args[i + 1]) {
          const parsedN = Number(args[i + 1]);
          if (Number.isInteger(parsedN) && parsedN > 0) {
            lineLimit = Math.min(500, parsedN);
          }
          i += 1;
        } else if ((cmd === 'head' || cmd === 'tail') && /^-\d+$/.test(a)) {
          lineLimit = Math.min(500, Math.max(1, Number(a.slice(1))));
        } else if (!a.startsWith('-')) {
          fileArgs.push(a);
        }
      }
      if (fileArgs.length === 0) {
        appendLog(server.id, 'stderr', `${cmd}: sertakan nama file (mis. ${cmd} package.json)\n`);
        return 1;
      }
      for (const fArg of fileArgs) {
        const target = resolveContainerArgPath(cwd, state.shellRelDir, fArg);
        if (!fs.existsSync(target)) {
          appendLog(server.id, 'stderr', `${cmd}: ${fArg}: No such file or directory\n`);
          return 1;
        }
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          appendLog(server.id, 'stderr', `${cmd}: ${fArg}: Is a directory\n`);
          return 1;
        }
        const maxBytes = 256 * 1024;
        const fd = fs.openSync(target, 'r');
        let content = '';
        try {
          const readLen = Math.min(stat.size, maxBytes);
          const buf = Buffer.alloc(readLen);
          fs.readSync(fd, buf, 0, readLen, 0);
          if (buf.includes(0)) {
            appendLog(server.id, 'stderr', `${cmd}: ${fArg}: File biner tidak dapat ditampilkan\n`);
            return 1;
          }
          content = buf.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
        if (cmd === 'head' || cmd === 'tail') {
          const split = content.replace(/\r\n/g, '\n').split('\n');
          const sliced = cmd === 'head' ? split.slice(0, lineLimit) : split.slice(-lineLimit);
          content = sliced.join('\n');
        }
        appendLog(server.id, 'stdout', content.endsWith('\n') ? content : `${content}\n`);
        if (stat.size > maxBytes && cmd === 'cat') {
          appendLog(server.id, 'system', `Output dipotong pada 256 KiB (ukuran total ${formatByteSizeCompact(stat.size)}).`);
        }
      }
      return 0;
    }
    case 'mkdir': {
      const dirs = args.filter((a) => !a.startsWith('-'));
      if (dirs.length === 0) {
        appendLog(server.id, 'stderr', 'mkdir: sertakan nama direktori\n');
        return 1;
      }
      for (const dirArg of dirs) {
        const target = resolveContainerArgPath(cwd, state.shellRelDir, dirArg);
        fs.mkdirSync(target, { recursive: true });
      }
      emitWorkspaceChanged(`files:${server.id}`);
      return 0;
    }
    case 'touch': {
      const files = args.filter((a) => !a.startsWith('-'));
      if (files.length === 0) {
        appendLog(server.id, 'stderr', 'touch: sertakan nama file\n');
        return 1;
      }
      const now = new Date();
      for (const fileArg of files) {
        const target = resolveContainerArgPath(cwd, state.shellRelDir, fileArg);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) {
          fs.utimesSync(target, now, now);
        } else {
          fs.writeFileSync(target, '', 'utf8');
        }
      }
      emitWorkspaceChanged(`files:${server.id}`);
      return 0;
    }
    case 'rm': {
      let recursive = false;
      let force = false;
      const targets: string[] = [];
      for (const a of args) {
        if (a.startsWith('-')) {
          if (a.includes('r') || a.includes('R')) recursive = true;
          if (a.includes('f')) force = true;
        } else {
          targets.push(a);
        }
      }
      if (targets.length === 0) {
        appendLog(server.id, 'stderr', 'rm: sertakan path yang akan dihapus\n');
        return 1;
      }
      for (const tArg of targets) {
        const target = resolveContainerArgPath(cwd, state.shellRelDir, tArg);
        if (target === path.resolve(cwd)) {
          appendLog(server.id, 'stderr', 'rm: tidak boleh menghapus direktori root container\n');
          return 1;
        }
        if (!fs.existsSync(target)) {
          if (!force) {
            appendLog(server.id, 'stderr', `rm: cannot remove '${tArg}': No such file or directory\n`);
            return 1;
          }
          continue;
        }
        const st = fs.lstatSync(target);
        if (st.isDirectory() && !recursive) {
          appendLog(server.id, 'stderr', `rm: cannot remove '${tArg}': Is a directory (gunakan rm -rf)\n`);
          return 1;
        }
        fs.rmSync(target, { recursive, force });
      }
      emitWorkspaceChanged(`files:${server.id}`);
      return 0;
    }
    case 'mv':
    case 'cp': {
      const recursive = args.some((a) => a.startsWith('-') && (a.includes('r') || a.includes('R')));
      const positional = args.filter((a) => !a.startsWith('-'));
      if (positional.length !== 2) {
        appendLog(server.id, 'stderr', `${cmd}: gunakan "${cmd} <sumber> <tujuan>"\n`);
        return 1;
      }
      const src = resolveContainerArgPath(cwd, state.shellRelDir, positional[0]);
      let dst = resolveContainerArgPath(cwd, state.shellRelDir, positional[1]);
      if (!fs.existsSync(src)) {
        appendLog(server.id, 'stderr', `${cmd}: cannot stat '${positional[0]}': No such file or directory\n`);
        return 1;
      }
      if (src === path.resolve(cwd)) {
        appendLog(server.id, 'stderr', `${cmd}: tidak dapat memindahkan root container\n`);
        return 1;
      }
      if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) {
        dst = path.join(dst, path.basename(src));
        assertConsoleTargetRealContainment(cwd, dst);
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (cmd === 'mv') {
        fs.renameSync(src, dst);
      } else {
        const srcStat = fs.statSync(src);
        if (srcStat.isDirectory() && !recursive) {
          appendLog(server.id, 'stderr', `cp: -r not specified; omitting directory '${positional[0]}'\n`);
          return 1;
        }
        fs.cpSync(src, dst, { recursive });
      }
      emitWorkspaceChanged(`files:${server.id}`);
      return 0;
    }
    default: {
      const parsed = parseSafeConsoleRuntimeCommand(tokens);
      if (!parsed) {
        appendLog(
          server.id,
          'stderr',
          `sh: ${cmd}: command not found (ketik "help" untuk daftar perintah)\n`
        );
        return 127;
      }

      if (parsed.kind === 'pip') {
        const resolvedPip = resolveConsolePipInvocation(
          cwd,
          parsed.executable,
          parsed.executable === 'python' || parsed.executable === 'python3'
            ? parsed.args.slice(parsed.args.indexOf('-m') + 2)
            : parsed.args
        );
        return spawnShellRuntimeCommand(
          server.id,
          state,
          cwd,
          workDir,
          resolvedPip.executable,
          resolvedPip.args,
          parsed.isMutating
        );
      }

      const execPath =
        parsed.kind === 'python'
          ? resolvePythonExecutable(cwd, parsed.executable)
          : resolveNodeExecutable(cwd, parsed.executable);

      return spawnShellRuntimeCommand(
        server.id,
        state,
        cwd,
        workDir,
        execPath,
        parsed.args,
        parsed.isMutating
      );
    }
  }
}

function startConsoleShellChain(
  server: ServerConfig,
  state: ManagedProcess,
  rawShellCommand: string
): Promise<void> {
  if (state.shellChild) {
    throw new Error('Perintah shell sebelumnya masih berjalan. Tunggu selesai atau gunakan "stop"/"kill".');
  }
  const cwd = ensureServerDir(server.id);
  const segments = splitChainedConsoleCommands(rawShellCommand);
  if (segments.length === 0) return Promise.resolve();

  // Pre-validate syntax & paths synchronously before returning HTTP 200
  for (const seg of segments) {
    const tokens = tokenizeConsoleCommand(seg);
    if (tokens.length > 0) {
      parseSafeConsoleRuntimeCommand(tokens);
    }
  }

  const promptPrefix = state.shellRelDir ? `container@cmnty:${state.shellRelDir}~` : 'container@cmnty~';
  appendLog(server.id, 'system', `${promptPrefix} ${rawShellCommand.trim()}`);

  const runPromise = (async () => {
    for (const seg of segments) {
      try {
        const code = await executeConsoleShellSegment(server, state, cwd, seg);
        if (code !== 0) {
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal menjalankan perintah console.';
        appendLog(server.id, 'stderr', `${msg}\n`);
        break;
      }
    }
  })();

  return runPromise;
}

export async function sendCommandToServer(
  serverId: string,
  input: string,
  rawMode: ConsoleInputMode = 'auto'
): Promise<{ routed: 'stdin' | 'shell' | 'control' }> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error('Server tidak ditemukan.');
  }

  const state = getOrCreateState(serverId);
  if (state.status === 'stopping') {
    throw new Error('Server sedang berhenti. Tunggu beberapa detik sebelum mengirim perintah.');
  }

  const mode = normalizeConsoleInputMode(rawMode);
  const trimmed = input.trim();

  if (mode === 'stdin') {
    const targetChild =
      state.status === 'installing'
        ? state.installChild
        : state.shellChild ??
          (state.status === 'running' || state.status === 'starting' ? state.child : null);

    if (!targetChild || !targetChild.stdin || targetChild.stdin.destroyed || !targetChild.stdin.writable) {
      throw new Error(
        'Tidak ada proses aktif untuk menerima stdin. Ubah mode ke Auto/Shell atau klik Start.'
      );
    }
    appendLog(serverId, 'stdin', `> ${input}`);
    targetChild.stdin.write(`${input}\n`);
    return { routed: 'stdin' };
  }

  if (mode === 'shell') {
    if (!trimmed) {
      return { routed: 'control' };
    }
    const cleanCmd = trimmed.startsWith('!') ? trimmed.slice(1).trim() : trimmed;
    if (!cleanCmd) return { routed: 'control' };
    const promise = startConsoleShellChain(server, state, cleanCmd);
    // Allow fast sync/lifecycle commands (`ls`, `clear`, `start`, `stop`, `restart`) to finish cleanly
    await Promise.race([promise, new Promise<void>((r) => setTimeout(r, 80))]);
    return { routed: 'shell' };
  }

  // Mode 'auto'
  if (trimmed.startsWith('!')) {
    const cleanCmd = trimmed.slice(1).trim();
    if (!cleanCmd) return { routed: 'control' };
    const promise = startConsoleShellChain(server, state, cleanCmd);
    await Promise.race([promise, new Promise<void>((r) => setTimeout(r, 80))]);
    return { routed: 'shell' };
  }

  if (state.shellChild && state.shellChild.stdin && !state.shellChild.stdin.destroyed && state.shellChild.stdin.writable) {
    appendLog(serverId, 'stdin', `> ${input}`);
    state.shellChild.stdin.write(`${input}\n`);
    return { routed: 'stdin' };
  }

  if (
    state.status === 'installing' &&
    state.installChild &&
    state.installChild.stdin &&
    !state.installChild.stdin.destroyed &&
    state.installChild.stdin.writable
  ) {
    appendLog(serverId, 'stdin', `> ${input}`);
    state.installChild.stdin.write(`${input}\n`);
    return { routed: 'stdin' };
  }

  if (
    (state.status === 'running' || state.status === 'starting') &&
    state.child &&
    state.child.stdin &&
    !state.child.stdin.destroyed &&
    state.child.stdin.writable &&
    (state.stdinActive || input === '')
  ) {
    appendLog(serverId, 'stdin', `> ${input}`);
    state.child.stdin.write(`${input}\n`);
    return { routed: 'stdin' };
  }

  if (!trimmed) {
    return { routed: 'control' };
  }

  const promise = startConsoleShellChain(server, state, trimmed);
  await Promise.race([promise, new Promise<void>((r) => setTimeout(r, 80))]);
  return { routed: 'shell' };
}

export async function sendStdinToServer(serverId: string, input: string): Promise<void> {
  await sendCommandToServer(serverId, input, 'auto');
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

const globalForShutdown = globalThis as unknown as {
  __nodalExitCleanupRegistered?: boolean;
};

if (!globalForShutdown.__nodalExitCleanupRegistered && typeof process !== 'undefined') {
  globalForShutdown.__nodalExitCleanupRegistered = true;
  process.once('exit', () => {
    const map = globalForPm.__nodalProcesses;
    if (!map) return;
    for (const state of map.values()) {
      if (state.shellChild) {
        killProcessTree(state.shellChild, 'SIGTERM');
      }
      if (state.installChild) {
        killProcessTree(state.installChild, 'SIGTERM');
      }
      if (state.child) {
        killProcessTree(state.child, 'SIGTERM');
      }
      cleanupNetMonitor(state);
    }
  });
}
