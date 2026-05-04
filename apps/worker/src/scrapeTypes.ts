import type { Id } from './convexBridge/doc.js';

export type ScrapedPostingInput = {
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
