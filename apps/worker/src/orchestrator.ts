import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api.js';
import type { Doc, Id } from '../../../convex/_generated/dataModel.js';
import { workerLog } from './log.js';
import { InMemoryTaskQueue } from './queue.js';
import { rankJobsWithLlm } from './ranking/rankJobsWithLlm.js';
import { withRetry } from './retry.js';
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

export class WorkerOrchestrator {
  private readonly convex: ConvexHttpClient;
  private readonly queue: InMemoryTaskQueue<QueuePayload>;

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

    for (const runId of triggered.runIds) {
      const source = input.source ?? 'manual';
      this.queue.enqueue({
        id: `run:${runId}`,
        context: { runId, source },
        run: async (payload) => {
          await this.processRun(payload);
        },
      });
    }
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
      await this.triggerAndEnqueue({ source: 'manual' });
      return;
    }

    const uniqueSources = Array.from(
      new Set(
        (activeCriteria.targetSources.length > 0 ? activeCriteria.targetSources : ['manual']).map(
          (source) => source.trim()
        )
      )
    ).filter((source) => source.length > 0);

    for (const source of uniqueSources) {
      await this.triggerAndEnqueue({
        criteriaId: activeCriteria._id,
        source,
      });
    }
  }

  queueSnapshot(): { queued: number; running: number } {
    return this.queue.snapshot();
  }

  private async processRun(payload: QueuePayload): Promise<void> {
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

    try {
      const collected = await withRetry(
        () =>
          collectPostingsForSource({
            runId: payload.runId,
            source: payload.source,
          }),
        {
          maxAttempts: 2,
          baseDelayMs: 400,
          maxDelayMs: 2000,
          label: `collectPostings:${payload.source}`,
        }
      );

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

      workerLog.info('run.phase', {
        phase: 'upserted',
        runId: payload.runId,
        source: payload.source,
        inserted: upsertResult.inserted,
        updated: upsertResult.updated,
        batchDeduped: upsertResult.batchDeduped,
        skippedInvalid: upsertResult.skippedInvalid,
        processed: upsertResult.processed,
      });

      const recompute = (await this.runConvex(`ranking.recompute:${payload.runId}`, () =>
        this.convex.mutation(api.ranking.recompute, {
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
        candidates: candidatesForRun,
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
            insertedCount: upsertResult.inserted,
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
      workerLog.error('run.phase', {
        phase: 'failed',
        runId: payload.runId,
        source: payload.source,
        durationMs: Date.now() - runStartedAt,
        err: error instanceof Error ? error.message : 'Unknown worker error',
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
          errorMessage: error instanceof Error ? error.message : 'Unknown worker error',
        })
      );

      throw error;
    }
  }
}
