import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import type { PrewarmJob, ResumeJob } from "@codex-auto/core";

import type { RuntimeConfig } from "./runtime-config.js";

const execFileAsync = promisify(execFile);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildResumeShellCommand(job: ResumeJob): string {
  const args = ["resume"];
  if (job.modelName) args.push("-m", shellQuote(job.modelName));
  if (job.effort) args.push("-c", shellQuote(`model_reasoning_effort=${job.effort}`));
  args.push("--yolo", shellQuote(job.sessionId), shellQuote("continue"));
  return `cd ${shellQuote(job.cwd)} && codex ${args.join(" ")}`;
}

export function buildPrewarmArgs(): string[] {
  return [
    "exec",
    "-m",
    "gpt-5.4-mini",
    "-c",
    "model_reasoning_effort=low",
    "-a",
    "never",
    "--ephemeral",
    "--ignore-rules",
    "--skip-git-repo-check",
    "Just say Hi",
  ];
}

export async function runPrewarmProbe(
  _job: PrewarmJob,
  options: { stateDir: string; config: RuntimeConfig },
): Promise<void> {
  const cwd = join(options.stateDir, "prewarm-workspace");
  await mkdir(cwd, { recursive: true });
  await execFileAsync("codex", buildPrewarmArgs(), {
    cwd,
    env: { ...process.env, ...options.config.proxy },
    timeout: 300_000,
  });
}

function appleScriptQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function findExecutable(name: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const path = join(directory, name);
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

export async function launchResumeTerminal(job: ResumeJob): Promise<void> {
  const command = buildResumeShellCommand(job);
  if (process.platform === "darwin") {
    const script = `tell application "Terminal"\nactivate\ndo script ${appleScriptQuote(command)}\nend tell`;
    await execFileAsync("osascript", ["-e", script], { timeout: 10_000 });
    return;
  }
  if (process.platform === "linux") {
    const candidates: Array<[string, string[]]> = [
      ["x-terminal-emulator", ["-e", "bash", "-lc", command]],
      ["gnome-terminal", ["--", "bash", "-lc", command]],
      ["konsole", ["-e", "bash", "-lc", command]],
      ["xfce4-terminal", ["--command", `bash -lc ${shellQuote(command)}`]],
      ["xterm", ["-e", "bash", "-lc", command]],
    ];
    for (const [name, args] of candidates) {
      const executable = await findExecutable(name);
      if (!executable) continue;
      const child = spawn(executable, args, { detached: true, stdio: "ignore" });
      child.unref();
      return;
    }
    throw new Error("no supported terminal emulator found");
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}
