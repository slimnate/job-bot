import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const schemaVersion = 'slim_job_criteria';

export default defineSchema({
  job_criteria: defineTable({
    name: v.string(),
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
    criteriaId: v.optional(v.id('job_criteria')),
    source: v.string(),
    /** LinkedIn: empty/omitted = jobs hub "Jobs based on your preferences" path; non-empty = keyword search. */
    linkedinSearchQuery: v.optional(v.string()),
    /** LinkedIn search location filter (city/region text accepted by LinkedIn). */
    linkedinLocation: v.optional(v.string()),
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
    criteriaId: v.optional(v.id('job_criteria')),
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
});
