export interface TurnPerformanceSnapshot {
  state: "running" | "completed" | "failed" | "timeout";
  elapsedSeconds: number;
  timeToFirstTokenSeconds?: number;
  outputTokens: number;
  outputTokensPerSecond?: number;
}

interface RolloutEvent {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function timestamp(event: RolloutEvent): number | null {
  if (!event.timestamp) return null;
  const value = Date.parse(event.timestamp);
  return Number.isNaN(value) ? null : value;
}

export function deriveTurnPerformance(events: RolloutEvent[]): TurnPerformanceSnapshot | null {
  let startedAt: number | null = null;
  let firstOutputAt: number | null = null;
  let completedAt: number | null = null;
  let outputTokens = 0;
  let state: TurnPerformanceSnapshot["state"] = "running";

  for (const event of events) {
    const at = timestamp(event);
    const payload = event.payload;
    if (at === null || !payload) continue;
    if (event.type === "event_msg" && payload.type === "task_started") {
      startedAt = at;
      firstOutputAt = null;
      completedAt = null;
      outputTokens = 0;
      state = "running";
      continue;
    }
    if (startedAt === null) continue;
    if (event.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
      firstOutputAt ??= at;
    }
    if (event.type === "event_msg" && payload.type === "token_count") {
      const info = payload.info as Record<string, unknown> | null | undefined;
      const usage = info?.last_token_usage as Record<string, unknown> | undefined;
      if (typeof usage?.output_tokens === "number") outputTokens = usage.output_tokens;
    }
    if (event.type === "event_msg" && payload.type === "task_complete") {
      completedAt = at;
      state = "completed";
    }
  }

  if (startedAt === null) return null;
  const endAt = completedAt ?? timestamp(events.at(-1) ?? {}) ?? startedAt;
  const result: TurnPerformanceSnapshot = {
    state,
    elapsedSeconds: Math.max(0, (endAt - startedAt) / 1_000),
    outputTokens,
  };
  if (firstOutputAt !== null) {
    result.timeToFirstTokenSeconds = Math.max(0, (firstOutputAt - startedAt) / 1_000);
    const generationSeconds = (endAt - firstOutputAt) / 1_000;
    if (generationSeconds > 0) result.outputTokensPerSecond = outputTokens / generationSeconds;
  }
  return result;
}

