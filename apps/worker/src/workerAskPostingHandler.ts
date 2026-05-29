import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { mkdir } from 'node:fs/promises';

import { POSTING_QA_SYSTEM_MESSAGE } from '@job-bot/shared';
import type { ConvexHttpClient } from 'convex/browser';

import { api } from './convexBridge/api.js';
import type { Id } from './convexBridge/doc.js';
import {
  convexReadRetryOptions,
  convexSaveRetryOptions,
  createWorkerConvexClient,
} from './convexHttp.js';
import { workerLog } from './log.js';
import { withAskRunLogContext } from './ranking/askRunContext.js';
import { finishAskRunLog, isValidAskRunId } from './ranking/askRunLogHub.js';
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

type AskPostingBody = {
  postingId?: string;
  question?: string;
  providerKey?: string;
  model?: string;
  askRunId?: string;
};

function resolveAskRunId(body: AskPostingBody): string {
  const fromBody = body.askRunId?.trim();
  if (fromBody && isValidAskRunId(fromBody)) {
    return fromBody;
  }
  return randomUUID();
}

function parseArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split(/\s+/);
}

function loadCursorCliConfigForAsk(modelOverride?: string): CursorCliConfig {
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
    workerLog.debug('llm.ask.cursor_cli.output', { stream, line });
  };
}

function extractPlainAnswer(stdout: string): string {
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
 * Handles `POST /ask-posting`: loads Q&A context from Convex, runs Cursor CLI, saves `posting_questions`.
 */
export async function handleAskPostingRequest(params: {
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

  const body = (parsed ?? {}) as AskPostingBody;
  const postingId = body.postingId?.trim();
  const question = body.question?.trim();
  const providerKey = typeof body.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!postingId || !question || !providerKey || !model) {
    writeJson(res, 400, {
      ok: false,
      error: 'Missing postingId, question, providerKey, or model',
    });
    return;
  }

  const convex = createWorkerConvexClient(convexUrl);
  const askRunId = resolveAskRunId(body);

  async function runConvexRead<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withRetry(operation, {
      ...convexReadRetryOptions,
      label,
      retryDebugSubsystem: 'rank',
    });
  }

  await withAskRunLogContext(askRunId, async () => {
    try {
      workerLog.info('llm.ask.run.begin', { askRunId, postingId, providerKey, model });

      const context = await runConvexRead('postingQuestions.getAskContext', () =>
        convex.query(api.postingQuestions.getAskContext, {
          postingId: postingId as Id<'job_postings'>,
          question,
        })
      );

      if (!context) {
        finishAskRunLog(askRunId, { ok: false, error: 'Posting not found' });
        writeJson(res, 404, { ok: false, error: 'Posting not found' });
        return;
      }

      const config = loadCursorCliConfigForAsk(model);
      const combinedPrompt = `${POSTING_QA_SYSTEM_MESSAGE}\n\n---\n\n${context.userPrompt}`;
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
          workerLog.debug('llm.ask.cursor_cli.spawn', {
            command: commandLine,
            timeoutMs: cliTimeoutMs,
            cwd,
          });
        },
      });

      const answerText = extractPlainAnswer(stdout);
      if (!answerText) {
        const errMsg =
          stderr.trim().slice(0, 500) || 'Cursor CLI returned an empty answer.';
        const answerId = await withRetry(
          () =>
            convex.mutation(api.postingQuestions.saveAnswer, {
              postingId: postingId as Id<'job_postings'>,
              question,
              answer: '',
              providerKey,
              model,
              status: 'failed',
              errorMessage: errMsg,
            }),
          { ...convexSaveRetryOptions, label: 'postingQuestions.saveAnswer' }
        );
        finishAskRunLog(askRunId, { ok: false, error: errMsg, answerId: answerId as string });
        writeJson(res, 500, { ok: false, error: errMsg, answerId });
        return;
      }

      const answerId = await withRetry(
        () =>
          convex.mutation(api.postingQuestions.saveAnswer, {
            postingId: postingId as Id<'job_postings'>,
            question,
            answer: answerText,
            providerKey,
            model,
            status: 'completed',
          }),
        { ...convexSaveRetryOptions, label: 'postingQuestions.saveAnswer' }
      );

      workerLog.info('llm.ask.run.end', { askRunId, postingId, answerId });
      finishAskRunLog(askRunId, { ok: true, answerId: answerId as string });
      writeJson(res, 200, { ok: true, answerId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ask posting failed';
      workerLog.error('llm.ask.run.error', { askRunId, postingId, error: message });
      try {
        await convex.mutation(api.postingQuestions.saveAnswer, {
          postingId: postingId as Id<'job_postings'>,
          question,
          answer: '',
          providerKey,
          model,
          status: 'failed',
          errorMessage: message,
        });
      } catch {
        // ignore secondary failure
      }
      finishAskRunLog(askRunId, { ok: false, error: message });
      writeJson(res, 500, { ok: false, error: message });
    }
  });
}
