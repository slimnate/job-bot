import type { LogFields, LogLevel } from '../log.js';

/** One worker log line mirrored for a scoring run (UI live log panel). */
export type RankRunLogEntry = {
  ts: string;
  level: LogLevel;
  msg: string;
  fields: LogFields;
};

export type RankRunLogEnd = {
  type: 'end';
  ok: boolean;
  error?: string;
  scoreOverall?: number;
  saved?: number;
};

type RankRunSubscriber = (event: RankRunLogEntry | RankRunLogEnd) => void;

const MAX_ENTRIES_PER_RUN = 500;
const MAX_FIELD_LINE_CHARS = 4_000;

type RunBuffer = {
  entries: RankRunLogEntry[];
  subscribers: Set<RankRunSubscriber>;
  finished: RankRunLogEnd | null;
};

const buffers = new Map<string, RunBuffer>();

function bufferFor(runId: string): RunBuffer {
  let buf = buffers.get(runId);
  if (!buf) {
    buf = { entries: [], subscribers: new Set(), finished: null };
    buffers.set(runId, buf);
  }
  return buf;
}

/**
 * Truncates very long CLI output lines before buffering for the UI.
 */
function sanitizeFieldsForUi(msg: string, fields: LogFields): LogFields {
  if (msg !== 'llm.rank.cursor_cli.output' || typeof fields.line !== 'string') {
    return fields;
  }
  const line = fields.line;
  if (line.length <= MAX_FIELD_LINE_CHARS) {
    return fields;
  }
  return {
    ...fields,
    line: `${line.slice(0, MAX_FIELD_LINE_CHARS)}… [truncated ${line.length - MAX_FIELD_LINE_CHARS} chars]`,
  };
}

/**
 * Appends an `llm.rank.*` log line to the in-memory buffer for this scoring run.
 */
export function appendRankRunLog(
  rankingRunId: string,
  entry: Omit<RankRunLogEntry, 'fields'> & { fields?: LogFields }
): void {
  const buf = bufferFor(rankingRunId);
  const normalized: RankRunLogEntry = {
    ts: entry.ts,
    level: entry.level,
    msg: entry.msg,
    fields: sanitizeFieldsForUi(entry.msg, entry.fields ?? {}),
  };
  buf.entries.push(normalized);
  if (buf.entries.length > MAX_ENTRIES_PER_RUN) {
    buf.entries.shift();
  }
  for (const sub of buf.subscribers) {
    sub(normalized);
  }
}

/**
 * Marks a scoring run complete and notifies SSE subscribers.
 */
export function finishRankRunLog(rankingRunId: string, end: Omit<RankRunLogEnd, 'type'>): void {
  const buf = bufferFor(rankingRunId);
  const event: RankRunLogEnd = { type: 'end', ...end };
  buf.finished = event;
  for (const sub of buf.subscribers) {
    sub(event);
  }
  setTimeout(() => {
    buffers.delete(rankingRunId);
  }, 120_000);
}

/**
 * Subscribes to live log events for a scoring run (replays buffered entries first).
 */
export function subscribeRankRunLog(
  rankingRunId: string,
  subscriber: RankRunSubscriber
): () => void {
  const buf = bufferFor(rankingRunId);
  for (const entry of buf.entries) {
    subscriber(entry);
  }
  if (buf.finished) {
    subscriber(buf.finished);
    return () => {};
  }
  buf.subscribers.add(subscriber);
  return () => {
    buf.subscribers.delete(subscriber);
  };
}

/**
 * Validates a client-supplied scoring run id (UUID or similar opaque token).
 */
export function isValidRankingRunId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

/** Clears all in-memory scoring run log buffers (tests only). */
export function resetRankRunLogHubForTests(): void {
  buffers.clear();
}
