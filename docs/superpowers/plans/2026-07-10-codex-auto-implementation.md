# Codex Auto TypeScript Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a bundled TypeScript CLI, MCP server, and Codex plugin for auto-resume and local session insights.

**Architecture:** A shared core package owns all parsing and domain decisions. Thin CLI and MCP adapters consume immutable snapshots, while the plugin exposes the MCP tools and skills without duplicating logic.

**Tech Stack:** Node.js 22+, TypeScript, pnpm, Turborepo, tsdown, Vitest, Commander, Zod, smol-toml, picocolors, string-width, and the MCP TypeScript SDK.

## Global Constraints

- Keep all data local and read-only except the tool's own config, lock, and scheduler state.
- Current session model comes from rollout `turn_context`; `config.toml` is fallback only.
- Token output uses adaptive raw/k/m formatting.
- JSON output contains no ANSI escape sequences.
- macOS and Linux are supported; unsupported terminal launchers fail explicitly.
- Every behavior change follows a red-green-refactor TDD cycle.

---

### Task 1: Workspace And Package Contracts

**Files:** root workspace files and each package `package.json`, `tsconfig.json`, and `src/index.ts`.

**Interfaces:** `@codex-auto/core` exports domain APIs; CLI and MCP consume only those exports.

- [ ] Add package manifests and tsdown build scripts.
- [ ] Install exact dependency versions with pnpm and commit the lockfile.
- [ ] Run `pnpm build`; expect all package bundles and declarations to be produced.

### Task 2: Formatting And Semantic Colors

**Files:** `packages/core/test/format.test.ts`, `packages/core/src/format.ts`, `packages/core/src/colors.ts`.

**Interfaces:** Produce `formatTokens(value: number): string`, `classifyMetric(kind, value): MetricLevel`, and `renderStatusLine(snapshot, options): string`.

- [ ] Write tests asserting `643`, `162.3k`, `3.73m`, context thresholds, duration thresholds, speed thresholds, `NO_COLOR`, and width degradation.
- [ ] Run `pnpm --filter @codex-auto/core test`; expect failures because the exports do not exist.
- [ ] Implement the minimal pure functions and renderers.
- [ ] Re-run the focused tests; expect all formatting tests to pass.

### Task 3: Codex Rollout And Config Readers

**Files:** `packages/core/test/codex-store.test.ts`, `packages/core/src/codex/types.ts`, `rollout.ts`, `config.ts`, `sessions.ts`, fixtures under `packages/core/test/fixtures`.

**Interfaces:** Produce `readLatestSession(options): Promise<SessionSnapshot | null>` and `readConfiguredModel(path): Promise<ModelSettings | null>`.

- [ ] Write fixtures and failing tests for complete, malformed, partial, and multiple-session rollouts.
- [ ] Verify failures identify missing reader functions.
- [ ] Implement streaming JSONL parsing, latest complete token snapshot selection, latest turn context selection, and config fallback.
- [ ] Verify current context, cumulative usage, null limits, and effective model assertions pass.

### Task 4: Git And Performance Snapshots

**Files:** `packages/core/test/git.test.ts`, `performance.test.ts`, `packages/core/src/git.ts`, `performance.ts`.

**Interfaces:** Produce `probeGit(cwd, runner?): Promise<GitSnapshot | null>` and `deriveTurnPerformance(events): TurnPerformanceSnapshot | null`.

- [ ] Write failing tests for branch, detached HEAD, dirty, ahead/behind, timeout, completed turn, running turn, and unavailable speed.
- [ ] Implement structured porcelain-v2 parsing and injected subprocess execution.
- [ ] Implement event timing without fabricating first-token timestamps.
- [ ] Run focused and full core tests.

### Task 5: CLI Commands

**Files:** `packages/cli/test/cli.test.ts`, `packages/cli/src/bin.ts`, `commands/status.ts`, `commands/statusline.ts`, `commands/context.ts`, `commands/doctor.ts`.

**Interfaces:** `runCli(argv, io, dependencies): Promise<number>` supports status, statusline, context, doctor, color, JSON, cwd, and session options.

- [ ] Write failing CLI tests using fixture Codex Home directories.
- [ ] Implement dependency-injected commands and stable exit codes.
- [ ] Verify table, compact line, JSON, unavailable limits, and no-session diagnostics.
- [ ] Build the CLI and execute fixture smoke tests.

### Task 6: MCP And Plugin

**Files:** `packages/mcp-server/test/server.test.ts`, `packages/mcp-server/src/server.ts`, and `packages/plugins/codex-insights/**`.

**Interfaces:** Expose `get_status`, `get_context_stats`, `get_rate_limits`, and `list_sessions` as read-only MCP tools.

- [ ] Write failing handler tests for structured results and safe errors.
- [ ] Implement handlers over `@codex-auto/core` and stdio startup.
- [ ] Generate and customize the plugin manifest, MCP config, and status skill.
- [ ] Run MCP smoke tests and plugin validation.

### Task 7: Auto-Resume Watcher

**Files:** `packages/core/test/scheduler.test.ts`, `packages/core/src/resume/candidates.ts`, `scheduler.ts`, `state.ts`, `packages/cli/src/commands/watch.ts`, `resume.ts`.

**Interfaces:** `reconcileResumeJobs(input): ResumeState` is pure; `runWatcherCycle(dependencies): Promise<CycleReport>` owns effects.

- [ ] Write failing tests for primary/secondary transitions, global overrides, ten-minute grace, duplicate prevention, manual-resume cancellation, corrupt state, and atomic saves.
- [ ] Implement pure candidate ranking and reconciliation.
- [ ] Implement the single-instance lock, persisted state adapter, due-job triggering, and OS terminal adapter.
- [ ] Verify focused tests, then run the full workspace check.

### Task 8: Documentation And Release Verification

**Files:** `README.md`, package READMEs, and plugin skill documentation.

- [ ] Document install, statusline/tmux integration, color thresholds, privacy, watcher operation, and migration from Python.
- [ ] Run `pnpm check`; expect lint, typecheck, tests, and builds to succeed.
- [ ] Run CLI fixture and live read-only status smoke tests.
- [ ] Validate the plugin with the plugin-creator validator and inspect Git status for generated artifacts.

