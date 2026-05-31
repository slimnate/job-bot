import type { Id } from './_generated/dataModel.js';
import type { MutationCtx } from './_generated/server.js';

/**
 * Idempotently records that a posting was seen during a scrape run.
 * Skips when `scrapeRunId` is absent (e.g. manual `/ingest-posting`).
 */
export async function linkPostingToScrapeRun(
  ctx: MutationCtx,
  scrapeRunId: Id<'scrape_runs'> | undefined,
  postingId: Id<'job_postings'>,
  discoveredAt: number
): Promise<void> {
  if (!scrapeRunId) {
    return;
  }

  const existing = await ctx.db
    .query('scrape_run_postings')
    .withIndex('by_scrape_run_and_posting', (q) =>
      q.eq('scrapeRunId', scrapeRunId).eq('postingId', postingId)
    )
    .first();
  if (existing) {
    return;
  }

  await ctx.db.insert('scrape_run_postings', {
    scrapeRunId,
    postingId,
    discoveredAt,
    createdAt: Date.now(),
  });
}

/** Removes all run–posting links for one posting (before deleting the posting). */
export async function deleteScrapeRunPostingsForPosting(
  ctx: MutationCtx,
  postingId: Id<'job_postings'>
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const batch = await ctx.db
      .query('scrape_run_postings')
      .withIndex('by_posting_id', (q) => q.eq('postingId', postingId))
      .take(200);
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }
  return deleted;
}

/** Removes all run–posting links for one scrape run (before deleting the run). */
export async function deleteScrapeRunPostingsForRun(
  ctx: MutationCtx,
  scrapeRunId: Id<'scrape_runs'>
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const batch = await ctx.db
      .query('scrape_run_postings')
      .withIndex('by_scrape_run_id', (q) => q.eq('scrapeRunId', scrapeRunId))
      .take(200);
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
  }
  return deleted;
}
