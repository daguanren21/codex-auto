import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectUsage } from "../src/index.js";

const codexHome = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "codex-home");

describe("collectUsage", () => {
  it("sums per-request usage within a time range and groups by model", async () => {
    const result = await collectUsage({
      codexHome,
      start: new Date("2026-07-10T02:00:00.000Z"),
      end: new Date("2026-07-10T05:00:00.000Z"),
    });

    expect(result).toMatchObject({
      inputTokens: 165_348,
      cachedInputTokens: 164_236,
      outputTokens: 673,
      reasoningOutputTokens: 407,
      totalTokens: 166_021,
      sessionCount: 3,
    });
    expect(result.cacheRatio).toBeCloseTo(0.993, 3);
    expect(result.models).toMatchObject({
      "gpt-5.4": { totalTokens: 1_010 },
      "gpt-5.6-sol": { totalTokens: 165_011 },
    });
  });
});
