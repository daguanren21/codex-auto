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
  let requestStartedAt: number | null = null;
  let firstOutputAt: number | null = null;
  let lastOutputAt: number | null = null;
  let pendingInputAt: number | null = null;
  let latest: { startedAt: number; firstOutputAt: number | null; endedAt: number; outputTokens: number } | null = null;
  let latestCanExtendToTaskComplete = false;
  let state: TurnPerformanceSnapshot["state"] = "running";

  for (const event of events) {
    const at = timestamp(event);
    const payload = event.payload;
    if (at === null || !payload) continue;
    if (event.type === "event_msg" && payload.type === "task_started") {
      requestStartedAt = at;
      firstOutputAt = null;
      lastOutputAt = null;
      pendingInputAt = null;
      latest = null;
      latestCanExtendToTaskComplete = false;
      state = "running";
      continue;
    }
    if (requestStartedAt === null) continue;
    if (event.type === "response_item") {
      const payloadType = typeof payload.type === "string" ? payload.type : "";
      const isInput = payloadType.endsWith("_output") || (payloadType === "message" && payload.role === "user");
      if (isInput) pendingInputAt = at;
      else {
        firstOutputAt ??= at;
        lastOutputAt = at;
      }
    }
    if (event.type === "event_msg" && payload.type === "token_count") {
      const info = payload.info as Record<string, unknown> | null | undefined;
      const usage = info?.last_token_usage as Record<string, unknown> | undefined;
      if (typeof usage?.output_tokens === "number" && firstOutputAt !== null) {
        const hasNextRequest = pendingInputAt !== null;
        latest = {
          startedAt: requestStartedAt,
          firstOutputAt,
          endedAt: hasNextRequest ? (lastOutputAt ?? at) : at,
          outputTokens: usage.output_tokens,
        };
        latestCanExtendToTaskComplete = !hasNextRequest;
        if (hasNextRequest) {
          requestStartedAt = pendingInputAt;
          firstOutputAt = null;
          lastOutputAt = null;
          pendingInputAt = null;
        }
      }
    }
    if (event.type === "event_msg" && payload.type === "task_complete") {
      state = "completed";
      if (latest && latestCanExtendToTaskComplete) latest.endedAt = at;
      else if (!latest && requestStartedAt !== null) {
        latest = { startedAt: requestStartedAt, firstOutputAt, endedAt: at, outputTokens: 0 };
      }
    }
  }

  if (requestStartedAt === null) return null;
  const call = latest ?? {
    startedAt: requestStartedAt,
    firstOutputAt,
    endedAt: timestamp(events.at(-1) ?? {}) ?? requestStartedAt,
    outputTokens: 0,
  };
  const result: TurnPerformanceSnapshot = {
    state,
    elapsedSeconds: Math.max(0, (call.endedAt - call.startedAt) / 1_000),
    outputTokens: call.outputTokens,
  };
  if (call.firstOutputAt !== null) {
    result.timeToFirstTokenSeconds = Math.max(0, (call.firstOutputAt - call.startedAt) / 1_000);
    const generationSeconds = (call.endedAt - call.firstOutputAt) / 1_000;
    if (generationSeconds > 0 && call.outputTokens > 0) {
      result.outputTokensPerSecond = call.outputTokens / generationSeconds;
    }
  }
  return result;
}
