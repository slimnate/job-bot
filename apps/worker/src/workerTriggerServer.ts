import http from 'node:http';

import { workerLog } from './log.js';
import type { WorkerScheduler } from './scheduler.js';
import { handleIngestPostingRequest } from './workerIngestPostingHandler.js';
import { handleRankRunLogStreamRequest } from './ranking/rankRunLogStream.js';
import { handleRankPostingRequest, handleRankPostingsRequest } from './workerRankPostingHandler.js';

const corsTrigger: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const corsJson: Record<string, string> = {
  ...corsTrigger,
  'Content-Type': 'application/json; charset=utf-8',
};

/**
 * Local-only HTTP trigger: `GET /scheduler` returns scheduler JSON; `POST /trigger` runs one scheduler tick;
 * `POST /rank-posting` scores one posting and `POST /rank-postings` scores multiple postings in one batch via Cursor CLI;
 * `GET /rank-logs?rankingRunId=…` streams `llm.rank.*` logs for a scoring run (SSE, used by the Postings score dialog);
 * `POST /ingest-posting` upserts captured job postings (e.g. from the oc-job-capture browser extension).
 * Binds `127.0.0.1` only.
 */
export function startWorkerTriggerServer(
  scheduler: WorkerScheduler,
  port: number,
  options: { convexUrl: string }
): http.Server {
  const server = http.createServer((req, res) => {
    if (
      req.method === 'OPTIONS' &&
      (req.url === '/trigger' ||
        req.url === '/scheduler' ||
        req.url === '/rank-posting' ||
        req.url === '/rank-postings' ||
        req.url === '/ingest-posting' ||
        req.url?.startsWith('/rank-logs'))
    ) {
      res.writeHead(204, corsTrigger);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/scheduler') {
      try {
        const body = JSON.stringify(scheduler.getStatus());
        res.writeHead(200, corsJson);
        res.end(body);
      } catch (err: unknown) {
        res.writeHead(500, { ...corsTrigger, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(err instanceof Error ? err.message : 'scheduler status failed');
      }
      return;
    }
    if (req.method === 'POST' && req.url === '/trigger') {
      void scheduler
        .runNow()
        .then(() => {
          res.writeHead(204, corsTrigger);
          res.end();
        })
        .catch((err: unknown) => {
          res.writeHead(500, { ...corsTrigger, 'Content-Type': 'text/plain' });
          res.end(err instanceof Error ? err.message : 'scheduler tick failed');
        });
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/rank-logs')) {
      handleRankRunLogStreamRequest(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/rank-posting') {
      void handleRankPostingRequest({ convexUrl: options.convexUrl, req, res });
      return;
    }
    if (req.method === 'POST' && req.url === '/rank-postings') {
      void handleRankPostingsRequest({ convexUrl: options.convexUrl, req, res });
      return;
    }
    if (req.method === 'POST' && req.url === '/ingest-posting') {
      void handleIngestPostingRequest({ convexUrl: options.convexUrl, req, res });
      return;
    }
    res.writeHead(404, corsTrigger);
    res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    workerLog.info('worker.trigger_http', {
      port,
      paths: ['/scheduler', '/trigger', '/rank-posting', '/rank-postings', '/rank-logs', '/ingest-posting'],
      bind: '127.0.0.1',
    });
  });

  return server;
}

export async function stopWorkerTriggerServer(server: http.Server | undefined): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => {
      const code = err && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (err && code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
