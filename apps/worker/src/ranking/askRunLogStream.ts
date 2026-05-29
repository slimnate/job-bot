import type http from 'node:http';

import {
  finishAskRunLog,
  isValidAskRunId,
  subscribeAskRunLog,
  type AskRunLogEnd,
  type AskRunLogEntry,
} from './askRunLogHub.js';

const corsSse: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
};

function parseAskRunId(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const id = params.get('askRunId')?.trim() ?? '';
  return id && isValidAskRunId(id) ? id : null;
}

function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * `GET /ask-logs?askRunId=…` — Server-Sent Events stream of Q&A logs for one ask run.
 */
export function handleAskRunLogStreamRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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

  const askRunId = parseAskRunId(req.url);
  if (!askRunId) {
    res.writeHead(400, { ...corsSse, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing or invalid askRunId query parameter');
    return;
  }

  res.writeHead(200, corsSse);

  const unsubscribe = subscribeAskRunLog(askRunId, (event) => {
    if ((event as AskRunLogEnd).type === 'end') {
      writeSse(res, 'end', event);
      res.end();
      return;
    }
    writeSse(res, 'log', event as AskRunLogEntry);
  });

  req.on('close', () => {
    unsubscribe();
    if (!res.writableEnded) {
      res.end();
    }
  });
}
