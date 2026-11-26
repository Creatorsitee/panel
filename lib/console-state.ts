import type { ServerStatus } from './types';

export interface ConsolePowerPermissions {
  canStart: boolean;
  canRestart: boolean;
  canStop: boolean;
  canKill: boolean;
  canSendInput: boolean;
  isBusy: boolean;
}

export function getConsolePowerPermissions(
  status: ServerStatus,
  awaitingInput = false
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
    canSendInput: awaitingInput && (isRunning || isStarting),
    isBusy: isStarting || isStopping,
  };
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
