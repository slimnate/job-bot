# Job Bot MVP

Job Bot is a monorepo MVP for collecting job postings, deduplicating them in Convex, ranking them, and browsing everything in a small dashboard.

## What is implemented so far

- Web dashboard with three sections:
  - Criteria editor (`apps/web/src/components/CriteriaEditor.tsx`)
  - Ranked postings viewer (`apps/web/src/components/PostingViewer.tsx`)
  - Scrape run history + manual trigger (`apps/web/src/components/HistoryViewer.tsx`)
- Convex backend with schema + APIs for:
  - Criteria management (`convex/criteria.ts`)
  - Posting upsert/list (`convex/postings.ts`)
  - Run lifecycle (`convex/runs.ts`)
  - Ranking recompute/upsert (`convex/ranking.ts`)
- Worker runtime with:
  - Cron-like scheduler (`apps/worker/src/scheduler.ts`)
  - In-memory bounded queue abstraction (`apps/worker/src/queue.ts`)
  - Run orchestration pipeline (`apps/worker/src/orchestrator.ts`)
  - Deterministic source adapter placeholder (`apps/worker/src/sourceAdapters.ts`)
- Shared package and agent-core placeholders:
  - Ranking type in `packages/shared/src/schemas/ranking.ts`
  - Agent core stub in `packages/agent-core/src/index.ts`

## Current flow

1. User saves active criteria in the web app.
2. Runs are queued either:
   - manually from the dashboard (`runs.trigger`), or
   - automatically by the worker scheduler.
3. Worker dequeues runs with bounded concurrency.
4. Worker collects postings for a source (current deterministic seed adapter).
5. Worker upserts postings in Convex (`postings.upsertBatch`).
6. Worker computes LLM ranking and persists results (`ranking.upsertResults`).
7. Worker marks run status and stats (`runs.updateStatus`).
8. Web app updates from Convex queries.

## Monorepo layout

- `apps/web`: React + Vite dashboard
- `apps/worker`: scheduler, queue, orchestration runtime
- `convex`: schema and function API surface
- `packages/shared`: shared types/schemas
- `packages/agent-core`: agent-core package (currently stub)

## Data model (Convex)

- `job_criteria`: search criteria profile and target sources
- `scrape_runs`: run status, timing, logs summary, aggregate stats
- `job_postings`: normalized postings deduplicated by source + external id
- `job_rankings`: per-posting ranking outputs with score + reasoning

Schema lives in `convex/schema.ts`.

## API surface (implemented)

- `api.criteria.get`
- `api.criteria.listActive`
- `api.criteria.upsert`
- `api.postings.list`
- `api.postings.upsertBatch`
- `api.runs.list`
- `api.runs.trigger`
- `api.runs.updateStatus`
- `api.ranking.listForPosting`
- `api.ranking.recompute`
- `api.ranking.upsertResults`

## Local setup

### 1) Install dependencies

```bash
npm run install:all
```

### 2) Environment

The project currently relies on Convex URL values. In local development, set:

- `VITE_CONVEX_URL` for the web app
- `CONVEX_URL` for worker runtime

Worker-specific optional env vars:

- `WORKER_QUEUE_CONCURRENCY` (default: `2`)
- `WORKER_CRON_INTERVAL_MINUTES` (default: `15`)
- `WORKER_RUN_ON_START` (default: `true`)
- `LLM_RANKING_PROVIDER` (default: `cursor`; options: `cursor`, `http`)
- `LLM_RANKING_MODEL` (provider model label/override)
- `LLM_RANKING_TIMEOUT_MS` (provider timeout in milliseconds, default: `60000`)
- `CURSOR_CLI_COMMAND` (default: `cursor-agent`)
- `CURSOR_CLI_ARGS` (default: `--print`; use `{prompt}` placeholder to inject prompt in custom arg layouts)

For `http` provider mode:

- `OPENAI_API_KEY` (required)
- `LLM_API_BASE_URL` (optional; defaults to `https://api.openai.com/v1`)
- `LLM_RANKING_TEMPERATURE` (optional; default: `0.1`)

### 3) Run Convex

Use your normal Convex workflow (for example, `npx convex dev`) so generated API types stay current.

### 4) Run the web app

```bash
npm run dev --workspace @job-bot/web
```

### 5) Build and run worker

```bash
npm run build --workspace @job-bot/worker
npm run start --workspace @job-bot/worker
```

## Useful scripts

From repo root:

- `npm run build`
- `npm run typecheck`
- `npm run clean`

Per workspace:

- Web: `npm run dev --workspace @job-bot/web`
- Worker: `npm run typecheck --workspace @job-bot/worker`

## MVP status and next priorities

Done:

- End-to-end criteria -> run -> posting -> ranking -> dashboard loop
- Scheduler + queue + run orchestration scaffold
- Source adapter boundary for future real scraping integrations

Still placeholder:

- Real browser/CDP scraping in `packages/agent-core`
- Queue backend swap (currently in-memory only)
- Production hardening (retry policies, richer metrics, deeper tests)
