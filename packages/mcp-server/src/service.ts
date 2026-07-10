import { collectUsage, getCurrentStatus, listSessions as listCodexSessions } from "@codex-auto/core";

export interface StatusInput {
  codexHome: string;
  cwd: string;
}

export interface UsageInput {
  codexHome: string;
  start?: string;
  end?: string;
}

interface ToolResult<T extends Record<string, unknown>> {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
  isError?: boolean;
}

function result<T extends Record<string, unknown>>(data: T, summary: string): ToolResult<T> {
  return { content: [{ type: "text", text: summary }], structuredContent: data };
}

function errorResult(summary: string): ToolResult<{ available: false }> {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { available: false },
    isError: true,
  };
}

export function createStatusService() {
  return {
    async getStatus(input: StatusInput) {
      const snapshot = await getCurrentStatus(input);
      if (!snapshot) {
        return errorResult(`No Codex session found for ${input.cwd}`);
      }
      return result(
        { available: true, ...snapshot },
        `${snapshot.model?.name ?? "unknown"} context ${(snapshot.context.ratio * 100).toFixed(1)}%`,
      );
    },

    async getContextStats(input: StatusInput) {
      const snapshot = await getCurrentStatus(input);
      if (!snapshot) {
        return errorResult(`No Codex session found for ${input.cwd}`);
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

    async getUsageSummary(input: UsageInput) {
      const now = new Date();
      const start = input.start
        ? new Date(input.start)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = input.end ? new Date(input.end) : now;
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        return errorResult("Usage range must contain valid dates with start before end");
      }
      const summary = await collectUsage({ codexHome: input.codexHome, start, end });
      const data = {
        available: true,
        range: { start: start.toISOString(), end: end.toISOString() },
        ...summary,
      };
      return result(data, `${summary.totalTokens} tokens across ${summary.sessionCount} sessions`);
    },

    async listSessions(input: { codexHome: string }) {
      const sessions = (await listCodexSessions(input)).map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        updatedAt: session.updatedAt.toISOString(),
        model: session.model?.name ?? null,
        effort: session.model?.effort ?? null,
        contextUsage: Number(session.context.ratio.toFixed(6)),
        contextTokens: session.context.usedTokens,
        maxContextTokens: session.context.maxTokens,
        cumulativeTokens: session.cumulativeTokens,
        stale: session.stale,
      }));
      return result({ available: true, sessions }, `${sessions.length} local Codex sessions`);
    },
  };
}
