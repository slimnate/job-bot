import { spawn } from 'node:child_process';

const MAX_ERROR_SNIPPET_CHARS = 6_000;

/** Legacy catalog / env values that are not valid `cursor-agent --model` ids. */
const CURSOR_MODEL_ALIASES: Record<string, string> = {
  'cursor-default': 'auto',
  'composer-1': 'composer-2.5',
};

/** Placeholder from `ranking.recompute` when no model is chosen; use worker settings instead. */
const RANKING_MODEL_PLACEHOLDERS = new Set(['llm-default', '']);

/**
 * Returns a settings/env model override, or undefined when the caller passed a placeholder.
 */
export function effectiveRankingModelOverride(modelOverride?: string): string | undefined {
  const trimmed = modelOverride?.trim();
  if (!trimmed || RANKING_MODEL_PLACEHOLDERS.has(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Resolves Cursor CLI model id from an explicit default (no settings I/O).
 */
export function resolveCursorApiModelIdWithDefault(
  modelOverride: string | undefined,
  defaultModel: string
): string {
  const override = effectiveRankingModelOverride(modelOverride);
  const raw = (override ?? defaultModel).trim();
  if (!raw) {
    throw new Error(
      'LLM_RANKING_CURSOR_MODEL is empty; set it in Settings or LLM_RANKING_CURSOR_MODEL env.'
    );
  }
  return CURSOR_MODEL_ALIASES[raw] ?? raw;
}

export type CursorCliConfig = {
  command: string;
  args: string[];
  timeoutMs: number;
  model: string;
  workspaceDir: string;
};

export type CursorCliRunResult = {
  stdout: string;
  stderr: string;
};

export type CursorCliStream = 'stdout' | 'stderr';

/** Called once per complete stdout/stderr line while `cursor-agent` runs. */
export type CursorCliOutputLineHandler = (stream: CursorCliStream, line: string) => void;

/** Incremental line buffer for one Cursor CLI stream. */
export type CursorCliLineBuffer = {
  pending: string;
};

type SpawnCloseError = Error & {
  code?: number | string | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
};

/**
 * Creates an empty line buffer for streaming Cursor CLI stdout/stderr.
 */
export function createCursorCliLineBuffer(): CursorCliLineBuffer {
  return { pending: '' };
}

/**
 * Appends a chunk and returns any newly completed lines (text before each `\n`).
 */
export function drainCursorCliLines(buffer: CursorCliLineBuffer, chunk: string): string[] {
  if (!chunk) {
    return [];
  }
  buffer.pending += chunk;
  const lines = buffer.pending.split('\n');
  buffer.pending = lines.pop() ?? '';
  return lines;
}

/**
 * Returns trailing text without a final newline, or null if the buffer is empty.
 */
export function flushCursorCliLineBuffer(buffer: CursorCliLineBuffer): string | null {
  if (!buffer.pending) {
    return null;
  }
  const line = buffer.pending;
  buffer.pending = '';
  return line;
}

/**
 * True when `args` already includes a flag like `--mode` or `--mode=ask`.
 */
export function hasCliArgFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

/**
 * Forces `--output-format json` for ranking (removes text/stream-json output-format flags).
 */
export function enforceRankingJsonOutputFormat(args: string[]): string[] {
  const withoutOutputFormat: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--output-format' || arg === '-o') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--output-format=')) {
      continue;
    }
    withoutOutputFormat.push(arg);
  }
  if (!hasCliArgFlag(withoutOutputFormat, '--output-format')) {
    withoutOutputFormat.push('--output-format', 'json');
  }
  return withoutOutputFormat;
}

/**
 * Builds argv for `cursor-agent`, avoiding duplicate flags when `CURSOR_CLI_ARGS` uses `--mode=ask` style.
 */
export function buildCursorCliArgs(
  config: CursorCliConfig,
  prompt: string,
  options: { minimalContext?: boolean } = {}
): string[] {
  let args = enforceRankingJsonOutputFormat([...config.args]);
  const minimal = options.minimalContext ?? true;

  if (minimal) {
    const ensureFlag = (flag: string, value?: string) => {
      if (hasCliArgFlag(args, flag)) {
        return;
      }
      if (value !== undefined) {
        args.push(flag, value);
      } else {
        args.push(flag);
      }
    };

    ensureFlag('--mode', 'ask');
    ensureFlag('--trust');
    ensureFlag('--workspace', config.workspaceDir);
    if (!hasCliArgFlag(args, '--print') && !args.includes('-p')) {
      args.unshift('--print');
    }
    if (!hasCliArgFlag(args, '--model')) {
      args.push('--model', config.model);
    }
  }

  const hasPlaceholder = args.some((arg) => arg.includes('{prompt}'));
  if (hasPlaceholder) {
    return args.map((arg) => arg.replaceAll('{prompt}', prompt));
  }

  return [...args, prompt];
}

/**
 * Shell-safe-ish command line for logs/errors (prompt replaced with a length hint).
 */
export function formatCursorCliCommandLine(
  command: string,
  args: string[],
  prompt?: string
): string {
  const rendered = args.map((arg) => {
    if (prompt && arg === prompt) {
      return `<prompt ${prompt.length} chars>`;
    }
    if (/\s/.test(arg)) {
      return `"${arg.replaceAll('"', '\\"')}"`;
    }
    return arg;
  });
  return [command, ...rendered].join(' ');
}

function truncateForError(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}… [truncated]`;
}

/**
 * Human-readable failure text including command, stderr, and stdout when useful.
 */
export function formatCursorCliFailure(params: {
  reason: string;
  command: string;
  args: string[];
  prompt?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | string | null;
  signal?: string | null;
}): string {
  const lines: string[] = [params.reason];
  lines.push(`Command: ${formatCursorCliCommandLine(params.command, params.args, params.prompt)}`);

  if (params.exitCode !== undefined && params.exitCode !== null && params.exitCode !== '') {
    lines.push(`Exit code: ${String(params.exitCode)}`);
  }
  if (params.signal) {
    lines.push(`Signal: ${params.signal}`);
  }

  const stderr = params.stderr?.trim() ?? '';
  const stdout = params.stdout?.trim() ?? '';

  if (stderr) {
    lines.push(`stderr:\n${truncateForError(stderr, MAX_ERROR_SNIPPET_CHARS)}`);
  }
  if (stdout && (!stderr || stdout !== stderr)) {
    lines.push(`stdout:\n${truncateForError(stdout, MAX_ERROR_SNIPPET_CHARS)}`);
  }

  if (!stderr && !stdout) {
    lines.push('(no stdout or stderr captured)');
  }

  return lines.join('\n');
}

function spawnHint(message: string): string {
  return /enoent|spawn/i.test(message)
    ? ' Install the Cursor CLI, set CURSOR_CLI_COMMAND to the full path of the agent binary, or use LLM_RANKING_PROVIDER=http with OPENAI_API_KEY.'
    : '';
}

function isCursorCliTimeout(params: {
  timedOut: boolean;
  exitCode?: number | string | null;
  signal?: string | null;
}): boolean {
  if (params.timedOut) {
    return true;
  }
  if (params.signal === 'SIGTERM') {
    return true;
  }
  const code = params.exitCode;
  if (code === 143 || code === '143') {
    return true;
  }
  return false;
}

function handleStreamChunk(
  stream: CursorCliStream,
  buffer: CursorCliLineBuffer,
  chunk: Buffer,
  onAccumulate: (text: string) => void,
  onOutputLine?: CursorCliOutputLineHandler
): void {
  const text = chunk.toString('utf8');
  onAccumulate(text);
  for (const line of drainCursorCliLines(buffer, text)) {
    onOutputLine?.(stream, line);
  }
}

function flushStreamLines(
  stream: CursorCliStream,
  buffer: CursorCliLineBuffer,
  onOutputLine?: CursorCliOutputLineHandler
): void {
  const tail = flushCursorCliLineBuffer(buffer);
  if (tail !== null) {
    onOutputLine?.(stream, tail);
  }
}

/**
 * Runs Cursor CLI and returns stdout/stderr. Streams each output line to worker logs when enabled.
 * Throws a detailed error on failure.
 */
export type CursorCliJsonEnvelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  result?: string;
};

/**
 * Parses the final `--output-format json` line from Cursor CLI stdout (status only).
 */
export function parseCursorCliJsonEnvelope(stdout: string): CursorCliJsonEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as CursorCliJsonEnvelope;
  } catch {
    return null;
  }
}

export async function runCursorCli(params: {
  config: CursorCliConfig;
  args: string[];
  prompt: string;
  timeoutMs: number;
  cwd: string;
  /** When true, exit code 0 with empty stdout is allowed (ranking reads results from disk). */
  allowEmptyStdout?: boolean;
  /** Invoked for each stdout/stderr line (and any trailing fragment without a final newline). */
  onOutputLine?: CursorCliOutputLineHandler;
  /** Called once when the child process is spawned (before streaming output). */
  onSpawn?: (details: { commandLine: string; timeoutMs: number; cwd: string }) => void;
}): Promise<CursorCliRunResult> {
  const { config, args, prompt, timeoutMs, cwd, allowEmptyStdout, onOutputLine, onSpawn } = params;

  onSpawn?.({
    commandLine: formatCursorCliCommandLine(config.command, args, prompt),
    timeoutMs,
    cwd,
  });

  return new Promise((resolve, reject) => {
    const stdoutBuffer = createCursorCliLineBuffer();
    const stderrBuffer = createCursorCliLineBuffer();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(config.command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const clearRunTimeout = () => {
      clearTimeout(timeoutId);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      handleStreamChunk('stdout', stdoutBuffer, chunk, (text) => {
        stdout += text;
      }, onOutputLine);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      handleStreamChunk('stderr', stderrBuffer, chunk, (text) => {
        stderr += text;
      }, onOutputLine);
    });

    child.on('error', (error) => {
      clearRunTimeout();
      flushStreamLines('stdout', stdoutBuffer, onOutputLine);
      flushStreamLines('stderr', stderrBuffer, onOutputLine);
      reject(
        new Error(
          formatCursorCliFailure({
            reason: 'Cursor CLI failed to start.',
            command: config.command,
            args,
            prompt,
            stderr: stderr || error.message,
            stdout,
          }) + spawnHint(error.message)
        )
      );
    });

    child.on('close', (code, signal) => {
      clearRunTimeout();
      flushStreamLines('stdout', stdoutBuffer, onOutputLine);
      flushStreamLines('stderr', stderrBuffer, onOutputLine);

      const exitCode = code;
      const exitSignal = signal;

      if (exitCode === 0 && !timedOut) {
        if (!stdout.trim() && stderr.trim() && !allowEmptyStdout) {
          reject(
            new Error(
              formatCursorCliFailure({
                reason:
                  'Cursor CLI wrote to stderr and produced no stdout (often a model or flag error).',
                command: config.command,
                args,
                prompt,
                stderr,
                stdout,
              })
            )
          );
          return;
        }
        if (!stdout.trim() && !stderr.trim() && !allowEmptyStdout) {
          reject(
            new Error(
              formatCursorCliFailure({
                reason: 'Cursor CLI produced empty stdout.',
                command: config.command,
                args,
                prompt,
                stderr,
                stdout,
              })
            )
          );
          return;
        }
        resolve({ stdout, stderr });
        return;
      }

      const reason = isCursorCliTimeout({ timedOut, exitCode, signal: exitSignal })
        ? `Cursor CLI timed out after ${timeoutMs}ms.`
        : 'Cursor CLI process failed.';

      const err = new Error(
        formatCursorCliFailure({
          reason,
          command: config.command,
          args,
          prompt,
          stdout,
          stderr,
          exitCode,
          signal: exitSignal,
        })
      ) as SpawnCloseError;
      err.code = exitCode;
      err.signal = exitSignal;
      err.stdout = stdout;
      err.stderr = stderr;
      err.timedOut = timedOut;
      reject(err);
    });
  });
}
