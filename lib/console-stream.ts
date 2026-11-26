import type { ConsoleLine } from './types';

export interface StreamPartialState {
  activeLineId: string | null;
  buffer: string;
  overwritePending: boolean;
}

export function createStreamPartialState(): StreamPartialState {
  return {
    activeLineId: null,
    buffer: '',
    overwritePending: false,
  };
}

export function sealStreamPartial(state: StreamPartialState): void {
  state.activeLineId = null;
  state.buffer = '';
  state.overwritePending = false;
}

function applySegmentToBuffer(
  current: string,
  segment: string,
  overwrite: boolean
): string {
  if (!overwrite) {
    return current + segment;
  }
  if (segment.length >= current.length) {
    return segment;
  }
  return segment + current.slice(segment.length);
}

function upsertLineInPlace(
  logs: ConsoleLine[],
  line: ConsoleLine,
  maxLines: number
): void {
  const existingIdx = logs.findIndex((item) => item.id === line.id);
  if (existingIdx !== -1) {
    logs[existingIdx] = line;
    return;
  }
  logs.push(line);
  if (logs.length > maxLines) {
    logs.shift();
  }
}

export function processStreamChunk(options: {
  logs: ConsoleLine[];
  partial: StreamPartialState;
  stream: 'stdout' | 'stderr';
  rawText: string;
  maxLines?: number;
  createId: () => string;
  timestamp: string;
}): ConsoleLine[] {
  const {
    logs,
    partial,
    stream,
    rawText,
    maxLines = 400,
    createId,
    timestamp,
  } = options;

  if (!rawText) return [];

  let normalized = rawText.replace(/\r\n/g, '\n');

  if (partial.overwritePending && normalized.startsWith('\n')) {
    partial.overwritePending = false;
  }

  const emittedById = new Map<string, ConsoleLine>();
  const recordEmit = (entry: ConsoleLine) => {
    if (emittedById.has(entry.id)) {
      emittedById.delete(entry.id);
    }
    emittedById.set(entry.id, entry);
  };

  let cursor = 0;
  while (cursor < normalized.length) {
    const nlIdx = normalized.indexOf('\n', cursor);
    const crIdx = normalized.indexOf('\r', cursor);

    let nextCtrl = -1;
    let ctrlType: '\n' | '\r' | null = null;
    if (nlIdx !== -1 && crIdx !== -1) {
      if (nlIdx < crIdx) {
        nextCtrl = nlIdx;
        ctrlType = '\n';
      } else {
        nextCtrl = crIdx;
        ctrlType = '\r';
      }
    } else if (nlIdx !== -1) {
      nextCtrl = nlIdx;
      ctrlType = '\n';
    } else if (crIdx !== -1) {
      nextCtrl = crIdx;
      ctrlType = '\r';
    }

    const segmentEnd = nextCtrl === -1 ? normalized.length : nextCtrl;
    let segment = normalized.slice(cursor, segmentEnd);

    if (segment.length > 0) {

      const eraseAllIdx = segment.lastIndexOf('\x1b[2K');
      if (eraseAllIdx !== -1) {
        partial.buffer = '';
        partial.overwritePending = false;
        segment = segment.slice(eraseAllIdx + 4);
      } else if (segment.startsWith('\x1b[K') || segment.startsWith('\x1b[0K')) {
        partial.buffer = '';
        partial.overwritePending = false;
        segment = segment.replace(/^\x1b\[0?K/, '');
      }

      if (segment.length > 0) {
        partial.buffer = applySegmentToBuffer(
          partial.buffer,
          segment,
          partial.overwritePending
        );
        partial.overwritePending = false;

        if (!partial.activeLineId) {
          partial.activeLineId = createId();
        }
        const entry: ConsoleLine = {
          id: partial.activeLineId,
          timestamp,
          stream,
          text: partial.buffer,
        };
        upsertLineInPlace(logs, entry, maxLines);
        recordEmit(entry);
      }
    }

    if (ctrlType === '\n') {
      if (!partial.activeLineId) {
        const emptyLine: ConsoleLine = {
          id: createId(),
          timestamp,
          stream,
          text: '',
        };
        upsertLineInPlace(logs, emptyLine, maxLines);
        recordEmit(emptyLine);
      } else {
        const finalizedLine: ConsoleLine = {
          id: partial.activeLineId,
          timestamp,
          stream,
          text: partial.buffer,
        };
        upsertLineInPlace(logs, finalizedLine, maxLines);
        recordEmit(finalizedLine);
      }
      sealStreamPartial(partial);
      cursor = segmentEnd + 1;
    } else if (ctrlType === '\r') {
      partial.overwritePending = true;
      cursor = segmentEnd + 1;
    } else {
      break;
    }
  }

  return Array.from(emittedById.values());
}

export function upsertConsoleLineList(
  prev: ConsoleLine[],
  nextLine: ConsoleLine,
  maxLines = 400
): ConsoleLine[] {
  if (!nextLine?.id) return prev;
  const idx = prev.findIndex((item) => item.id === nextLine.id);
  if (idx !== -1) {
    const existing = prev[idx];
    if (
      existing.text === nextLine.text &&
      existing.stream === nextLine.stream &&
      existing.timestamp === nextLine.timestamp
    ) {
      return prev;
    }
    const copy = [...prev];
    copy[idx] = nextLine;
    return copy;
  }
  const limit = Math.max(1, maxLines);
  const next = prev.length >= limit ? [...prev.slice(-(limit - 1)), nextLine] : [...prev, nextLine];
  return next;
}
