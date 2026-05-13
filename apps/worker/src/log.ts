import { AsyncLocalStorage } from 'node:async_hooks';

import type { Id } from './convexBridge/doc.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

type RunLogStore = {
  runId: Id<'scrape_runs'>;
  nextSeq: number;
  pending: Array<{ seq: number; line: string }>;
};

const runLogAls = new AsyncLocalStorage<RunLogStore>();

/**
 * Runs `fn` with async-local storage so each `workerLog` line is also buffered for Convex (`run_log_lines`).
 * Call `drainRunLogPending()` from the provided flush callback until the buffer stays empty.
 */
export async function withRunLogContext<T>(
  runId: Id<'scrape_runs'>,
  flushPending: () => Promise<void>,
  fn: () => Promise<T>
): Promise<T> {
  const store: RunLogStore = { runId, nextSeq: 0, pending: [] };
  return runLogAls.run(store, async () => {
    try {
      return await fn();
    } finally {
      for (let i = 0; i < 200; i++) {
        if (store.pending.length === 0) {
          break;
        }
        await flushPending();
      }
    }
  });
}

/**
 * Removes all buffered lines for the current run context and returns them for upload (or null if none).
 */
export function drainRunLogPending(): {
  runId: Id<'scrape_runs'>;
  entries: Array<{ seq: number; line: string }>;
} | null {
  const store = runLogAls.getStore();
  if (!store || store.pending.length === 0) {
    return null;
  }
  const entries = store.pending.splice(0, store.pending.length);
  return { runId: store.runId, entries };
}

function writeLine(level: LogLevel, message: string, fields: LogFields): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'job-bot-worker',
    ...fields,
  };
  const line = JSON.stringify(entry);
  const store = runLogAls.getStore();
  if (store) {
    store.pending.push({ seq: store.nextSeq++, line });
  }
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const workerLog = {
  /** Always emitted when called; use subsystem env flags to avoid noisy call sites. */
  debug(message: string, fields: LogFields = {}): void {
    writeLine('debug', message, fields);
  },
  info(message: string, fields: LogFields = {}): void {
    writeLine('info', message, fields);
  },
  warn(message: string, fields: LogFields = {}): void {
    writeLine('warn', message, fields);
  },
  error(message: string, fields: LogFields = {}): void {
    writeLine('error', message, fields);
  },
};
