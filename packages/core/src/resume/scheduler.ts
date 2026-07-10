import type { SessionSnapshot } from "../codex/types.js";

export interface ResumeCandidate {
  sessionId: string;
  cwd: string;
  retryAt: string;
  scheduledRunAt: string;
  scope: "session" | "global";
  modelName?: string;
  effort?: string;
  checkpointAt?: string;
}

export interface ResumeJob extends ResumeCandidate {
  status: "pending" | "triggered" | "failed" | "expired" | "replaced";
  statusReason?: string;
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string;
  failedAt?: string;
}

export interface ResumeState {
  jobs: ResumeJob[];
  prewarmJobs?: import("./prewarm.js").PrewarmJob[];
}

function fullyUsed(value: number | undefined): boolean {
  return value !== undefined && value >= 100;
}

export function buildResumeCandidate(session: SessionSnapshot): ResumeCandidate | null {
  const secondary = session.limits?.secondary;
  const primary = session.limits?.primary;
  const window = fullyUsed(secondary?.usedPercent) && secondary?.resetsAt
    ? { scope: "global" as const, resetsAt: secondary.resetsAt }
    : fullyUsed(primary?.usedPercent) && primary?.resetsAt
      ? { scope: "session" as const, resetsAt: primary.resetsAt }
      : null;
  if (!window) return null;
  const retryAt = new Date(window.resetsAt * 1_000);
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    retryAt: retryAt.toISOString(),
    scheduledRunAt: new Date(retryAt.getTime() + 10 * 60_000).toISOString(),
    scope: window.scope,
    ...(session.model?.name ? { modelName: session.model.name } : {}),
    ...(session.model?.effort ? { effort: session.model.effort } : {}),
    checkpointAt: (session.limitObservedAt ?? session.updatedAt).toISOString(),
  };
}

export function reconcileResumeJobs(input: {
  candidates: ResumeCandidate[];
  previous: ResumeState;
  now: Date;
  resumedSessionIds: Set<string>;
}): ResumeState {
  const now = input.now.toISOString();
  const jobs = input.previous.jobs.map((job) => ({ ...job }));
  const pendingBySession = new Map<string, ResumeJob[]>();
  for (const job of jobs) {
    if (job.status !== "pending") continue;
    const sessionJobs = pendingBySession.get(job.sessionId) ?? [];
    sessionJobs.push(job);
    pendingBySession.set(job.sessionId, sessionJobs);
  }

  for (const sessionId of input.resumedSessionIds) {
    for (const job of pendingBySession.get(sessionId) ?? []) {
      job.status = "expired";
      job.statusReason = "session_already_resumed_manually";
      job.updatedAt = now;
    }
  }

  const latestBySession = new Map<string, ResumeCandidate>();
  for (const candidate of input.candidates) {
    const current = latestBySession.get(candidate.sessionId);
    if (!current || candidate.scheduledRunAt > current.scheduledRunAt) latestBySession.set(candidate.sessionId, candidate);
  }
  const global = input.candidates
    .filter((candidate) => candidate.scope === "global")
    .sort((left, right) => right.scheduledRunAt.localeCompare(left.scheduledRunAt))[0];

  for (const [sessionId, candidate] of latestBySession) {
    if (input.resumedSessionIds.has(sessionId)) continue;
    const governing = global ?? candidate;
    const desired: ResumeCandidate = {
      ...candidate,
      retryAt: governing.retryAt,
      scheduledRunAt: governing.scheduledRunAt,
      scope: governing.scope,
    };
    const existing = (pendingBySession.get(sessionId) ?? []).find(
      (job) => job.status === "pending" && job.scheduledRunAt === desired.scheduledRunAt && job.scope === desired.scope,
    );
    if (existing) continue;
    for (const job of pendingBySession.get(sessionId) ?? []) {
      if (job.status !== "pending") continue;
      job.status = "replaced";
      job.statusReason = "superseded_by_newer_candidate";
      job.updatedAt = now;
    }
    jobs.push({ ...desired, status: "pending", createdAt: now, updatedAt: now });
  }

  for (const [sessionId, sessionJobs] of pendingBySession) {
    if (latestBySession.has(sessionId) || input.resumedSessionIds.has(sessionId)) continue;
    for (const job of sessionJobs) {
      if (job.status !== "pending") continue;
      job.status = "expired";
      job.statusReason = "candidate_no_longer_active";
      job.updatedAt = now;
    }
  }
  return { jobs };
}
