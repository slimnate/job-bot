import type http from 'node:http';
import { mkdir } from 'node:fs/promises';

import { COVER_LETTER_OUTLINE_SYSTEM_MESSAGE } from '@job-bot/shared';

import { api } from './convexBridge/api.js';
import type { Id } from './convexBridge/doc.js';
import {
  convexReadRetryOptions,
  convexSaveRetryOptions,
  createWorkerConvexClient,
} from './convexHttp.js';
import { workerLog } from './log.js';
import {
  buildCursorCliArgs,
  parseCursorCliJsonEnvelope,
  runCursorCli,
  type CursorCliConfig,
  type CursorCliOutputLineHandler,
} from './ranking/cursorCli.js';
import { resolveCursorApiModelId } from './ranking/cursorCliModel.js';
import {
  isCursorCliOutputLogEnabled,
  isCursorMinimalContextEnabled,
  loadCursorExtraTimeoutMs,
  loadRankingBaseTimeoutMs,
} from './ranking/rankingEnv.js';
import { resolveCursorCliWorkspaceDir } from './workerPaths.js';
import { getSettingString } from './settings/settingsHelpers.js';
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

type CoverLetterBody = {
  postingId?: string;
  userMessage?: string;
  providerKey?: string;
  model?: string;
  revisedFromId?: string;
};

function parseArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split(/\s+/);
}

function loadCursorCliConfigForCoverLetter(modelOverride?: string): CursorCliConfig {
  const workspaceRaw = getSettingString('CURSOR_CLI_WORKSPACE').trim();
  return {
    command: getSettingString('CURSOR_CLI_COMMAND').trim(),
    args: parseArgs(
      process.env.CURSOR_CLI_ARGS ?? '--print --trust --output-format json'
    ),
    timeoutMs: loadRankingBaseTimeoutMs(),
    model: resolveCursorApiModelId(modelOverride),
    workspaceDir: resolveCursorCliWorkspaceDir(workspaceRaw),
  };
}

function createCursorCliOutputLogger(): CursorCliOutputLineHandler {
  return (stream, line) => {
    workerLog.debug('llm.cover_letter.cursor_cli.output', { stream, line });
  };
}

function extractPlainOutline(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return '';
  }
  const envelope = parseCursorCliJsonEnvelope(trimmed);
  if (envelope?.result?.trim()) {
    return envelope.result.trim();
  }
  return trimmed;
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
): void {
  res.writeHead(status, { ...corsJson, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * Handles `POST /cover-letter-outline`: loads context from Convex, runs Cursor CLI, saves turn.
 */
export async function handleCoverLetterOutlineRequest(params: {
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
    writeJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = await readJsonBody(req);
  } catch {
    writeJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  const body = (parsed ?? {}) as CoverLetterBody;
  const postingId = body.postingId?.trim();
  const userMessage = typeof body.userMessage === 'string' ? body.userMessage : '';
  const providerKey = typeof body.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  const revisedFromId = body.revisedFromId?.trim();

  if (!postingId || !providerKey || !model) {
    writeJson(res, 400, {
      ok: false,
      error: 'Missing postingId, providerKey, or model',
    });
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
    workerLog.info('llm.cover_letter.run.begin', { postingId, providerKey, model, revisedFromId });

    const context = await runConvexRead('postingCoverLetters.getCoverLetterContext', () =>
      convex.query(api.postingCoverLetters.getCoverLetterContext, {
        postingId: postingId as Id<'job_postings'>,
        userMessage,
        revisedFromId: revisedFromId
          ? (revisedFromId as Id<'posting_cover_letter_outlines'>)
          : undefined,
      })
    );

    if (!context) {
      writeJson(res, 404, { ok: false, error: 'Posting or parent outline not found' });
      return;
    }

    const saveBase = {
      postingId: postingId as Id<'job_postings'>,
      userMessage: context.normalizedUserMessage,
      providerKey,
      model,
      revisedFromId: revisedFromId
        ? (revisedFromId as Id<'posting_cover_letter_outlines'>)
        : undefined,
    };

    const config = loadCursorCliConfigForCoverLetter(model);
    const combinedPrompt = `${COVER_LETTER_OUTLINE_SYSTEM_MESSAGE}\n\n---\n\n${context.userPrompt}`;
    const args = buildCursorCliArgs(config, combinedPrompt, {
      minimalContext: isCursorMinimalContextEnabled(),
      useDefaultAgentMode: false,
      jsonOutput: false,
    });

    const extraTimeout = loadCursorExtraTimeoutMs();
    const timeoutMs = config.timeoutMs + extraTimeout;

    await mkdir(config.workspaceDir, { recursive: true });

    const { stdout, stderr } = await runCursorCli({
      config,
      args,
      prompt: combinedPrompt,
      timeoutMs,
      cwd: config.workspaceDir,
      onOutputLine: isCursorCliOutputLogEnabled() ? createCursorCliOutputLogger() : undefined,
      onSpawn: ({ commandLine, timeoutMs: cliTimeoutMs, cwd }) => {
        workerLog.debug('llm.cover_letter.cursor_cli.spawn', {
          command: commandLine,
          timeoutMs: cliTimeoutMs,
          cwd,
        });
      },
    });

    const outlineText = extractPlainOutline(stdout);
    if (!outlineText) {
      const errMsg =
        stderr.trim().slice(0, 500) || 'Cursor CLI returned an empty outline.';
      const turnId = await withRetry(
        () =>
          convex.mutation(api.postingCoverLetters.saveTurn, {
            ...saveBase,
            outline: '',
            status: 'failed',
            errorMessage: errMsg,
          }),
        { ...convexSaveRetryOptions, label: 'postingCoverLetters.saveTurn' }
      );
      writeJson(res, 500, { ok: false, error: errMsg, turnId });
      return;
    }

    const turnId = await withRetry(
      () =>
        convex.mutation(api.postingCoverLetters.saveTurn, {
          ...saveBase,
          outline: outlineText,
          status: 'completed',
        }),
      { ...convexSaveRetryOptions, label: 'postingCoverLetters.saveTurn' }
    );

    workerLog.info('llm.cover_letter.run.end', { postingId, turnId });
    writeJson(res, 200, { ok: true, turnId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Cover letter outline failed';
    workerLog.error('llm.cover_letter.run.error', { postingId, error: message });
    try {
      await convex.mutation(api.postingCoverLetters.saveTurn, {
        postingId: postingId as Id<'job_postings'>,
        userMessage: userMessage.trim() || 'Generate a cover letter outline for this posting.',
        outline: '',
        providerKey,
        model,
        status: 'failed',
        errorMessage: message,
        revisedFromId: revisedFromId
          ? (revisedFromId as Id<'posting_cover_letter_outlines'>)
          : undefined,
      });
    } catch {
      // ignore secondary failure
    }
    writeJson(res, 500, { ok: false, error: message });
  }
}
