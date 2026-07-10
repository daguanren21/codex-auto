import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { deriveTurnPerformance } from "../performance.js";
import type { ModelSettings, RateLimits, SessionSnapshot, TokenUsage } from "./types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tokenUsage(value: unknown): TokenUsage | null {
  const item = object(value);
  if (!item) return null;
  const inputTokens = number(item.input_tokens);
  const cachedInputTokens = number(item.cached_input_tokens);
  const outputTokens = number(item.output_tokens);
  const totalTokens = number(item.total_tokens);
  if (inputTokens === null || cachedInputTokens === null || outputTokens === null || totalTokens === null) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: number(item.reasoning_output_tokens) ?? 0,
    totalTokens,
  };
}

function rateLimits(value: unknown): RateLimits | null {
  const limits = object(value);
  if (!limits) return null;
  const parseWindow = (candidate: unknown) => {
    const window = object(candidate);
    if (!window) return null;
    const result: { usedPercent?: number; windowMinutes?: number; resetsAt?: number } = {};
    const usedPercent = number(window.used_percent);
    const windowMinutes = number(window.window_minutes);
    const resetsAt = number(window.resets_at);
    if (usedPercent !== null) result.usedPercent = usedPercent;
    if (windowMinutes !== null) result.windowMinutes = windowMinutes;
    if (resetsAt !== null) result.resetsAt = resetsAt;
    return result;
  };
  return { primary: parseWindow(limits.primary), secondary: parseWindow(limits.secondary) };
}

function isNormalAssistantMessage(payload: JsonObject): boolean {
  if (payload.type !== "message" || payload.role !== "assistant" || !Array.isArray(payload.content)) return false;
  const text = payload.content
    .map((item) => object(item)?.text)
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return !lowered.includes("usage limit") && !lowered.includes("try again at");
}

export async function readSessionSnapshot(path: string): Promise<SessionSnapshot | null> {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let model: ModelSettings | undefined;
  let updatedAt: Date | undefined;
  let lastUsage: TokenUsage | undefined;
  let cumulativeUsage: TokenUsage | undefined;
  let maxTokens: number | undefined;
  let limits: RateLimits | null = null;
  let stale = false;
  let limitObservedAt: Date | undefined;
  let lastAssistantAt: Date | undefined;
  const performanceEvents: Array<{
    timestamp?: string;
    type?: string;
    payload?: Record<string, unknown>;
  }> = [];

  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    let event: JsonObject;
    try {
      event = JSON.parse(line) as JsonObject;
    } catch {
      continue;
    }
    const timestamp = typeof event.timestamp === "string" ? new Date(event.timestamp) : null;
    if (timestamp && !Number.isNaN(timestamp.getTime())) updatedAt = timestamp;
    const payload = object(event.payload);
    if (!payload) continue;
    performanceEvents.push({
      ...(typeof event.timestamp === "string" ? { timestamp: event.timestamp } : {}),
      ...(typeof event.type === "string" ? { type: event.type } : {}),
      payload,
    });

    if (event.type === "response_item" && timestamp && isNormalAssistantMessage(payload)) {
      lastAssistantAt = timestamp;
    }

    if (event.type === "session_meta") {
      if (typeof payload.session_id === "string") sessionId = payload.session_id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      continue;
    }
    if (event.type === "turn_context") {
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.model === "string") {
        model = typeof payload.effort === "string"
          ? { name: payload.model, effort: payload.effort, source: "session" }
          : { name: payload.model, source: "session" };
      }
      continue;
    }
    if (event.type !== "event_msg" || payload.type !== "token_count") continue;

    limits = rateLimits(payload.rate_limits);
    if (
      timestamp
      && ((limits?.primary?.usedPercent ?? 0) >= 100 || (limits?.secondary?.usedPercent ?? 0) >= 100)
    ) {
      limitObservedAt = timestamp;
    }
    const info = object(payload.info);
    if (!info) {
      if (lastUsage) stale = true;
      continue;
    }
    const nextLastUsage = tokenUsage(info.last_token_usage);
    const nextCumulativeUsage = tokenUsage(info.total_token_usage);
    const nextMaxTokens = number(info.model_context_window);
    if (!nextLastUsage || !nextCumulativeUsage || nextMaxTokens === null || nextMaxTokens <= 0) continue;
    lastUsage = nextLastUsage;
    cumulativeUsage = nextCumulativeUsage;
    maxTokens = nextMaxTokens;
    stale = false;
  }

  if (!sessionId || !cwd || !updatedAt || !lastUsage || !cumulativeUsage || !maxTokens) return null;
  const performance = deriveTurnPerformance(performanceEvents);
  return {
    sessionId,
    rolloutPath: path,
    cwd,
    updatedAt,
    ...(model ? { model } : {}),
    context: {
      usedTokens: lastUsage.totalTokens,
      maxTokens,
      ratio: lastUsage.totalTokens / maxTokens,
    },
    lastUsage,
    cumulativeUsage,
    cumulativeTokens: cumulativeUsage.totalTokens,
    cacheRatio: lastUsage.inputTokens > 0 ? lastUsage.cachedInputTokens / lastUsage.inputTokens : 0,
    limits,
    stale,
    ...(performance ? { performance } : {}),
    ...(limitObservedAt ? { limitObservedAt } : {}),
    ...(lastAssistantAt ? { lastAssistantAt } : {}),
  };
}
