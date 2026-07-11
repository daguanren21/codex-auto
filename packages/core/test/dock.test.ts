import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vitest";

import { renderDockStatus, type StatusLineSnapshot } from "../src/index.js";

const snapshot: StatusLineSnapshot = {
  model: { name: "gpt-5.6-sol", effort: "high" },
  git: { branch: "main", dirty: true, ahead: 2, behind: 1 },
  context: { usedTokens: 162_991, maxTokens: 353_400, ratio: 0.461 },
  cacheRatio: 0.995,
  performance: { elapsedSeconds: 32.5, outputTokensPerSecond: 19.8 },
  cumulativeTokens: 3_733_101,
};

describe("renderDockStatus", () => {
  it("renders every available metric in a narrow multi-line dashboard", () => {
    expect(renderDockStatus(snapshot, { color: false })).toBe([
      "Codex Insights",
      "Model     gpt-5.6-sol high",
      "Git       main* +2/-1",
      "Context   163k / 353.4k  46.1%",
      "Cache     99.5%",
      "Time      32.5s",
      "Speed     19.8 tok/s",
      "Total     3.73m",
    ].join("\n"));
  });

  it("renders a quiet idle frame when no matching session exists", () => {
    expect(renderDockStatus(null, { color: false })).toBe("Codex Insights\nNo active Codex session");
  });

  it.each([
    [0.7, "warn", "\u001B[33m", "70.0%"],
    [0.9, "high", "\u001B[31m", "90.0%"],
  ] as const)("colors %s context as %s", (ratio, marker, escape, percentage) => {
    const rendered = renderDockStatus(
      { ...snapshot, context: { usedTokens: 300, maxTokens: 400, ratio } },
      { color: true },
    );

    expect(rendered).toContain(escape);
    expect(stripVTControlCharacters(rendered)).toContain(`${percentage} ${marker}`);
  });

  it("preserves the same text when ANSI color is enabled", () => {
    expect(stripVTControlCharacters(renderDockStatus(snapshot, { color: true })))
      .toBe(renderDockStatus(snapshot, { color: false }));
  });
});
