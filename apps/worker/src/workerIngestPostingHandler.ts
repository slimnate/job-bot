import type http from 'node:http';

import { createWorkerConvexClient } from './convexHttp.js';

import { api } from './convexBridge/api.js';
import { workerLog } from './log.js';
import { withRetry } from './retry.js';

const corsJson: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const convexRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 5000,
} as const;

const NA = 'N/A';

type IngestPostingInput = {
  source?: string;
  externalId?: string;
  url?: string;
  title?: string;
  company?: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: number;
  discoveredAt?: number;
  rawPayload?: unknown;
};

type NormalizedPosting = {
  source: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  salaryText?: string;
  descriptionSnippet?: string;
  postedAt?: number;
  discoveredAt?: number;
  rawPayload?: unknown;
};

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve(null);
          return;
        }
        resolve(JSON.parse(raw) as unknown);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === NA) {
    return undefined;
  }
  return trimmed;
}

function requiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === NA) {
    return null;
  }
  return trimmed;
}

/**
 * Derives `source` and `externalId` from a job URL when the client omitted them.
 */
export function deriveSourceAndExternalId(url: string): { source: string; externalId: string } | null {
  const linkedInView = url.match(/\/jobs\/view\/(\d+)/i);
  if (linkedInView?.[1]) {
    return { source: 'linkedin', externalId: linkedInView[1] };
  }
  const linkedInCurrent = url.match(/[?&]currentJobId=(\d+)/i);
  if (linkedInCurrent?.[1]) {
    return { source: 'linkedin', externalId: linkedInCurrent[1] };
  }
  const indeedJk = url.match(/[?&]jk=([a-f0-9]+)/i);
  if (indeedJk?.[1]) {
    return { source: 'indeed', externalId: indeedJk[1] };
  }
  return null;
}

/**
 * Canonicalizes LinkedIn job URLs to `/jobs/view/{id}/` when the id is numeric.
 */
export function canonicalizeJobUrl(source: string, externalId: string, url: string): string {
  if (source === 'linkedin' && /^\d+$/.test(externalId)) {
    return `https://www.linkedin.com/jobs/view/${externalId}/`;
  }
  return url.trim();
}

/**
 * Normalizes one ingest body object into a Convex `upsertBatch` posting row.
 */
export function normalizeIngestPosting(raw: IngestPostingInput): NormalizedPosting | { error: string } {
  const url = requiredString(raw.url);
  if (!url) {
    return { error: 'Missing or invalid url' };
  }

  let source = requiredString(raw.source);
  let externalId = requiredString(raw.externalId);

  if (!source || !externalId) {
    const derived = deriveSourceAndExternalId(url);
    if (!derived) {
      return { error: 'Could not derive source and externalId from url' };
    }
    source = source ?? derived.source;
    externalId = externalId ?? derived.externalId;
  }

  source = source.trim().toLowerCase();
  externalId = externalId.trim();

  if (source === 'linkedin' && !/^\d+$/.test(externalId)) {
    return { error: 'LinkedIn externalId must be numeric' };
  }

  const title = requiredString(raw.title);
  const company = requiredString(raw.company);
  if (!title || !company) {
    return { error: 'Missing or invalid title or company' };
  }

  const canonicalUrl = canonicalizeJobUrl(source, externalId, url);

  return {
    source,
    externalId,
    url: canonicalUrl,
    title,
    company,
    location: optionalString(raw.location),
    salaryText: optionalString(raw.salaryText),
    descriptionSnippet: optionalString(raw.descriptionSnippet),
    postedAt: typeof raw.postedAt === 'number' && Number.isFinite(raw.postedAt) ? raw.postedAt : undefined,
    discoveredAt:
      typeof raw.discoveredAt === 'number' && Number.isFinite(raw.discoveredAt)
        ? raw.discoveredAt
        : Date.now(),
    rawPayload: raw.rawPayload,
  };
}

function extractPostingsFromBody(parsed: unknown): IngestPostingInput[] {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const body = parsed as Record<string, unknown>;
  if (Array.isArray(body.postings)) {
    return body.postings.filter((p): p is IngestPostingInput => !!p && typeof p === 'object');
  }
  return [body as IngestPostingInput];
}

/**
 * Handles `POST /ingest-posting`: validates extension or manual capture payloads and upserts into `job_postings`.
 */
export async function handleIngestPostingRequest(params: {
  convexUrl: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
}): Promise<void> {
  const { convexUrl, req, res } = params;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsJson);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    res.writeHead(400, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    return;
  }

  const rawPostings = extractPostingsFromBody(parsed);
  if (rawPostings.length === 0) {
    res.writeHead(400, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'No postings in body' }));
    return;
  }

  const postings: NormalizedPosting[] = [];
  for (const raw of rawPostings) {
    const normalized = normalizeIngestPosting(raw);
    if ('error' in normalized) {
      res.writeHead(400, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: normalized.error }));
      return;
    }
    postings.push(normalized);
  }

  const convex = createWorkerConvexClient(convexUrl);

  try {
    workerLog.info('ingest_posting.start', { count: postings.length });

    const result = await withRetry(
      () => convex.mutation(api.postings.upsertBatch, { postings }),
      {
        ...convexRetryOptions,
        label: 'postings.upsertBatch',
      }
    );

    res.writeHead(200, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        inserted: result.inserted,
        updated: result.updated,
        skippedInvalid: result.skippedInvalid,
        processed: result.processed,
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    workerLog.error('ingest_posting.failed', { err: message });
    res.writeHead(500, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}
