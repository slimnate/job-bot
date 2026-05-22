import { ConvexHttpClient } from 'convex/browser';

import type { RetryOptions } from './retry.js';

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

/**
 * Fetch wrapper with a per-request timeout (Node undici has no default timeout).
 */
export function convexFetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Convex HTTP client for the worker (queries + mutations to the deployment URL).
 */
export function createWorkerConvexClient(convexUrl: string): ConvexHttpClient {
  const url = convexUrl.trim();
  return new ConvexHttpClient(url, {
    logger: false,
    fetch: (input, init) => convexFetchWithTimeout(input, init),
  });
}

/** Retries for routine Convex reads (evaluator/posting load). */
export const convexReadRetryOptions: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 5000,
};

/** Extra retries/backoff when persisting rankings after a successful LLM run. */
export const convexSaveRetryOptions: RetryOptions = {
  maxAttempts: 8,
  baseDelayMs: 400,
  maxDelayMs: 15_000,
};
