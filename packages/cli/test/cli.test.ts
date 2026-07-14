import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { parsePositiveNumber, runCli } from "../src/cli.js";

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

describe("CLI identity", () => {
  it("uses encore as the documented command name", async () => {
    const output = capture();

    expect(await runCli(["--help"], output.io)).toBe(0);
    expect(output.stdout.join("")).toContain("Usage: encore");
    expect(output.stdout.join("")).toContain("Keep Codex coding sessions going through usage limits.");
  });
});

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

  it("renders tmux format at an explicit width", async () => {
    const output = capture();
    const code = await runCli(
      [
        "statusline",
        "--codex-home",
        codexHome,
        "--cwd",
        "/workspace/project",
        "--format",
        "tmux",
        "--width",
        "60",
      ],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stdout.join("")).toContain("#[fg=");
    expect(output.stdout.join("")).not.toContain("\u001B[");
  });

  it("is silent when tmux has no matching session", async () => {
    const output = capture();
    const emptyHome = await mkdtemp(join(tmpdir(), "codex-auto-empty-"));
    const code = await runCli(
      ["statusline", "--codex-home", emptyHome, "--cwd", "/missing", "--format", "tmux"],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([]);
  });

  it("reuses a fresh statusline cache entry", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "codex-auto-statusline-cache-"));
    const args = [
      "statusline",
      "--codex-home",
      codexHome,
      "--cwd",
      "/workspace/project",
      "--cache-ttl",
      "10",
      "--state-dir",
      stateDir,
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

describe("usage", () => {
  it("summarizes token usage across sessions and models for an explicit range", async () => {
    const output = capture();
    const code = await runCli(
      [
        "usage",
        "--codex-home",
        codexHome,
        "--since",
        "2026-07-10T02:00:00.000Z",
        "--until",
        "2026-07-10T05:00:00.000Z",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      range: {
        start: "2026-07-10T02:00:00.000Z",
        end: "2026-07-10T05:00:00.000Z",
      },
      totalTokens: 166_021,
      sessionCount: 3,
      models: {
        "gpt-5.4": { totalTokens: 1_010 },
        "gpt-5.6-sol": { totalTokens: 165_011 },
      },
    });
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

describe("config", () => {
  it("persists normalized work times and proxy settings", async () => {
    const output = capture();
    const stateDir = await mkdtemp(join(tmpdir(), "codex-auto-config-"));
    const code = await runCli(
      [
        "config",
        "--state-dir",
        stateDir,
        "--workat",
        "14:00,10:30,10:30",
        "--http-proxy",
        "http://127.0.0.1:7890",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual({
      workat: ["10:30", "14:00"],
      proxy: { HTTP_PROXY: "http://127.0.0.1:7890" },
    });
    expect(JSON.parse(await readFile(join(stateDir, "config.json"), "utf8"))).toEqual({
      workat: ["10:30", "14:00"],
      proxy: { HTTP_PROXY: "http://127.0.0.1:7890" },
    });
  });
});

describe("tmux config", () => {
  it("installs and uninstalls the tmux block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auto-tmux-"));
    const configPath = join(dir, ".tmux.conf");
    const existing = `set -g @plugin 'tmux-plugins/tpm'\nrun "~/.config/tmux/plugins/tpm/tpm"\n`;
    await writeFile(configPath, existing, "utf8");

    expect(
      await runCli(
        [
          "tmux",
          "install",
          "--config",
          configPath,
          "--executable",
          "/usr/local/bin/codex-auto",
          "--no-reload",
        ],
        capture().io,
      ),
    ).toBe(0);
    expect(await readFile(configPath, "utf8")).toContain("/usr/local/bin/codex-auto");
    expect(
      await runCli(["tmux", "uninstall", "--config", configPath, "--no-reload"], capture().io),
    ).toBe(0);
    expect(await readFile(configPath, "utf8")).toBe(existing);
  });
});

describe("parsePositiveNumber", () => {
  it("returns a positive decimal", () => {
    expect(parsePositiveNumber("1.5", "--interval")).toBe(1.5);
  });

  it.each(["0", "-1", "not-a-number", "Infinity"])("rejects %s", (value) => {
    expect(() => parsePositiveNumber(value, "--interval"))
      .toThrow("--interval must be a positive number");
  });
});

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

describe("watch --once", () => {
  it("scans rollouts and persists pending resume jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T07:00:00Z"));
    try {
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
    } finally {
      vi.useRealTimers();
    }
  });
});
