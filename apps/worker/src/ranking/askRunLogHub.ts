import type { LogFields, LogLevel } from '../log.js';

/** One worker log line mirrored for a posting Q&A run (UI live log panel). */
export type AskRunLogEntry = {
  ts: string;
  level: LogLevel;
  msg: string;
  fields: LogFields;
};

export type AskRunLogEnd = {
  type: 'end';
  ok: boolean;
  error?: string;
  answerId?: string;
};

type AskRunSubscriber = (event: AskRunLogEntry | AskRunLogEnd) => void;

const MAX_ENTRIES_PER_RUN = 500;
const MAX_FIELD_LINE_CHARS = 4_000;

type RunBuffer = {
  entries: AskRunLogEntry[];
  subscribers: Set<AskRunSubscriber>;
  finished: AskRunLogEnd | null;
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

function sanitizeFieldsForUi(msg: string, fields: LogFields): LogFields {
  if (msg !== 'llm.ask.cursor_cli.output' && msg !== 'llm.rank.cursor_cli.output') {
    return fields;
  }
  if (typeof fields.line !== 'string') {
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
 * Appends a log line to the in-memory buffer for this Q&A run.
 */
export function appendAskRunLog(
  askRunId: string,
  entry: Omit<AskRunLogEntry, 'fields'> & { fields?: LogFields }
): void {
  const buf = bufferFor(askRunId);
  const normalized: AskRunLogEntry = {
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
 * Marks a Q&A run complete and notifies SSE subscribers.
 */
export function finishAskRunLog(askRunId: string, end: Omit<AskRunLogEnd, 'type'>): void {
  const buf = bufferFor(askRunId);
  const event: AskRunLogEnd = { type: 'end', ...end };
  buf.finished = event;
  for (const sub of buf.subscribers) {
    sub(event);
  }
  setTimeout(() => {
    buffers.delete(askRunId);
  }, 120_000);
}

/**
 * Subscribes to live log events for a Q&A run (replays buffered entries first).
 */
export function subscribeAskRunLog(askRunId: string, subscriber: AskRunSubscriber): () => void {
  const buf = bufferFor(askRunId);
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
 * Validates a client-supplied Q&A run id (UUID or similar opaque token).
 */
export function isValidAskRunId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

/** Clears all in-memory Q&A run log buffers (tests only). */
export function resetAskRunLogHubForTests(): void {
  buffers.clear();
}
