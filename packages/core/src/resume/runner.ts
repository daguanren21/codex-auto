import type { ResumeJob, ResumeState } from "./scheduler.js";

export async function runDueResumeJobs(input: {
  state: ResumeState;
  now: Date;
  resumedSessionIds: Set<string>;
  trigger(job: ResumeJob): Promise<void>;
}): Promise<ResumeState> {
  const now = input.now.toISOString();
  const jobs = input.state.jobs.map((job) => ({ ...job }));
  for (const job of jobs) {
    if (job.status !== "pending" || job.scheduledRunAt > now) continue;
    if (input.resumedSessionIds.has(job.sessionId)) {
      job.status = "expired";
      job.statusReason = "session_already_resumed_manually";
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
      job.statusReason = error instanceof Error ? error.message : "resume trigger failed";
    }
    job.updatedAt = now;
  }
  return { jobs };
}

