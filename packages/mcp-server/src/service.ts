import { getCurrentStatus } from "@codex-auto/core";

export interface StatusInput {
  codexHome: string;
  cwd: string;
}

interface ToolResult<T extends Record<string, unknown>> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
  isError?: boolean;
}

function result<T extends Record<string, unknown>>(data: T, summary: string): ToolResult<T> {
  return { content: [{ type: "text", text: summary }], structuredContent: data };
}

export function createStatusService() {
  return {
    async getStatus(input: StatusInput) {
      const snapshot = await getCurrentStatus(input);
      if (!snapshot) {
        return {
          content: [{ type: "text" as const, text: `No Codex session found for ${input.cwd}` }],
          structuredContent: { available: false },
          isError: true,
        };
      }
      return result(
        { available: true, ...snapshot },
        `${snapshot.model?.name ?? "unknown"} context ${(snapshot.context.ratio * 100).toFixed(1)}%`,
      );
    },

    async getContextStats(input: StatusInput) {
      const snapshot = await getCurrentStatus(input);
      if (!snapshot) {
        return {
          content: [{ type: "text" as const, text: `No Codex session found for ${input.cwd}` }],
          structuredContent: { available: false },
          isError: true,
        };
      }
      const data = {
        available: true,
        model: snapshot.model?.name ?? null,
        effort: snapshot.model?.effort ?? null,
        contextTokens: snapshot.context.usedTokens,
        maxContextTokens: snapshot.context.maxTokens,
        contextUsage: Number(snapshot.context.ratio.toFixed(6)),
        cacheRatio: Number(snapshot.cacheRatio.toFixed(6)),
        cumulativeTokens: snapshot.cumulativeTokens,
        elapsedSeconds: snapshot.performance?.elapsedSeconds ?? null,
        outputTokensPerSecond: snapshot.performance?.outputTokensPerSecond ?? null,
        stale: snapshot.stale,
      };
      return result(data, `${data.model ?? "unknown"} context ${(data.contextUsage * 100).toFixed(1)}%`);
    },

    async getRateLimits(input: StatusInput) {
      const snapshot = await getCurrentStatus(input);
      const data = snapshot?.limits
        ? { available: true, primary: snapshot.limits.primary ?? null, secondary: snapshot.limits.secondary ?? null }
        : { available: false, primary: null, secondary: null };
      return result(data, data.available ? JSON.stringify(data) : "Rate limits unavailable");
    },
  };
}

