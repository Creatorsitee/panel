import type { ServerStatus } from './types';

export type ConsoleInputMode = 'auto' | 'stdin' | 'shell';

export interface ConsolePowerPermissions {
  canStart: boolean;
  canRestart: boolean;
  canStop: boolean;
  canKill: boolean;
  canSendInput: boolean;
  isBusy: boolean;
}

export function getConsolePowerPermissions(
  status: ServerStatus
): ConsolePowerPermissions {
  const isRunning = status === 'running';
  const isStarting = status === 'starting' || status === 'installing';
  const isStopping = status === 'stopping';
  const isOffline = status === 'stopped' || status === 'error';

  return {
    canStart: isOffline,
    canRestart: isRunning,
    canStop: isRunning || isStarting,
    canKill: isRunning || isStarting || isStopping,
    canSendInput: !isStopping,
    isBusy: isStarting || isStopping,
  };
}

export function normalizeConsoleInputMode(raw: unknown): ConsoleInputMode {
  if (raw === 'stdin' || raw === 'shell') return raw;
  return 'auto';
}

export function getNextConsoleInputMode(current: ConsoleInputMode): ConsoleInputMode {
  if (current === 'auto') return 'shell';
  if (current === 'shell') return 'stdin';
  return 'auto';
}

export function getConsoleModeLabel(mode: ConsoleInputMode): string {
  switch (mode) {
    case 'shell':
      return 'Shell';
    case 'stdin':
      return 'Stdin';
    case 'auto':
    default:
      return 'Auto';
  }
}

export function getStatusDisplayLabel(status: ServerStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'installing':
      return 'Installing';
    case 'stopping':
      return 'Stopping';
    case 'error':
      return 'Error';
    case 'stopped':
    default:
      return 'Offline';
  }
}
