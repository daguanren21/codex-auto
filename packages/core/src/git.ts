import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitSnapshot {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export function parseGitStatus(output: string): GitSnapshot | null {
  let branch: string | undefined;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) branch = line.slice("# branch.head ".length).trim();
    else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line && !line.startsWith("# ")) dirty = true;
  }
  return branch ? { branch, dirty, ahead, behind } : null;
}

export async function probeGit(cwd: string, timeoutMs = 1_500): Promise<GitSnapshot | null> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v2", "--branch"], {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1_000_000,
    });
    const snapshot = parseGitStatus(stdout);
    if (!snapshot) return null;
    if (snapshot.branch === "(detached)") {
      const detached = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
        cwd,
        encoding: "utf8",
        timeout: timeoutMs,
      });
      snapshot.branch = `@${detached.stdout.trim()}`;
    }
    return snapshot;
  } catch {
    return null;
  }
}

