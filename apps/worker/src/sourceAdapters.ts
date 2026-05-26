import {
  closeWorkerChromeAfterLinkedInScrape,
  ensureWorkerChromeForLinkedIn,
  getWorkerChromeDriver,
} from './chromeSession.js';
import type { Id } from './convexBridge/doc.js';
import { isScrapeDebug } from './debugFlags.js';
import { withLinkedInBrowserExclusive } from './linkedinBrowserLock.js';
import { workerLog } from './log.js';
import { getWorkerSettingsCache } from './settings/settingsCache.js';
import { collectLinkedInPostings } from './sources/linkedinJobs.js';
import { collectGreenhousePostings } from './sources/greenhouseJobs.js';
import { collectRemotivePostings } from './sources/remotiveJobs.js';
import type { ScrapedPostingInput, ScrapeResult, ScrapeStats } from './scrapeTypes.js';

export type { ScrapeResult, ScrapeStats } from './scrapeTypes.js';

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
        if (isScrapeDebug()) {
          workerLog.debug('scrape.source.begin', { runId: params.runId, source: normalizedSource });
        }
        await ensureWorkerChromeForLinkedIn();
        if (isScrapeDebug()) {
          workerLog.debug('scrape.source.chrome_ready', { runId: params.runId });
        }
        const driver = getWorkerChromeDriver();
        if (!driver) {
          throw new Error(
            'LinkedIn scraping requires Chrome with CDP. Set WORKER_USE_CHROME=1 (and usually WORKER_CHROME_HEADLESS=0 for login); `npm run dev:all` sets these on the worker. Chrome starts when the first LinkedIn scrape runs, not at worker boot. To attach your own browser instead of spawning one, set WORKER_MANAGE_CHROME=0 and use WORKER_CHROME_PORT.'
          );
        }
        return await collectLinkedInPostings({
          runId: params.runId,
          sourceCriteria: params.sourceCriteria,
          driver,
          env: getWorkerSettingsCache().getEnvRecord(),
          streamPosting: params.streamPosting,
        });
      } finally {
        if (isScrapeDebug()) {
          workerLog.debug('scrape.source.finally_cleanup', { runId: params.runId });
        }
        await closeWorkerChromeAfterLinkedInScrape();
      }
    });
  }

  if (normalizedSource === 'remotive') {
    return collectRemotivePostings({
      runId: params.runId,
      sourceCriteria: params.sourceCriteria,
      streamPosting: params.streamPosting,
    });
  }

  if (normalizedSource === 'greenhouse') {
    return collectGreenhousePostings({
      runId: params.runId,
      sourceCriteria: params.sourceCriteria,
      streamPosting: params.streamPosting,
    });
  }

  /**
   * We intentionally fail fast for unsupported sources so the worker never inserts
   * synthetic placeholder rows into real postings data.
   */
  throw new Error(
    `Unsupported scrape source '${normalizedSource}'. Supported sources: linkedin, remotive, greenhouse.`
  );
}
