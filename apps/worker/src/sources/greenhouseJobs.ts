import {
  filterGreenhouseJobs,
  GREENHOUSE_BOARDS_API_BASE,
  resolveGreenhouseSearchCriteria,
  type GreenhouseJobListItem,
} from '@job-bot/shared';

import type { Id } from '../convexBridge/doc.js';
import { workerLog } from '../log.js';
import { withRetry } from '../retry.js';
import type { ScrapedPostingInput, ScrapeResult } from '../scrapeTypes.js';
import { htmlToPlainText } from './remotiveRssUtils.js';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type GreenhouseBoardResponse = {
  name?: string;
  content?: string;
};

type GreenhouseJobsListResponse = {
  jobs?: GreenhouseJobListItem[];
  meta?: { total?: number };
};

/**
 * Fetches JSON from the public Greenhouse Job Board API.
 */
async function fetchGreenhouseJson<T>(path: string, timeoutMs: number): Promise<T> {
  const url = `${GREENHOUSE_BOARDS_API_BASE}${path}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 404) {
    throw new Error(
      `Invalid or unpublished Greenhouse board token (HTTP 404). Check boards.greenhouse.io/{token}.`
    );
  }

  if (!response.ok) {
    throw new Error(`Greenhouse API request failed (${response.status}): ${url}`);
  }

  return (await response.json()) as T;
}

function jobToPosting(
  job: GreenhouseJobListItem,
  params: {
    runId: Id<'scrape_runs'>;
    boardToken: string;
    companyName: string;
    discoveredAt: number;
    descriptionSnippet?: string;
  }
): ScrapedPostingInput | null {
  const title = job.title?.trim() ?? '';
  const url = job.absolute_url?.trim() ?? '';
  if (!title || !url) {
    return null;
  }

  const updatedAt = job.updated_at ? Date.parse(job.updated_at) : undefined;

  return {
    source: 'greenhouse',
    externalId: String(job.id),
    url,
    title,
    company: params.companyName,
    location: job.location?.name?.trim() || undefined,
    descriptionSnippet: params.descriptionSnippet,
    postedAt:
      updatedAt !== undefined && !Number.isNaN(updatedAt) ? updatedAt : undefined,
    discoveredAt: params.discoveredAt,
    scrapeRunId: params.runId,
    rawPayload: {
      provider: 'greenhouse-job-board-api',
      boardToken: params.boardToken,
      internalJobId: job.internal_job_id,
      language: job.language,
      departments: job.departments,
      offices: job.offices,
      updatedAt: job.updated_at,
    },
  };
}

/**
 * Fetches a Greenhouse board and all published jobs (`content=true`), applies client-side filters, and maps postings.
 */
export async function collectGreenhousePostings(params: {
  runId: Id<'scrape_runs'>;
  sourceCriteria?: Record<string, string>;
  streamPosting?: (posting: ScrapedPostingInput) => Promise<void>;
}): Promise<ScrapeResult> {
  const criteria = resolveGreenhouseSearchCriteria(params.sourceCriteria);
  if (!criteria.boardToken) {
    throw new Error(
      'Greenhouse requires a board token (e.g. stripe from https://boards.greenhouse.io/stripe).'
    );
  }

  const fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS;

  const board = await withRetry(
    () => fetchGreenhouseJson<GreenhouseBoardResponse>(`/boards/${criteria.boardToken}`, fetchTimeoutMs),
    {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      label: 'greenhouse.fetch_board',
    }
  );

  const companyName = board.name?.trim() || criteria.boardToken;

  const listResponse = await withRetry(
    () =>
      fetchGreenhouseJson<GreenhouseJobsListResponse>(
        `/boards/${criteria.boardToken}/jobs?content=true`,
        fetchTimeoutMs
      ),
    {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      label: 'greenhouse.fetch_jobs',
    }
  );

  const allJobs = listResponse.jobs ?? [];
  const plainContentByJobId = new Map<number, string>();
  for (const job of allJobs) {
    if (job.content) {
      plainContentByJobId.set(job.id, htmlToPlainText(job.content));
    }
  }

  const filtered = filterGreenhouseJobs(allJobs, criteria, { plainContentByJobId });
  const discoveredAt = Date.now();
  const postings: ScrapedPostingInput[] = [];

  for (const job of filtered) {
    const descriptionSnippet = plainContentByJobId.get(job.id);
    const posting = jobToPosting(job, {
      runId: params.runId,
      boardToken: criteria.boardToken,
      companyName,
      discoveredAt,
      descriptionSnippet,
    });
    if (!posting) {
      continue;
    }
    postings.push(posting);
    if (params.streamPosting) {
      await params.streamPosting(posting);
    }
  }

  const dedupedCount = Math.max(0, allJobs.length - filtered.length);

  workerLog.info('greenhouse.scrape.complete', {
    runId: params.runId,
    boardToken: criteria.boardToken,
    companyName,
    totalFromApi: allJobs.length,
    afterFilters: filtered.length,
    exported: postings.length,
    includeProspects: criteria.includeProspects,
    hasKeyword: Boolean(criteria.keyword),
    hasDepartment: Boolean(criteria.department),
    hasOffice: Boolean(criteria.office),
  });

  return {
    postings,
    stats: {
      discoveredCount: filtered.length,
      dedupedCount,
    },
  };
}
