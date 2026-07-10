# Tmux Statusline Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Codex Auto insights in a colored, responsive tmux bottom status bar without a persistent daemon or disruption to the existing tmux plugin configuration.

**Architecture:** The core renderer owns one segment model and emits ANSI, plain, or tmux-native markup from the same responsive layout. The CLI caches render-ready snapshots by Codex home and cwd, while a focused tmux config adapter installs and removes one idempotent managed block.

**Tech Stack:** Node.js 22+, TypeScript, Commander, picocolors, string-width, Vitest, tsdown, pnpm, Turborepo, and tmux 3.6b.

## Global Constraints

- Preserve all existing `~/.tmux.conf` content and keep TPM initialization last.
- Do not install or reconfigure tmux plugins, cmux, Ghostty, or shell startup files.
- Use tmux `#[...]` markup; never place ANSI escapes in tmux output.
- Preserve Git and context during responsive degradation.
- Cache entries live under `~/.codex-auto/statusline-cache`, are keyed by cwd and Codex home, and are written atomically.
- Tmux refreshes every 10 seconds and no persistent status daemon is introduced.
- Every behavior change follows a red-green-refactor TDD cycle.

---

### Task 1: Shared Tmux-Native Renderer

**Files:**
- Modify: `packages/core/src/statusline.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/statusline.test.ts`

**Interfaces:**
- Consumes: existing `StatusLineSnapshot` and `classifyMetric()`.
- Produces: `StatusLineFormat = "ansi" | "plain" | "tmux"`; `renderStatusLine(snapshot, { color, width, format })`.

- [ ] **Step 1: Add failing tests for tmux markup, escaping, thresholds, and width**

Add tests with a helper that removes only tmux formatting directives:

```ts
function stripTmux(value: string): string {
  return value.replaceAll(/#\[[^\]]*\]/g, "").replaceAll("##", "#");
}

it("renders tmux-native colors without ANSI", () => {
  const rendered = renderStatusLine(snapshot, { color: true, width: 160, format: "tmux" });
  expect(rendered).toContain("#[fg=#3b82f6]");
  expect(rendered).toContain("#[fg=#d946ef]");
  expect(rendered).not.toContain("\u001B[");
  expect(stripTmux(rendered)).toBe(renderStatusLine(snapshot, { color: false, width: 160, format: "plain" }));
});

it("escapes branch text that resembles a tmux directive", () => {
  const rendered = renderStatusLine(
    { ...snapshot, git: { ...snapshot.git!, branch: "feature/#[fg=red]" } },
    { color: true, width: 160, format: "tmux" },
  );
  expect(rendered).toContain("feature/##[fg=red]");
  expect(stripTmux(rendered)).toContain("feature/#[fg=red]");
});

it.each([30, 40, 60])("keeps tmux output within %i visible columns", (width) => {
  const rendered = renderStatusLine(snapshot, { color: true, width, format: "tmux" });
  expect(stringWidth(stripTmux(rendered))).toBeLessThanOrEqual(width);
  expect(stripTmux(rendered)).toContain("main*");
  expect(stripTmux(rendered)).toContain("ctx 46.1%");
});
```

- [ ] **Step 2: Run the focused test and verify red state**

Run:

```bash
pnpm --filter @codex-auto/core run test -- test/statusline.test.ts
```

Expected: FAIL because `StatusLineOptions` does not accept `format` and tmux markup is not emitted.

- [ ] **Step 3: Refactor segments to semantic styles and add tmux rendering**

Update the public options and segment representation:

```ts
export type StatusLineFormat = "ansi" | "plain" | "tmux";

export interface StatusLineOptions {
  color: boolean;
  width: number;
  format?: StatusLineFormat;
}

type SegmentTone = "blue" | "magenta" | "cyan" | MetricLevel;

interface Segment {
  key: SegmentKey;
  plain: string;
  tone: SegmentTone;
}
```

Use one selected segment list for all formats. Escape literal `#` before applying tmux directives:

```ts
const TMUX_COLORS: Record<SegmentTone, string> = {
  blue: "#3b82f6",
  magenta: "#d946ef",
  cyan: "#06b6d4",
  low: "#22c55e",
  medium: "#eab308",
  high: "#ef4444",
  neutral: "#6b7280",
};

function tmuxEscape(value: string): string {
  return value.replaceAll("#", "##");
}

function renderTmuxSegment(segment: Segment): string {
  const bold = segment.tone === "high" ? ",bold" : "";
  return `#[fg=${TMUX_COLORS[segment.tone]}${bold}]${tmuxEscape(segment.plain)}#[default]`;
}
```

For `plain`, join `segment.plain`. For `ansi`, retain the existing picocolors behavior. For `tmux`, join `renderTmuxSegment(segment)` using `#[fg=#6b7280] | #[default]`. Width checks always use plain segment text before formatting.

Export the new type from `packages/core/src/index.ts`:

```ts
export type { StatusLineFormat, StatusLineOptions, StatusLineSnapshot } from "./statusline.js";
```

- [ ] **Step 4: Run renderer tests and the full core suite**

Run:

```bash
pnpm --filter @codex-auto/core run test -- test/statusline.test.ts
pnpm --filter @codex-auto/core run test
```

Expected: all core test files pass; existing ANSI/plain snapshots remain unchanged.

- [ ] **Step 5: Commit the renderer**

```bash
git add packages/core/src/statusline.ts packages/core/src/index.ts packages/core/test/statusline.test.ts
git commit -m "feat: add tmux-native statusline rendering"
```

---

### Task 2: Snapshot Cache And Statusline CLI Contract

**Files:**
- Create: `packages/cli/src/status-cache.ts`
- Create: `packages/cli/test/status-cache.test.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `StatusLineSnapshot`, `getCurrentStatus()`, and `renderStatusLine()`.
- Produces: `statusCachePath(options): string`, `readCachedStatusLine(options, loader): Promise<StatusLineSnapshot | null>`, and CLI flags `--format`, `--width`, `--cache-ttl`, `--state-dir`.

- [ ] **Step 1: Write failing cache tests**

Create `packages/cli/test/status-cache.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCachedStatusLine, statusCachePath } from "../src/status-cache.js";

const snapshot = { context: { usedTokens: 50, maxTokens: 100, ratio: 0.5 } };

it("uses a fresh cache entry without calling the loader", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "codex-auto-cache-"));
  let calls = 0;
  const load = async () => { calls += 1; return snapshot; };
  const options = { cacheDir, codexHome: "/codex", cwd: "/repo", ttlSeconds: 10, now: new Date("2026-07-10T09:00:00Z") };
  expect(await readCachedStatusLine(options, load)).toEqual(snapshot);
  expect(await readCachedStatusLine({ ...options, now: new Date("2026-07-10T09:00:05Z") }, load)).toEqual(snapshot);
  expect(calls).toBe(1);
});

it("replaces stale or corrupt cache entries", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "codex-auto-cache-"));
  const options = { cacheDir, codexHome: "/codex", cwd: "/repo", ttlSeconds: 10, now: new Date("2026-07-10T09:00:20Z") };
  await writeFile(statusCachePath(options), "not json", "utf8");
  let calls = 0;
  const result = await readCachedStatusLine(
    options,
    async () => { calls += 1; return snapshot; },
  );
  expect(result).toEqual(snapshot);
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run cache tests and verify red state**

Run:

```bash
pnpm --filter @codex-auto/cli run test -- test/status-cache.test.ts
```

Expected: FAIL because `status-cache.ts` does not exist.

- [ ] **Step 3: Implement atomic keyed caching**

Create `packages/cli/src/status-cache.ts` with these signatures:

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { StatusLineSnapshot } from "@codex-auto/core";

export interface StatusCacheOptions {
  cacheDir: string;
  codexHome: string;
  cwd: string;
  ttlSeconds: number;
  now?: Date;
}

export function statusCachePath(options: StatusCacheOptions): string {
  const key = createHash("sha256")
    .update(`${resolve(options.codexHome)}\0${resolve(options.cwd)}`)
    .digest("hex");
  return resolve(options.cacheDir, `${key}.json`);
}

export async function readCachedStatusLine(
  options: StatusCacheOptions,
  loader: () => Promise<StatusLineSnapshot | null>,
): Promise<StatusLineSnapshot | null>;
```

The stored shape is `{ createdAt: string, snapshot: StatusLineSnapshot | null }`. When `ttlSeconds <= 0`, call the loader without reading or writing a cache. A fresh valid entry returns immediately. Other entries call the loader, create the directory, write a PID/timestamp temporary file, and atomically rename it over the cache path.

- [ ] **Step 4: Add failing CLI tests for format, width, cache, and quiet misses**

Extend the `statusline` suite:

```ts
it("renders tmux format at an explicit width", async () => {
  const output = capture();
  const code = await runCli([
    "statusline", "--codex-home", codexHome, "--cwd", "/workspace/project",
    "--format", "tmux", "--width", "60",
  ], output.io);
  expect(code).toBe(0);
  expect(output.stdout.join("")).toContain("#[fg=");
  expect(output.stdout.join("")).not.toContain("\u001B[");
});

it("is silent when tmux has no matching session", async () => {
  const output = capture();
  const emptyHome = await mkdtemp(join(tmpdir(), "codex-auto-empty-"));
  const code = await runCli([
    "statusline", "--codex-home", emptyHome, "--cwd", "/missing", "--format", "tmux",
  ], output.io);
  expect(code).toBe(0);
  expect(output.stdout).toEqual([]);
  expect(output.stderr).toEqual([]);
});
```

Add a CLI test that proves the second call does not rewrite the cache:

```ts
it("reuses a fresh statusline cache entry", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-auto-statusline-cache-"));
  const args = [
    "statusline", "--codex-home", codexHome, "--cwd", "/workspace/project",
    "--cache-ttl", "10", "--state-dir", stateDir,
  ];
  expect(await runCli(args, capture().io)).toBe(0);
  const cacheDir = join(stateDir, "statusline-cache");
  const [cacheName] = await readdir(cacheDir);
  const cachePath = join(cacheDir, cacheName!);
  const first = await stat(cachePath);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await runCli(args, capture().io)).toBe(0);
  const second = await stat(cachePath);
  expect(second.mtimeMs).toBe(first.mtimeMs);
});
```

Add `readdir` and `stat` to the existing `node:fs/promises` test imports.

- [ ] **Step 5: Implement statusline-only CLI options**

Define a statusline-specific options type:

```ts
interface StatusLineCliOptions extends StatusOptions {
  format: "ansi" | "plain" | "tmux";
  width?: string;
  cacheTtl: string;
  stateDir: string;
}
```

Register and validate the flags on `statusline`. Build the render-ready snapshot in the cache loader:

```ts
const snapshot = await readCachedStatusLine(
  {
    cacheDir: join(options.stateDir, "statusline-cache"),
    codexHome: options.codexHome,
    cwd: options.cwd,
    ttlSeconds: parseNonNegativeNumber(options.cacheTtl, "--cache-ttl"),
  },
  async () => {
    const current = await getCurrentStatus({ codexHome: options.codexHome, cwd: options.cwd });
    return current ? asStatusLine(current) : null;
  },
);
```

For tmux misses, return code 0 with no output. For other formats, preserve the existing diagnostic and code 1. `plain` always disables color; `tmux` uses native markup; `ansi` continues honoring `--color`, `NO_COLOR`, and `FORCE_COLOR`.

- [ ] **Step 6: Run CLI tests and workspace type/lint checks**

Run:

```bash
pnpm --filter @codex-auto/cli run test
pnpm typecheck
pnpm lint
```

Expected: CLI tests pass; typecheck and lint report zero errors and warnings.

- [ ] **Step 7: Commit cache and CLI behavior**

```bash
git add packages/cli/src/status-cache.ts packages/cli/test/status-cache.test.ts packages/cli/src/cli.ts packages/cli/test/cli.test.ts
git commit -m "feat: cache tmux statusline snapshots"
```

---

### Task 3: Idempotent Tmux Config Installer

**Files:**
- Create: `packages/cli/src/tmux-config.ts`
- Create: `packages/cli/test/tmux-config.test.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: absolute CLI executable path and a tmux config string.
- Produces: `renderTmuxBlock()`, `installTmuxBlock()`, `removeTmuxBlock()`, and `codex-auto tmux install|uninstall`.

- [ ] **Step 1: Write failing pure config transformation tests**

Create fixture strings in `tmux-config.test.ts`:

```ts
const existing = `set -g @plugin 'tmux-plugins/tpm'\nrun "~/.config/tmux/plugins/tpm/tpm"\n`;

it("inserts one managed block before TPM and preserves existing content", () => {
  const block = renderTmuxBlock("/Users/test/.local/bin/codex-auto");
  const result = installTmuxBlock(existing, block);
  expect(result.indexOf("# BEGIN codex-auto statusline")).toBeLessThan(result.indexOf('run "~/.config/tmux/plugins/tpm/tpm"'));
  expect(result).toContain("set -g @plugin 'tmux-plugins/tpm'");
  expect(result.match(/BEGIN codex-auto statusline/g)).toHaveLength(1);
});

it("replaces the managed block idempotently", () => {
  const first = installTmuxBlock(existing, renderTmuxBlock("/old/codex-auto"));
  const second = installTmuxBlock(first, renderTmuxBlock("/new/codex-auto"));
  expect(second).not.toContain("/old/codex-auto");
  expect(second.match(/BEGIN codex-auto statusline/g)).toHaveLength(1);
});

it("uninstalls only the managed block", () => {
  const installed = installTmuxBlock(existing, renderTmuxBlock("/bin/codex-auto"));
  expect(removeTmuxBlock(installed)).toBe(existing);
});
```

- [ ] **Step 2: Run installer tests and verify red state**

Run:

```bash
pnpm --filter @codex-auto/cli run test -- test/tmux-config.test.ts
```

Expected: FAIL because `tmux-config.ts` does not exist.

- [ ] **Step 3: Implement managed block transforms and atomic file writes**

Create constants and pure transforms:

```ts
export const TMUX_BLOCK_START = "# BEGIN codex-auto statusline";
export const TMUX_BLOCK_END = "# END codex-auto statusline";

export function renderTmuxBlock(executable: string): string {
  const command = `${shellQuote(executable)} statusline --format tmux --cache-ttl 10 --cwd #{q:pane_current_path} --width #{client_width}`;
  return [
    TMUX_BLOCK_START,
    "set -g status on",
    "set -g status-position bottom",
    "set -g status-interval 10",
    "set -g status-right-length 220",
    `set -g status-right "#(${command})"`,
    TMUX_BLOCK_END,
  ].join("\n");
}
```

`installTmuxBlock(source, block)` first removes an existing managed block, then inserts the new block immediately before the first TPM run line matching `/^\s*run(?:-shell)?\s+.*tpm/m`; if no line matches, append the block. `removeTmuxBlock()` removes the markers, contents, and one adjacent blank line while preserving the rest byte-for-byte.

Add `writeTmuxConfig(path, transformed)` using `mkdir`, a unique temporary file, and `rename`.

- [ ] **Step 4: Add CLI install/uninstall tests**

Use a temporary config and pass `--no-reload` plus an explicit executable:

```ts
it("installs and uninstalls the tmux block", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-auto-tmux-"));
  const configPath = join(dir, ".tmux.conf");
  const existing = `set -g @plugin 'tmux-plugins/tpm'\nrun "~/.config/tmux/plugins/tpm/tpm"\n`;
  await writeFile(configPath, existing, "utf8");
  expect(await runCli([
    "tmux", "install", "--config", configPath,
    "--executable", "/usr/local/bin/codex-auto", "--no-reload",
  ], capture().io)).toBe(0);
  expect(await readFile(configPath, "utf8")).toContain("/usr/local/bin/codex-auto");
  expect(await runCli(["tmux", "uninstall", "--config", configPath, "--no-reload"], capture().io)).toBe(0);
  expect(await readFile(configPath, "utf8")).toBe(existing);
});
```

- [ ] **Step 5: Register `tmux install` and `tmux uninstall`**

Add a parent `tmux` command. Both subcommands default `--config` to `~/.tmux.conf`; install defaults `--executable` to the absolute current CLI entry path. Unless `--no-reload` is set, call:

```ts
await execFileAsync("tmux", ["source-file", options.config], { timeout: 5_000 });
```

If reload fails because no tmux server is running, keep the config write, print `installed; start tmux to load the statusline`, and exit 0. Other write failures return code 1 with a path-specific diagnostic.

- [ ] **Step 6: Run installer and complete CLI suites**

Run:

```bash
pnpm --filter @codex-auto/cli run test -- test/tmux-config.test.ts test/cli.test.ts
pnpm --filter @codex-auto/cli run test
```

Expected: all CLI tests pass and the fixture TPM line remains last.

- [ ] **Step 7: Commit installer behavior**

```bash
git add packages/cli/src/tmux-config.ts packages/cli/test/tmux-config.test.ts packages/cli/src/cli.ts packages/cli/test/cli.test.ts
git commit -m "feat: add tmux statusline installer"
```

---

### Task 4: Documentation, Installation, And Live Verification

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify outside repository through the tested installer: `~/.tmux.conf`

**Interfaces:**
- Consumes: built `packages/cli/dist/bin.mjs`, globally linked `~/.local/bin/codex-auto`, and `codex-auto tmux install`.
- Produces: installed tmux status configuration and verified bottom-bar output.

- [ ] **Step 1: Document installation, output formats, cache, and rollback**

Add these user commands to the root README and CLI README:

```bash
pnpm build
codex-auto tmux install
tmux source-file ~/.tmux.conf
codex-auto tmux uninstall
```

Document that Codex must run inside tmux, the bar follows the active pane cwd, refreshes every 10 seconds, and tmux mode is distinct from Codex's native `/statusline` and the Codex Insights MCP plugin.

- [ ] **Step 2: Run the full deterministic verification gate**

Run:

```bash
pnpm check
python3 /Users/liyanchao/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py packages/plugins/codex-insights
git diff --check
```

Expected: lint has zero warnings/errors, typecheck passes, all Vitest tests pass, all tsdown builds succeed, plugin validation passes, and `git diff --check` has no output.

- [ ] **Step 3: Verify bundled CLI output before touching user config**

Run:

```bash
node packages/cli/dist/bin.mjs statusline --format tmux --width 160 --cache-ttl 10 --cwd /Users/liyanchao/code/open-source/codex-auto
```

Expected: output contains tmux `#[fg=...]` markup, `main`, `ctx`, `time`, and `speed`, and contains no ANSI escape bytes.

- [ ] **Step 4: Install with the tested command and reload tmux**

Run with user approval because it writes outside the workspace:

```bash
codex-auto tmux install --config /Users/liyanchao/.tmux.conf --executable /Users/liyanchao/.local/bin/codex-auto
```

Expected: exactly one managed block appears before `run "/Users/liyanchao/.config/tmux/plugins/tpm/tpm"` and existing agent-status settings are unchanged.

- [ ] **Step 5: Start an isolated tmux server and inspect effective settings**

Run:

```bash
tmux -L codex-auto-verify -f /Users/liyanchao/.tmux.conf new-session -d -s codex-auto-verify -c /Users/liyanchao/code/open-source/codex-auto
tmux -L codex-auto-verify show-options -g status-position
tmux -L codex-auto-verify show-options -g status-interval
tmux -L codex-auto-verify show-options -g status-right
tmux -L codex-auto-verify kill-server
```

Expected: `status-position bottom`, `status-interval 10`, and `status-right` contains the absolute `codex-auto` path plus `pane_current_path` and `client_width`.

- [ ] **Step 6: Verify live data and repository state**

Run:

```bash
codex-auto statusline --format plain --cwd /Users/liyanchao/code/open-source/codex-auto --width 160
git status --short
```

Expected: the live line includes `gpt-5.6-sol`, `main`, current context, time, and speed; Git status contains only intended documentation changes before the final commit.

- [ ] **Step 7: Commit documentation and handoff**

```bash
git add README.md packages/cli/README.md
git commit -m "docs: document tmux statusline setup"
```

Report the installed managed block, the live rendered line, the full test count, and `codex-auto tmux uninstall` as the rollback command.
