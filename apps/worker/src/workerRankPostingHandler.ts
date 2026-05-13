import type http from 'node:http';

import { ConvexHttpClient } from 'convex/browser';

import { api } from './convexBridge/api.js';
import type { Doc, Id } from './convexBridge/doc.js';
import { isRankDebug } from './debugFlags.js';
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
  postingIds?: string[];
  evaluatorId?: string;
  model?: string;
};

const convexRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 5000,
} as const;

/**
 * Handles `POST /rank-posting`: loads posting + evaluator from Convex, runs Cursor CLI ranking for one job,
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
  const evaluatorId = body.evaluatorId;
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!postingId || !evaluatorId || !model) {
    res.writeHead(400, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Missing postingId, evaluatorId, or model' }));
    return;
  }

  const convex = new ConvexHttpClient(convexUrl);

  async function runConvex<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexRetryOptions,
      label,
      retryDebugSubsystem: 'rank',
    });
  }

  try {
    if (isRankDebug()) {
      workerLog.debug('rank_posting.request', { postingId, evaluatorId, model });
    }
    const posting = await runConvex('postings.getById', () =>
      convex.query(api.postings.getById, { postingId: postingId as Id<'job_postings'> })
    );
    if (!posting) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Posting not found' }));
      return;
    }

    const evaluator = await runConvex('evaluators.getById', () =>
      convex.query(api.evaluators.getById, { id: evaluatorId as Id<'job_evaluators'> })
    );
    if (!evaluator) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Evaluator profile not found' }));
      return;
    }

    if (isRankDebug()) {
      workerLog.debug('rank_posting.loaded', {
        postingId,
        evaluatorId: evaluator._id,
      });
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
      evaluatorId,
      model,
    });

    if (isRankDebug()) {
      workerLog.debug('rank_posting.invoke', { provider: 'cursor', candidateCount: candidates.length });
    }

    const rankingResult = await rankJobsWithCursor({
      evaluator: evaluator as Doc<'job_evaluators'>,
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
        evaluatorId: evaluatorId as Id<'job_evaluators'>,
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

/**
 * Handles `POST /rank-postings`: loads selected postings + evaluator, runs one Cursor CLI ranking call
 * for the full batch, writes one ranking row per posting.
 */
export async function handleRankPostingsRequest(params: {
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
  const postingIdsRaw = Array.isArray(body.postingIds) ? body.postingIds : [];
  const postingIds = Array.from(
    new Set(postingIdsRaw.filter((value): value is string => typeof value === 'string' && value.length > 0))
  );
  const evaluatorId = body.evaluatorId;
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!postingIds.length || !evaluatorId || !model) {
    res.writeHead(400, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Missing postingIds, evaluatorId, or model' }));
    return;
  }

  const convex = new ConvexHttpClient(convexUrl);

  async function runConvex<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexRetryOptions,
      label,
      retryDebugSubsystem: 'rank',
    });
  }

  try {
    if (isRankDebug()) {
      workerLog.debug('rank_postings.request', {
        postingCount: postingIds.length,
        evaluatorId,
        model,
      });
    }
    const evaluator = await runConvex('evaluators.getById', () =>
      convex.query(api.evaluators.getById, { id: evaluatorId as Id<'job_evaluators'> })
    );
    if (!evaluator) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Evaluator profile not found' }));
      return;
    }

    const postingDocs = await Promise.all(
      postingIds.map((postingId) =>
        runConvex('postings.getById', () =>
          convex.query(api.postings.getById, { postingId: postingId as Id<'job_postings'> })
        )
      )
    );
    const candidates: LlmRankingCandidate[] = postingDocs
      .filter((posting): posting is NonNullable<typeof posting> => posting !== null)
      .map((posting) => ({
        _id: posting._id,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        salaryText: posting.salaryText,
        descriptionSnippet: posting.descriptionSnippet,
        postedAt: posting.postedAt,
        url: posting.url,
        source: posting.source,
      }));
    if (!candidates.length) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No selected postings were found' }));
      return;
    }

    if (isRankDebug()) {
      workerLog.debug('rank_postings.loaded', {
        evaluatorId: evaluator._id,
        candidateCount: candidates.length,
      });
    }

    workerLog.info('rank_postings.start', {
      postingCount: candidates.length,
      evaluatorId,
      model,
    });

    if (isRankDebug()) {
      workerLog.debug('rank_postings.invoke', { provider: 'cursor', candidateCount: candidates.length });
    }

    const rankingResult = await rankJobsWithCursor({
      evaluator: evaluator as Doc<'job_evaluators'>,
      model,
      candidates,
    });

    const rankings = rankingResult.rankings;
    if (rankings.length !== candidates.length) {
      res.writeHead(500, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Ranker returned incomplete results' }));
      return;
    }

    await runConvex('ranking.upsertResults', () =>
      convex.mutation(api.ranking.upsertResults, {
        evaluatorId: evaluatorId as Id<'job_evaluators'>,
        model: rankingResult.model,
        rankings,
      })
    );

    res.writeHead(200, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        saved: rankings.length,
        model: rankingResult.model,
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    workerLog.error('rank_postings.failed', { err: message });
    res.writeHead(500, { ...corsJson, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}
