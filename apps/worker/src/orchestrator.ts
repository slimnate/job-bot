import { ConvexHttpClient } from 'convex/browser';

import { api } from './convexBridge/api.js';
import type { Doc, Id } from './convexBridge/doc.js';

const runIdKey = (runId: Id<'scrape_runs'>): string => runId as string;
import { drainRunLogPending, withRunLogContext, workerLog } from './log.js';
import { InMemoryTaskQueue } from './queue.js';
import { rankJobsWithLlm, type LlmRankingCandidate } from './ranking/rankJobsWithLlm.js';
import { withRetry } from './retry.js';
import { JOB_BOT_SCRAPE_ABORT_MESSAGE } from './sources/linkedinJobs.js';
import { collectPostingsForSource } from './sourceAdapters.js';

type TriggerRunInput = {
  criteriaId?: Id<'job_criteria'>;
  source?: string;
};

type QueuePayload = {
  runId: Id<'scrape_runs'>;
  source: string;
};

type RecomputeResponse = {
  criteria: Doc<'job_criteria'> | null;
  model: string;
  candidates: Array<Doc<'job_postings'>>;
};

const defaultStats = {
  discoveredCount: 0,
  dedupedCount: 0,
  insertedCount: 0,
  rankedCount: 0,
  errorCount: 0,
};

const convexRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 5000,
} as const;

/**
 * Node's `fetch()` often throws `TypeError: fetch failed` with the real reason on `error.cause`
 * (e.g. `ECONNREFUSED` to Convex or the LLM API). Surfaces that for logs and Convex run rows.
 */
function formatWorkerError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  let text = error.message;
  const c = error.cause;
  if (c instanceof Error) {
    text = `${text} (${c.message})`;
  } else if (c && typeof c === 'object' && 'code' in c) {
    text = `${text} [${String((c as NodeJS.ErrnoException).code)}]`;
  }
  return text;
}

export class WorkerOrchestrator {
  private readonly convex: ConvexHttpClient;
  private readonly queue: InMemoryTaskQueue<QueuePayload>;
  /** Run IDs already handed to the in-memory queue (or running). Prevents duplicate work from scheduler + DB. */
  private readonly inflightRunIds = new Set<string>();

  constructor(params: { convexUrl: string; concurrency: number }) {
    this.convex = new ConvexHttpClient(params.convexUrl);
    this.queue = new InMemoryTaskQueue<QueuePayload>(params.concurrency);
  }

  private runConvex<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexRetryOptions,
      label,
    });
  }

  async triggerAndEnqueue(input: TriggerRunInput = {}): Promise<void> {
    const triggered = await this.runConvex('runs.trigger', () =>
      this.convex.mutation(api.runs.trigger, {
        criteriaId: input.criteriaId,
        source: input.source,
      })
    );

    const entries =
      triggered.runs ??
      triggered.runIds.map((runId: Id<'scrape_runs'>) => ({
        runId,
        source: input.source ?? 'linkedin',
      }));

    for (const entry of entries) {
      if (!this.tryClaimRun(entry.runId)) {
        continue;
      }
      this.queue.enqueue({
        id: `run:${entry.runId}`,
        context: { runId: entry.runId, source: entry.source },
        run: async (payload) => {
          try {
            await this.processRun(payload);
          } finally {
            this.releaseRun(entry.runId);
          }
        },
      });
    }
  }

  /**
   * Picks up scrape runs that are queued in Convex but not yet in the worker queue
   * (for example when the dashboard inserted rows via `runs.trigger` alone).
   */
  async enqueueDbQueuedRuns(): Promise<void> {
    const queued = await this.runConvex('runs.list:queued', () =>
      this.convex.query(api.runs.list, {
        status: 'queued',
        limit: 50,
      })
    );

    for (const row of queued) {
      if (!this.tryClaimRun(row._id)) {
        continue;
      }
      this.queue.enqueue({
        id: `run:${row._id}`,
        context: { runId: row._id, source: row.source },
        run: async (payload) => {
          try {
            await this.processRun(payload);
          } finally {
            this.releaseRun(row._id);
          }
        },
      });
    }
  }

  private tryClaimRun(runId: Id<'scrape_runs'>): boolean {
    const key = runIdKey(runId);
    if (this.inflightRunIds.has(key)) {
      return false;
    }
    this.inflightRunIds.add(key);
    return true;
  }

  private releaseRun(runId: Id<'scrape_runs'>): void {
    this.inflightRunIds.delete(runIdKey(runId));
  }

  async enqueueScheduledRuns(): Promise<void> {
    const activeCriteria = await withRetry(
      () =>
        this.convex.query(api.criteria.get, {
          onlyActive: true,
        }),
      {
        ...convexRetryOptions,
        label: 'criteria.get',
      }
    );

    if (!activeCriteria) {
      await this.triggerAndEnqueue({ source: 'linkedin' });
      return;
    }

    /** Criteria no longer lists scrape sources; scheduled runs default to LinkedIn only. */
    await this.triggerAndEnqueue({
      criteriaId: (activeCriteria as Doc<'job_criteria'>)._id,
      source: 'linkedin',
    });
  }

  queueSnapshot(): { queued: number; running: number } {
    return this.queue.snapshot();
  }

  /**
   * Persists buffered JSON log lines to Convex in chunks; safe to call when the buffer is empty.
   */
  private async flushRunLogsToConvex(): Promise<void> {
    const CHUNK = 300;
    for (;;) {
      const drained = drainRunLogPending();
      if (!drained?.entries.length) {
        return;
      }
      for (let i = 0; i < drained.entries.length; i += CHUNK) {
        const chunk = drained.entries.slice(i, i + CHUNK);
        await this.runConvex(`runLogs.appendBatch:${drained.runId}`, () =>
          this.convex.mutation(api.runLogs.appendBatch, {
            runId: drained.runId,
            entries: chunk,
          })
        );
      }
    }
  }

  private async processRun(payload: QueuePayload): Promise<void> {
    await withRunLogContext(payload.runId, () => this.flushRunLogsToConvex(), async () => {
      const runStartedAt = Date.now();
      workerLog.info('run.phase', {
        phase: 'start',
        runId: payload.runId,
        source: payload.source,
      });

      await this.runConvex(`runs.updateStatus:running:${payload.runId}`, () =>
        this.convex.mutation(api.runs.updateStatus, {
          runId: payload.runId,
          status: 'running',
          logsSummary: `Started source '${payload.source}' run`,
        })
      );

      const runDoc = await this.runConvex(`runs.get:${payload.runId}`, () =>
        this.convex.query(api.runs.get, { runId: payload.runId })
      );

      if (!runDoc) {
        throw new Error(`Run not found: ${payload.runId}`);
      }

      try {
        /** LinkedIn streams one posting per mutation during scrape; inserts happen there. The batch upsert below then updates existing rows, so its `inserted` is usually 0 unless we sum stream calls. */
        let streamedInserted = 0;
        let streamedUpdated = 0;

        const collected = await withRetry(
          () =>
            collectPostingsForSource({
              runId: payload.runId,
              source: payload.source,
              linkedinSearchQuery: runDoc.linkedinSearchQuery,
              streamPosting: async (posting) => {
                const row = await this.runConvex(`postings.upsertBatch.stream:${payload.runId}`, () =>
                  this.convex.mutation(api.postings.upsertBatch, {
                    postings: [posting],
                  })
                );
                streamedInserted += row.inserted;
                streamedUpdated += row.updated;
              },
            }),
          {
            maxAttempts: 2,
            baseDelayMs: 400,
            maxDelayMs: 2000,
            label: `collectPostings:${payload.source}`,
          }
        );

        await this.flushRunLogsToConvex();

        workerLog.info('run.phase', {
          phase: 'collected',
          runId: payload.runId,
          source: payload.source,
          discoveredCount: collected.stats.discoveredCount,
          durationMs: Date.now() - runStartedAt,
        });

        const upsertResult = await this.runConvex(`postings.upsertBatch:${payload.runId}`, () =>
          this.convex.mutation(api.postings.upsertBatch, {
            postings: collected.postings,
          })
        );

        const insertedTotal = streamedInserted + upsertResult.inserted;
        const updatedTotal = streamedUpdated + upsertResult.updated;

        await this.flushRunLogsToConvex();

        workerLog.info('run.phase', {
          phase: 'upserted',
          runId: payload.runId,
          source: payload.source,
          inserted: insertedTotal,
          insertedBatch: upsertResult.inserted,
          insertedStreamed: streamedInserted,
          updated: updatedTotal,
          updatedBatch: upsertResult.updated,
          updatedStreamed: streamedUpdated,
          batchDeduped: upsertResult.batchDeduped,
          skippedInvalid: upsertResult.skippedInvalid,
          processed: upsertResult.processed,
        });

        const recompute = (await this.runConvex(`ranking.recompute:${payload.runId}`, () =>
          this.convex.mutation(api.ranking.recompute, {
            criteriaId: runDoc.criteriaId,
            source: payload.source,
            limit: 100,
          })
        )) as RecomputeResponse;

        const candidatesForRun = recompute.candidates.filter(
          (posting) => posting.scrapeRunId === payload.runId
        );

        workerLog.info('run.phase', {
          phase: 'ranking_input',
          runId: payload.runId,
          source: payload.source,
          candidateCount: candidatesForRun.length,
        });

        const rankingResult = await rankJobsWithLlm({
          criteria: recompute.criteria,
          model: recompute.model,
          candidates: candidatesForRun as unknown as LlmRankingCandidate[],
        });
        const rankings = rankingResult.rankings;

        if (rankings.length > 0) {
          const saveResult = await this.runConvex(`ranking.upsertResults:${payload.runId}`, () =>
            this.convex.mutation(api.ranking.upsertResults, {
              criteriaId: recompute.criteria?._id,
              scrapeRunId: payload.runId,
              model: rankingResult.model,
              rankings,
            })
          );

          workerLog.info('run.phase', {
            phase: 'rankings_saved',
            runId: payload.runId,
            source: payload.source,
            saved: saveResult.saved,
            dedupedInBatch: saveResult.dedupedInBatch,
          });
        }

        await this.runConvex(`runs.updateStatus:succeeded:${payload.runId}`, () =>
          this.convex.mutation(api.runs.updateStatus, {
            runId: payload.runId,
            status: 'succeeded',
            logsSummary: `Completed source '${payload.source}' run`,
            stats: {
              discoveredCount: collected.stats.discoveredCount,
              dedupedCount: upsertResult.updated + collected.stats.dedupedCount,
              insertedCount: insertedTotal,
              rankedCount: rankings.length,
              errorCount: 0,
            },
          })
        );

        workerLog.info('run.phase', {
          phase: 'complete',
          runId: payload.runId,
          source: payload.source,
          status: 'succeeded',
          durationMs: Date.now() - runStartedAt,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message === JOB_BOT_SCRAPE_ABORT_MESSAGE
            ? JOB_BOT_SCRAPE_ABORT_MESSAGE
            : formatWorkerError(error);

        if (message === JOB_BOT_SCRAPE_ABORT_MESSAGE) {
          workerLog.info('run.phase', {
            phase: 'cancelled',
            runId: payload.runId,
            source: payload.source,
            durationMs: Date.now() - runStartedAt,
          });

          await this.runConvex(`runs.updateStatus:cancelled:${payload.runId}`, () =>
            this.convex.mutation(api.runs.updateStatus, {
              runId: payload.runId,
              status: 'cancelled',
              logsSummary: `Cancelled source '${payload.source}' run (scrape aborted in browser)`,
              errorMessage: 'Aborted in headed Chrome controls',
            })
          );
          return;
        }

        workerLog.error('run.phase', {
          phase: 'failed',
          runId: payload.runId,
          source: payload.source,
          durationMs: Date.now() - runStartedAt,
          err: message,
        });

        await this.runConvex(`runs.updateStatus:failed:${payload.runId}`, () =>
          this.convex.mutation(api.runs.updateStatus, {
            runId: payload.runId,
            status: 'failed',
            logsSummary: `Failed source '${payload.source}' run`,
            stats: {
              ...defaultStats,
              errorCount: 1,
            },
            errorMessage: message,
          })
        );

        throw error;
      }
    });
  }
}
