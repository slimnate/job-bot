import type http from 'node:http';

import {
  finishRankRunLog,
  isValidRankingRunId,
  subscribeRankRunLog,
  type RankRunLogEnd,
  type RankRunLogEntry,
} from './rankRunLogHub.js';

const corsSse: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
};

function parseRankingRunId(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const id = params.get('rankingRunId')?.trim() ?? '';
  return id && isValidRankingRunId(id) ? id : null;
}

function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * `GET /rank-logs?rankingRunId=…` — Server-Sent Events stream of `llm.rank.*` logs for one scoring run.
 */
export function handleRankRunLogStreamRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsSse);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, corsSse);
    res.end('Method not allowed');
    return;
  }

  const rankingRunId = parseRankingRunId(req.url);
  if (!rankingRunId) {
    res.writeHead(400, { ...corsSse, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing or invalid rankingRunId query parameter');
    return;
  }

  res.writeHead(200, corsSse);

  const unsubscribe = subscribeRankRunLog(rankingRunId, (event) => {
    if ((event as RankRunLogEnd).type === 'end') {
      writeSse(res, 'end', event);
      res.end();
      return;
    }
    writeSse(res, 'log', event as RankRunLogEntry);
  });

  req.on('close', () => {
    unsubscribe();
    if (!res.writableEnded) {
      res.end();
    }
  });
}
