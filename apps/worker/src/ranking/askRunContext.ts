import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogFields, LogLevel } from '../log.js';
import { appendAskRunLog } from './askRunLogHub.js';

type AskRunStore = {
  askRunId: string;
};

const askRunAls = new AsyncLocalStorage<AskRunStore>();

/**
 * Returns the active Q&A run id when inside {@link withAskRunLogContext}.
 */
export function getActiveAskRunId(): string | undefined {
  return askRunAls.getStore()?.askRunId;
}

/**
 * Runs `fn` with async-local storage so `llm.ask.*` worker logs are mirrored to {@link appendAskRunLog}.
 */
export async function withAskRunLogContext<T>(askRunId: string, fn: () => Promise<T>): Promise<T> {
  return askRunAls.run({ askRunId }, fn);
}

/**
 * Mirrors a worker log line into the live Q&A log hub when a run context is active.
 */
export function mirrorAskRunLogToHub(
  level: LogLevel,
  message: string,
  fields: LogFields,
  ts: string
): void {
  const store = askRunAls.getStore();
  if (!store || !message.startsWith('llm.ask')) {
    return;
  }
  appendAskRunLog(store.askRunId, { ts, level, msg: message, fields });
}
