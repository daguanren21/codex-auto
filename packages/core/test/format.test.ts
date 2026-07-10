import { describe, expect, it } from "vitest";

import { classifyMetric, formatTokens } from "../src/index.js";

describe("formatTokens", () => {
  it.each([
    [643, "643"],
    [162_348, "162.3k"],
    [353_400, "353.4k"],
    [3_733_101, "3.73m"],
  ])("formats %i tokens as %s", (value, expected) => {
    expect(formatTokens(value)).toBe(expected);
  });
});

describe("classifyMetric", () => {
  it.each([
    ["context", 0.46, "low"],
    ["context", 0.6, "medium"],
    ["context", 0.85, "high"],
    ["duration", 14.9, "low"],
    ["duration", 15, "medium"],
    ["duration", 45.1, "high"],
    ["speed", 50, "low"],
    ["speed", 15, "medium"],
    ["speed", 14.9, "high"],
    ["cache", 0.8, "low"],
    ["cache", 0.5, "medium"],
    ["cache", 0.49, "neutral"],
  ] as const)("classifies %s=%d as %s", (kind, value, expected) => {
    expect(classifyMetric(kind, value)).toBe(expected);
  });
});
