import { EventEmitter } from 'node:events';

const globalForRealtime = globalThis as unknown as {
  __cmntyRealtimeBus?: EventEmitter;
};

function getRealtimeBus(): EventEmitter {
  if (!globalForRealtime.__cmntyRealtimeBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(300);
    globalForRealtime.__cmntyRealtimeBus = emitter;
  }
  return globalForRealtime.__cmntyRealtimeBus;
}

export function emitWorkspaceChanged(reason = 'update'): void {
  getRealtimeBus().emit('workspace:changed', reason);
}

export function subscribeWorkspaceEvents(listener: (reason: string) => void): () => void {
  const bus = getRealtimeBus();
  bus.on('workspace:changed', listener);
  return () => {
    bus.off('workspace:changed', listener);
  };
}

export function emitFilesChanged(serverId: string): void {
  getRealtimeBus().emit('files:changed', serverId);
}

export function subscribeFilesChanged(listener: (serverId: string) => void): () => void {
  const bus = getRealtimeBus();
  bus.on('files:changed', listener);
  return () => {
    bus.off('files:changed', listener);
  };
}
