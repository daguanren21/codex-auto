import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  acquireWatcherLock,
  buildResumeCandidate,
  classifyMetric,
  formatTokens,
  getCurrentStatus,
  listSessions,
  readResumeState,
  reconcileResumeJobs,
  renderStatusLine,
  runDueResumeJobs,
  saveResumeState,
  type CurrentStatusSnapshot,
} from "@codex-auto/core";
import { Command } from "commander";
import pc from "picocolors";

import { launchResumeTerminal } from "./terminal.js";

const execFileAsync = promisify(execFile);

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
  isTTY: boolean;
  columns: number;
  env: Record<string, string | undefined>;
}

interface StatusOptions {
  codexHome: string;
  cwd: string;
  color: "auto" | "always" | "never";
  json?: boolean;
}

function addStatusOptions(command: Command, includeJson: boolean): Command {
  command
    .option("--codex-home <path>", "Codex home directory", join(homedir(), ".codex"))
    .option("--cwd <path>", "Session working directory", process.cwd())
    .option("--color <mode>", "Color mode: auto, always, never", "auto");
  if (includeJson) command.option("--json", "Print structured JSON");
  return command;
}

function colorEnabled(mode: StatusOptions["color"], io: CliIo): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (io.env.NO_COLOR !== undefined) return false;
  if (io.env.FORCE_COLOR !== undefined && io.env.FORCE_COLOR !== "0") return true;
  return io.isTTY;
}

function asStatusLine(snapshot: CurrentStatusSnapshot) {
  return {
    ...(snapshot.model ? { model: { name: snapshot.model.name, effort: snapshot.model.effort } } : {}),
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

function renderContext(snapshot: CurrentStatusSnapshot, color: boolean): string {
  const colors = pc.createColors(color);
  const line = (label: string, value: string, labelColor: (text: string) => string = colors.cyan) =>
    `${labelColor(label.padEnd(11))}${value}`;
  const contextLevel = classifyMetric("context", snapshot.context.ratio);
  const contextValue = `${formatTokens(snapshot.context.usedTokens)} / ${formatTokens(snapshot.context.maxTokens)}  ${(snapshot.context.ratio * 100).toFixed(1)}%`;
  const contextColored = contextLevel === "high"
    ? colors.bold(colors.red(contextValue))
    : contextLevel === "medium"
      ? colors.yellow(contextValue)
      : colors.green(contextValue);
  const remaining = Math.max(0, snapshot.context.maxTokens - snapshot.context.usedTokens);
  const lines = [
    line("Model", [snapshot.model?.name, snapshot.model?.effort].filter(Boolean).join(" ") || "unknown", colors.blue),
    line("Context", contextColored),
    line("Remaining", `${formatTokens(remaining)}  ${((1 - snapshot.context.ratio) * 100).toFixed(1)}%`),
    line("Input", formatTokens(snapshot.lastUsage.inputTokens), colors.blue),
    line("Cached", `${formatTokens(snapshot.lastUsage.cachedInputTokens)}  ${(snapshot.cacheRatio * 100).toFixed(1)}%`, colors.green),
    line("Output", formatTokens(snapshot.lastUsage.outputTokens), colors.magenta),
    line("Reasoning", formatTokens(snapshot.lastUsage.reasoningOutputTokens), colors.magenta),
    line("Session", formatTokens(snapshot.cumulativeTokens), colors.cyan),
  ];
  if (snapshot.performance) {
    lines.push(line("Time", `${snapshot.performance.elapsedSeconds.toFixed(1)}s`, colors.yellow));
    if (snapshot.performance.timeToFirstTokenSeconds !== undefined) {
      lines.push(line("TTFT", `${snapshot.performance.timeToFirstTokenSeconds.toFixed(1)}s`, colors.yellow));
    }
    if (snapshot.performance.outputTokensPerSecond !== undefined) {
      lines.push(line("Speed", `${snapshot.performance.outputTokensPerSecond.toFixed(1)} tok/s`, colors.green));
    }
  }
  lines.push(line("Limits", snapshot.limits ? JSON.stringify(snapshot.limits) : "unavailable", colors.dim));
  return `${lines.join("\n")}\n`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function doctor(codexHome: string) {
  const checks = {
    codexHome: await pathExists(codexHome),
    sessions: await pathExists(join(codexHome, "sessions")),
    config: await pathExists(join(codexHome, "config.toml")),
    git: false,
  };
  try {
    await execFileAsync("git", ["--version"], { timeout: 1_500 });
    checks.git = true;
  } catch {
    checks.git = false;
  }
  return { ok: Object.values(checks).every(Boolean), checks };
}

async function runWatchCycle(options: { codexHome: string; stateDir: string }, io: CliIo): Promise<void> {
  const statePath = join(options.stateDir, "state.json");
  const sessions = await listSessions({ codexHome: options.codexHome });
  const candidates = sessions.map(buildResumeCandidate).filter((candidate) => candidate !== null);
  const resumedSessionIds = new Set(
    sessions
      .filter((session) => {
        const candidate = candidates.find((item) => item.sessionId === session.sessionId);
        return Boolean(
          candidate?.checkpointAt
          && session.lastAssistantAt
          && session.lastAssistantAt > new Date(candidate.checkpointAt),
        );
      })
      .map((session) => session.sessionId),
  );
  const previous = await readResumeState(statePath);
  const reconciled = reconcileResumeJobs({
    candidates,
    previous,
    now: new Date(),
    resumedSessionIds,
  });
  const state = await runDueResumeJobs({
    state: reconciled,
    now: new Date(),
    resumedSessionIds,
    trigger: launchResumeTerminal,
  });
  await saveResumeState(statePath, state);
  const pending = state.jobs.filter((job) => job.status === "pending").length;
  io.stdout(`ok pending=${pending} sessions=${sessions.length}\n`);
}

async function loadStatus(options: StatusOptions, io: CliIo): Promise<CurrentStatusSnapshot | null> {
  const snapshot = await getCurrentStatus({ codexHome: options.codexHome, cwd: options.cwd });
  if (!snapshot) io.stderr(`No Codex session found for ${options.cwd}\n`);
  return snapshot;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const program = new Command().name("codex-auto").exitOverride().configureOutput({
    writeOut: (value) => io.stdout(value),
    writeErr: (value) => io.stderr(value),
  });
  let exitCode = 0;

  addStatusOptions(program.command("statusline"), false).action(async (options: StatusOptions) => {
    const snapshot = await loadStatus(options, io);
    if (!snapshot) {
      exitCode = 1;
      return;
    }
    io.stdout(
      `${renderStatusLine(asStatusLine(snapshot), {
        color: colorEnabled(options.color, io),
        width: io.columns,
      })}\n`,
    );
  });

  addStatusOptions(program.command("status"), true).action(async (options: StatusOptions) => {
    const snapshot = await loadStatus(options, io);
    if (!snapshot) {
      exitCode = 1;
      return;
    }
    if (options.json) {
      io.stdout(`${JSON.stringify(snapshot, null, 2)}\n`);
      return;
    }
    io.stdout(`${renderStatusLine(asStatusLine(snapshot), { color: colorEnabled(options.color, io), width: io.columns })}\n`);
  });

  addStatusOptions(program.command("context"), true).action(async (options: StatusOptions) => {
    const snapshot = await loadStatus(options, io);
    if (!snapshot) {
      exitCode = 1;
      return;
    }
    if (options.json) io.stdout(`${JSON.stringify(snapshot, null, 2)}\n`);
    else io.stdout(renderContext(snapshot, colorEnabled(options.color, io)));
  });

  program
    .command("doctor")
    .option("--codex-home <path>", "Codex home directory", join(homedir(), ".codex"))
    .option("--json", "Print structured JSON")
    .action(async (options: { codexHome: string; json?: boolean }) => {
      const result = await doctor(options.codexHome);
      exitCode = result.ok ? 0 : 1;
      if (options.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      else {
        for (const [name, ok] of Object.entries(result.checks)) io.stdout(`${ok ? "ok" : "fail"} ${name}\n`);
      }
    });

  program
    .command("watch")
    .option("--once", "Run one reconciliation cycle")
    .option("--codex-home <path>", "Codex home directory", join(homedir(), ".codex"))
    .option("--state-dir <path>", "Watcher state directory", join(homedir(), ".codex-auto"))
    .option("--interval <seconds>", "Polling interval", "1800")
    .action(async (options: { once?: boolean; codexHome: string; stateDir: string; interval: string }) => {
      const lock = await acquireWatcherLock(join(options.stateDir, "watcher.lock"));
      try {
        do {
          await runWatchCycle(options, io);
          if (options.once) break;
          const seconds = Math.max(1, Number(options.interval) || 1_800);
          await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
        } while (true);
      } finally {
        await lock.release();
      }
    });

  try {
    await program.parseAsync(["node", "codex-auto", ...argv]);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "commander.helpDisplayed" || code === "commander.version") return 0;
    return 2;
  }
  return exitCode;
}
