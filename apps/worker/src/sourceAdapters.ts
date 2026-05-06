import { ensureWorkerChromeForLinkedIn, getWorkerChromeDriver } from './chromeSession.js';
import type { Id } from './convexBridge/doc.js';
import { withLinkedInBrowserExclusive } from './linkedinBrowserLock.js';
import { collectLinkedInPostings } from './sources/linkedinJobs.js';
import type { ScrapedPostingInput, ScrapeResult, ScrapeStats } from './scrapeTypes.js';

export type { ScrapeResult, ScrapeStats } from './scrapeTypes.js';

export async function collectPostingsForSource(params: {
  runId: Id<'scrape_runs'>;
  source: string;
  linkedinSearchQuery?: string;
  /** LinkedIn: upsert each posting as soon as it is scraped (orchestrator only). */
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
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

  /**
   * We intentionally fail fast for unsupported sources so the worker never inserts
   * synthetic placeholder rows into real postings data.
   */
  throw new Error(
    `Unsupported scrape source '${normalizedSource}'. Only 'linkedin' is implemented in the worker source adapter.`
  );
}
