import type { Id } from '../../../convex/_generated/dataModel.js';

type ScrapedPostingInput = {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: number;
  discoveredAt: number;
  scrapeRunId: Id<'scrape_runs'>;
  rawPayload: Record<string, unknown>;
};

export type ScrapeStats = {
  discoveredCount: number;
  dedupedCount: number;
};

export type ScrapeResult = {
  postings: ScrapedPostingInput[];
  stats: ScrapeStats;
};

const hourMs = 60 * 60 * 1000;

export async function collectPostingsForSource(params: {
  runId: Id<'scrape_runs'>;
  source: string;
}): Promise<ScrapeResult> {
  const now = Date.now();
  const normalizedSource = params.source.trim().toLowerCase();

  const postings: ScrapedPostingInput[] = [
    {
      source: normalizedSource,
      externalId: `${normalizedSource}-core-platform-1`,
      url: `https://${normalizedSource}.example/jobs/core-platform-engineer`,
      title: 'Software Engineer, Platform',
      company: 'Acme Labs',
      location: 'Remote',
      salaryText: '$130k - $170k',
      descriptionSnippet: 'Build backend services, data pipelines, and cloud automation.',
      postedAt: now - (8 * hourMs),
      discoveredAt: now,
      scrapeRunId: params.runId,
      rawPayload: { provider: 'seed-adapter', source: normalizedSource },
    },
    {
      source: normalizedSource,
      externalId: `${normalizedSource}-frontend-2`,
      url: `https://${normalizedSource}.example/jobs/frontend-typescript`,
      title: 'Frontend Engineer (TypeScript)',
      company: 'Signal Works',
      location: 'Hybrid - NYC',
      descriptionSnippet: 'Ship product UI with React, TypeScript, and robust testing.',
      postedAt: now - (30 * hourMs),
      discoveredAt: now,
      scrapeRunId: params.runId,
      rawPayload: { provider: 'seed-adapter', source: normalizedSource },
    },
  ];

  return {
    postings,
    stats: {
      discoveredCount: postings.length,
      // We cannot know dedupe count before DB upsert, leave at zero for now.
      dedupedCount: 0,
    },
  };
}
