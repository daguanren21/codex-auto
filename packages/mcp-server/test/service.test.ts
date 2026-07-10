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
});
