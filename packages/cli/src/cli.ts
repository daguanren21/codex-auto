import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  acquireWatcherLock,
  buildPrewarmJobs,
  buildResumeCandidate,
  classifyMetric,
  collectUsage,
  formatTokens,
  getCurrentStatus,
  listSessions,
  normalizeWorkat,
  readResumeState,
  reconcilePrewarmJobs,
  reconcileResumeJobs,
  renderStatusLine,
  runDueResumeJobs,
  runDuePrewarmJobs,
  saveResumeState,
  type CurrentStatusSnapshot,
  type StatusLineFormat,
} from "@codex-auto/core";
import { Command } from "commander";
import pc from "picocolors";

import { readRuntimeConfig, saveRuntimeConfig } from "./runtime-config.js";
import { readCachedStatusLine } from "./status-cache.js";
import { launchResumeTerminal, runPrewarmProbe } from "./terminal.js";
import { installTmuxBlock, removeTmuxBlock, renderTmuxBlock, writeTmuxConfig } from "./tmux-config.js";

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

interface StatusLineCliOptions extends StatusOptions {
  format: StatusLineFormat;
  width?: string;
  cacheTtl: string;
  stateDir: string;
}

interface UsageOptions {
  codexHome: string;
  color: "auto" | "always" | "never";
  json?: boolean;
  today?: boolean;
  recent?: string;
  date?: string;
  since?: string;
  until?: string;
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

function parseNonNegativeNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

function parseWidth(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--width must be a positive integer");
  return parsed;
}

function asStatusLine(snapshot: CurrentStatusSnapshot) {
  return {
    ...(snapshot.model
      ? {
          model: {
            name: snapshot.model.name,
            ...(snapshot.model.effort ? { effort: snapshot.model.effort } : {}),
          },
        }
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

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseUsageRange(options: UsageOptions, now = new Date()): { start: Date; end: Date } {
  if (options.since || options.until) {
    const start = options.since ? new Date(options.since) : startOfLocalDay(now);
    const end = options.until ? new Date(options.until) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      throw new Error("Usage range must contain valid dates with start before end");
    }
    return { start, end };
  }
  if (options.date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.date);
    if (!match) throw new Error("--date must use YYYY-MM-DD");
    const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      start.getFullYear() !== Number(match[1])
      || start.getMonth() !== Number(match[2]) - 1
      || start.getDate() !== Number(match[3])
    ) throw new Error("--date is not a valid calendar date");
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (options.recent) {
    const days = Number(options.recent);
    if (!Number.isInteger(days) || days < 1) throw new Error("--recent must be a positive number of days");
    return { start: new Date(now.getTime() - days * 86_400_000), end: now };
  }
  return { start: startOfLocalDay(now), end: now };
}

function renderUsage(
  summary: Awaited<ReturnType<typeof collectUsage>>,
  range: { start: Date; end: Date },
  color: boolean,
): string {
  const colors = pc.createColors(color);
  const lines = [
    colors.dim(`${range.start.toISOString()} -> ${range.end.toISOString()}`),
    `${colors.cyan("Total".padEnd(11))}${colors.bold(colors.cyan(formatTokens(summary.totalTokens)))}`,
    `${colors.blue("Input".padEnd(11))}${colors.blue(formatTokens(summary.inputTokens))}`,
    `${colors.green("Cached".padEnd(11))}${colors.green(`${formatTokens(summary.cachedInputTokens)}  ${(summary.cacheRatio * 100).toFixed(1)}%`)}`,
    `${colors.magenta("Output".padEnd(11))}${colors.magenta(formatTokens(summary.outputTokens))}`,
    `${colors.yellow("Reasoning".padEnd(11))}${colors.yellow(formatTokens(summary.reasoningOutputTokens))}`,
    `${colors.white("Sessions".padEnd(11))}${summary.sessionCount}`,
  ];
  for (const [model, totals] of Object.entries(summary.models).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${colors.blue(model.padEnd(20))}${colors.cyan(formatTokens(totals.totalTokens))}`);
  }
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

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function reloadTmuxConfig(path: string): Promise<"reloaded" | "no-server"> {
  try {
    await execFileAsync("tmux", ["source-file", path], { timeout: 5_000 });
    return "reloaded";
  } catch (error) {
    const message = [
      (error as { message?: string }).message,
      (error as { stderr?: string }).stderr,
    ].filter(Boolean).join("\n");
    if (message.includes("no server running") || message.includes("error connecting to")) return "no-server";
    throw error;
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
  const now = new Date();
  const statePath = join(options.stateDir, "state.json");
  const config = await readRuntimeConfig(join(options.stateDir, "config.json"));
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
    now,
    resumedSessionIds,
  });
  const state = await runDueResumeJobs({
    state: reconciled,
    now,
    resumedSessionIds,
    trigger: launchResumeTerminal,
  });
  const desiredPrewarm = buildPrewarmJobs({ workat: config.workat, now });
  const reconciledPrewarm = reconcilePrewarmJobs({
    desired: desiredPrewarm,
    previous: previous.prewarmJobs ?? [],
    now,
  });
  const resumeTriggered = state.jobs.some((job) => job.status === "triggered" && job.triggeredAt === now.toISOString());
  const prewarmJobs = await runDuePrewarmJobs({
    jobs: reconciledPrewarm,
    now,
    suppress: resumeTriggered,
    trigger: (job) => runPrewarmProbe(job, { stateDir: options.stateDir, config }),
  });
  await saveResumeState(statePath, { ...state, prewarmJobs });
  const pending = state.jobs.filter((job) => job.status === "pending").length;
  const prewarm = prewarmJobs.filter((job) => job.status === "pending").length;
  io.stdout(`ok pending=${pending} prewarm=${prewarm} sessions=${sessions.length}\n`);
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

  addStatusOptions(program.command("statusline"), false)
    .option("--format <format>", "Output format: ansi, plain, tmux", "ansi")
    .option("--width <columns>", "Visible output width")
    .option("--cache-ttl <seconds>", "Status cache lifetime", "10")
    .option("--state-dir <path>", "State directory", join(homedir(), ".codex-auto"))
    .action(async (options: StatusLineCliOptions) => {
      if (!(["ansi", "plain", "tmux"] as string[]).includes(options.format)) {
        throw new Error("--format must be ansi, plain, or tmux");
      }
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
      if (!snapshot) {
        if (options.format !== "tmux") {
          io.stderr(`No Codex session found for ${options.cwd}\n`);
          exitCode = 1;
        }
        return;
      }
      const color = options.format === "plain"
        ? false
        : options.format === "tmux" || colorEnabled(options.color, io);
      io.stdout(
        `${renderStatusLine(snapshot, {
          color,
          width: parseWidth(options.width, io.columns),
          format: options.format,
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
    .command("usage")
    .option("--codex-home <path>", "Codex home directory", join(homedir(), ".codex"))
    .option("--today", "Summarize the current local day")
    .option("--recent <days>", "Summarize the trailing number of days")
    .option("--date <YYYY-MM-DD>", "Summarize one local calendar day")
    .option("--since <date>", "Range start as an ISO date")
    .option("--until <date>", "Range end as an ISO date")
    .option("--color <mode>", "Color mode: auto, always, never", "auto")
    .option("--json", "Print structured JSON")
    .action(async (options: UsageOptions) => {
      const range = parseUsageRange(options);
      const summary = await collectUsage({ codexHome: options.codexHome, ...range });
      if (options.json) {
        io.stdout(`${JSON.stringify({
          range: { start: range.start.toISOString(), end: range.end.toISOString() },
          ...summary,
        }, null, 2)}\n`);
        return;
      }
      io.stdout(renderUsage(summary, range, colorEnabled(options.color, io)));
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
    .command("config")
    .option("--state-dir <path>", "State directory", join(homedir(), ".codex-auto"))
    .option("--workat <times>", "Comma-separated local work times in HH:MM format")
    .option("--clear-workat", "Remove all work times")
    .option("--http-proxy <url>", "Set HTTP_PROXY")
    .option("--https-proxy <url>", "Set HTTPS_PROXY")
    .option("--all-proxy <url>", "Set ALL_PROXY")
    .option("--json", "Print structured JSON")
    .action(async (options: {
      stateDir: string;
      workat?: string;
      clearWorkat?: boolean;
      httpProxy?: string;
      httpsProxy?: string;
      allProxy?: string;
      json?: boolean;
    }) => {
      const path = join(options.stateDir, "config.json");
      const config = await readRuntimeConfig(path);
      if (options.clearWorkat) config.workat = [];
      else if (options.workat !== undefined) config.workat = normalizeWorkat(options.workat.split(","));
      if (options.httpProxy !== undefined) config.proxy.HTTP_PROXY = options.httpProxy;
      if (options.httpsProxy !== undefined) config.proxy.HTTPS_PROXY = options.httpsProxy;
      if (options.allProxy !== undefined) config.proxy.ALL_PROXY = options.allProxy;
      await saveRuntimeConfig(path, config);
      if (options.json) io.stdout(`${JSON.stringify(config, null, 2)}\n`);
      else io.stdout(`saved ${path}\n`);
    });

  const tmux = program.command("tmux");
  tmux
    .command("install")
    .option("--config <path>", "Tmux config path", join(homedir(), ".tmux.conf"))
    .option("--executable <path>", "Absolute codex-auto executable", resolve(process.argv[1] ?? "codex-auto"))
    .option("--no-reload", "Do not reload the tmux config")
    .action(async (options: { config: string; executable: string; reload: boolean }) => {
      try {
        const source = await readOptionalFile(options.config);
        const transformed = installTmuxBlock(source, renderTmuxBlock(resolve(options.executable)));
        await writeTmuxConfig(options.config, transformed);
        if (options.reload) {
          const result = await reloadTmuxConfig(options.config);
          if (result === "no-server") {
            io.stdout("installed; start tmux to load the statusline\n");
            return;
          }
        }
        io.stdout(`installed ${options.config}\n`);
      } catch (error) {
        io.stderr(`Failed to install tmux config ${options.config}: ${(error as Error).message}\n`);
        exitCode = 1;
      }
    });
  tmux
    .command("uninstall")
    .option("--config <path>", "Tmux config path", join(homedir(), ".tmux.conf"))
    .option("--no-reload", "Do not reload the tmux config")
    .action(async (options: { config: string; reload: boolean }) => {
      try {
        const source = await readOptionalFile(options.config);
        await writeTmuxConfig(options.config, removeTmuxBlock(source));
        if (options.reload) await reloadTmuxConfig(options.config);
        io.stdout(`uninstalled ${options.config}\n`);
      } catch (error) {
        io.stderr(`Failed to uninstall tmux config ${options.config}: ${(error as Error).message}\n`);
        exitCode = 1;
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
          if (!options.once) {
            const seconds = Math.max(1, Number(options.interval) || 1_800);
            await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
          }
        } while (!options.once);
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
