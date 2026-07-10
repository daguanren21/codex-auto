# Global cmux Dock Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a globally installable cmux right-sidebar Dock dashboard that shows live `codex-auto` status without tmux.

**Architecture:** Core owns conversion from `CurrentStatusSnapshot` to the compact status snapshot and a deterministic multi-line Dock renderer. The CLI owns an abortable refresh loop plus an idempotent JSON transformer for `~/.config/cmux/dock.json`; cmux launches the watcher per workspace and owns its process lifetime.

**Tech Stack:** Node.js 22+, TypeScript 6, pnpm 10.33.2, Commander 15, picocolors, Vitest 4, oxlint, tsdown, and cmux 0.64+ Dock controls.

## Global Constraints

- The default refresh interval is exactly 10 seconds and `--interval` accepts only positive finite numbers.
- The managed global Dock control id is exactly `codex-auto` and the default config path is `~/.config/cmux/dock.json`.
- Preserve unknown top-level Dock config fields and every control not owned by `codex-auto`.
- Do not modify `~/.tmux.conf`, remove the tmux integration, add a launch agent, or run a global daemon.
- Normal Dock rendering must not require a running cmux app, cmux socket, credentials, private paths, or workspace ids in config.
- Use the existing 10-second status cache, metric thresholds, ANSI color policy, and atomic sibling-file rename pattern.
- Add no runtime dependency.

---

## File Structure

- Create `packages/core/src/dock.ts`: deterministic multi-line Dock rendering only.
- Create `packages/core/test/dock.test.ts`: complete, idle, color, and threshold rendering coverage.
- Modify `packages/core/src/status.ts`: move the existing CLI snapshot conversion into core as `toStatusLineSnapshot`.
- Modify `packages/core/src/index.ts`: export the converter and Dock renderer APIs.
- Create `packages/cli/src/dock-runner.ts`: one-shot and abortable repeated frame orchestration.
- Create `packages/cli/test/dock-runner.test.ts`: immediate render, replacement, transient failure, and abort coverage.
- Create `packages/cli/src/shell.ts`: shared POSIX single-quote escaping for generated commands.
- Modify `packages/cli/src/tmux-config.ts`: consume the shared quoting helper without behavior changes.
- Create `packages/cli/src/cmux-config.ts`: parse, transform, serialize, and atomically write Dock JSON.
- Create `packages/cli/test/cmux-config.test.ts`: preservation, idempotence, malformed input, quoting, and uninstall coverage.
- Modify `packages/cli/src/cli.ts`: register `dock` and `cmux install|uninstall`, signals, cache loading, and diagnostics.
- Modify `packages/cli/test/cli.test.ts`: command-level one-shot, idle, validation, install, and uninstall coverage.
- Modify `README.md` and `packages/cli/README.md`: document global cmux setup, reload, usage, and rollback.

---

### Task 1: Core Dock Snapshot And Renderer

**Files:**
- Create: `packages/core/src/dock.ts`
- Create: `packages/core/test/dock.test.ts`
- Modify: `packages/core/src/status.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/cli.ts`

**Interfaces:**
- Consumes: `CurrentStatusSnapshot`, `StatusLineSnapshot`, `classifyMetric()`, and `formatTokens()`.
- Produces: `toStatusLineSnapshot(snapshot: CurrentStatusSnapshot): StatusLineSnapshot` and `renderDockStatus(snapshot: StatusLineSnapshot | null, options: { color: boolean }): string`.

- [ ] **Step 1: Write failing Dock renderer tests**

Create `packages/core/test/dock.test.ts`:

```typescript
import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vitest";

import { renderDockStatus, type StatusLineSnapshot } from "../src/index.js";

const snapshot: StatusLineSnapshot = {
  model: { name: "gpt-5.6-sol", effort: "high" },
  git: { branch: "main", dirty: true, ahead: 2, behind: 1 },
  context: { usedTokens: 162_991, maxTokens: 353_400, ratio: 0.461 },
  cacheRatio: 0.995,
  performance: { elapsedSeconds: 32.5, outputTokensPerSecond: 19.8 },
  cumulativeTokens: 3_733_101,
};

describe("renderDockStatus", () => {
  it("renders every available metric in a narrow multi-line dashboard", () => {
    expect(renderDockStatus(snapshot, { color: false })).toBe([
      "Codex Insights",
      "Model     gpt-5.6-sol high",
      "Git       main* +2/-1",
      "Context   163k / 353.4k  46.1%",
      "Cache     99.5%",
      "Time      32.5s",
      "Speed     19.8 tok/s",
      "Total     3.73m",
    ].join("\n"));
  });

  it("renders a quiet idle frame when no matching session exists", () => {
    expect(renderDockStatus(null, { color: false })).toBe("Codex Insights\nNo active Codex session");
  });

  it.each([
    [0.7, "warn", "\u001B[33m"], "70.0%"],
    [0.9, "high", "\u001B[31m", "90.0%"],
  ] as const)("colors %s context as %s", (ratio, marker, escape, percentage) => {
    const rendered = renderDockStatus(
      { ...snapshot, context: { usedTokens: 300, maxTokens: 400, ratio } },
      { color: true },
    );

    expect(rendered).toContain(escape);
    expect(stripVTControlCharacters(rendered)).toContain(`${percentage} ${marker}`);
  });

  it("preserves the same text when ANSI color is enabled", () => {
    expect(stripVTControlCharacters(renderDockStatus(snapshot, { color: true })))
      .toBe(renderDockStatus(snapshot, { color: false }));
  });
});
```

- [ ] **Step 2: Run the focused test to verify the red state**

Run:

```bash
rtk pnpm --filter @codex-auto/core test -- test/dock.test.ts
```

Expected: FAIL because `renderDockStatus` is not exported.

- [ ] **Step 3: Move snapshot conversion into core**

Add this import and function to `packages/core/src/status.ts`:

```typescript
import type { StatusLineSnapshot } from "./statusline.js";

export function toStatusLineSnapshot(snapshot: CurrentStatusSnapshot): StatusLineSnapshot {
  return {
    ...(snapshot.model
      ? { model: { name: snapshot.model.name, ...(snapshot.model.effort ? { effort: snapshot.model.effort } : {}) } }
      : {}),
    ...(snapshot.git ? { git: snapshot.git } : {}),
    context: snapshot.context,
    cacheRatio: snapshot.cacheRatio,
    ...(snapshot.performance
      ? {
          performance: {
            elapsedSeconds: snapshot.performance.elapsedSeconds,
            ...(snapshot.performance.outputTokensPerSecond !== undefined
              ? { outputTokensPerSecond: snapshot.performance.outputTokensPerSecond }
              : {}),
          },
        }
      : {}),
    cumulativeTokens: snapshot.cumulativeTokens,
  };
}
```

Export it from `packages/core/src/index.ts`:

```typescript
export { getCurrentStatus, toStatusLineSnapshot } from "./status.js";
```

In `packages/cli/src/cli.ts`, import `toStatusLineSnapshot`, delete the private `asStatusLine()` function, and replace all three `asStatusLine(snapshot)` calls with `toStatusLineSnapshot(snapshot)`.

- [ ] **Step 4: Implement the minimal Dock renderer**

Create `packages/core/src/dock.ts`:

```typescript
import pc from "picocolors";

import { formatTokens } from "./format.js";
import { classifyMetric, type MetricLevel } from "./metrics.js";
import type { StatusLineSnapshot } from "./statusline.js";

export interface DockStatusOptions {
  color: boolean;
}

function metricColor(
  value: string,
  level: MetricLevel,
  colors: ReturnType<typeof pc.createColors>,
): string {
  if (level === "high") return colors.bold(colors.red(value));
  if (level === "medium") return colors.yellow(value);
  if (level === "neutral") return colors.dim(value);
  return colors.green(value);
}

function gitText(git: NonNullable<StatusLineSnapshot["git"]>): string {
  const sync = `${git.ahead ? ` +${git.ahead}` : ""}${git.behind ? `/-${git.behind}` : ""}`;
  return `${git.branch}${git.dirty ? "*" : ""}${sync}`;
}

export function renderDockStatus(
  snapshot: StatusLineSnapshot | null,
  options: DockStatusOptions,
): string {
  const colors = pc.createColors(options.color);
  const line = (label: string, value: string) => `${label.padEnd(10)}${value}`;
  const lines = [colors.bold(colors.cyan("Codex Insights"))];
  if (!snapshot) return `${lines[0]}\n${colors.dim("No active Codex session")}`;

  if (snapshot.model) {
    lines.push(line("Model", colors.blue([snapshot.model.name, snapshot.model.effort].filter(Boolean).join(" "))));
  }
  if (snapshot.git) lines.push(line("Git", colors.magenta(gitText(snapshot.git))));
  if (snapshot.context) {
    const level = classifyMetric("context", snapshot.context.ratio);
    const marker = level === "high" ? " high" : level === "medium" ? " warn" : "";
    const value = `${formatTokens(snapshot.context.usedTokens)} / ${formatTokens(snapshot.context.maxTokens)}  ${(snapshot.context.ratio * 100).toFixed(1)}%${marker}`;
    lines.push(line("Context", metricColor(value, level, colors)));
  }
  if (snapshot.cacheRatio !== undefined) {
    const value = `${(snapshot.cacheRatio * 100).toFixed(1)}%`;
    lines.push(line("Cache", metricColor(value, classifyMetric("cache", snapshot.cacheRatio), colors)));
  }
  if (snapshot.performance?.elapsedSeconds !== undefined) {
    const value = `${snapshot.performance.elapsedSeconds.toFixed(1)}s`;
    lines.push(line("Time", metricColor(value, classifyMetric("duration", snapshot.performance.elapsedSeconds), colors)));
  }
  if (snapshot.performance?.outputTokensPerSecond !== undefined) {
    const value = `${snapshot.performance.outputTokensPerSecond.toFixed(1)} tok/s`;
    lines.push(line("Speed", metricColor(value, classifyMetric("speed", snapshot.performance.outputTokensPerSecond), colors)));
  }
  if (snapshot.cumulativeTokens !== undefined) {
    lines.push(line("Total", colors.cyan(formatTokens(snapshot.cumulativeTokens))));
  }
  return lines.join("\n");
}
```

Export it from `packages/core/src/index.ts`:

```typescript
export { renderDockStatus } from "./dock.js";
export type { DockStatusOptions } from "./dock.js";
```

- [ ] **Step 5: Run focused and regression tests**

Run:

```bash
rtk pnpm --filter @codex-auto/core test -- test/dock.test.ts test/statusline.test.ts
rtk pnpm --filter @codex-auto/cli test -- test/cli.test.ts
rtk pnpm typecheck
```

Expected: all commands PASS; existing statusline and CLI output remain unchanged.

- [ ] **Step 6: Commit the renderer**

```bash
rtk git add packages/core/src/dock.ts packages/core/src/status.ts packages/core/src/index.ts packages/core/test/dock.test.ts packages/cli/src/cli.ts
rtk git commit -m "feat: add cmux dock status renderer"
```

---

### Task 2: Abortable Dock Refresh Loop

**Files:**
- Create: `packages/cli/src/dock-runner.ts`
- Create: `packages/cli/test/dock-runner.test.ts`

**Interfaces:**
- Consumes: `StatusLineSnapshot | null` from an injected async loader.
- Produces: `runDock(options: DockRunOptions, dependencies: DockRunDependencies): Promise<"ok" | "error">` and `waitForDelay(milliseconds: number, signal?: AbortSignal): Promise<void>`.

- [ ] **Step 1: Write failing refresh-loop tests**

Create `packages/cli/test/dock-runner.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { runDock } from "../src/dock-runner.js";

const snapshot = { context: { usedTokens: 1, maxTokens: 2, ratio: 0.5 } };

describe("runDock", () => {
  it("renders one frame immediately in one-shot mode", async () => {
    const writes: string[] = [];
    const result = await runDock(
      { watch: false, intervalMs: 10_000 },
      {
        load: async () => snapshot,
        render: () => "frame",
        write: (value) => writes.push(value),
        wait: async () => undefined,
      },
    );

    expect(result).toBe("ok");
    expect(writes).toEqual(["frame\n"]);
  });

  it("replaces frames until its abort signal fires", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    let loads = 0;
    let waits = 0;
    await runDock(
      { watch: true, intervalMs: 10_000, signal: controller.signal },
      {
        load: async () => {
          loads += 1;
          return snapshot;
        },
        render: () => `frame-${loads}`,
        write: (value) => writes.push(value),
        wait: async () => {
          waits += 1;
          if (waits === 2) controller.abort();
        },
      },
    );

    expect(loads).toBe(2);
    expect(writes).toEqual(["frame-1\n", "\u001B[2J\u001B[Hframe-2\n"]);
  });

  it("shows one concise error frame and retries on the next interval", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    let loads = 0;
    await runDock(
      { watch: true, intervalMs: 10_000, signal: controller.signal },
      {
        load: async () => {
          loads += 1;
          if (loads === 1) throw new Error("rollout unavailable\nextra detail");
          return snapshot;
        },
        render: () => "recovered",
        write: (value) => writes.push(value),
        wait: async () => {
          if (loads === 2) controller.abort();
        },
      },
    );

    expect(writes[0]).toBe("Codex Insights\nUnavailable: rollout unavailable\n");
    expect(writes[1]).toBe("\u001B[2J\u001B[Hrecovered\n");
  });
});
```

- [ ] **Step 2: Run the focused test to verify the red state**

```bash
rtk pnpm --filter @codex-auto/cli test -- test/dock-runner.test.ts
```

Expected: FAIL because `dock-runner.ts` does not exist.

- [ ] **Step 3: Implement the refresh loop and abortable wait**

Create `packages/cli/src/dock-runner.ts`:

```typescript
import type { StatusLineSnapshot } from "@codex-auto/core";

export interface DockRunOptions {
  watch: boolean;
  intervalMs: number;
  signal?: AbortSignal;
}

export interface DockRunDependencies {
  load(): Promise<StatusLineSnapshot | null>;
  render(snapshot: StatusLineSnapshot | null): string;
  write(value: string): void;
  wait(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0] || "unknown error";
}

export function waitForDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function runDock(
  options: DockRunOptions,
  dependencies: DockRunDependencies,
): Promise<"ok" | "error"> {
  let first = true;
  do {
    let frame: string;
    let result: "ok" | "error" = "ok";
    try {
      frame = dependencies.render(await dependencies.load());
    } catch (error) {
      frame = `Codex Insights\nUnavailable: ${conciseError(error)}`;
      result = "error";
    }
    dependencies.write(`${first ? "" : "\u001B[2J\u001B[H"}${frame}\n`);
    first = false;
    if (!options.watch) return result;
    await dependencies.wait(options.intervalMs, options.signal);
  } while (!options.signal?.aborted);
  return "ok";
}
```

- [ ] **Step 4: Run tests and type checking**

```bash
rtk pnpm --filter @codex-auto/cli test -- test/dock-runner.test.ts
rtk pnpm --filter @codex-auto/cli typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the refresh loop**

```bash
rtk git add packages/cli/src/dock-runner.ts packages/cli/test/dock-runner.test.ts
rtk git commit -m "feat: add abortable dock refresh loop"
```

---

### Task 3: Global cmux Dock Config Transform

**Files:**
- Create: `packages/cli/src/shell.ts`
- Create: `packages/cli/src/cmux-config.ts`
- Create: `packages/cli/test/cmux-config.test.ts`
- Modify: `packages/cli/src/tmux-config.ts`
- Test: `packages/cli/test/tmux-config.test.ts`

**Interfaces:**
- Consumes: an absolute executable path and an existing JSON string.
- Produces: `renderCmuxControl()`, `installCmuxControl()`, `removeCmuxControl()`, `writeCmuxDockConfig()`, and shared `shellQuote()`.

- [ ] **Step 1: Write failing config transform tests**

Create `packages/cli/test/cmux-config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  installCmuxControl,
  removeCmuxControl,
  renderCmuxControl,
} from "../src/cmux-config.js";

const existing = `${JSON.stringify({
  version: 1,
  controls: [{ id: "tests", title: "Tests", command: "pnpm test", height: 180 }],
}, null, 2)}\n`;

describe("cmux Dock config transforms", () => {
  it("adds one managed global control and preserves unknown data", () => {
    const result = JSON.parse(installCmuxControl(existing, renderCmuxControl("/usr/local/bin/codex-auto")));

    expect(result.version).toBe(1);
    expect(result.controls).toContainEqual(expect.objectContaining({ id: "tests" }));
    expect(result.controls).toContainEqual({
      id: "codex-auto",
      title: "Codex Insights",
      command: "'/usr/local/bin/codex-auto' dock --watch",
      height: 260,
    });
  });

  it("replaces the managed control idempotently", () => {
    const first = installCmuxControl(existing, renderCmuxControl("/old/codex-auto"));
    const second = installCmuxControl(first, renderCmuxControl("/new/codex-auto"));
    const controls = JSON.parse(second).controls;

    expect(controls.filter((control: { id?: string }) => control.id === "codex-auto")).toHaveLength(1);
    expect(second).not.toContain("/old/codex-auto");
  });

  it("quotes executable paths containing apostrophes", () => {
    expect(renderCmuxControl("/Users/test/O'Brien/codex-auto").command)
      .toBe("'/Users/test/O'\"'\"'Brien/codex-auto' dock --watch");
  });

  it("removes only the managed control and preserves an absent file", () => {
    const installed = installCmuxControl(existing, renderCmuxControl("/bin/codex-auto"));

    expect(JSON.parse(removeCmuxControl(installed))).toEqual(JSON.parse(existing));
    expect(removeCmuxControl("")).toBe("");
  });

  it("rejects malformed JSON and non-array controls", () => {
    expect(() => installCmuxControl("not json", renderCmuxControl("/bin/codex-auto"))).toThrow();
    expect(() => installCmuxControl('{"controls":{}}', renderCmuxControl("/bin/codex-auto")))
      .toThrow("controls must be an array");
  });
});
```

- [ ] **Step 2: Run the focused test to verify the red state**

```bash
rtk pnpm --filter @codex-auto/cli test -- test/cmux-config.test.ts
```

Expected: FAIL because `cmux-config.ts` does not exist.

- [ ] **Step 3: Extract shared shell quoting without changing tmux output**

Create `packages/cli/src/shell.ts`:

```typescript
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
```

In `packages/cli/src/tmux-config.ts`, import `shellQuote` from `./shell.js` and delete its private `shellQuote()` function.

- [ ] **Step 4: Implement structured Dock JSON transforms and atomic writes**

Create `packages/cli/src/cmux-config.ts`:

```typescript
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { shellQuote } from "./shell.js";

export const CMUX_CONTROL_ID = "codex-auto";

export interface CmuxDockControl {
  id: string;
  title: string;
  command: string;
  height: number;
  [key: string]: unknown;
}

interface CmuxDockConfig {
  controls: unknown[];
  [key: string]: unknown;
}

function parseCmuxDockConfig(source: string): CmuxDockConfig {
  if (!source.trim()) return { controls: [] };
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Dock config must be a JSON object");
  }
  const config = parsed as Record<string, unknown>;
  if (config.controls !== undefined && !Array.isArray(config.controls)) {
    throw new Error("Dock config controls must be an array");
  }
  return { ...config, controls: (config.controls as unknown[] | undefined) ?? [] };
}

function isManagedControl(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === CMUX_CONTROL_ID);
}

function serialize(config: CmuxDockConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function renderCmuxControl(executable: string): CmuxDockControl {
  return {
    id: CMUX_CONTROL_ID,
    title: "Codex Insights",
    command: `${shellQuote(resolve(executable))} dock --watch`,
    height: 260,
  };
}

export function installCmuxControl(source: string, control: CmuxDockControl): string {
  const config = parseCmuxDockConfig(source);
  return serialize({
    ...config,
    controls: [...config.controls.filter((candidate) => !isManagedControl(candidate)), control],
  });
}

export function removeCmuxControl(source: string): string {
  if (!source.trim()) return source;
  const config = parseCmuxDockConfig(source);
  const controls = config.controls.filter((candidate) => !isManagedControl(candidate));
  if (controls.length === config.controls.length) return source;
  return serialize({ ...config, controls });
}

export async function writeCmuxDockConfig(path: string, transformed: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, transformed, "utf8");
  await rename(temporaryPath, path);
}
```

- [ ] **Step 5: Run focused and tmux regression tests**

```bash
rtk pnpm --filter @codex-auto/cli test -- test/cmux-config.test.ts test/tmux-config.test.ts
rtk pnpm --filter @codex-auto/cli typecheck
```

Expected: PASS; the tmux managed block remains byte-for-byte compatible.

- [ ] **Step 6: Commit the config adapter**

```bash
rtk git add packages/cli/src/shell.ts packages/cli/src/cmux-config.ts packages/cli/src/tmux-config.ts packages/cli/test/cmux-config.test.ts
rtk git commit -m "feat: add cmux dock config adapter"
```

---

### Task 4: CLI Commands And Lifecycle Wiring

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `renderDockStatus()`, `toStatusLineSnapshot()`, `readCachedStatusLine()`, `runDock()`, and cmux config transforms.
- Produces: `codex-auto dock`, `codex-auto dock --watch`, and `codex-auto cmux install|uninstall`.

- [ ] **Step 1: Add failing command-level tests**

Append these suites to `packages/cli/test/cli.test.ts`:

```typescript
describe("dock", () => {
  it("renders one complete Dock frame without ANSI", async () => {
    const output = capture();
    const code = await runCli(
      [
        "dock", "--codex-home", codexHome, "--cwd", "/workspace/project",
        "--color", "never", "--cache-ttl", "0",
      ],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(output.stdout.join("")).toContain("Codex Insights\nModel     gpt-5.6-sol high\n");
    expect(output.stdout.join("")).toContain("Context   163k / 353.4k  46.1%\n");
  });

  it("renders an idle frame successfully", async () => {
    const output = capture();
    const emptyHome = await mkdtemp(join(tmpdir(), "codex-auto-dock-empty-"));
    const code = await runCli(
      [
        "dock", "--codex-home", emptyHome, "--cwd", "/missing",
        "--color", "never", "--cache-ttl", "0",
      ],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stdout.join("")).toBe("Codex Insights\nNo active Codex session\n");
  });

  it.each(["0", "-1", "not-a-number"])("rejects interval %s", async (interval) => {
    expect(await runCli(["dock", "--watch", "--interval", interval], capture().io)).toBe(2);
  });
});

describe("cmux config", () => {
  it("installs and uninstalls only the global Dock control", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auto-cmux-"));
    const configPath = join(dir, "dock.json");
    const existing = `${JSON.stringify({ controls: [{ id: "tests", command: "pnpm test" }] }, null, 2)}\n`;
    await writeFile(configPath, existing, "utf8");

    expect(await runCli([
      "cmux", "install", "--config", configPath, "--executable", "/usr/local/bin/codex-auto",
    ], capture().io)).toBe(0);
    expect(await readFile(configPath, "utf8")).toContain("'/usr/local/bin/codex-auto' dock --watch");

    expect(await runCli(["cmux", "uninstall", "--config", configPath], capture().io)).toBe(0);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(JSON.parse(existing));
  });

  it("leaves malformed config unchanged and reports its path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auto-cmux-invalid-"));
    const configPath = join(dir, "dock.json");
    await writeFile(configPath, "not json\n", "utf8");
    const output = capture();

    expect(await runCli(["cmux", "install", "--config", configPath], output.io)).toBe(1);
    expect(await readFile(configPath, "utf8")).toBe("not json\n");
    expect(output.stderr.join("")).toContain(`Failed to install cmux Dock config ${configPath}`);
  });
});
```

- [ ] **Step 2: Run CLI tests to verify the red state**

```bash
rtk pnpm --filter @codex-auto/cli test -- test/cli.test.ts
```

Expected: FAIL because `dock` and `cmux` are unknown commands.

- [ ] **Step 3: Add imports, option types, and positive interval validation**

Add these core imports in `packages/cli/src/cli.ts`:

```typescript
renderDockStatus,
toStatusLineSnapshot,
type StatusLineSnapshot,
```

Add these local imports:

```typescript
import {
  installCmuxControl,
  removeCmuxControl,
  renderCmuxControl,
  writeCmuxDockConfig,
} from "./cmux-config.js";
import { runDock, waitForDelay } from "./dock-runner.js";
```

Add the option type and validator:

```typescript
interface DockCliOptions extends StatusOptions {
  watch?: boolean;
  interval: string;
  cacheTtl: string;
  stateDir: string;
}

function parsePositiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}
```

- [ ] **Step 4: Register one-shot and watch Dock rendering**

Insert this command before `statusline` registration in `runCli()`:

```typescript
addStatusOptions(program.command("dock"), false)
  .option("--watch", "Refresh continuously for a cmux Dock control")
  .option("--interval <seconds>", "Refresh interval", "10")
  .option("--cache-ttl <seconds>", "Status cache lifetime", "10")
  .option("--state-dir <path>", "State directory", join(homedir(), ".codex-auto"))
  .action(async (options: DockCliOptions) => {
    const intervalMs = parsePositiveNumber(options.interval, "--interval") * 1_000;
    const cacheTtl = parseNonNegativeNumber(options.cacheTtl, "--cache-ttl");
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (options.watch) {
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    }
    try {
      const result = await runDock(
        { watch: Boolean(options.watch), intervalMs, signal: controller.signal },
        {
          load: async (): Promise<StatusLineSnapshot | null> => readCachedStatusLine(
            {
              cacheDir: join(options.stateDir, "statusline-cache"),
              codexHome: options.codexHome,
              cwd: options.cwd,
              ttlSeconds: cacheTtl,
            },
            async () => {
              const current = await getCurrentStatus({ codexHome: options.codexHome, cwd: options.cwd });
              return current ? toStatusLineSnapshot(current) : null;
            },
          ),
          render: (snapshot) => renderDockStatus(snapshot, { color: colorEnabled(options.color, io) }),
          write: io.stdout,
          wait: waitForDelay,
        },
      );
      if (!options.watch && result === "error") exitCode = 1;
    } finally {
      if (options.watch) {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    }
  });
```

- [ ] **Step 5: Register global cmux install and uninstall**

Insert this command group after the existing `tmux` group:

```typescript
const cmux = program.command("cmux");
cmux
  .command("install")
  .option("--config <path>", "Global cmux Dock config path", join(homedir(), ".config", "cmux", "dock.json"))
  .option("--executable <path>", "Absolute codex-auto executable", resolve(process.argv[1] ?? "codex-auto"))
  .action(async (options: { config: string; executable: string }) => {
    try {
      const source = await readOptionalFile(options.config);
      const transformed = installCmuxControl(source, renderCmuxControl(options.executable));
      await writeCmuxDockConfig(options.config, transformed);
      io.stdout(`installed ${options.config}\nReload an open cmux Dock with its Reload Dock action.\n`);
    } catch (error) {
      io.stderr(`Failed to install cmux Dock config ${options.config}: ${(error as Error).message}\n`);
      exitCode = 1;
    }
  });
cmux
  .command("uninstall")
  .option("--config <path>", "Global cmux Dock config path", join(homedir(), ".config", "cmux", "dock.json"))
  .action(async (options: { config: string }) => {
    try {
      const source = await readOptionalFile(options.config);
      const transformed = removeCmuxControl(source);
      if (transformed !== source) await writeCmuxDockConfig(options.config, transformed);
      io.stdout(`uninstalled ${options.config}\nReload an open cmux Dock with its Reload Dock action.\n`);
    } catch (error) {
      io.stderr(`Failed to uninstall cmux Dock config ${options.config}: ${(error as Error).message}\n`);
      exitCode = 1;
    }
  });
```

- [ ] **Step 6: Run CLI and complete project checks**

```bash
rtk pnpm --filter @codex-auto/cli test -- test/cli.test.ts test/dock-runner.test.ts test/cmux-config.test.ts test/tmux-config.test.ts
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test
rtk pnpm build
```

Expected: every command exits 0 and all existing tmux behavior remains green.

- [ ] **Step 7: Commit the CLI surface**

```bash
rtk git add packages/cli/src/cli.ts packages/cli/test/cli.test.ts
rtk git commit -m "feat: add global cmux dock commands"
```

---

### Task 5: Documentation And Real cmux Verification

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify outside the repository through the tested installer: `~/.config/cmux/dock.json`

**Interfaces:**
- Consumes: built `codex-auto dock` and `codex-auto cmux install|uninstall` commands.
- Produces: documented global installation, reload guidance, rollback, and a verified live Dock control.

- [ ] **Step 1: Add the global cmux instructions to the root README**

Insert this section immediately before `### Tmux Status Bar` in `README.md`:

````markdown
### cmux Dock

Install one global right-sidebar Dock control for every cmux workspace:

```bash
pnpm build
codex-auto cmux install
```

Open the cmux right sidebar in Dock mode. If the Dock was already open during installation, use its **Reload Dock** action once. The control inherits each workspace working directory, renders immediately, and refreshes model, Git, context, cache, timing, speed, and cumulative tokens every 10 seconds. It does not require tmux, a cmux socket, or a global daemon.

Render one deterministic frame for troubleshooting:

```bash
codex-auto dock --color never
```

Remove only the managed `codex-auto` control with:

```bash
codex-auto cmux uninstall
```
````

- [ ] **Step 2: Add compact CLI package documentation**

Insert this section before `## Tmux` in `packages/cli/README.md`:

````markdown
## cmux Dock

Install or remove the global right-sidebar control with:

```bash
codex-auto cmux install
codex-auto cmux uninstall
```

The installer idempotently manages the `codex-auto` entry in `~/.config/cmux/dock.json` and preserves all other controls. Use cmux's **Reload Dock** action if the sidebar was already open. The managed command is `codex-auto dock --watch`; one-shot `codex-auto dock` is available for diagnostics.
````

- [ ] **Step 3: Run deterministic documentation and project verification**

```bash
rtk git diff --check
rtk pnpm check
rtk node packages/cli/dist/bin.mjs dock --codex-home packages/core/test/fixtures/codex-home --cwd /workspace/project --color never
```

Expected: `git diff --check` and `pnpm check` exit 0. The Dock command prints `Codex Insights`, `gpt-5.6-sol high`, `Context`, `Cache`, `Time`, `Speed`, and `Total` on separate lines with no ANSI bytes.

- [ ] **Step 4: Back up an existing personal Dock config before the live install**

First run:

```bash
rtk ls -l ~/.config/cmux/dock.json
```

If the file exists, run this as a separate command after obtaining filesystem approval:

```bash
rtk cp ~/.config/cmux/dock.json /tmp/codex-auto-cmux-dock.pre-install.json
```

Expected: either the source is absent, or the backup exists at `/tmp/codex-auto-cmux-dock.pre-install.json` before installation.

- [ ] **Step 5: Install and inspect the real global control**

```bash
rtk codex-auto cmux install
rtk sed -n '1,220p' ~/.config/cmux/dock.json
rtk cmux right-sidebar dock
```

Expected: the JSON contains exactly one `codex-auto` control whose command uses an absolute executable path and `dock --watch`; unrelated controls remain present; cmux switches the active workspace's right sidebar to Dock mode.

Open or reload cmux Dock and verify two workspaces: the project workspace shows its matching Codex metrics, while a workspace without a matching rollout shows `No active Codex session`. Closing or reloading the Dock must terminate the old control process instead of leaving a global watcher.

- [ ] **Step 6: Commit documentation**

```bash
rtk git add README.md packages/cli/README.md
rtk git commit -m "docs: document cmux dock integration"
```

- [ ] **Step 7: Perform final branch verification**

```bash
rtk git status --short --branch
rtk git log -5 --oneline
rtk pnpm check
```

Expected: only pre-existing ignored or explicitly acknowledged local artifacts remain; the five feature commits are visible; `pnpm check` exits 0.
