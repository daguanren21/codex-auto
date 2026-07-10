export interface PrewarmJob {
  jobKey: string;
  workat: string;
  workatAt: string;
  scheduledRunAt: string;
  runDeadlineAt: string;
  expectedResetAt: string;
  modelName: "gpt-5.4-mini";
  effort: "low";
  prompt: "Just say Hi";
  status: "pending" | "triggered" | "failed" | "expired";
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string;
  failedAt?: string;
  statusReason?: string;
}

export function normalizeWorkat(values: string[]): string[] {
  const normalized = values.map((value) => {
    const trimmed = value.trim();
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
      throw new Error(`Invalid workat time: ${value}`);
    }
    return trimmed;
  });
  return [...new Set(normalized)].sort();
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildPrewarmJobs(input: { workat: string[]; now: Date }): PrewarmJob[] {
  const jobs: PrewarmJob[] = [];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const workat of normalizeWorkat(input.workat)) {
      const [hour, minute] = workat.split(":").map(Number) as [number, number];
      const workatAt = new Date(
        input.now.getFullYear(),
        input.now.getMonth(),
        input.now.getDate() + dayOffset,
        hour,
        minute,
      );
      const scheduledRunAt = new Date(workatAt.getTime() - 4 * 60 * 60_000);
      const runDeadlineAt = new Date(scheduledRunAt.getTime() + 5 * 60_000);
      if (runDeadlineAt <= input.now) continue;
      jobs.push({
        jobKey: `${localDateKey(workatAt)}|${workat}`,
        workat,
        workatAt: workatAt.toISOString(),
        scheduledRunAt: scheduledRunAt.toISOString(),
        runDeadlineAt: runDeadlineAt.toISOString(),
        expectedResetAt: new Date(workatAt.getTime() + 60 * 60_000).toISOString(),
        modelName: "gpt-5.4-mini",
        effort: "low",
        prompt: "Just say Hi",
        status: "pending",
        createdAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      });
    }
  }
  return jobs;
}

export function reconcilePrewarmJobs(input: {
  desired: PrewarmJob[];
  previous: PrewarmJob[];
  now: Date;
}): PrewarmJob[] {
  const now = input.now.toISOString();
  const jobs = input.previous.map((job) => ({ ...job }));
  const desiredKeys = new Set(input.desired.map((job) => job.jobKey));
  const existingByKey = new Map(jobs.map((job) => [job.jobKey, job]));

  for (const desired of input.desired) {
    const existing = existingByKey.get(desired.jobKey);
    if (existing) {
      if (existing.status === "pending") Object.assign(existing, desired, { createdAt: existing.createdAt, updatedAt: now });
      continue;
    }
    jobs.push(desired);
  }
  for (const job of jobs) {
    if (job.status !== "pending" || desiredKeys.has(job.jobKey)) continue;
    job.status = "expired";
    job.statusReason = "schedule_no_longer_active";
    job.updatedAt = now;
  }
  return jobs;
}

export async function runDuePrewarmJobs(input: {
  jobs: PrewarmJob[];
  now: Date;
  suppress: boolean;
  trigger(job: PrewarmJob): Promise<void>;
}): Promise<PrewarmJob[]> {
  const now = input.now.toISOString();
  const jobs = input.jobs.map((job) => ({ ...job }));
  for (const job of jobs) {
    if (job.status !== "pending" || job.scheduledRunAt > now) continue;
    if (job.runDeadlineAt < now) {
      job.status = "expired";
      job.statusReason = "missed_prewarm_deadline";
      job.updatedAt = now;
      continue;
    }
    if (input.suppress) {
      job.status = "expired";
      job.statusReason = "suppressed_by_resume_priority";
      job.updatedAt = now;
      continue;
    }
    try {
      await input.trigger(job);
      job.status = "triggered";
      job.triggeredAt = now;
    } catch (error) {
      job.status = "failed";
      job.failedAt = now;
      job.statusReason = error instanceof Error ? error.message : "prewarm trigger failed";
    }
    job.updatedAt = now;
  }
  return jobs;
}
