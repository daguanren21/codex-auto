# Codex Auto TypeScript Monorepo Design

## Purpose

Build a local-first TypeScript CLI and Codex plugin that replace the Python auto-resume runtime and add session context, token, Git, timing, and throughput insights. The implementation reads local Codex state only and never uploads conversation data.

## Product Surfaces

- `codex-auto watch`: foreground watcher that reconciles usage-limit resume jobs and prewarm schedules.
- `codex-auto status`: detailed current project, model, context, token, timing, speed, and rate-limit report.
- `codex-auto statusline`: one ANSI-aware line suitable for tmux and shell integrations.
- `codex-auto context`: context-focused alias with table and JSON output.
- `codex-auto doctor`: validates Codex Home, rollout access, Git, terminal launch support, and configuration.
- `codex-insights` plugin: read-only skills and MCP tools backed by the same core package.

## Monorepo

- `packages/core`: domain types, Codex rollout/config readers, Git probes, formatters, scheduler, and state persistence.
- `packages/cli`: command parsing, terminal output, watcher process, and OS terminal adapters.
- `packages/mcp-server`: read-only MCP tools for current status, context, sessions, and limits.
- `packages/plugins/codex-insights`: Codex manifest, MCP configuration, and user-invocable skills.

## Status Model

The latest complete rollout `token_count` event is the source of current context usage. `last_token_usage.total_tokens / model_context_window` is current context occupancy; `total_token_usage.total_tokens` is cumulative session usage and must remain separate. The latest `turn_context` is authoritative for the active model and effort; `config.toml` is a fallback only.

Git data is collected asynchronously with explicit working directories. Branch identity has a 5-second TTL, dirty/ahead/behind state has a 15-second TTL, and every probe has a 1.5-second timeout. Detached HEAD displays `@<short-sha>`.

Turn performance stores task start, first assistant output, completion, elapsed time, time to first token, output token count, and output tokens per second. When first-output timing is unavailable, speed is omitted rather than fabricated.

## Presentation

Token counts use adaptive units: raw below 1,000, `k` below one million, and `m` at one million or above. A wide statusline renders model, Git, context, cache, duration, speed, and cumulative usage. Narrow renderers remove cumulative usage, cache, model detail, and path in that order while preserving Git and context.

Stable module colors identify model, Git, context, cache, duration, and totals. Numeric colors represent thresholds. Context is green below 60%, yellow from 60% through 84%, and bold red from 85%. Duration is green below 15 seconds, yellow through 45 seconds, and red above 45 seconds. Output speed is green at 50 tokens/second or above, yellow from 15 through 49.9, and red below 15. Cache below 50% is dim rather than red because a cold cache is not a failure.

Color output supports `auto`, `always`, and `never`, honors `NO_COLOR` and `FORCE_COLOR`, and is disabled for JSON. Text markers preserve warnings without color.

## Auto Resume

The watcher parses structured rollout rate-limit transitions, distinguishes session and global windows, schedules resume ten minutes after reset, and persists jobs atomically. A single-instance lock prevents duplicate terminals. Before triggering, it checks for normal assistant activity after the limit checkpoint and expires jobs already resumed manually. Resume uses the latest session model and effort; when unavailable, it omits explicit model flags so Codex applies `config.toml`.

## Failure Handling

Malformed JSONL lines are skipped. Partial token updates retain the last complete snapshot and become stale. Missing rate limits are unavailable, never zero. Corrupt local state is quarantined and replaced with an empty state. Git, SQLite, config, and terminal failures return typed diagnostics without exposing conversation content.

## Testing

Vitest fixtures cover multiple rollout schemas, malformed records, partial updates, compaction drops, multiple sessions in one working directory, Git detached/dirty/ahead states, subprocess timeouts, ANSI-free output, narrow widths, watcher idempotency, manual resume guards, and atomic state writes. Integration checks build every package with tsdown, start the MCP server over stdio, invoke CLI JSON output, and validate the plugin manifest.

