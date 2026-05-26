# Ranking CLI workspace

Isolated directory for Cursor CLI job scoring (`CURSOR_CLI_WORKSPACE`).

The worker runs `cursor-agent` here so project rules (`AGENTS.md`, `.cursor/rules`) and repo MCP config are not loaded from the monorepo root.

## Workspace file scoring

Each scoring run writes under `.ranking-batches/{batchId}/`:

```
.ranking-batches/{batchId}/
  evaluator.json   # profile name, resume, scoring instructions
  postings.json    # JSON array of jobs (full descriptions)
  results.json     # written by the agent — score array (worker reads this after CLI exits)
```

The worker sends a short prompt that tells the agent to read `evaluator.json` and `postings.json`, then **write scores to `results.json`**. The CLI is invoked **without `--mode`** so Cursor uses default **Agent** mode (read/write tools). `--mode=ask` and `--mode=plan` are read-only and cannot write the results file. If the file is missing or uses a legacy shape, the worker also tries to parse JSON from the CLI result text. Stdout/stderr lines are still logged when `LLM_RANKING_CURSOR_LOG_OUTPUT=1`.

Large selections are split into multiple CLI runs when `LLM_RANKING_CURSOR_CHUNK_SIZE` is set (default `12`).

The batch directory is removed after the run unless `LLM_RANKING_CURSOR_KEEP_BATCH_FILES=1`.

Set `LLM_RANKING_CURSOR_INLINE_PROMPT=1` to also embed posting text in the argv prompt (files are still written and `results.json` is still required).
