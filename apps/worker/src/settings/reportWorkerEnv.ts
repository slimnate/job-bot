import { collectAllowlistedEnvOverrides } from '@job-bot/shared';
import type { ConvexHttpClient } from 'convex/browser';

import { api } from '../convexBridge/api.js';

/**
 * Reports allowlisted non-empty env vars from this worker process to Convex
 * so the Settings UI can show Env override badges for `.env.local` values.
 */
export async function reportWorkerEnvOverrides(
  convex: ConvexHttpClient,
  workerId: string
): Promise<void> {
  const envOverrides = collectAllowlistedEnvOverrides(process.env);
  await convex.mutation(api.workerSettingsEnv.upsertFromWorker, {
    workerId,
    envOverrides,
    reportedAt: Date.now(),
  });
}
