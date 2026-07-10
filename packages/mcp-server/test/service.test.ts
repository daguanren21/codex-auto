import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createStatusService } from "../src/service.js";

const codexHome = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../core/test/fixtures/codex-home",
);

describe("Codex Insights MCP service", () => {
  it("returns structured context statistics", async () => {
    const service = createStatusService();
    const result = await service.getContextStats({ codexHome, cwd: "/workspace/project" });

    expect(result.structuredContent).toMatchObject({
      model: "gpt-5.6-sol",
      effort: "high",
      contextTokens: 162_991,
      maxContextTokens: 353_400,
      contextUsage: 0.461208,
      cumulativeTokens: 3_733_101,
      elapsedSeconds: 13,
      outputTokensPerSecond: 321.5,
    });
    expect(result.content[0]?.text).toContain("46.1%");
  });

  it("returns unavailable instead of zero for missing rate limits", async () => {
    const service = createStatusService();
    const result = await service.getRateLimits({ codexHome, cwd: "/workspace/project" });

    expect(result.structuredContent).toEqual({ available: false, primary: null, secondary: null });
  });

  it("returns usage totals for a requested time range", async () => {
    const service = createStatusService();
    const result = await service.getUsageSummary({
      codexHome,
      start: "2026-07-10T02:00:00.000Z",
      end: "2026-07-10T05:00:00.000Z",
    });

    expect(result.structuredContent).toMatchObject({
      range: {
        start: "2026-07-10T02:00:00.000Z",
        end: "2026-07-10T05:00:00.000Z",
      },
      totalTokens: 166_021,
      sessionCount: 3,
      models: {
        "gpt-5.6-sol": { totalTokens: 165_011 },
      },
    });
  });

  it("lists local sessions without conversation content", async () => {
    const service = createStatusService();
    const result = await service.listSessions({ codexHome });

    expect(result.structuredContent.available).toBe(true);
    expect(result.structuredContent.sessions.length).toBeGreaterThan(0);
    expect(result.structuredContent.sessions[0]).toEqual(expect.objectContaining({
      sessionId: expect.any(String),
      cwd: expect.any(String),
      contextUsage: expect.any(Number),
    }));
    expect(JSON.stringify(result.structuredContent)).not.toContain("Just say Hi");
  });
});
