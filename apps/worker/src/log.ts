export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

function writeLine(level: LogLevel, message: string, fields: LogFields): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'job-bot-worker',
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const workerLog = {
  debug(message: string, fields: LogFields = {}): void {
    if (process.env.WORKER_LOG_LEVEL === 'debug') {
      writeLine('debug', message, fields);
    }
  },
  info(message: string, fields: LogFields = {}): void {
    writeLine('info', message, fields);
  },
  warn(message: string, fields: LogFields = {}): void {
    writeLine('warn', message, fields);
  },
  error(message: string, fields: LogFields = {}): void {
    writeLine('error', message, fields);
  },
};
