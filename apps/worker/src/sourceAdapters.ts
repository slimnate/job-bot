import { ensureWorkerChromeForLinkedIn, getWorkerChromeDriver } from './chromeSession.js';
import type { Id } from './convexBridge/doc.js';
import { withLinkedInBrowserExclusive } from './linkedinBrowserLock.js';
import { collectLinkedInPostings } from './sources/linkedinJobs.js';
import type { ScrapedPostingInput, ScrapeResult, ScrapeStats } from './scrapeTypes.js';

export type { ScrapeResult, ScrapeStats } from './scrapeTypes.js';

const hourMs = 60 * 60 * 1000;

export async function collectPostingsForSource(params: {
  runId: Id<'scrape_runs'>;
  source: string;
  linkedinSearchQuery?: string;
  /** LinkedIn: upsert each posting as soon as it is scraped (orchestrator only). */
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
  const now = Date.now();
  const normalizedSource = params.source.trim().toLowerCase();

  if (normalizedSource === 'linkedin') {
    return withLinkedInBrowserExclusive(async () => {
      await ensureWorkerChromeForLinkedIn();
      const driver = getWorkerChromeDriver();
      if (!driver) {
        throw new Error(
          'LinkedIn scraping requires Chrome with CDP. Set WORKER_USE_CHROME=1 (and usually WORKER_CHROME_HEADLESS=0 for login); `npm run dev:all` sets these on the worker. Chrome starts when the first LinkedIn scrape runs, not at worker boot. To attach your own browser instead of spawning one, set WORKER_MANAGE_CHROME=0 and use WORKER_CHROME_PORT.'
        );
      }
      return collectLinkedInPostings({
        runId: params.runId,
        linkedinSearchQuery: params.linkedinSearchQuery,
        driver,
        env: process.env,
        streamPosting: params.streamPosting,
      });
    });
  }

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
