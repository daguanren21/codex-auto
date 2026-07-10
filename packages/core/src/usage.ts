import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface UsageSummary extends UsageTotals {
  cacheRatio: number;
  sessionCount: number;
  models: Record<string, UsageTotals>;
}

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
}

function add(target: UsageTotals, usage: Record<string, unknown>): boolean {
  const input = usage.input_tokens;
  const cached = usage.cached_input_tokens;
  const output = usage.output_tokens;
  const total = usage.total_tokens;
  if (![input, cached, output, total].every((value) => typeof value === "number" && Number.isFinite(value))) return false;
  target.inputTokens += input as number;
  target.cachedInputTokens += cached as number;
  target.outputTokens += output as number;
  target.reasoningOutputTokens += typeof usage.reasoning_output_tokens === "number" ? usage.reasoning_output_tokens : 0;
  target.totalTokens += total as number;
  return true;
}

async function rollouts(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await rollouts(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) paths.push(path);
  }
  return paths;
}

export async function collectUsage(options: {
  codexHome: string;
  start: Date;
  end: Date;
}): Promise<UsageSummary> {
  const totals = emptyTotals();
  const models: Record<string, UsageTotals> = {};
  const usedSessions = new Set<string>();

  for (const path of await rollouts(join(options.codexHome, "sessions"))) {
    let model = "unknown";
    let sessionId = path;
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const payload = event.payload as Record<string, unknown> | null | undefined;
      if (!payload) continue;
      if (event.type === "session_meta" && typeof payload.session_id === "string") sessionId = payload.session_id;
      if (event.type === "turn_context" && typeof payload.model === "string") model = payload.model;
      if (event.type !== "event_msg" || payload.type !== "token_count") continue;
      const at = typeof event.timestamp === "string" ? new Date(event.timestamp) : null;
      if (!at || Number.isNaN(at.getTime()) || at < options.start || at >= options.end) continue;
      const info = payload.info as Record<string, unknown> | null | undefined;
      const usage = info?.last_token_usage as Record<string, unknown> | undefined;
      if (!usage) continue;
      const modelTotals = models[model] ?? emptyTotals();
      if (!add(modelTotals, usage)) continue;
      models[model] = modelTotals;
      add(totals, usage);
      usedSessions.add(sessionId);
    }
  }
  return {
    ...totals,
    cacheRatio: totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0,
    sessionCount: usedSessions.size,
    models,
  };
}
