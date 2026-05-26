# Job Bot MVP

Job Bot is a monorepo MVP for collecting job postings, deduplicating them in Convex, ranking them, and browsing everything in a small dashboard.

## What is implemented so far

- Web dashboard with main sections:
  - Evaluators (`apps/web/src/components/EvaluatorsEditor.tsx`): multiple named evaluator profiles, optional **Resume (Markdown)** and **Evaluation prompt** for the LLM, **Notes** (private — not sent to the ranker), and an **Active** flag per profile (only **Active** profiles can be chosen on queued runs; worker default ranking profile is `WORKER_DEFAULT_EVALUATOR_ID` per machine, not this flag)
- Postings viewer (`apps/web/src/components/PostingViewer.tsx`) with:
  - humanized discovered timestamps (same-day time, older relative age)
  - **sticky toolbar** (below the nav): search, source, **rank status** (all / ranked only / unranked only), min score, sort, **Select all visible**, bulk **Score selected** / **Delete selected** — stays visible while scrolling the list
  - postings shown as a **list** (`PostingTable.tsx`): compact meta row (color-coded score, styled external title link, source, location, ranked/discovered, actions), description preview with **Show full description** / **Show less**, and ranking details: **compact rubric score table** (criteria + score, expandable to full details column), **green / yellow / red flag** rows (one line + “N more”), model label (no redundant per-dimension scores from `criteriaMatchJson`)
  - filters: `postings.list` supports `rankStatus` (`ranked` | `unranked`) in addition to text search, source, `minScore`, and sort (`scoreDesc`, `rankedAtDesc`, `discoveredAtDesc`, `postedAtDesc`; unranked rows sort last when sorting by rank date)
  - per-item actions (`View`, **`Score`** — criteria + **provider** (OpenAI via Convex vs **Cursor CLI** on the local worker) + **model** from the Convex catalog, `Delete`), multi-select checkboxes (larger click targets), bulk `Score selected` / `Delete selected`, and `Clear All`
  - bulk score uses **fixed-size chunks** (default **3 postings** per LLM/CLI request); global rank is merged by `scoreOverall` after all chunks succeed
- detailed modal view (human-readable fields + raw JSON), including latest reasoning summary rendered as markdown (supports tables/lists from LLM output)
- Workers (`/workers`) scheduler status (`WorkerSchedulerPanel` → reactive Convex `worker_scheduler_status`), queue + history (`apps/web/src/components/HistoryViewer.tsx`, `apps/web/src/components/ScrapeQueuePanel.tsx`) with:
  - status color coding (`queued` blue, `running` yellow, `succeeded` green, `failed`/`cancelled` red)
  - history actions (`Logs`, `Stop`, `Delete`) and `Clear All`
  - log detail modal with table-first view, **per-level filters** (debug / info / warn / error), and raw JSON
- Settings (`/settings`, sidebar layout in `apps/web/src/pages/SettingsLayout.tsx`): **Overview** plus section routes (`/settings/scheduler`, `/settings/linkedin`, `/settings/remotive`, `/settings/ranking`, `/settings/http-openai`, `/settings/cursor-cli`, `/settings/web`, `/settings/advanced`). Worker, LinkedIn, Remotive, ranking, HTTP/OpenAI (non-secret), Cursor CLI, and web↔worker options stored in Convex `app_settings`; each field has always-visible hint text (catalog in `packages/shared/src/settings/appSettingDefinitions.ts`). Non-empty env vars override saved values; the worker refreshes settings about every 30 seconds. Draft edits persist across section navigation until you save.
- Sources (`/sources`, `apps/web/src/components/SourcesManager.tsx`) with:
  - source **Enabled** on/off toggle (disabled sources are omitted from the queue source picker)
  - read-only accepted criteria fields (code-defined contracts)
  - source preset management for **LinkedIn** — **Add preset** opens the criteria form; **Edit** / **Duplicate** open it prefilled; create, edit, duplicate, and delete reusable criteria combinations
  - **Remotive** has no presets; use category checkboxes on the Workers queue instead
- Convex backend with schema + APIs for:
  - Evaluator management (`convex/evaluators.ts`)
  - Source management (`convex/sources.ts`)
  - Source preset management (`convex/sourcePresets.ts`)
  - Posting upsert/list (`convex/postings.ts`)
  - Run lifecycle (`convex/runs.ts`)
  - Ranking recompute/upsert (`convex/ranking.ts`)
  - Ranking LLM catalog for the Score dialog (`convex/rankingLlmCatalog.ts`): providers + models; seed Cursor rows with `npx convex run rankingLlmCatalog:seedCursorCliModelsCatalog` or full catalog with `npm run populate:ranking-catalog`
  - App settings (`convex/appSettings.ts`): `get`, `getForUi`, `upsert`, `seedMissingSettings` (per-key factory seed), internal `getEffective` for env-over-Convex resolution
  - Worker-reported env (`convex/workerSettingsEnv.ts`): worker pushes allowlisted `.env.local` overrides on heartbeat so Settings **Env override** badges match the worker host (not only Convex cloud env)
- Worker runtime with:
  - Cron-like scheduler (`apps/worker/src/scheduler.ts`)
  - In-memory bounded queue abstraction (`apps/worker/src/queue.ts`)
  - Run orchestration pipeline (`apps/worker/src/orchestrator.ts`)
  - Source adapters (`apps/worker/src/sourceAdapters.ts`): **LinkedIn** (Chrome/CDP) and **Remotive** (public RSS feeds)
- Shared package and agent-core placeholders:
  - Ranking type in `packages/shared/src/schemas/ranking.ts`
  - Agent core stub in `packages/agent-core/src/index.ts`

## Current flow

1. User creates or edits evaluator profiles in the web app (resume + evaluation prompt drive how the LLM ranks jobs; notes are for the user only).
2. Runs are queued either:
   - manually from the dashboard (`runs.trigger`), optionally with an explicit `source`, `sourceCriteria`, and `evaluatorId`.
3. Worker dequeues runs with bounded concurrency.
4. Worker collects postings for a source (**LinkedIn** and **Remotive** implemented; other sources fail fast). **LinkedIn:** opens `/jobs/`, waits for a signed-in jobs UI (optional `LINKEDIN_USER` / `LINKEDIN_PASS` auto-login, or sign in manually in the Chrome window). When `sourceCriteria.search` is set, it runs a **UI-only** search on `/jobs/`: the SDUI typeahead receives `"<search> in <location>"` when location is also set, or just the search term when location is omitted. With empty `search`, the preferences hub path runs (“Show all”); `location` without `search` is ignored. The listing/detail scraper expands “About the job” when possible and persists the **full** job description with line breaks in `job_postings.descriptionSnippet`. LinkedIn scrape cleanup tears down Chrome after each run by default (`WORKER_AUTO_CLEANUP_CHROME=1`). **Remotive:** fetches public RSS feeds over HTTP (`https://remotive.com/remote-jobs/feed` when no categories are selected, or one feed per selected category slug). Queue criteria use comma-separated category slugs from the [Remotive category list](https://remotive.com/remote-jobs/rss-feed) (see `packages/shared/src/sources/remotiveCategories.ts`). Respect [Remotive’s RSS terms](https://remotive.com/remote-jobs/rss-feed): link back to listing URLs and mention Remotive as the source; do not repost to third-party job aggregators. Settings → **Remotive scraping**: `WORKER_REMOTIVE_MAX_POSTINGS` (optional cap) and `WORKER_REMOTIVE_FETCH_TIMEOUT_MS` (per-feed timeout; env overrides).
5. Worker upserts postings in Convex (`postings.upsertBatch`).
6. Worker scores postings with the LLM: **Cursor** = one or more CLI runs (workspace files under `ranking-cli-workspace/.ranking-batches/`, scores in `results.json`); **HTTP** = one API call per posting. Uses the **run’s** `evaluatorId` when set, otherwise **`job_sources.defaultEvaluatorId`** for that source (Sources page), otherwise **`WORKER_DEFAULT_EVALUATOR_ID`** on that worker process. Each posting gets an independent `scoreOverall` (no global rank). Results are persisted via `ranking.upsertResults` unless disabled with `WORKER_ENABLE_LLM_RANKING=0` during testing.
7. Worker marks run status and stats (`runs.updateStatus`).
8. While a run executes, the worker mirrors JSON log lines to Convex (`runLogs.appendBatch`) for inspection in the dashboard.
9. Web app updates from Convex queries.

## Monorepo layout

- `apps/web`: React + Vite dashboard
- `apps/worker`: scheduler, queue, orchestration runtime
- `convex`: schema and function API surface
- `packages/shared`: shared types/schemas
- `packages/agent-core`: agent-core package (currently stub)

Web static assets include a robot favicon at `apps/web/public/favicon.svg`.

## Data model (Convex)

- `job_evaluators`: named evaluator profile (`name`, `isActive` = available for queue selection, optional `notes`, `resumeMarkdown`, `rankingPrompt`)
- `job_sources`: source enablement metadata (`source`, `displayName`, `isEnabled`, optional `defaultEvaluatorId` for ranking when a run has no evaluator)
- `source_presets`: reusable source criteria combinations (`source`, `name`, `sourceCriteria`)
- `scrape_runs`: run status, timing, logs summary, aggregate stats
- `scrape_runs.sourceCriteria`: source-specific run criteria payload (LinkedIn: optional `search`; optional `location` only when `search` is set; Remotive: optional comma-separated `categories` slugs — empty → all-jobs feed)
- `scrape_runs.linkedinSearchStrategy`: records LinkedIn search path (`ui` for criteria-driven search, `preferences_hub` when criteria are empty; legacy runs may still show `search_url` / `url_fallback`)
- `scrape_runs.usedLinkedinUrlFallback`: boolean warning flag for URL fallback usage
- `scrape_runs.linkedinFallbackReason`: structured reason when fallback is used
- `run_log_lines`: JSON log lines for a run (streamed from the worker; used by the Workers log modal and run log page)
- `job_postings`: normalized postings deduplicated by source + external id
- `job_rankings`: per-posting scoring outputs (`scoreOverall`, reasoning, criteria match, red flags) linked by `evaluatorId` — no `rank` field
- `ranking_llm_providers`: stable `key`, `displayName`, `surface` (`convex_http` = OpenAI-compatible call from Convex; `worker_cursor` = Cursor CLI on the worker), `sortOrder`
- `ranking_llm_models`: `providerKey`, `apiModelId`, `displayName`, `sortOrder` (options shown in the Score dialog)
- `app_settings`: global scope singleton (`values` map of string settings for the Settings page)
- `worker_settings_env`: per-`workerId` snapshot of allowlisted env vars from the worker process (`envOverrides`, `reportedAt`)

Schema lives in `convex/schema.ts`.

### Breaking change: evaluator/source cutover

Early development cutover: schema now uses `job_evaluators`, `job_sources`, and `source_presets`, and run/ranking links now use `evaluatorId`. If local data no longer matches schema after pulling changes, clear old rows and recreate from the updated UI.

## API surface (implemented)

- `api.evaluators.get`
- `api.evaluators.getById`
- `api.evaluators.list`
- `api.evaluators.listActive`
- `api.evaluators.create`
- `api.evaluators.upsert`
- `api.sources.list`
- `api.sources.setEnabled`
- `api.sources.defaultEvaluatorForSource`
- `api.sources.setDefaultEvaluator`
- `api.sourcePresets.listBySource`
- `api.sourcePresets.create`
- `api.sourcePresets.update`
- `api.sourcePresets.remove`
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
- `api.rankingLlmCatalog.seedCursorCliModelsCatalog` (mutation: delete all `cursor` model rows, insert 111 Cursor CLI models from `@job-bot/shared`; OpenAI rows unchanged)
- `api.rankingScorePosting.scoreOnePosting` (Convex **action**: OpenAI / compatible HTTP path only; writes `job_rankings`; Cursor uses worker `POST /rank-posting`)
- `api.appSettings.get`
- `api.appSettings.getForUi`
- `api.appSettings.upsert`
- `api.appSettings.seedMissingSettings` (idempotent: inserts/patches only missing catalog keys from system defaults)
- `api.workerSettingsEnv.getByWorkerId`
- `api.workerSettingsEnv.upsertFromWorker`

## Local setup

### 1) Install dependencies

```bash
npm run install:all
```

### 2) Environment

#### Infrastructure (env only — not on Settings page)

> If `npx convex dev` prints **Found multiple CONVEX_URL environment variables in .env.local**, you have the same key loaded twice: often `CONVEX_URL` is set in your shell *and* in `.env.local`. Unset the shell copy (`unset CONVEX_URL`) or remove the duplicate line in `.env.local`.

- `VITE_CONVEX_URL` — web app bootstrap
- `CONVEX_URL` — worker and scripts
- `OPENAI_API_KEY` — Convex dashboard env and/or `.env.local` (required for HTTP scoring)
- `LINKEDIN_USER` / `LINKEDIN_PASS` — optional LinkedIn auto-login (worker host only; never stored in Convex)
- `CHROME_PATH` — machine-specific Chrome/Chromium binary
- `WORKER_HTTP_TRIGGER_PORT` — local worker HTTP bind (e.g. `3999` in `dev:all`)
- `WORKER_ID` — per-process worker identity for `worker_scheduler_status`
- `WORKER_MANAGE_CHROME` — attach to existing Chrome (`0`) vs spawn (`1`, default)
- `SCHEDULER_DEBUG`, `ORCHESTRATOR_DEBUG`, `SCRAPE_DEBUG`, `RANK_DEBUG` — verbose worker debug logs
- `TRIGGER_LINKEDIN_RUN_TIMEOUT_MS` — `npm run trigger:linkedin` poll timeout
- `CURSOR_CLI_ARGS` — advanced Cursor CLI argv template (`{prompt}` for huge prompts)

#### Configurable via Settings (`/settings`) with optional env override

Most tuning vars are editable on the **Settings** page (stored in `app_settings`). When a variable is set to a **non-empty** value in `.env.local` or the shell, it **overrides** the saved UI value on the **worker**. Runtime code does **not** apply hidden fallbacks — only env, Convex stored values, or (for seeding/UI labels) the developer file below. The Settings UI shows **Env override** with a tooltip indicating **worker** (`.env.local`), **Convex** (deployment env), or **browser** (Vite) when applicable. The worker reports allowlisted env keys to `worker_settings_env` on its ~30s heartbeat. Shell exports still beat `.env.local` for the same key (Node `--env-file` behavior).

**Factory defaults (developers):** edit `packages/shared/src/settings/systemSettingDefaults.ts` only. On cold start or when you add a new catalog key, `seedMissingSettings` patches **each missing key individually** into `app_settings` (never overwrites existing keys, including optional fields saved as empty string). The worker calls this on every settings refresh; opening **Settings** in the web app also seeds once.

Examples you can set in the UI (see in-app hints for full detail): `WORKER_CRON_INTERVAL_MINUTES`, `WORKER_QUEUE_CONCURRENCY`, `WORKER_USE_CHROME`, `WORKER_LINKEDIN_PAGES`, `LLM_RANKING_PROVIDER`, `LLM_RANKING_MODEL`, `VITE_WORKER_TRIGGER_URL` (also overridable via `import.meta.env` in the browser), and others listed in `packages/shared/src/settings/appSettingDefinitions.ts`.

`VITE_WORKER_TRIGGER_URL`: URL for **Trigger now** and Cursor **Score** (`POST …/rank-posting`). Must match `WORKER_HTTP_TRIGGER_PORT`. Set in Settings (seeded from system defaults on first run), `.env.local`, or Vite (`VITE_*` wins in the browser when set at build/dev time). There is no hardcoded URL fallback in the web app.

#### Legacy env reference (same keys as Settings)

Worker-specific optional env vars (all overridable from Settings unless listed as infrastructure above):

- `WORKER_USE_CHROME` (default: off): set to `1` to use Chrome with remote debugging for CDP scrapers. **Required for LinkedIn.** Root `npm run dev:all` sets this on the worker leg. The worker still does **not** launch Chrome at process startup; the first LinkedIn scrape spawns or attaches Chrome. If Chrome exits while the worker keeps running, the next LinkedIn scrape **reconnects CDP** or **respawns** managed Chrome so you are less likely to see `WebSocket is not open` from a stale session.
- LinkedIn scrapes **do not** fail on a pre-flight cookie check: the worker navigates to LinkedIn first, then waits for the jobs shell. If Chrome is not signed in, complete login in the window or set `LINKEDIN_USER` / `LINKEDIN_PASS` for a one-shot form submit (see below); the run only fails if that wait times out. After a successful env-based login the worker always opens `https://www.linkedin.com/jobs/`; if you are already signed in but LinkedIn left you on feed/home, the worker navigates to that same jobs hub once, and may reload it once if the jobs UI is slow to appear.
- **LinkedIn login-wait diagnostics:** each `linkedin.login_wait` line in Convex run logs includes `signedIn` (effective: DOM **or** `li_at` cookie via CDP), `signedInDom`, `liAtPresent`, `waitReason` / `waitReasonDom`, and `dbg` — URL `path`, `onLoginUrl`, `onMemberOnlyPath` (including locale segments like `/en/feed/`), `hasMemberNav`, `hasNarrowGuestChrome`, `signedInPathOk`, `signedInNavOk`, and jobs-shell hints. No credentials or page text are logged.
- `WORKER_CHROME_HEADLESS` (default: `true`): use `0` for a visible window (recommended for LinkedIn login). `dev:all` sets `0` on the worker leg.
- `LINKEDIN_USER` / `LINKEDIN_PASS` (optional, worker only): if **both** are set (non-empty), the worker opens `/login` when needed and runs **one** automatic LinkedIn sign-in when a login form is detected, while waiting for the jobs shell. This does not bypass 2FA, CAPTCHA, or security challenges — complete those in the browser if they appear. Do not commit real credentials; use `.env.local` and keep it out of version control.
- `CHROME_PATH` (optional; path to Chrome/Chromium)
- `WORKER_CHROME_PORT` (default: `9222`)
- `WORKER_MANAGE_CHROME` (default: `true`; set `0` to attach to an already running Chrome with remote debugging on `WORKER_CHROME_PORT`)
- `WORKER_AUTO_CLEANUP_CHROME` (default: `true`; set `0` during debugging to keep the Chrome worker instance alive across LinkedIn runs instead of auto-closing/detaching after each run)
- `WORKER_HTTP_TRIGGER_PORT` (optional): when set (e.g. `3999`), the worker listens on `127.0.0.1` for `GET /scheduler` (JSON status for the dashboard), `POST /trigger`, `POST /rank-posting` / `POST /rank-postings` (manual Cursor CLI score from the Postings page), and `POST /ingest-posting` (browser extension / manual capture ingest). Root `npm run dev:all` sets `3999` on the worker leg. These routes are **dev-only**: unauthenticated, bound to `127.0.0.1`, with CORS `*` for local tools.
- `WORKER_LINKEDIN_PAGES` (default: `3`): how many LinkedIn results **pages** (pagination “Next”) the in-browser scraper will attempt per run, minimum `1`, maximum `10`. Invalid values fall back to the default; values above the cap are clamped with a worker warning.
- `WORKER_LINKEDIN_MAX_POSTINGS` (optional, default: unlimited): positive integer cap for total LinkedIn postings collected in a run. When set, the browser-side scraper stops after hitting the cap, live stream upserts also stop at the same threshold, and final postings output is capped for consistency. Invalid values are ignored with a worker warning.

**LinkedIn field extraction (anti bleed):** The CDP scraper resolves the **active** job from the URL (`currentJobId` or `/jobs/view/<id>`) and scopes fields to that job’s **list card** and the **job detail** column.

**LinkedIn split-pane list clicks (geo search and preferences “Show all”):** After setup, both paths use the same results shell. The scraper scopes clicks to the left-hand list only. **SDUI results** (`componentkey="SearchResultsMainContent"`): dismissible `div[role="button"]` cards. **Legacy two-pane results** (`li[data-occludable-job-id]`, `div.job-card-container--clickable`): the card container, not `a.job-card-list__title--link` / `/jobs/view/` title anchors (see `ex/example-search.html`). Detail column nodes (`JobDetails_*`, `.jobs-search__job-details`) are excluded. `window.location.href` is recorded before scraping; if a click lands on a standalone `/jobs/view/{id}` page, the worker navigates back to the list URL (preserving `currentJobId` when known). Recovery count is logged as `linkedin_list_nav_recovery` and stored on job `rawPayload.listNavRecoveryCount`.

- **Salary** — taken only from (1) the expanded “About the job” / legal pay text in the detail pane, then (2) a short salary chip **inside that job’s list card**. It does **not** walk every `span`/`p`/`div` on the page (which previously reused one sidebar salary for unrelated postings).
- **Title, company, location** — prefer the selected card + detail pane; there is no `document.body` regex fallback for location.
- **Integrity** — a capture is skipped if the posting id disagrees with the URL’s current job id, or if neither a list card nor a detail root can be resolved.

Stored postings include `rawPayload.extractionDiagnostics` (`salarySource`, `hasListCard`, `hasDetailRoot`, `detailLikelyForJob`, `currentJobIdFromUrl`) for debugging. Regression coverage: `npm run test:worker` (requires dependencies installed; the worker lists `jsdom` as a dev dependency).

- `WORKER_LINKEDIN_DEBUG_STEPS` (default: off / `none` if unset): `none` | `coarse` | `fine` — controls **manual Continue** stepping only (in-page `waitMajor` / `waitFine` and Node `linkedInWaitStep`). After the jobs shell is ready, the worker **always** injects the **full** top bar (stats badges, Pause/Resume, Finish & rank, Continue, Abort). **`none`**: no manual checkpoints. **`coarse`**: pauses at major phases and before pagination. **`fine`**: also pauses after each job (title + ~100-character description preview in the bar). While stepping, each job is upserted live when captured (final batch upsert still runs). Set in `.env.local` while iterating. **Important:** Node’s `--env-file` does **not** override variables already set in the process environment, so a shell export of `WORKER_LINKEDIN_DEBUG_STEPS=…` would ignore your `.env.local` value for that key until you unset it or remove the export.
- **Worker debug flags** (optional, default off; each enables `workerLog.debug` for that subsystem — hide **debug** lines in the Workers **Run logs** modal with the level checkboxes when you do not need them): **`SCHEDULER_DEBUG`** (scheduler tick start, queue enqueue/task start-finish, skipped status flush), **`ORCHESTRATOR_DEBUG`** (trigger/DB-queue summaries, skip-duplicate claims, run doc loaded; **`run.log.flush`** is one JSON line per flush to **stdout** only — total lines appended — so it is not re-buffered into Convex run logs), **`SCRAPE_DEBUG`** (Chrome reconnect/ping/cleanup, source adapter + browser lock, LinkedIn milestones / overlay inject / stream dedupe skips), **`RANK_DEBUG`** (HTTP rank request/load/invoke, LLM rank attempts). **`LLM_RANKING_CURSOR_LOG_OUTPUT`** (default on) streams each `cursor-agent` stdout/stderr line as **`llm.rank.cursor_cli.output`** during Cursor ranking (set `0` to silence). Convex **`retry.attempt`** logs are gated per call site: orchestrator `withRetry` uses **`ORCHESTRATOR_DEBUG`**; rank handler and LLM HTTP `withRetry` use **`RANK_DEBUG`**.
- `WORKER_DEFAULT_EVALUATOR_ID` (optional): Convex document id for `job_evaluators` used when a scrape run has no `evaluatorId` **and** the source has no `defaultEvaluatorId`. Set on each worker host (e.g. in `.env.local`). If unset after those checks, ranking still runs but with an empty evaluator profile (and the worker logs a warning). The id must point to a row that exists and has **Active** on if you want full profile context in the ranker.
- `WORKER_ENABLE_LLM_RANKING` (default: `true`; set `0` during testing to skip post-scrape LLM ranking and complete runs with `rankedCount=0`)
- `WORKER_QUEUE_CONCURRENCY` (default: `2`): multiple sources can run in parallel, but **LinkedIn scrapes are serialized** in the worker (one shared Chrome tab/CDP session) so two LinkedIn jobs never navigate at once.
- `WORKER_CRON_INTERVAL_MINUTES` (default: `15`)
- `WORKER_RUN_ON_START` (default: `true`): controls whether the scheduler immediately checks for already queued runs on worker boot; it does **not** auto-create new scrape runs.
- `TRIGGER_LINKEDIN_RUN_TIMEOUT_MS` (optional): max time in milliseconds that `npm run trigger:linkedin` polls Convex for the LinkedIn run to finish (default **45 minutes**).
- `LLM_RANKING_PROVIDER` (default: `cursor`; options: `cursor`, `http`)
- `LLM_RANKING_MODEL` (HTTP OpenAI model; optional fallback for Cursor if `LLM_RANKING_CURSOR_MODEL` unset)
- `LLM_RANKING_CURSOR_MODEL` (default: `auto`; passed to `cursor-agent --model`. Legacy `cursor-default` from old catalog rows is mapped to `auto`.)
- `LLM_RANKING_TIMEOUT_MS` (base timeout in milliseconds, default: `60000`)
- `LLM_RANKING_TIMEOUT_PER_CANDIDATE_MS` (added to base timeout per posting, default: `5000`)
- `LLM_RANKING_DESCRIPTION_MAX_CHARS` (max job description chars in HTTP inline prompts; full text stays in DB and in Cursor `postings.json`, default: `4096`)
- `LLM_RANKING_CURSOR_USE_BATCH_FILES` (default: `1`; write `postings.json` + `evaluator.json` under `ranking-cli-workspace/.ranking-batches/`)
- `LLM_RANKING_CURSOR_INLINE_PROMPT` (default: `0`; set `1` to put all posting text in the argv prompt instead of batch files)
- `LLM_RANKING_CURSOR_KEEP_BATCH_FILES` (default: `0`; set `1` to leave batch dirs on disk for debugging)
- `LLM_RANKING_CURSOR_EXTRA_TIMEOUT_MS` (extra timeout for Cursor workspace file ranking, default: `90000`; legacy env `LLM_RANKING_CURSOR_FILE_EXTRA_TIMEOUT_MS` still accepted)
- `LLM_RANKING_CURSOR_CHUNK_SIZE` (max postings per Cursor CLI call, default: `12`; set `0` to disable chunking)
- `LLM_RANKING_CURSOR_MINIMAL_CONTEXT` (default: `1`; set `0` to skip forced `--mode=ask`, `--trust`, `--workspace`)
- `LLM_RANKING_CURSOR_LOG_OUTPUT` (default: `1`; set `0` to disable streaming `llm.rank.cursor_cli.output` debug logs for each `cursor-agent` stdout/stderr line)
- `CURSOR_CLI_COMMAND` (default: `cursor-agent`)
- `CURSOR_CLI_ARGS` (default: `--print --mode=ask --trust --output-format json`; ranking always forces `--output-format json`. Scores are read from `results.json` in the batch directory, not from stdout.)
- `CURSOR_CLI_WORKSPACE` (default: `apps/worker/ranking-cli-workspace` — resolved to an absolute path from the repo root before invoking `cursor-agent`, so worker cwd does not break the path; empty dir so repo `AGENTS.md` / `.cursor/rules` are not loaded)

LinkedIn automation may conflict with LinkedIn’s terms; only use credentials and tooling you are allowed to use.

For `http` provider mode:

- `OPENAI_API_KEY` (required)
- `LLM_API_BASE_URL` (optional; defaults to `https://api.openai.com/v1`)
- `LLM_RANKING_TEMPERATURE` (optional; default: `0.1`)

`LLM_RANKING_DESCRIPTION_MAX_CHARS` also applies to Convex **`scorePostingsBatch`** / **`scoreOnePosting`** when scoring from the Postings page via OpenAI (one HTTP request per posting).

**Live ranking logs (Postings score dialog):** For Cursor scoring, the web UI generates a **`rankingRunId`**, opens **`GET /rank-logs?rankingRunId=…`** (SSE), then **`POST /rank-posting(s)`** with the same id. The worker mirrors every **`llm.rank.*`** log line (including `llm.rank.run.begin` / `llm.rank.run.end`) into that stream while the run is active.

**Ranking vs saving:** The worker runs `cursor-agent` first, then calls Convex **`ranking.upsertResults`**. If you see **`llm.rank.success`** followed by **`rank_posting.save_failed`** or **`fetch failed`** on `ranking.upsertResults`, the model output was parsed correctly but the worker could not reach your deployment — confirm **`CONVEX_URL`** in `.env.local`, keep **`npx convex dev`** running, and check network/DNS to `*.convex.cloud`. The Postings UI will show the computed score with a save error when that happens.

**Schema note:** `job_rankings` no longer stores `rank`. After deploying the schema change in dev, clear stale rows (Postings **Clear All**, or `postings.clearAll`) so old documents with `rank` do not linger.

### 3) Run Convex

Use your normal Convex workflow (for example, `npx convex dev`) so generated API types stay current.

**Postings page → Score:** choose **OpenAI** (Convex action `api.rankingScorePosting.scoreOnePosting`) or **Cursor CLI** (browser `fetch` to the worker `POST /rank-posting`). Populate provider/model rows with `npm run populate:ranking-catalog` (see script header for env vars), or refresh only Cursor models:

```bash
npx convex run rankingLlmCatalog:seedCursorCliModelsCatalog
```

The Score dialog **Model** field is a searchable dropdown (`FilterSelect`) — type to filter the list (useful when the Cursor catalog lists 111 models).

Convex (OpenAI path):

- `OPENAI_API_KEY` (required for OpenAI in **Score**)
- `LLM_API_BASE_URL` (optional; default `https://api.openai.com/v1`)
- `LLM_RANKING_TEMPERATURE` (optional; default `0.1`)
- `LLM_RANKING_DESCRIPTION_MAX_CHARS` (optional; Convex dashboard env)

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
- `npm run dev:all` — runs Convex, web, and worker together. The worker leg sets `WORKER_HTTP_TRIGGER_PORT=3999`, `WORKER_USE_CHROME=1`, and `WORKER_CHROME_HEADLESS=0` so LinkedIn CDP and the HTTP trigger work without extra shell env; Chrome still **starts only when the first LinkedIn scrape runs**, not at worker boot. The LinkedIn scrape **top bar** (badges, Pause/Resume, Finish & rank, Continue, Abort) is always shown once the jobs shell is ready; set `WORKER_LINKEDIN_DEBUG_STEPS` to `coarse` or `fine` when you want **manual Continue** stepping (`none` = no stepping). Set `SCHEDULER_DEBUG`, `ORCHESTRATOR_DEBUG`, `SCRAPE_DEBUG`, and/or `RANK_DEBUG` to `1` for extra worker debug logs. If you add new npm dependencies, run `npm install` at the repo root.

### oc-job-capture browser extension

The sibling repo [`oc-job-capture`](../oc-job-capture) can save the **open** LinkedIn (or Indeed) job tab into `job_postings` via the worker HTTP API.

1. In job-bot: `npm run dev:all` (needs Convex + worker on port `3999`; web on `:5173` to view `/postings`).
2. In Edge: load unpacked `oc-job-capture`, open a job page, click **Save to job-bot**.

**`POST http://127.0.0.1:3999/ingest-posting`** — JSON body: one posting object, or `{ "postings": [ … ] }` for a small batch. Required fields: `url`, `title`, `company` (and usually `source` + `externalId`; the worker can derive those from LinkedIn/Indeed URLs). Optional: `location`, `salaryText`, `descriptionSnippet`, `postedAt`, `discoveredAt`, `rawPayload`. Response: `{ "ok": true, "inserted", "updated", "skippedInvalid", "processed" }`.

Smoke test:

```bash
curl -s -X POST http://127.0.0.1:3999/ingest-posting \
  -H 'Content-Type: application/json' \
  -d '{"source":"linkedin","externalId":"123","url":"https://www.linkedin.com/jobs/view/123/","title":"Test","company":"Co"}'
```
- `npm run populate:ranking-catalog` — fetches OpenAI `/v1/models` (chat-oriented filter) and merges the full Cursor CLI catalog from `@job-bot/shared` into Convex (`rankingLlmCatalog.replaceCatalog`). Requires `CONVEX_URL` and `OPENAI_API_KEY` for live OpenAI rows. Build shared first if imports fail: `npm run build --workspace @job-bot/shared`.
- `npx convex run rankingLlmCatalog:seedCursorCliModelsCatalog` — replaces only Cursor provider models (111 rows); does not wipe OpenAI catalog rows.
- `npm run trigger:linkedin` — if nothing responds on the worker HTTP trigger port, builds (unless `--skip-worker-build`) and **imports the worker in the same Node process** (`startWorker()`), so worker logs and errors print in your terminal. Queues a LinkedIn scrape, runs **`scheduler.runNow()`** (no HTTP hop when embedded), waits until Convex reports a terminal run status (override timeout with `TRIGGER_LINKEDIN_RUN_TIMEOUT_MS`). If a worker is already listening on the trigger port, only queues + **POST /trigger** is used. Loads `.env.local` via Node’s `--env-file`. Criteria are sent as `sourceCriteria`: `npm run trigger:linkedin -- --query "your terms"` and optionally `… --location "Austin, TX"` (searched as `your terms in Austin, TX` in the LinkedIn UI; omit `--location` to use your profile location). Flags: `--no-start-worker`, `--skip-worker-build`, `--no-wait` (exit before polling run completion).

Per workspace:

- Web: `npm run dev --workspace @job-bot/web`
- Worker: `npm run typecheck --workspace @job-bot/worker`

## UI behavior notes and edge cases

- Workers route is now `/workers` with legacy redirects from `/history`.
- Workers **Scheduler** panel is backed by a Convex reactive query (`worker_scheduler_status`). The worker writes status on start/stop, around every tick, and on a 30s heartbeat interval (`flushStatus` in `apps/worker/src/scheduler.ts`); the dashboard flips the timer badge to **stale** (red) when the heartbeat is older than 90 seconds, which usually means the worker process died. State persists across worker restarts. The inline **live** heartbeat label stays the word `live` (no per-second age text) until that same 90s threshold; hover still shows the absolute last heartbeat time.
- The worker still exposes `GET /scheduler` on `WORKER_HTTP_TRIGGER_PORT` for ad-hoc `curl` inspection, but the dashboard no longer depends on it.
- Workers history shows LinkedIn search path (`UI search`, `Preferences hub`, or legacy `Search URL` / `URL fallback` on older runs).
- History `Stop` behavior:
  - queued runs: immediately marked `cancelled`
  - running runs: graceful stop request is recorded; worker finishes in-flight upsert + ranking before terminal status
- `Clear All` actions in Postings and Workers run in bounded Convex batches and may schedule follow-up cleanup for large datasets.
- Workers log modal intentionally keeps original log timestamps (no humanized conversion) and color-codes levels (`debug` slate, `info` blue, `warn` yellow, `error` red). **Level** checkboxes filter which rows are shown (unparseable lines always stay visible). Fixed columns are timestamp, level, source, service, phase, and message; any remaining JSON fields render in an **Other** column as `key: value` lines.

## MVP status and next priorities

Done:

- End-to-end worker source criteria -> posting aggregation -> evaluator ranking -> dashboard loop
- Scheduler + queue + run orchestration scaffold
- Source adapter boundary for future real scraping integrations

Still placeholder:

- Real browser/CDP scraping in `packages/agent-core`
- Queue backend swap (currently in-memory only)
- Production hardening (retry policies, richer metrics, deeper tests)
