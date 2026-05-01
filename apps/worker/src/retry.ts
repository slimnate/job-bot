export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio?: number;
  label?: string;
  isRetryable?: (error: unknown) => boolean;
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
      await sleep(exp + jitter);
    }
  }

  throw new Error(label ? `${label}: retry exhausted` : 'withRetry: retry exhausted');
}
