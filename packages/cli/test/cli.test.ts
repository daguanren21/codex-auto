import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

const codexHome = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../core/test/fixtures/codex-home",
);

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      isTTY: false,
      columns: 160,
      env: {},
    },
    stdout,
    stderr,
  };
}

describe("statusline", () => {
  it("renders the current session in one ANSI-free line", async () => {
    const output = capture();
    const code = await runCli(
      ["statusline", "--codex-home", codexHome, "--cwd", "/workspace/project", "--color", "never"],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(output.stdout.join(""))
      .toBe("gpt-5.6-sol high | ctx 46.1% 163k/353.4k | cache 99.5% | time 13.0s | speed 321.5t/s | total 3.73m\n");
  });
});

describe("status --json", () => {
  it("returns structured context, model, token, and performance data", async () => {
    const output = capture();
    const code = await runCli(
      ["status", "--codex-home", codexHome, "--cwd", "/workspace/project", "--json"],
      output.io,
    );

    expect(code).toBe(0);
    const result = JSON.parse(output.stdout.join(""));
    expect(result).toMatchObject({
      model: { name: "gpt-5.6-sol", effort: "high", source: "session" },
      context: { usedTokens: 162_991, maxTokens: 353_400 },
      cumulativeTokens: 3_733_101,
      performance: { elapsedSeconds: 13, outputTokensPerSecond: 321.5 },
      limits: null,
    });
    expect(result.cacheRatio).toBeCloseTo(0.995, 3);
  });
});

describe("context", () => {
  it("renders a readable token and performance breakdown", async () => {
    const output = capture();
    const code = await runCli(
      ["context", "--codex-home", codexHome, "--cwd", "/workspace/project", "--color", "never"],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stdout.join("")).toContain("Context    163k / 353.4k  46.1%");
    expect(output.stdout.join("")).toContain("Cached     161.5k  99.5%");
    expect(output.stdout.join("")).toContain("Speed      321.5 tok/s");
    expect(output.stdout.join("")).toContain("Limits     unavailable");
  });
});

describe("doctor", () => {
  it("reports a usable Codex home as JSON", async () => {
    const output = capture();
    const code = await runCli(["doctor", "--codex-home", codexHome, "--json"], output.io);

    expect(code).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual({
      ok: true,
      checks: {
        codexHome: true,
        sessions: true,
        config: true,
        git: true,
      },
    });
  });
});

describe("watch --once", () => {
  it("scans rollouts and persists pending resume jobs", async () => {
    const output = capture();
    const stateDir = await mkdtemp(join(tmpdir(), "codex-auto-watch-"));
    const code = await runCli(
      ["watch", "--once", "--codex-home", codexHome, "--state-dir", stateDir],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stdout.join("")).toContain("pending=1");
    const state = JSON.parse(await readFile(join(stateDir, "state.json"), "utf8"));
    expect(state.jobs).toContainEqual(
      expect.objectContaining({
        sessionId: "22222222-2222-4222-8222-222222222222",
        status: "pending",
        scheduledRunAt: "2026-07-11T07:10:00.000Z",
      }),
    );
    expect(state.jobs).not.toContainEqual(
      expect.objectContaining({ sessionId: "33333333-3333-4333-8333-333333333333", status: "pending" }),
    );
  });
});
