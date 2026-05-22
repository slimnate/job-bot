# Ranking CLI workspace

Isolated directory for Cursor CLI job scoring (`CURSOR_CLI_WORKSPACE`).

The worker runs `cursor-agent` here so project rules (`AGENTS.md`, `.cursor/rules`) and repo MCP config are not loaded from the monorepo root.

## File-batch scoring (default)

When `LLM_RANKING_CURSOR_USE_BATCH_FILES=1` (default), each scoring run writes:

```
.ranking-batches/{batchId}/
  evaluator.json   # profile name, resume, scoring instructions
  postings.json    # JSON array of jobs (full descriptions)
```

The worker sends a short prompt that tells the agent to read only those paths and return a JSON array of per-posting scores (`postingId`, `scoreOverall`, `reasoningSummary`, `criteriaMatch`, `redFlags`). The batch directory is removed after the run unless `LLM_RANKING_CURSOR_KEEP_BATCH_FILES=1`.

Set `LLM_RANKING_CURSOR_INLINE_PROMPT=1` to embed all posting text in the argv prompt instead (legacy inline mode).
