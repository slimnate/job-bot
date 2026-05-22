/** One line from the worker `GET /rank-logs` SSE stream. */
export type RankRunLogEntry = {
  ts: string;
  level: string;
  msg: string;
  fields: Record<string, unknown>;
};

export type RankRunLogEnd = {
  type: 'end';
  ok: boolean;
  error?: string;
  scoreOverall?: number;
  saved?: number;
};

/**
 * Formats a worker `llm.rank.*` log entry for the scoring dialog.
 */
export function formatRankRunLogLine(entry: RankRunLogEntry): string {
  const time = entry.ts.length >= 19 ? entry.ts.slice(11, 19) : entry.ts;
  let detail = '';
  if (entry.msg === 'llm.rank.cursor_cli.output' && typeof entry.fields.line === 'string') {
    const line = entry.fields.line;
    detail = line.length > 240 ? `${line.slice(0, 240)}…` : line;
  } else if (Object.keys(entry.fields).length > 0) {
    detail = JSON.stringify(entry.fields);
    if (detail.length > 320) {
      detail = `${detail.slice(0, 320)}…`;
    }
  }
  return detail ? `${time} [${entry.level}] ${entry.msg} ${detail}` : `${time} [${entry.level}] ${entry.msg}`;
}

/**
 * Subscribes to live `llm.rank.*` logs for a scoring run. Open before `POST /rank-posting(s)`.
 */
export function subscribeRankRunLogs(
  workerBaseUrl: string,
  rankingRunId: string,
  handlers: {
    onLog: (entry: RankRunLogEntry) => void;
    onEnd: (end: RankRunLogEnd) => void;
    onError?: () => void;
  }
): () => void {
  const url = `${workerBaseUrl}/rank-logs?rankingRunId=${encodeURIComponent(rankingRunId)}`;
  const source = new EventSource(url);

  source.addEventListener('log', (event) => {
    try {
      handlers.onLog(JSON.parse((event as MessageEvent).data as string) as RankRunLogEntry);
    } catch {
      // ignore malformed events
    }
  });

  source.addEventListener('end', (event) => {
    try {
      handlers.onEnd(JSON.parse((event as MessageEvent).data as string) as RankRunLogEnd);
    } catch {
      handlers.onEnd({ type: 'end', ok: false, error: 'Invalid end event from worker' });
    }
    source.close();
  });

  source.onerror = () => {
    handlers.onError?.();
    source.close();
  };

  return () => source.close();
}
