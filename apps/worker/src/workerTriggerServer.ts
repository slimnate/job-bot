import http from 'node:http';

import { workerLog } from './log.js';
import type { WorkerScheduler } from './scheduler.js';
import { handleRankPostingRequest } from './workerRankPostingHandler.js';

const corsTrigger: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Local-only HTTP trigger: `POST /trigger` runs one scheduler tick; `POST /rank-posting` scores one posting
 * via Cursor CLI (see `workerRankPostingHandler`). Binds `127.0.0.1` only.
 */
export function startWorkerTriggerServer(
  scheduler: WorkerScheduler,
  port: number,
  options: { convexUrl: string }
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS' && (req.url === '/trigger' || req.url === '/rank-posting')) {
      res.writeHead(204, corsTrigger);
      res.end();
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
    if (req.method === 'POST' && req.url === '/rank-posting') {
      void handleRankPostingRequest({ convexUrl: options.convexUrl, req, res });
      return;
    }
    res.writeHead(404, corsTrigger);
    res.end();
  });

  server.listen(port, '127.0.0.1', () => {
    workerLog.info('worker.trigger_http', {
      port,
      paths: ['/trigger', '/rank-posting'],
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
