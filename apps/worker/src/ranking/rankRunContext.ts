import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogFields, LogLevel } from '../log.js';
import { appendRankRunLog } from './rankRunLogHub.js';

type RankRunStore = {
  rankingRunId: string;
};

const rankRunAls = new AsyncLocalStorage<RankRunStore>();

/**
 * Returns the active scoring run id when inside {@link withRankRunLogContext}.
 */
export function getActiveRankingRunId(): string | undefined {
  return rankRunAls.getStore()?.rankingRunId;
}

/**
 * Runs `fn` with async-local storage so `llm.rank.*` worker logs are mirrored to {@link appendRankRunLog}.
 */
export async function withRankRunLogContext<T>(
  rankingRunId: string,
  fn: () => Promise<T>
): Promise<T> {
  return rankRunAls.run({ rankingRunId }, fn);
}

/**
 * Mirrors a worker log line into the live scoring log hub when a run context is active.
 */
export function mirrorRankRunLogToHub(
  level: LogLevel,
  message: string,
  fields: LogFields,
  ts: string
): void {
  const store = rankRunAls.getStore();
  if (!store || !message.startsWith('llm.rank')) {
    return;
  }
  appendRankRunLog(store.rankingRunId, { ts, level, msg: message, fields });
}
