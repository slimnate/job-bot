/**
 * LinkedIn scrapes share one Chrome tab and one CDP connection. Running two LinkedIn jobs at the
 * same time navigates the same target from parallel tasks and breaks CDP (e.g. "Promise was
 * collected", disconnected client). This lock ensures at most one LinkedIn collection runs at a time.
 */
import { isScrapeDebug } from './debugFlags.js';
import { workerLog } from './log.js';

let tail: Promise<void> = Promise.resolve();

export async function withLinkedInBrowserExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  if (isScrapeDebug()) {
    workerLog.debug('linkedin.lock.acquired', {});
  }
  try {
    return await fn();
  } finally {
    if (isScrapeDebug()) {
      workerLog.debug('linkedin.lock.released', {});
    }
    release();
  }
}
