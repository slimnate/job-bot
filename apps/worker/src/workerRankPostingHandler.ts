import { randomUUID } from 'node:crypto';
import type http from 'node:http';

import type { RankingResult } from '@job-bot/shared';
import type { ConvexHttpClient } from 'convex/browser';

import { api } from './convexBridge/api.js';
import type { Doc, Id } from './convexBridge/doc.js';
import {
  convexReadRetryOptions,
  convexSaveRetryOptions,
  createWorkerConvexClient,
} from './convexHttp.js';
import { isRankDebug } from './debugFlags.js';
import { workerLog } from './log.js';
import { withRankRunLogContext } from './ranking/rankRunContext.js';
import { finishRankRunLog, isValidRankingRunId } from './ranking/rankRunLogHub.js';
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
  /** Client-generated id; subscribe via `GET /rank-logs?rankingRunId=` before POST. */
  rankingRunId?: string;
};

/**
 * Resolves the scoring run id from the request body or generates one.
 */
function resolveRankingRunId(body: RankPostingBody): string {
  const fromBody = body.rankingRunId?.trim();
  if (fromBody && isValidRankingRunId(fromBody)) {
    return fromBody;
  }
  return randomUUID();
}

type RankSavePayload = {
  evaluatorId: Id<'job_evaluators'>;
  model: string;
  rankings: RankingResult[];
};

/**
 * Persists ranking rows to Convex with extended retries and `skipQueue` so the mutation
 * is not blocked behind any queued mutations on this HTTP client.
 */
async function saveRankingsToConvex(
  convex: ConvexHttpClient,
  payload: RankSavePayload
): Promise<{ saved: number }> {
  return withRetry(
    () =>
      convex.mutation(
        api.ranking.upsertResults,
        {
          evaluatorId: payload.evaluatorId,
          model: payload.model,
          rankings: payload.rankings,
        },
        { skipQueue: true }
      ),
    {
      ...convexSaveRetryOptions,
      label: 'ranking.upsertResults',
      retryDebugSubsystem: 'rank',
    }
  );
}

function formatConvexSaveError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return (
    `Ranking finished but saving scores to Convex failed (${detail}). ` +
    'Check that `CONVEX_URL` in `.env.local` matches your deployment, `npx convex dev` is running, and the network can reach convex.cloud.'
  );
}

function sendRankFailure(
  res: http.ServerResponse,
  status: number,
  error: string,
  extra?: Record<string, unknown>
): void {
  res.writeHead(status, { ...corsJson, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error, ...extra }));
}

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

  const convex = createWorkerConvexClient(convexUrl);

  async function runConvexRead<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexReadRetryOptions,
      label,
      retryDebugSubsystem: 'rank',
    });
  }

  try {
    if (isRankDebug()) {
      workerLog.debug('rank_posting.request', { postingId, evaluatorId, model });
    }
    const posting = await runConvexRead('postings.getById', () =>
      convex.query(api.postings.getById, { postingId: postingId as Id<'job_postings'> })
    );
    if (!posting) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Posting not found' }));
      return;
    }

    const evaluator = await runConvexRead('evaluators.getById', () =>
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

    const rankingRunId = resolveRankingRunId(body);

    await withRankRunLogContext(rankingRunId, async () => {
      try {
      workerLog.info('llm.rank.run.begin', {
        rankingRunId,
        postingCount: 1,
        postingId,
        evaluatorId,
        model,
      });

      const rankingResult = await rankJobsWithCursor({
        evaluator: evaluator as Doc<'job_evaluators'>,
        model,
        candidates,
      });

      const rankings = rankingResult.rankings;
      if (rankings.length === 0) {
        const err = 'Ranker returned no results';
        workerLog.error('llm.rank.run.end', { rankingRunId, ok: false, error: err });
        finishRankRunLog(rankingRunId, { ok: false, error: err });
        sendRankFailure(res, 500, err);
        return;
      }

      const scoreOverall = rankings[0]?.scoreOverall ?? 0;

      try {
        const saveResult = await saveRankingsToConvex(convex, {
          evaluatorId: evaluatorId as Id<'job_evaluators'>,
          model: rankingResult.model,
          rankings,
        });
        workerLog.info('rank_posting.saved', {
          postingId,
          scoreOverall,
          saved: saveResult.saved,
        });
        workerLog.info('llm.rank.run.end', { rankingRunId, ok: true, scoreOverall, saved: saveResult.saved });
        finishRankRunLog(rankingRunId, { ok: true, scoreOverall, saved: saveResult.saved });

        res.writeHead(200, { ...corsJson, 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            scoreOverall,
            model: rankingResult.model,
            rankingRunId,
          })
        );
      } catch (saveErr: unknown) {
        const message = formatConvexSaveError(saveErr);
        workerLog.error('rank_posting.save_failed', {
          postingId,
          scoreOverall,
          err: saveErr instanceof Error ? saveErr.message : String(saveErr),
        });
        workerLog.error('llm.rank.run.end', { rankingRunId, ok: false, error: message, scoreOverall });
        finishRankRunLog(rankingRunId, { ok: false, error: message, scoreOverall });
        sendRankFailure(res, 502, message, {
          ranked: true,
          scoreOverall,
          model: rankingResult.model,
          rankingRunId,
        });
      }
      } catch (rankErr: unknown) {
        const message = rankErr instanceof Error ? rankErr.message : String(rankErr);
        workerLog.error('llm.rank.run.end', { rankingRunId, ok: false, error: message });
        finishRankRunLog(rankingRunId, { ok: false, error: message });
        throw rankErr;
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    workerLog.error('rank_posting.failed', { err: message });
    sendRankFailure(res, 500, message);
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

  const convex = createWorkerConvexClient(convexUrl);

  async function runConvexRead<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexReadRetryOptions,
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
    const evaluator = await runConvexRead('evaluators.getById', () =>
      convex.query(api.evaluators.getById, { id: evaluatorId as Id<'job_evaluators'> })
    );
    if (!evaluator) {
      res.writeHead(404, { ...corsJson, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Evaluator profile not found' }));
      return;
    }

    const postingDocs = await Promise.all(
      postingIds.map((postingId) =>
        runConvexRead('postings.getById', () =>
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

    const rankingRunId = resolveRankingRunId(body);

    await withRankRunLogContext(rankingRunId, async () => {
      try {
      workerLog.info('llm.rank.run.begin', {
        rankingRunId,
        postingCount: candidates.length,
        evaluatorId,
        model,
      });

      const rankingResult = await rankJobsWithCursor({
        evaluator: evaluator as Doc<'job_evaluators'>,
        model,
        candidates,
      });

      const rankings = rankingResult.rankings;
      if (rankings.length !== candidates.length) {
        const err = 'Ranker returned incomplete results';
        workerLog.error('llm.rank.run.end', { rankingRunId, ok: false, error: err });
        finishRankRunLog(rankingRunId, { ok: false, error: err });
        sendRankFailure(res, 500, err);
        return;
      }

      const scores = rankings.map((row) => ({
        postingId: row.postingId,
        scoreOverall: row.scoreOverall,
      }));

      try {
        const saveResult = await saveRankingsToConvex(convex, {
          evaluatorId: evaluatorId as Id<'job_evaluators'>,
          model: rankingResult.model,
          rankings,
        });
        workerLog.info('rank_postings.saved', {
          saved: saveResult.saved,
          postingCount: rankings.length,
        });
        workerLog.info('llm.rank.run.end', {
          rankingRunId,
          ok: true,
          saved: saveResult.saved,
        });
        finishRankRunLog(rankingRunId, { ok: true, saved: saveResult.saved });

        res.writeHead(200, { ...corsJson, 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            saved: rankings.length,
            model: rankingResult.model,
            rankingRunId,
          })
        );
      } catch (saveErr: unknown) {
        const message = formatConvexSaveError(saveErr);
        workerLog.error('rank_postings.save_failed', {
          postingCount: rankings.length,
          scores,
          err: saveErr instanceof Error ? saveErr.message : String(saveErr),
        });
        workerLog.error('llm.rank.run.end', { rankingRunId, ok: false, error: message });
        finishRankRunLog(rankingRunId, { ok: false, error: message });
        sendRankFailure(res, 502, message, {
          ranked: true,
          scores,
          model: rankingResult.model,
          rankingRunId,
        });
      }
      } catch (rankErr: unknown) {
        const message = rankErr instanceof Error ? rankErr.message : String(rankErr);
        workerLog.error('llm.rank.run.end', { rankingRunId, ok: false, error: message });
        finishRankRunLog(rankingRunId, { ok: false, error: message });
        throw rankErr;
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    workerLog.error('rank_postings.failed', { err: message });
    sendRankFailure(res, 500, message);
  }
}
