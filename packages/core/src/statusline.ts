import { stripVTControlCharacters } from "node:util";

import pc from "picocolors";
import stringWidth from "string-width";

import { formatTokens } from "./format.js";
import { classifyMetric, type MetricLevel } from "./metrics.js";

export interface StatusLineSnapshot {
  model?: { name: string; effort?: string };
  git?: { branch: string; dirty: boolean; ahead: number; behind: number };
  context?: { usedTokens: number; maxTokens: number; ratio: number };
  cacheRatio?: number;
  performance?: { elapsedSeconds?: number; outputTokensPerSecond?: number };
  cumulativeTokens?: number;
}

export interface StatusLineOptions {
  color: boolean;
  width: number;
}

type SegmentKey = "model" | "git" | "context" | "cache" | "time" | "speed" | "total";

interface Segment {
  key: SegmentKey;
  plain: string;
  colored: string;
}

function metricColor(colors: ReturnType<typeof pc.createColors>, level: MetricLevel, text: string): string {
  if (level === "high") return colors.bold(colors.red(text));
  if (level === "medium") return colors.yellow(text);
  if (level === "neutral") return colors.dim(text);
  return colors.green(text);
}

function contextText(context: NonNullable<StatusLineSnapshot["context"]>, compact: boolean): string {
  const ratio = Math.max(0, Math.min(context.ratio, 1));
  const marker = ratio >= 0.85 ? " high" : ratio >= 0.6 ? " warn" : "";
  const counts = compact ? "" : ` ${formatTokens(context.usedTokens)}/${formatTokens(context.maxTokens)}`;
  return `ctx ${(ratio * 100).toFixed(1)}%${counts}${marker}`;
}

function createSegments(snapshot: StatusLineSnapshot, color: boolean, compactContext = false): Segment[] {
  const colors = pc.createColors(color);
  const segments: Segment[] = [];

  if (snapshot.model) {
    const plain = [snapshot.model.name, snapshot.model.effort].filter(Boolean).join(" ");
    segments.push({ key: "model", plain, colored: colors.blue(plain) });
  }
  if (snapshot.git) {
    const sync = `${snapshot.git.ahead ? ` +${snapshot.git.ahead}` : ""}${snapshot.git.behind ? `/-${snapshot.git.behind}` : ""}`;
    const plain = `${snapshot.git.branch}${snapshot.git.dirty ? "*" : ""}${sync}`;
    segments.push({ key: "git", plain, colored: colors.magenta(plain) });
  }
  if (snapshot.context) {
    const plain = contextText(snapshot.context, compactContext);
    const level = classifyMetric("context", snapshot.context.ratio);
    segments.push({ key: "context", plain, colored: metricColor(colors, level, plain) });
  }
  if (snapshot.cacheRatio !== undefined) {
    const plain = `cache ${(snapshot.cacheRatio * 100).toFixed(1)}%`;
    segments.push({
      key: "cache",
      plain,
      colored: metricColor(colors, classifyMetric("cache", snapshot.cacheRatio), plain),
    });
  }
  if (snapshot.performance?.elapsedSeconds !== undefined) {
    const plain = `time ${snapshot.performance.elapsedSeconds.toFixed(1)}s`;
    segments.push({
      key: "time",
      plain,
      colored: metricColor(colors, classifyMetric("duration", snapshot.performance.elapsedSeconds), plain),
    });
  }
  if (snapshot.performance?.outputTokensPerSecond !== undefined) {
    const plain = `speed ${snapshot.performance.outputTokensPerSecond.toFixed(1)}t/s`;
    segments.push({
      key: "speed",
      plain,
      colored: metricColor(colors, classifyMetric("speed", snapshot.performance.outputTokensPerSecond), plain),
    });
  }
  if (snapshot.cumulativeTokens !== undefined) {
    const plain = `total ${formatTokens(snapshot.cumulativeTokens)}`;
    segments.push({ key: "total", plain, colored: colors.cyan(plain) });
  }
  return segments;
}

function lineWidth(segments: Segment[]): number {
  return stringWidth(segments.map((segment) => segment.plain).join(" | "));
}

export function renderStatusLine(snapshot: StatusLineSnapshot, options: StatusLineOptions): string {
  let compactContext = false;
  let segments = createSegments(snapshot, options.color, compactContext);
  const removalOrder: SegmentKey[] = ["total", "cache", "model", "speed", "time"];

  for (const key of removalOrder) {
    if (lineWidth(segments) <= options.width) break;
    segments = segments.filter((segment) => segment.key !== key);
  }
  if (lineWidth(segments) > options.width) {
    compactContext = true;
    const remaining = new Set(segments.map((segment) => segment.key));
    segments = createSegments(snapshot, options.color, compactContext).filter((segment) => remaining.has(segment.key));
  }

  const rendered = segments.map((segment) => segment.colored).join(pc.createColors(options.color).dim(" | "));
  if (stringWidth(stripVTControlCharacters(rendered)) <= options.width) return rendered;
  return stripVTControlCharacters(rendered).slice(0, Math.max(0, options.width));
}

