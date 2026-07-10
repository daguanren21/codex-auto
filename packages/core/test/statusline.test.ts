import { stripVTControlCharacters } from "node:util";

import stringWidth from "string-width";
import { describe, expect, it } from "vitest";

import { renderStatusLine, type StatusLineSnapshot } from "../src/index.js";

const snapshot: StatusLineSnapshot = {
  model: { name: "gpt-5.6-sol", effort: "high" },
  git: { branch: "main", dirty: true, ahead: 2, behind: 1 },
  context: { usedTokens: 162_991, maxTokens: 353_400, ratio: 0.461 },
  cacheRatio: 0.995,
  performance: { elapsedSeconds: 32.5, outputTokensPerSecond: 19.8 },
  cumulativeTokens: 3_733_101,
};

function stripTmux(value: string): string {
  return value
    .replaceAll("##", "\u0000")
    .replaceAll(/#\[[^\]]*\]/g, "")
    .replaceAll("\u0000", "#");
}

describe("renderStatusLine", () => {
  it("renders all modules without ANSI when color is disabled", () => {
    expect(renderStatusLine(snapshot, { color: false, width: 160 })).toBe(
      "gpt-5.6-sol high | main* +2/-1 | ctx 46.1% 163k/353.4k | cache 99.5% | time 32.5s | speed 19.8t/s | total 3.73m",
    );
  });

  it("uses distinct ANSI colors while preserving plain text", () => {
    const rendered = renderStatusLine(snapshot, { color: true, width: 160 });

    expect(rendered).toContain("\u001B[34m");
    expect(rendered).toContain("\u001B[35m");
    expect(rendered).toContain("\u001B[36m");
    expect(rendered).toContain("\u001B[33m");
    expect(stripVTControlCharacters(rendered)).toBe(renderStatusLine(snapshot, { color: false, width: 160 }));
  });

  it("colors high context usage red and adds a text marker", () => {
    const rendered = renderStatusLine(
      { ...snapshot, context: { usedTokens: 318_060, maxTokens: 353_400, ratio: 0.9 } },
      { color: true, width: 160 },
    );

    expect(rendered).toContain("\u001B[31m");
    expect(stripVTControlCharacters(rendered)).toContain("ctx 90.0% 318.1k/353.4k high");
  });

  it("renders tmux-native colors without ANSI", () => {
    const rendered = renderStatusLine(snapshot, { color: true, width: 160, format: "tmux" });

    expect(rendered).toContain("#[fg=#3b82f6]");
    expect(rendered).toContain("#[fg=#d946ef]");
    expect(rendered).not.toContain("\u001B[");
    expect(stripTmux(rendered)).toBe(
      renderStatusLine(snapshot, { color: false, width: 160, format: "plain" }),
    );
  });

  it("escapes branch text that resembles a tmux directive", () => {
    const rendered = renderStatusLine(
      { ...snapshot, git: { ...snapshot.git!, branch: "feature/#[fg=red]" } },
      { color: true, width: 160, format: "tmux" },
    );

    expect(rendered).toContain("feature/##[fg=red]");
    expect(stripTmux(rendered)).toContain("feature/#[fg=red]");
  });

  it.each([30, 40, 60])("keeps tmux output within %i visible columns", (width) => {
    const rendered = renderStatusLine(snapshot, { color: true, width, format: "tmux" });
    const plain = stripTmux(rendered);

    expect(stringWidth(plain)).toBeLessThanOrEqual(width);
    expect(plain).toContain("main*");
    expect(plain).toContain("ctx 46.1%");
  });

  it.each([30, 40, 60])("never exceeds a %i-column terminal", (width) => {
    const rendered = renderStatusLine(snapshot, { color: true, width });
    const plain = stripVTControlCharacters(rendered);

    expect(stringWidth(plain)).toBeLessThanOrEqual(width);
    expect(plain).toContain("main*");
    expect(plain).toContain("ctx 46.1%");
  });
});
