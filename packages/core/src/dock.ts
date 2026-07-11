import pc from "picocolors";

import { formatTokens } from "./format.js";
import { classifyMetric, type MetricLevel } from "./metrics.js";
import type { StatusLineSnapshot } from "./statusline.js";

export interface DockStatusOptions {
  color: boolean;
}

function metricColor(
  value: string,
  level: MetricLevel,
  colors: ReturnType<typeof pc.createColors>,
): string {
  if (level === "high") return colors.bold(colors.red(value));
  if (level === "medium") return colors.yellow(value);
  if (level === "neutral") return colors.dim(value);
  return colors.green(value);
}

function gitText(git: NonNullable<StatusLineSnapshot["git"]>): string {
  const sync = `${git.ahead ? ` +${git.ahead}` : ""}${git.behind ? `/-${git.behind}` : ""}`;
  return `${git.branch}${git.dirty ? "*" : ""}${sync}`;
}

export function renderDockStatus(
  snapshot: StatusLineSnapshot | null,
  options: DockStatusOptions,
): string {
  const colors = pc.createColors(options.color);
  const line = (label: string, value: string) => `${label.padEnd(10)}${value}`;
  const lines = [colors.bold(colors.cyan("Codex Insights"))];
  if (!snapshot) return `${lines[0]}\n${colors.dim("No active Codex session")}`;

  if (snapshot.model) {
    lines.push(line("Model", colors.blue([snapshot.model.name, snapshot.model.effort].filter(Boolean).join(" "))));
  }
  if (snapshot.git) lines.push(line("Git", colors.magenta(gitText(snapshot.git))));
  if (snapshot.context) {
    const level = classifyMetric("context", snapshot.context.ratio);
    const marker = level === "high" ? " high" : level === "medium" ? " warn" : "";
    const value = `${formatTokens(snapshot.context.usedTokens)} / ${formatTokens(snapshot.context.maxTokens)}  ${(snapshot.context.ratio * 100).toFixed(1)}%${marker}`;
    lines.push(line("Context", metricColor(value, level, colors)));
  }
  if (snapshot.cacheRatio !== undefined) {
    const value = `${(snapshot.cacheRatio * 100).toFixed(1)}%`;
    lines.push(line("Cache", metricColor(value, classifyMetric("cache", snapshot.cacheRatio), colors)));
  }
  if (snapshot.performance?.elapsedSeconds !== undefined) {
    const value = `${snapshot.performance.elapsedSeconds.toFixed(1)}s`;
    lines.push(line("Time", metricColor(value, classifyMetric("duration", snapshot.performance.elapsedSeconds), colors)));
  }
  if (snapshot.performance?.outputTokensPerSecond !== undefined) {
    const value = `${snapshot.performance.outputTokensPerSecond.toFixed(1)} tok/s`;
    lines.push(line("Speed", metricColor(value, classifyMetric("speed", snapshot.performance.outputTokensPerSecond), colors)));
  }
  if (snapshot.cumulativeTokens !== undefined) {
    lines.push(line("Total", colors.cyan(formatTokens(snapshot.cumulativeTokens))));
  }
  return lines.join("\n");
}
