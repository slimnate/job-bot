# Job Bot MVP

Job Bot is a monorepo MVP for collecting job postings, deduplicating them in Convex, ranking them, and browsing everything in a small dashboard.

## What is implemented so far

- Web dashboard with three sections:
  - Criteria profiles (`apps/web/src/components/CriteriaEditor.tsx`): multiple named profiles, optional **Resume (Markdown)** and **Ranking prompt** for the LLM, **Notes** (private — not sent to the ranker), and one **Active** profile for defaults
- Postings viewer (`apps/web/src/components/PostingViewer.tsx`) with:
  - humanized discovered timestamps (same-day time, older relative age)
  - postings shown as a **list** (`PostingTable.tsx`): each item has a meta row (score, role, company, source, location, ranked/discovered, actions), a description preview, and latest ranking details (reasoning, model, criteria match, red flags)
  - per-item actions (`View`, **`Score`** — criteria + **provider** (OpenAI via Convex vs **Cursor CLI** on the local worker) + **model** from the Convex catalog, `Delete`), multi-select checkboxes, bulk `Score selected` / `Delete selected`, and `Clear All`
  - bulk score uses one batched LLM prompt/request per provider path (shared criteria context + all selected postings) to reduce token usage
- detailed modal view (human-readable fields + raw JSON), including latest reasoning summary rendered as markdown (supports tables/lists from LLM output)
- Workers (`/workers`) queue + history (`apps/web/src/components/HistoryViewer.tsx`, `apps/web/src/components/ScrapeQueuePanel.tsx`) with:
  - status color coding (`queued` blue, `running` yellow, `succeeded` green, `failed`/`cancelled` red)
  - history actions (`Logs`, `Stop`, `Delete`) and `Clear All`
  - log detail modal with table-first view plus raw JSON
- Convex backend with schema + APIs for:
  - Criteria management (`convex/criteria.ts`)
  - Posting upsert/list (`convex/postings.ts`)
  - Run lifecycle (`convex/runs.ts`)
  - Ranking recompute/upsert (`convex/ranking.ts`)
  - Ranking LLM catalog for the Score dialog (`convex/rankingLlmCatalog.ts`): providers + models; seed with `npm run populate:ranking-catalog`
- Worker runtime with:
  - Cron-like scheduler (`apps/worker/src/scheduler.ts`)
  - In-memory bounded queue abstraction (`apps/worker/src/queue.ts`)
  - Run orchestration pipeline (`apps/worker/src/orchestrator.ts`)
  - Deterministic source adapter placeholder (`apps/worker/src/sourceAdapters.ts`)
- Shared package and agent-core placeholders:
  - Ranking type in `packages/shared/src/schemas/ranking.ts`
  - Agent core stub in `packages/agent-core/src/index.ts`

## Current flow

1. User creates or edits criteria profiles in the web app (resume + ranking prompt drive how the LLM ranks jobs; notes are for the user only).
2. Runs are queued either:
   - manually from the dashboard (`runs.trigger`), optionally with an explicit `source` and `criteriaId`.
3. Worker dequeues runs with bounded concurrency.
4. Worker collects postings for a source (**LinkedIn implemented**; unsupported sources fail fast to avoid placeholder data pollution). LinkedIn scrape cleanup tears down Chrome after each run.
5. Worker upserts postings in Convex (`postings.upsertBatch`).
6. Worker computes LLM ranking using the **run’s** `criteriaId` when set (otherwise the active profile) and persists results (`ranking.upsertResults`).
7. Worker marks run status and stats (`runs.updateStatus`).
8. While a run executes, the worker mirrors JSON log lines to Convex (`runLogs.appendBatch`) for inspection in the dashboard.
9. Web app updates from Convex queries.

## Monorepo layout

- `apps/web`: React + Vite dashboard
- `apps/worker`: scheduler, queue, orchestration runtime
- `convex`: schema and function API surface
- `packages/shared`: shared types/schemas
- `packages/agent-core`: agent-core package (currently stub)

## Data model (Convex)

- `job_criteria`: named profile (`name`, `isActive`, optional `notes`, `resumeMarkdown`, `rankingPrompt`)
- `scrape_runs`: run status, timing, logs summary, aggregate stats
- `run_log_lines`: JSON log lines for a run (streamed from the worker; used by the Workers log modal and run log page)
- `job_postings`: normalized postings deduplicated by source + external id
- `job_rankings`: per-posting ranking outputs with score + reasoning
- `ranking_llm_providers`: stable `key`, `displayName`, `surface` (`convex_http` = OpenAI-compatible call from Convex; `worker_cursor` = Cursor CLI on the worker), `sortOrder`
- `ranking_llm_models`: `providerKey`, `apiModelId`, `displayName`, `sortOrder` (options shown in the Score dialog)

Schema lives in `convex/schema.ts`.

### Breaking change: slim `job_criteria`

Older deployments stored structured fields (`titleKeywords`, `targetSources`, etc.). Those are removed. If `npx convex dev` or deploy fails because existing `job_criteria` documents no longer match the schema, delete the old `job_criteria` rows in the Convex dashboard (or clear the table) and recreate profiles in the UI.

## API surface (implemented)

- `api.criteria.get`
- `api.criteria.getById`
- `api.criteria.list`
- `api.criteria.listActive`
- `api.criteria.create`
- `api.criteria.upsert`
- `api.postings.list`
- `api.postings.count`
- `api.postings.getById`
- `api.postings.upsertBatch`
- `api.postings.deleteOne`
- `api.postings.clearAll`
- `api.runs.list`
- `api.runs.get`
- `api.runs.trigger`
- `api.runs.updateQueued`
- `api.runs.updateStatus`
- `api.runs.requestGracefulStop`
- `api.runs.deleteRunWithLogs`
- `api.runs.clearAllRunsAndLogs`
- `api.runLogs.appendBatch`
- `api.runLogs.listByRun`
- `api.ranking.listForPosting`
- `api.ranking.recompute`
- `api.ranking.upsertResults`
- `api.rankingLlmCatalog.listForUi` (providers + models for the Score dialog)
- `api.rankingLlmCatalog.replaceCatalog` (mutation: full replace of catalog; used by `populate:ranking-catalog`)
- `api.rankingScorePosting.scoreOnePosting` (Convex **action**: OpenAI / compatible HTTP path only; writes `job_rankings`; Cursor uses worker `POST /rank-posting`)

## Local setup

### 1) Install dependencies

```bash
npm run install:all
```

### 2) Environment

The project currently relies on Convex URL values. In local development, set:

> If `npx convex dev` prints **Found multiple CONVEX_URL environment variables in .env.local**, you have the same key loaded twice: often `CONVEX_URL` is set in your shell *and* in `.env.local`. Unset the shell copy (`unset CONVEX_URL`) or remove the duplicate line in `.env.local`.

- `VITE_CONVEX_URL` for the web app
- `CONVEX_URL` for worker runtime
- `VITE_WORKER_TRIGGER_URL` (optional): URL for **Trigger now** in the scrape queue (default in the app: `http://127.0.0.1:3999/trigger`; must match `WORKER_HTTP_TRIGGER_PORT` on the worker). The Postings **Score** dialog derives the worker base URL by stripping `/trigger` and calls `POST …/rank-posting` when you choose **Cursor CLI**.

Worker-specific optional env vars:

- `WORKER_USE_CHROME` (default: off): set to `1` to use Chrome with remote debugging for CDP scrapers. **Required for LinkedIn.** Root `npm run dev:all` sets this on the worker leg. The worker still does **not** launch Chrome at process startup; the first LinkedIn scrape spawns or attaches Chrome. If Chrome exits while the worker keeps running, the next LinkedIn scrape **reconnects CDP** or **respawns** managed Chrome so you are less likely to see `WebSocket is not open` from a stale session.
- `WORKER_CHROME_HEADLESS` (default: `true`): use `0` for a visible window (recommended for LinkedIn login). `dev:all` sets `0` on the worker leg.
- `LINKEDIN_USER` / `LINKEDIN_PASS` (optional, worker only): if **both** are set (non-empty), the worker runs one automatic LinkedIn sign-in when a login form is detected, **before** waiting for the jobs shell. This does not bypass 2FA, CAPTCHA, or security challenges — complete those in the browser if they appear. Do not commit real credentials; use `.env.local` and keep it out of version control.
- `CHROME_PATH` (optional; path to Chrome/Chromium)
- `WORKER_CHROME_PORT` (default: `9222`)
- `WORKER_MANAGE_CHROME` (default: `true`; set `0` to attach to an already running Chrome with remote debugging on `WORKER_CHROME_PORT`)
- `WORKER_HTTP_TRIGGER_PORT` (optional): when set (e.g. `3999`), the worker listens on `127.0.0.1` for `POST /trigger` and `POST /rank-posting` (manual Cursor CLI score from the Postings page). Root `npm run dev:all` sets `3999` on the worker leg.
- `WORKER_LINKEDIN_PAGES` (default: `1`): how many LinkedIn results **pages** (pagination “Next”) the in-browser scraper will attempt per run, minimum `1`, maximum `10`. Invalid values fall back to the default; values above the cap are clamped with a worker warning.
- **Temporary:** at most **3** distinct LinkedIn postings per run: the in-page script dedupes by job id, stops listing when `collected.length` reaches that cap, and the worker’s **stream** handler ignores further CDP binding payloads once three unique `externalId`s have been upserted (so Convex cannot race past the cap). The final `postings` list is also sliced to the same cap. Remove or replace `TEMP_LINKEDIN_MAX_COLLECTED_POSTINGS` in `apps/worker/src/sources/linkedinJobs.ts` when you no longer need this limit.
- `WORKER_LINKEDIN_DEBUG_STEPS` (default: off / `none` if unset): `none` | `coarse` | `fine` — after the browser reaches the jobs shell, a **fixed strip along the top** of the viewport is injected. **`none`**: a slim bar with **Finish & rank** (same behavior as the full bar — stop listing and continue the run into ranking with jobs collected so far) and **Abort** (cancel without ranking); no stepped **Continue** phases. **`coarse`** / **`fine`**: full bar with **Finish & rank**, **Continue**, and **Abort** — **Continue** advances stepped phases. While scraping (including `fine` steps), each job is upserted into Convex as soon as it is captured so the web UI updates live (final batch upsert still runs for consistency). `coarse` pauses at major phases and before pagination; `fine` also pauses after each job with title + 100-character description preview. Set this in `.env.local` (for example `fine` while iterating). **Important:** Node’s `--env-file` does **not** override variables already set in the process environment, so a shell export of `WORKER_LINKEDIN_DEBUG_STEPS=…` would ignore your `.env.local` value for that key until you unset it or remove the export.
- `WORKER_QUEUE_CONCURRENCY` (default: `2`): multiple sources can run in parallel, but **LinkedIn scrapes are serialized** in the worker (one shared Chrome tab/CDP session) so two LinkedIn jobs never navigate at once.
- `WORKER_CRON_INTERVAL_MINUTES` (default: `15`)
- `WORKER_RUN_ON_START` (default: `true`): controls whether the scheduler immediately checks for already queued runs on worker boot; it does **not** auto-create new scrape runs.
- `TRIGGER_LINKEDIN_RUN_TIMEOUT_MS` (optional): max time in milliseconds that `npm run trigger:linkedin` polls Convex for the LinkedIn run to finish (default **45 minutes**).
- `LLM_RANKING_PROVIDER` (default: `cursor`; options: `cursor`, `http`)
- `LLM_RANKING_MODEL` (provider model label/override)
- `LLM_RANKING_TIMEOUT_MS` (provider timeout in milliseconds, default: `60000`)
- `CURSOR_CLI_COMMAND` (default: `cursor-agent`)
- `CURSOR_CLI_ARGS` (default: `--print`; use `{prompt}` placeholder to inject prompt in custom arg layouts)

LinkedIn automation may conflict with LinkedIn’s terms; only use credentials and tooling you are allowed to use.

For `http` provider mode:

- `OPENAI_API_KEY` (required)
- `LLM_API_BASE_URL` (optional; defaults to `https://api.openai.com/v1`)
- `LLM_RANKING_TEMPERATURE` (optional; default: `0.1`)

### 3) Run Convex

Use your normal Convex workflow (for example, `npx convex dev`) so generated API types stay current.

**Postings page → Score:** choose **OpenAI** (Convex action `api.rankingScorePosting.scoreOnePosting`) or **Cursor CLI** (browser `fetch` to the worker `POST /rank-posting`). Populate provider/model rows with `npm run populate:ranking-catalog` (see script header for env vars).

Convex (OpenAI path):

- `OPENAI_API_KEY` (required for OpenAI in **Score**)
- `LLM_API_BASE_URL` (optional; default `https://api.openai.com/v1`)
- `LLM_RANKING_TEMPERATURE` (optional; default `0.1`)

### 4) Run the web app

```bash
npm run dev --workspace @job-bot/web
```

### 5) Build and run worker

```bash
npm run build --workspace @job-bot/worker
npm run start --workspace @job-bot/worker
```

`npm run start` on the worker runs `node --env-file=../../.env.local …` so `CONVEX_URL` and other vars load like `npm run dev` (requires a repo-root `.env.local`).

## Useful scripts

From repo root:

- `npm run build`
- `npm run typecheck`
- `npm run clean`
- `npm run dev:all` — runs Convex, web, and worker together. The worker leg sets `WORKER_HTTP_TRIGGER_PORT=3999`, `WORKER_USE_CHROME=1`, and `WORKER_CHROME_HEADLESS=0` so LinkedIn CDP and the HTTP trigger work without extra shell env; Chrome still **starts only when the first LinkedIn scrape runs**, not at worker boot. Add `WORKER_LINKEDIN_DEBUG_STEPS=fine` (or `coarse` / `none`) to `.env.local` if you want the in-page debug bar; leave unset for `none`. If you add new npm dependencies, run `npm install` at the repo root.
- `npm run populate:ranking-catalog` — fetches OpenAI `/v1/models` (chat-oriented filter) and merges a static Cursor CLI model list into Convex (`rankingLlmCatalog.replaceCatalog`). Requires `CONVEX_URL` and `OPENAI_API_KEY` for live OpenAI rows.
- `npm run trigger:linkedin` — if nothing responds on the worker HTTP trigger port, builds (unless `--skip-worker-build`) and **imports the worker in the same Node process** (`startWorker()`), so worker logs and errors print in your terminal. Queues a LinkedIn scrape, runs **`scheduler.runNow()`** (no HTTP hop when embedded), waits until Convex reports a terminal run status (override timeout with `TRIGGER_LINKEDIN_RUN_TIMEOUT_MS`). If a worker is already listening on the trigger port, only queues + **POST /trigger** is used. Loads `.env.local` via Node’s `--env-file`. Keyword search: `npm run trigger:linkedin -- --query "your terms"`. Flags: `--no-start-worker`, `--skip-worker-build`, `--no-wait` (exit before polling run completion).

Per workspace:

- Web: `npm run dev --workspace @job-bot/web`
- Worker: `npm run typecheck --workspace @job-bot/worker`

## UI behavior notes and edge cases

- Workers route is now `/workers` with legacy redirects from `/history`.
- History `Stop` behavior:
  - queued runs: immediately marked `cancelled`
  - running runs: graceful stop request is recorded; worker finishes in-flight upsert + ranking before terminal status
- `Clear All` actions in Postings and Workers run in bounded Convex batches and may schedule follow-up cleanup for large datasets.
- Workers log modal intentionally keeps original log timestamps (no humanized conversion) and color-codes levels (`info` blue, `warn` yellow, `error` red). Fixed columns are timestamp, level, source, service, phase, and message; any remaining JSON fields render in an **Other** column as `key: value` lines.

## MVP status and next priorities

Done:

- End-to-end criteria -> run -> posting -> ranking -> dashboard loop
- Scheduler + queue + run orchestration scaffold
- Source adapter boundary for future real scraping integrations

Still placeholder:

- Real browser/CDP scraping in `packages/agent-core`
- Queue backend swap (currently in-memory only)
- Production hardening (retry policies, richer metrics, deeper tests)
