import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquireWatcherLock,
  buildResumeCandidate,
  readResumeState,
  reconcileResumeJobs,
  saveResumeState,
  runDueResumeJobs,
  type SessionSnapshot,
} from "../src/index.js";

function session(
  sessionId: string,
  primary: { usedPercent: number; resetsAt: number } | null,
  secondary: { usedPercent: number; resetsAt: number } | null,
): SessionSnapshot {
  return {
    sessionId,
    rolloutPath: `/sessions/${sessionId}.jsonl`,
    cwd: `/workspace/${sessionId}`,
    updatedAt: new Date("2026-07-10T02:00:00.000Z"),
    context: { usedTokens: 100, maxTokens: 1_000, ratio: 0.1 },
    lastUsage: { inputTokens: 90, cachedInputTokens: 80, outputTokens: 10, reasoningOutputTokens: 2, totalTokens: 100 },
    cumulativeUsage: { inputTokens: 90, cachedInputTokens: 80, outputTokens: 10, reasoningOutputTokens: 2, totalTokens: 100 },
    cumulativeTokens: 100,
    cacheRatio: 80 / 90,
    limits: { primary, secondary },
    stale: false,
  };
}

describe("buildResumeCandidate", () => {
  it("schedules a primary window ten minutes after reset", () => {
    const candidate = buildResumeCandidate(session("one", { usedPercent: 100, resetsAt: 1_783_666_800 }, null));

    expect(candidate).toMatchObject({ sessionId: "one", scope: "session", retryAt: "2026-07-10T07:00:00.000Z" });
    expect(candidate?.scheduledRunAt).toBe("2026-07-10T07:10:00.000Z");
  });

  it("treats a fully used secondary window as global", () => {
    const candidate = buildResumeCandidate(session("one", null, { usedPercent: 100, resetsAt: 1_783_670_400 }));

    expect(candidate).toMatchObject({ sessionId: "one", scope: "global", retryAt: "2026-07-10T08:00:00.000Z" });
  });
});

describe("reconcileResumeJobs", () => {
  it("applies the latest global window to every active session", () => {
    const primary = buildResumeCandidate(session("one", { usedPercent: 100, resetsAt: 1_783_666_800 }, null));
    const other = buildResumeCandidate(session("two", { usedPercent: 100, resetsAt: 1_783_666_900 }, null));
    const global = buildResumeCandidate(session("three", null, { usedPercent: 100, resetsAt: 1_783_670_400 }));

    const state = reconcileResumeJobs({
      candidates: [primary, other, global].filter((item) => item !== null),
      previous: { jobs: [] },
      now: new Date("2026-07-10T02:05:00.000Z"),
      resumedSessionIds: new Set(),
    });

    expect(state.jobs.filter((job) => job.status === "pending")).toHaveLength(3);
    expect(new Set(state.jobs.map((job) => job.scheduledRunAt))).toEqual(new Set(["2026-07-10T08:10:00.000Z"]));
  });

  it("expires a pending job when the session resumed manually", () => {
    const candidate = buildResumeCandidate(session("one", { usedPercent: 100, resetsAt: 1_783_666_800 }, null));
    const state = reconcileResumeJobs({
      candidates: candidate ? [candidate] : [],
      previous: {
        jobs: [
          {
            sessionId: "one",
            cwd: "/workspace/one",
            retryAt: "2026-07-10T07:00:00.000Z",
            scheduledRunAt: "2026-07-10T07:10:00.000Z",
            scope: "session",
            status: "pending",
            createdAt: "2026-07-10T02:00:00.000Z",
            updatedAt: "2026-07-10T02:00:00.000Z"
          }
        ],
      },
      now: new Date("2026-07-10T02:05:00.000Z"),
      resumedSessionIds: new Set(["one"]),
    });

    expect(state.jobs[0]).toMatchObject({ status: "expired", statusReason: "session_already_resumed_manually" });
  });
});

describe("resume state persistence", () => {
  it("writes state atomically and prevents a second watcher lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auto-state-"));
    const statePath = join(dir, "state.json");
    const lockPath = join(dir, "watcher.lock");
    await saveResumeState(statePath, { jobs: [] });

    await expect(readResumeState(statePath)).resolves.toEqual({ jobs: [] });
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({ jobs: [] });

    const lock = await acquireWatcherLock(lockPath);
    await expect(acquireWatcherLock(lockPath)).rejects.toThrow("watcher is already running");
    await lock.release();
  });

  it("quarantines corrupt state before returning an empty state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auto-corrupt-state-"));
    const statePath = join(dir, "state.json");
    await writeFile(statePath, "not json", "utf8");

    await expect(readResumeState(statePath)).resolves.toEqual({ jobs: [] });
    expect(await readdir(dir)).toEqual([expect.stringMatching(/^state\.json\.corrupt-\d+$/)]);
  });
});

describe("runDueResumeJobs", () => {
  const dueJob = {
    sessionId: "one",
    cwd: "/workspace/one",
    retryAt: "2026-07-10T07:00:00.000Z",
    scheduledRunAt: "2026-07-10T07:10:00.000Z",
    scope: "session" as const,
    status: "pending" as const,
    createdAt: "2026-07-10T02:00:00.000Z",
    updatedAt: "2026-07-10T02:00:00.000Z",
  };

  it("marks a successfully launched due job as triggered", async () => {
    const calls: string[] = [];
    const state = await runDueResumeJobs({
      state: { jobs: [dueJob] },
      now: new Date("2026-07-10T07:11:00.000Z"),
      resumedSessionIds: new Set(),
      trigger: async (job) => {
        calls.push(job.sessionId);
      },
    });

    expect(calls).toEqual(["one"]);
    expect(state.jobs[0]).toMatchObject({ status: "triggered", triggeredAt: "2026-07-10T07:11:00.000Z" });
  });

  it("does not launch a due job that resumed manually", async () => {
    const state = await runDueResumeJobs({
      state: { jobs: [dueJob] },
      now: new Date("2026-07-10T07:11:00.000Z"),
      resumedSessionIds: new Set(["one"]),
      trigger: async () => {
        throw new Error("must not launch");
      },
    });

    expect(state.jobs[0]).toMatchObject({ status: "expired", statusReason: "session_already_resumed_manually" });
  });
});
