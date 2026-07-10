import { describe, expect, it } from "vitest";

import { buildPrewarmJobs, reconcilePrewarmJobs, runDuePrewarmJobs } from "../src/index.js";

describe("buildPrewarmJobs", () => {
  it("schedules today and tomorrow four hours before each work time", () => {
    const now = new Date(2026, 6, 9, 6, 0, 0);
    const jobs = buildPrewarmJobs({ workat: ["14:00", "10:30", "10:30"], now });

    expect(jobs).toHaveLength(4);
    expect(jobs.map((job) => job.workat)).toEqual(["10:30", "14:00", "10:30", "14:00"]);
    expect(new Date(jobs[0]!.scheduledRunAt).getTime()).toBe(new Date(2026, 6, 9, 6, 30, 0).getTime());
    expect(new Date(jobs[0]!.runDeadlineAt).getTime()).toBe(new Date(2026, 6, 9, 6, 35, 0).getTime());
    expect(jobs[0]).toMatchObject({ modelName: "gpt-5.4-mini", effort: "low", prompt: "Just say Hi" });
  });

  it("rejects invalid work times", () => {
    expect(() => buildPrewarmJobs({ workat: ["25:00"], now: new Date() })).toThrow("Invalid workat time");
  });
});

describe("runDuePrewarmJobs", () => {
  it("suppresses a due prewarm when resume work has priority", async () => {
    const now = new Date(2026, 6, 9, 6, 31, 0);
    const jobs = buildPrewarmJobs({ workat: ["10:30"], now: new Date(2026, 6, 9, 6, 0, 0) });
    const result = await runDuePrewarmJobs({
      jobs,
      now,
      suppress: true,
      trigger: async () => {
        throw new Error("must not trigger");
      },
    });

    expect(result[0]).toMatchObject({ status: "expired", statusReason: "suppressed_by_resume_priority" });
  });
});

describe("reconcilePrewarmJobs", () => {
  it("does not recreate an already triggered job", () => {
    const now = new Date(2026, 6, 9, 7, 0, 0);
    const desired = buildPrewarmJobs({ workat: ["10:30"], now });
    const triggered = {
      ...desired[0]!,
      status: "triggered" as const,
      triggeredAt: new Date(2026, 6, 9, 6, 31, 0).toISOString(),
    };

    const result = reconcilePrewarmJobs({ desired, previous: [triggered], now });

    expect(result.filter((job) => job.jobKey === triggered.jobKey)).toEqual([triggered]);
  });
});
