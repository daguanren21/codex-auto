import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { findLatestSession, readConfiguredModel, readSessionSnapshot } from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "codex-home");
const rollout = join(
  fixtures,
  "sessions/2026/07/10/rollout-2026-07-10T10-00-00-11111111-1111-4111-8111-111111111111.jsonl",
);

describe("readSessionSnapshot", () => {
  it("uses the latest complete token event and latest turn context", async () => {
    const snapshot = await readSessionSnapshot(rollout);

    expect(snapshot).toMatchObject({
      sessionId: "11111111-1111-4111-8111-111111111111",
      cwd: "/workspace/project",
      model: { name: "gpt-5.6-sol", effort: "high", source: "session" },
      context: { usedTokens: 162_991, maxTokens: 353_400 },
      cumulativeTokens: 3_733_101,
      limits: null,
      performance: {
        state: "completed",
        elapsedSeconds: 13,
        timeToFirstTokenSeconds: 11,
        outputTokens: 643,
        outputTokensPerSecond: 321.5,
      },
    });
    expect(snapshot?.context.ratio).toBeCloseTo(0.461208, 5);
    expect(snapshot?.cacheRatio).toBeCloseTo(0.995, 3);
    expect(snapshot?.lastUsage.reasoningOutputTokens).toBe(401);
  });
});

describe("readConfiguredModel", () => {
  it("reads the model and effort from config.toml", async () => {
    await expect(readConfiguredModel(join(fixtures, "config.toml"))).resolves.toEqual({
      name: "gpt-5.6-sol",
      effort: "high",
      source: "config",
    });
  });
});

describe("findLatestSession", () => {
  it("finds the newest session for a working directory", async () => {
    const snapshot = await findLatestSession({ codexHome: fixtures, cwd: "/workspace/project" });

    expect(snapshot?.sessionId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("uses the nearest parent workspace session for a nested project", async () => {
    const snapshot = await findLatestSession({
      codexHome: fixtures,
      cwd: "/workspace/project/packages/core",
    });

    expect(snapshot?.sessionId).toBe("11111111-1111-4111-8111-111111111111");
  });
});
