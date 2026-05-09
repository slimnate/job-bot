import {
  closeWorkerChromeAfterLinkedInScrape,
  ensureWorkerChromeForLinkedIn,
  getWorkerChromeDriver,
} from './chromeSession.js';
import type { Id } from './convexBridge/doc.js';
import { withLinkedInBrowserExclusive } from './linkedinBrowserLock.js';
import { workerLog } from './log.js';
import { collectLinkedInPostings } from './sources/linkedinJobs.js';
import type { ScrapedPostingInput, ScrapeResult, ScrapeStats } from './scrapeTypes.js';

export type { ScrapeResult, ScrapeStats } from './scrapeTypes.js';

async function assertLinkedInAuthenticatedSession(driver: {
  getCookiesForUrls?: (
    urls: string[]
  ) => Promise<Array<{ name: string; value: string; domain?: string; path?: string }>>;
}): Promise<void> {
  const cookieRows = driver.getCookiesForUrls
    ? await driver.getCookiesForUrls(['https://www.linkedin.com/', 'https://www.linkedin.com/jobs/'])
    : [];
  const hasLiAt = cookieRows.some((cookie) => cookie.name === 'li_at' && cookie.value.trim().length > 0);
  if (!hasLiAt) {
    workerLog.warn('linkedin.auth_state', {
      event: 'linkedin_auth_required',
      hasLiAt,
    });
    throw new Error(
      'LinkedIn sign-in is required before scraping. Open the worker Chrome session, sign in to LinkedIn, then retry.'
    );
  }
}

export async function collectPostingsForSource(params: {
  runId: Id<'scrape_runs'>;
  source: string;
  sourceCriteria?: Record<string, string>;
  /** LinkedIn: upsert each posting as soon as it is scraped (orchestrator only). */
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
  const normalizedSource = params.source.trim().toLowerCase();

  if (normalizedSource === 'linkedin') {
    return withLinkedInBrowserExclusive(async () => {
      try {
        await ensureWorkerChromeForLinkedIn();
        const driver = getWorkerChromeDriver();
        if (!driver) {
          throw new Error(
            'LinkedIn scraping requires Chrome with CDP. Set WORKER_USE_CHROME=1 (and usually WORKER_CHROME_HEADLESS=0 for login); `npm run dev:all` sets these on the worker. Chrome starts when the first LinkedIn scrape runs, not at worker boot. To attach your own browser instead of spawning one, set WORKER_MANAGE_CHROME=0 and use WORKER_CHROME_PORT.'
          );
        }
        await assertLinkedInAuthenticatedSession(driver);
        // #region agent log
        fetch('http://127.0.0.1:7497/ingest/a72e9a30-5649-4c67-82f3-8d4eaa4b35cd', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '779013',
          },
          body: JSON.stringify({
            sessionId: '779013',
            location: 'sourceAdapters.ts:linkedin',
            message: 'after ensure; about to return collectLinkedInPostings promise',
            data: { runId: params.runId, hypothesisId: 'A' },
            timestamp: Date.now(),
            hypothesisId: 'A',
          }),
        }).catch(() => {});
        // #endregion
        return await collectLinkedInPostings({
          runId: params.runId,
          sourceCriteria: params.sourceCriteria,
          driver,
          env: process.env,
          streamPosting: params.streamPosting,
        });
      } finally {
        // #region agent log
        fetch('http://127.0.0.1:7497/ingest/a72e9a30-5649-4c67-82f3-8d4eaa4b35cd', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '779013',
          },
          body: JSON.stringify({
            sessionId: '779013',
            location: 'sourceAdapters.ts:linkedin_finally',
            message: 'finally: closing chrome after linkedin scrape',
            data: { hypothesisId: 'A' },
            timestamp: Date.now(),
            hypothesisId: 'A',
          }),
        }).catch(() => {});
        // #endregion
        await closeWorkerChromeAfterLinkedInScrape();
      }
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
