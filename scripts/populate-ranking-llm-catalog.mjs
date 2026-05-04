#!/usr/bin/env node
/**
 * Fetches OpenAI’s current `/v1/models` list (chat-oriented filter), merges a static Cursor CLI model list,
 * and replaces Convex tables `ranking_llm_providers` + `ranking_llm_models` via `rankingLlmCatalog.replaceCatalog`.
 *
 * Prerequisites:
 * - `CONVEX_URL` in `.env.local` (or env)
 * - `OPENAI_API_KEY` for live OpenAI model discovery
 *
 * Usage:
 *   node --env-file=.env.local scripts/populate-ranking-llm-catalog.mjs
 *   npm run populate:ranking-catalog
 *
 * Cursor has no public “list models” API; the script seeds a small curated list. Edit `CURSOR_CLI_MODELS`
 * in this file when you want more options, then re-run.
 */

import { ConvexHttpClient } from 'convex/browser';

import { api } from '../convex/_generated/api.js';

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Curated Cursor CLI / `cursor-agent` model identifiers (extend as needed). */
const CURSOR_CLI_MODELS = [
  { apiModelId: 'cursor-default', displayName: 'Cursor default' },
  { apiModelId: 'composer-1', displayName: 'Composer 1' },
  { apiModelId: 'gpt-5.2-codex', displayName: 'GPT-5.2 Codex' },
  { apiModelId: 'gpt-5.2', displayName: 'GPT-5.2' },
  { apiModelId: 'claude-4.6-sonnet-medium-thinking', displayName: 'Claude 4.6 Sonnet (medium thinking)' },
];

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required env var '${name}'`);
  }
  return v;
}

/**
 * Heuristic: keep models that are plausibly used with Chat Completions / ranking-style calls.
 */
function isLikelyChatModel(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }
  if (/embedding|whisper|tts|dall-e|moderation|davinci-instruct|audio|realtime|search|computer-use|transcribe|speech/i.test(id)) {
    return false;
  }
  if (id.startsWith('ft:') || id.startsWith('babbage') || id.startsWith('ada-')) {
    return false;
  }
  return (
    /^gpt-/i.test(id) ||
    /^o[0-9]/i.test(id) ||
    /^chatgpt-/i.test(id) ||
    /^omni-/i.test(id)
  );
}

async function fetchOpenAiModelRows() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    console.warn('OPENAI_API_KEY not set; skipping live OpenAI model fetch (no OpenAI rows will be added).');
    return [];
  }

  const res = await fetch(OPENAI_MODELS_URL, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI /v1/models failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  const data = Array.isArray(json.data) ? json.data : [];
  const ids = data
    .map((row) => (typeof row.id === 'string' ? row.id : ''))
    .filter(isLikelyChatModel)
    .sort((a, b) => a.localeCompare(b));

  /** Dedupe and cap for Convex write size / UI sanity. */
  const unique = [...new Set(ids)].slice(0, 400);
  return unique.map((apiModelId, index) => ({
    providerKey: 'openai',
    apiModelId,
    displayName: apiModelId,
    sortOrder: index,
  }));
}

async function main() {
  const convexUrl = requireEnv('CONVEX_URL');

  const openaiModels = await fetchOpenAiModelRows();

  const providers = [
    {
      key: 'openai',
      displayName: 'OpenAI',
      surface: 'convex_http',
      sortOrder: 0,
    },
    {
      key: 'cursor',
      displayName: 'Cursor CLI',
      surface: 'worker_cursor',
      sortOrder: 1,
    },
  ];

  const cursorModels = CURSOR_CLI_MODELS.map((m, index) => ({
    providerKey: 'cursor',
    apiModelId: m.apiModelId,
    displayName: m.displayName,
    sortOrder: index,
  }));

  const models = [...openaiModels, ...cursorModels];

  const client = new ConvexHttpClient(convexUrl);
  const result = await client.mutation(api.rankingLlmCatalog.replaceCatalog, {
    providers,
    models,
  });

  console.log(
    `Catalog updated: ${result.providerCount} provider(s), ${result.modelCount} model(s) (${openaiModels.length} from OpenAI API, ${cursorModels.length} Cursor).`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
