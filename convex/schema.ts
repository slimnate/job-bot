import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const schemaVersion = 'initial';

export default defineSchema({
  job_criteria: defineTable({
    name: v.string(),
    isActive: v.boolean(),
    titleKeywords: v.array(v.string()),
    excludedKeywords: v.array(v.string()),
    locations: v.array(v.string()),
    remotePolicy: v.optional(
      v.union(
        v.literal('remote'),
        v.literal('hybrid'),
        v.literal('onsite'),
        v.literal('any')
      )
    ),
    salaryHints: v.optional(v.array(v.string())),
    seniority: v.optional(
      v.union(
        v.literal('intern'),
        v.literal('junior'),
        v.literal('mid'),
        v.literal('senior'),
        v.literal('staff'),
        v.literal('principal'),
        v.literal('any')
      )
    ),
    targetSources: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_is_active', ['isActive'])
    .index('by_updated_at', ['updatedAt']),

  scrape_runs: defineTable({
    criteriaId: v.optional(v.id('job_criteria')),
    source: v.string(),
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
});
