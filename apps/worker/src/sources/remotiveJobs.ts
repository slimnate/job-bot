import { XMLParser } from 'fast-xml-parser';

import {
  buildRemotiveFeedUrls,
  parseAppSettingValue,
  parseRemotiveCategorySlugs,
  REMOTIVE_ALL_JOBS_FEED_URL,
} from '@job-bot/shared';

import type { Id } from '../convexBridge/doc.js';
import { workerLog } from '../log.js';
import { getWorkerSettingsCache } from '../settings/settingsCache.js';
import type { ScrapedPostingInput, ScrapeResult } from '../scrapeTypes.js';
import {
  extractJobIdFromUrl,
  feedSlugFromUrl,
  htmlToPlainText,
  resolveRemotiveFeedUrls,
  textContent,
} from './remotiveRssUtils.js';

export { htmlToPlainText, resolveRemotiveFeedUrls } from './remotiveRssUtils.js';

type RssItem = Record<string, unknown>;

/** Optional cap from settings-merged env; undefined when blank or invalid. */
function parseRemotiveMaxPostings(env: Record<string, string | undefined>): number | undefined {
  const raw = env.WORKER_REMOTIVE_MAX_POSTINGS;
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  try {
    return parseAppSettingValue('WORKER_REMOTIVE_MAX_POSTINGS', raw) as number;
  } catch {
    workerLog.warn('remotive.invalid_max_postings', { raw });
    return undefined;
  }
}

function parseRemotiveFetchTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.WORKER_REMOTIVE_FETCH_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') {
    return 30_000;
  }
  try {
    return parseAppSettingValue('WORKER_REMOTIVE_FETCH_TIMEOUT_MS', raw) as number;
  } catch {
    workerLog.warn('remotive.invalid_fetch_timeout', { raw });
    return 30_000;
  }
}

function parseRssItems(xml: string): RssItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    isArray: (name) => name === 'item',
  });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const item = doc.rss?.channel?.item;
  if (!item) {
    return [];
  }
  return Array.isArray(item) ? item : [item];
}

function itemToPosting(
  item: RssItem,
  runId: Id<'scrape_runs'>,
  feedUrl: string,
  discoveredAt: number
): ScrapedPostingInput | null {
  const title = textContent(item.title);
  const company = textContent(item.company);
  const url = textContent(item.link);
  if (!title || !company || !url) {
    return null;
  }

  let externalId = textContent(item.jobId);
  if (!externalId) {
    externalId = extractJobIdFromUrl(url) ?? '';
  }
  if (!externalId) {
    return null;
  }

  const descriptionHtml = textContent(item.description);
  const descriptionSnippet = descriptionHtml ? htmlToPlainText(descriptionHtml) : undefined;
  const location = textContent(item.location) || undefined;
  const category = textContent(item.category) || undefined;
  const jobType = textContent(item.type) || undefined;
  const pubDateRaw = textContent(item.pubDate);
  const postedAt = pubDateRaw ? Date.parse(pubDateRaw) : undefined;

  return {
    source: 'remotive',
    externalId,
    url,
    title,
    company,
    location,
    descriptionSnippet,
    postedAt: postedAt !== undefined && !Number.isNaN(postedAt) ? postedAt : undefined,
    discoveredAt,
    scrapeRunId: runId,
    rawPayload: {
      provider: 'remotive-rss',
      category,
      jobType,
      feedUrl,
      feedSlug: feedSlugFromUrl(feedUrl),
      pubDate: pubDateRaw || undefined,
    },
  };
}

async function fetchRemotiveFeed(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Remotive RSS fetch failed (${response.status}): ${url}`);
  }
  return await response.text();
}

/**
 * Fetches Remotive RSS feed(s) for a scrape run and returns normalized postings.
 */
export async function collectRemotivePostings(params: {
  runId: Id<'scrape_runs'>;
  sourceCriteria?: Record<string, string>;
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
  const env = getWorkerSettingsCache().getEnvRecord();
  const maxPostings = parseRemotiveMaxPostings(env);
  const fetchTimeoutMs = parseRemotiveFetchTimeoutMs(env);
  const feedUrls = resolveRemotiveFeedUrls(params.sourceCriteria);
  const discoveredAt = Date.now();

  const byExternalId = new Map<string, ScrapedPostingInput>();
  let discoveredCount = 0;

  for (const feedUrl of feedUrls) {
    if (maxPostings !== undefined && byExternalId.size >= maxPostings) {
      break;
    }

    const xml = await fetchRemotiveFeed(feedUrl, fetchTimeoutMs);
    const items = parseRssItems(xml);

    for (const item of items) {
      if (maxPostings !== undefined && byExternalId.size >= maxPostings) {
        break;
      }
      const posting = itemToPosting(item, params.runId, feedUrl, discoveredAt);
      if (!posting) {
        continue;
      }
      discoveredCount += 1;
      if (byExternalId.has(posting.externalId)) {
        continue;
      }
      byExternalId.set(posting.externalId, posting);
      if (params.streamPosting) {
        await params.streamPosting(posting);
      }
    }
  }

  const postings = [...byExternalId.values()];
  const dedupedCount = Math.max(0, discoveredCount - postings.length);

  workerLog.info('remotive.scrape.complete', {
    runId: params.runId,
    feedCount: feedUrls.length,
    discoveredCount,
    uniqueCount: postings.length,
    dedupedCount,
  });

  return {
    postings,
    stats: {
      discoveredCount,
      dedupedCount,
    },
  };
}
