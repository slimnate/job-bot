import type http from 'node:http';

import { ConvexHttpClient } from 'convex/browser';

import { api } from './convexBridge/api.js';
import type { Doc, Id } from './convexBridge/doc.js';
import { workerLog } from './log.js';
import { rankJobsWithCursor, type LlmRankingCandidate } from './ranking/rankJobsWithLlm.js';
import { withRetry } from './retry.js';

const corsJson: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

type RankPostingBody = {
  postingId?: string;
  criteriaId?: string;
  model?: string;
};

const convexRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 5000,
} as const;

/**
 * Handles `POST /rank-posting`: loads posting + criteria from Convex, runs Cursor CLI ranking for one job,
 * writes `job_rankings`.
 */
export async function handleRankPostingRequest(params: {
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

  const body = (parsed ?? {}) as RankPostingBody;
  const postingId = body.postingId;
  const criteriaId = body.criteriaId;
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!postingId || !criteriaId || !model) {
    res.writeHead(400, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Missing postingId, criteriaId, or model' }));
    return;
  }

  const convex = new ConvexHttpClient(convexUrl);

  async function runConvex<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexRetryOptions,
      label,
    });
  }

  try {
    const posting = await runConvex('postings.getById', () =>
      convex.query(api.postings.getById, { postingId: postingId as Id<'job_postings'> })
    );
    if (!posting) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Posting not found' }));
      return;
    }

    const criteria = await runConvex('criteria.getById', () =>
      convex.query(api.criteria.getById, { id: criteriaId as Id<'job_criteria'> })
    );
    if (!criteria) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Criteria profile not found' }));
      return;
    }

    const candidates: LlmRankingCandidate[] = [
      {
        _id: posting._id,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        salaryText: posting.salaryText,
        descriptionSnippet: posting.descriptionSnippet,
        postedAt: posting.postedAt,
        url: posting.url,
        source: posting.source,
      },
    ];

    workerLog.info('rank_posting.start', {
      postingId,
      criteriaId,
      model,
    });

    const rankingResult = await rankJobsWithCursor({
      criteria: criteria as Doc<'job_criteria'>,
      model,
      candidates,
    });

    const rankings = rankingResult.rankings;
    if (rankings.length === 0) {
      res.writeHead(500, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Ranker returned no results' }));
      return;
    }

    await runConvex('ranking.upsertResults', () =>
      convex.mutation(api.ranking.upsertResults, {
        criteriaId: criteriaId as Id<'job_criteria'>,
        model: rankingResult.model,
        rankings,
      })
    );

    const scoreOverall = rankings[0]?.scoreOverall ?? 0;
    res.writeHead(200, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        scoreOverall,
        model: rankingResult.model,
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    workerLog.error('rank_posting.failed', { err: message });
    res.writeHead(500, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}
