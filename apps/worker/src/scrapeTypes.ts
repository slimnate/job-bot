import type { Id } from './convexBridge/doc.js';

export type ScrapedPostingInput = {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  /** Full job description (multiline); Convex field name is legacy `descriptionSnippet`. */
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
  searchTelemetry?: {
    strategyUsed: 'ui' | 'preferences_hub';
    /** Kept for Convex telemetry shape; always false (URL search fallback removed). */
    usedLinkedinUrlFallback: boolean;
  };
};
