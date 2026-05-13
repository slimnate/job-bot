import { isOrchestratorDebug, isRankDebug } from './debugFlags.js';
import { workerLog } from './log.js';

export type RetryDebugSubsystem = 'orchestrator' | 'rank';

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio?: number;
  label?: string;
  isRetryable?: (error: unknown) => boolean;
  /**
   * When set, logs `retry.attempt` at debug level before backing off if the matching
   * `ORCHESTRATOR_DEBUG` / `RANK_DEBUG` env flag is on. Omit for silent retries.
   */
  retryDebugSubsystem?: RetryDebugSubsystem;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const code = (error as NodeJS.ErrnoException).code?.toLowerCase() ?? '';
  return (
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'eai_again' ||
    code === 'enotfound' ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit') ||
    message.includes(' 503') ||
    message.includes(' 502') ||
    message.includes(' 429')
  );
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio = 0.2,
    label,
    isRetryable = defaultIsRetryable,
    retryDebugSubsystem,
  } = options;

  const attempts = Math.max(1, Math.floor(maxAttempts));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const retryable = attempt < attempts && isRetryable(error);
      if (!retryable) {
        throw error;
      }
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = exp * jitterRatio * Math.random();
      const delayMs = exp + jitter;
      if (retryDebugSubsystem) {
        const allow =
          retryDebugSubsystem === 'orchestrator'
            ? isOrchestratorDebug()
            : isRankDebug();
        if (allow) {
          workerLog.debug('retry.attempt', {
            subsystem: retryDebugSubsystem,
            label: label ?? null,
            attempt,
            maxAttempts: attempts,
            delayMs: Math.round(delayMs),
            err: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await sleep(delayMs);
    }
  }

  throw new Error(label ? `${label}: retry exhausted` : 'withRetry: retry exhausted');
}
