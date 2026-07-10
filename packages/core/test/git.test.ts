import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { parseGitStatus, probeGit } from "../src/index.js";

const run = promisify(execFile);

describe("parseGitStatus", () => {
  it("parses branch, ahead, behind, and dirty state from porcelain v2", () => {
    expect(
      parseGitStatus("# branch.head feature/status\n# branch.ab +2 -1\n? new-file.ts\n"),
    ).toEqual({ branch: "feature/status", dirty: true, ahead: 2, behind: 1 });
  });
});

describe("probeGit", () => {
  it("reads the current branch and untracked dirty state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codex-auto-git-"));
    await run("git", ["init", "-b", "main"], { cwd });
    await writeFile(join(cwd, "new-file.ts"), "export {};\n");

    await expect(probeGit(cwd)).resolves.toEqual({ branch: "main", dirty: true, ahead: 0, behind: 0 });
  });

  it("uses a short commit id for detached HEAD", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codex-auto-detached-"));
    await run("git", ["init", "-b", "main"], { cwd });
    await writeFile(join(cwd, "tracked.txt"), "tracked\n");
    await run("git", ["add", "tracked.txt"], { cwd });
    await run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "test"], { cwd });
    const { stdout } = await run("git", ["rev-parse", "--short", "HEAD"], { cwd });
    await run("git", ["checkout", "--detach"], { cwd });

    await expect(probeGit(cwd)).resolves.toMatchObject({ branch: `@${stdout.trim()}`, dirty: false });
  });
});

