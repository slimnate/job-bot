import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const schemaVersion = 'job_sources_default_evaluator';

export default defineSchema({
  job_evaluators: defineTable({
    name: v.string(),
    /** When true, the profile can be selected on queued runs. Worker default evaluator is `WORKER_DEFAULT_EVALUATOR_ID`, not this flag. */
    isActive: v.boolean(),
    /** Private to the user; never sent to the ranking LLM. */
    notes: v.optional(v.string()),
    resumeMarkdown: v.optional(v.string()),
    rankingPrompt: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_is_active', ['isActive'])
    .index('by_updated_at', ['updatedAt']),

  /**
   * Streamed JSON log lines from the worker for a single scrape run (stdout-style `workerLog` output).
   * `seq` is per-run monotonic so the UI can sort even if writes batch at different times.
   */
  run_log_lines: defineTable({
    runId: v.id('scrape_runs'),
    seq: v.number(),
    line: v.string(),
  }).index('by_run_and_seq', ['runId', 'seq']),

  scrape_runs: defineTable({
    evaluatorId: v.optional(v.id('job_evaluators')),
    source: v.string(),
    /**
     * Source-specific run criteria (validated by backend source contract).
     * Example for LinkedIn: { search?: string, location?: string }.
     */
    sourceCriteria: v.optional(v.record(v.string(), v.string())),
    linkedinSearchStrategy: v.optional(
      v.union(v.literal('ui'), v.literal('url_fallback'), v.literal('preferences_hub'))
    ),
    usedLinkedinUrlFallback: v.optional(v.boolean()),
    linkedinFallbackReason: v.optional(v.string()),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('cancelled')
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    logsSummary: v.optional(v.string()),
    stats: v.optional(
      v.object({
        discoveredCount: v.number(),
        dedupedCount: v.number(),
        insertedCount: v.number(),
        rankedCount: v.number(),
        errorCount: v.number(),
      })
    ),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_source_started_at', ['source', 'startedAt'])
    .index('by_started_at', ['startedAt']),

  job_postings: defineTable({
    source: v.string(),
    externalId: v.string(),
    url: v.string(),
    title: v.string(),
    company: v.string(),
    location: v.optional(v.string()),
    salaryText: v.optional(v.string()),
    descriptionSnippet: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    discoveredAt: v.number(),
    scrapeRunId: v.optional(v.id('scrape_runs')),
    rawPayload: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_source_external_id', ['source', 'externalId'])
    .index('by_discovered_at', ['discoveredAt'])
    .index('by_company', ['company']),

  job_rankings: defineTable({
    postingId: v.id('job_postings'),
    evaluatorId: v.optional(v.id('job_evaluators')),
    scrapeRunId: v.optional(v.id('scrape_runs')),
    rank: v.number(),
    scoreOverall: v.number(),
    model: v.string(),
    reasoningSummary: v.string(),
    criteriaMatchJson: v.any(),
    redFlags: v.optional(v.array(v.string())),
    rankedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_posting', ['postingId'])
    .index('by_posting_ranked_at', ['postingId', 'rankedAt'])
    .index('by_score', ['scoreOverall']),

  /**
   * User-managed source enablement state; accepted criteria fields remain code-defined.
   */
  job_sources: defineTable({
    source: v.string(),
    displayName: v.string(),
    isEnabled: v.boolean(),
    /** Default ranking evaluator for runs of this source when `scrape_runs.evaluatorId` is unset. */
    defaultEvaluatorId: v.optional(v.id('job_evaluators')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_source', ['source'])
    .index('by_enabled_and_source', ['isEnabled', 'source']),

  /**
   * User-managed reusable criteria combinations for a source.
   * For LinkedIn: sourceCriteria supports keys `search` and `location`.
   */
  source_presets: defineTable({
    source: v.string(),
    name: v.string(),
    sourceCriteria: v.record(v.string(), v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_source_and_updated_at', ['source', 'updatedAt'])
    .index('by_source_and_name', ['source', 'name']),

  /**
   * LLM vendors for manual posting score (UI + scripts). `surface` tells the web app where execution runs.
   */
  ranking_llm_providers: defineTable({
    /** Stable id, e.g. `openai`, `cursor`. */
    key: v.string(),
    displayName: v.string(),
    /** `convex_http`: OpenAI-compatible API from a Convex action. `worker_cursor`: Cursor CLI on the local worker. */
    surface: v.union(v.literal('convex_http'), v.literal('worker_cursor')),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  /** Models offered per provider (`providerKey` matches `ranking_llm_providers.key`). */
  ranking_llm_models: defineTable({
    providerKey: v.string(),
    /** Value passed to the provider API / CLI (e.g. `gpt-4.1-mini`, `cursor-default`). */
    apiModelId: v.string(),
    displayName: v.string(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_provider_key', ['providerKey']),

  /**
   * Persisted scheduler status for a worker process. Singleton row per `workerId`
   * (default `'default'`); the worker writes on start/stop/tick boundaries plus a
   * heartbeat interval so the dashboard can render a reactive view and detect
   * stale/dead workers via `now - heartbeatAt`.
   *
   * Field shape mirrors `WorkerSchedulerStatus` in `apps/worker/src/scheduler.ts`
   * so the worker can serialize directly. Nullable runtime fields use
   * `v.union(..., v.null())` instead of optionals to keep the JSON one-to-one
   * across wire/storage.
   */
  worker_scheduler_status: defineTable({
    workerId: v.string(),
    intervalMs: v.number(),
    intervalMinutes: v.number(),
    runOnStart: v.boolean(),
    schedulerStartedAt: v.union(v.number(), v.null()),
    lastIntervalRingAt: v.union(v.number(), v.null()),
    lastTickCompletedAt: v.union(v.number(), v.null()),
    lastTickTrigger: v.union(v.string(), v.null()),
    lastTickDurationMs: v.union(v.number(), v.null()),
    lastTickQueueSnapshot: v.union(
      v.object({ queued: v.number(), running: v.number() }),
      v.null()
    ),
    nextIntervalTickAt: v.union(v.number(), v.null()),
    timerActive: v.boolean(),
    tickInFlight: v.boolean(),
    lastTickFailedAt: v.union(v.number(), v.null()),
    lastTickError: v.union(v.string(), v.null()),
    /** Wall-clock time of the last heartbeat write; used client-side to detect a dead worker. */
    heartbeatAt: v.number(),
    updatedAt: v.number(),
  }).index('by_worker_id', ['workerId']),
});
