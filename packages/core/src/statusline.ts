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
  format?: StatusLineFormat;
}

export type StatusLineFormat = "ansi" | "plain" | "tmux";

type SegmentKey = "model" | "git" | "context" | "cache" | "time" | "speed" | "total";
type SegmentTone = "blue" | "magenta" | "cyan" | MetricLevel;

interface Segment {
  key: SegmentKey;
  plain: string;
  tone: SegmentTone;
}

const TMUX_COLORS: Record<SegmentTone, string> = {
  blue: "#3b82f6",
  magenta: "#d946ef",
  cyan: "#06b6d4",
  low: "#22c55e",
  medium: "#eab308",
  high: "#ef4444",
  neutral: "#6b7280",
};

function contextText(context: NonNullable<StatusLineSnapshot["context"]>, compact: boolean): string {
  const ratio = Math.max(0, Math.min(context.ratio, 1));
  const marker = ratio >= 0.85 ? " high" : ratio >= 0.6 ? " warn" : "";
  const counts = compact ? "" : ` ${formatTokens(context.usedTokens)}/${formatTokens(context.maxTokens)}`;
  return `ctx ${(ratio * 100).toFixed(1)}%${counts}${marker}`;
}

function createSegments(snapshot: StatusLineSnapshot, compactContext = false): Segment[] {
  const segments: Segment[] = [];

  if (snapshot.model) {
    const plain = [snapshot.model.name, snapshot.model.effort].filter(Boolean).join(" ");
    segments.push({ key: "model", plain, tone: "blue" });
  }
  if (snapshot.git) {
    const sync = `${snapshot.git.ahead ? ` +${snapshot.git.ahead}` : ""}${snapshot.git.behind ? `/-${snapshot.git.behind}` : ""}`;
    const plain = `${snapshot.git.branch}${snapshot.git.dirty ? "*" : ""}${sync}`;
    segments.push({ key: "git", plain, tone: "magenta" });
  }
  if (snapshot.context) {
    const plain = contextText(snapshot.context, compactContext);
    const level = classifyMetric("context", snapshot.context.ratio);
    segments.push({ key: "context", plain, tone: level });
  }
  if (snapshot.cacheRatio !== undefined) {
    const plain = `cache ${(snapshot.cacheRatio * 100).toFixed(1)}%`;
    segments.push({
      key: "cache",
      plain,
      tone: classifyMetric("cache", snapshot.cacheRatio),
    });
  }
  if (snapshot.performance?.elapsedSeconds !== undefined) {
    const plain = `time ${snapshot.performance.elapsedSeconds.toFixed(1)}s`;
    segments.push({
      key: "time",
      plain,
      tone: classifyMetric("duration", snapshot.performance.elapsedSeconds),
    });
  }
  if (snapshot.performance?.outputTokensPerSecond !== undefined) {
    const plain = `speed ${snapshot.performance.outputTokensPerSecond.toFixed(1)}t/s`;
    segments.push({
      key: "speed",
      plain,
      tone: classifyMetric("speed", snapshot.performance.outputTokensPerSecond),
    });
  }
  if (snapshot.cumulativeTokens !== undefined) {
    const plain = `total ${formatTokens(snapshot.cumulativeTokens)}`;
    segments.push({ key: "total", plain, tone: "cyan" });
  }
  return segments;
}

function lineWidth(segments: Segment[]): number {
  return stringWidth(segments.map((segment) => segment.plain).join(" | "));
}

function renderAnsiSegment(segment: Segment, color: boolean): string {
  const colors = pc.createColors(color);
  if (segment.tone === "blue") return colors.blue(segment.plain);
  if (segment.tone === "magenta") return colors.magenta(segment.plain);
  if (segment.tone === "cyan") return colors.cyan(segment.plain);
  if (segment.tone === "high") return colors.bold(colors.red(segment.plain));
  if (segment.tone === "medium") return colors.yellow(segment.plain);
  if (segment.tone === "neutral") return colors.dim(segment.plain);
  return colors.green(segment.plain);
}

function tmuxEscape(value: string): string {
  return value.replaceAll("#", "##");
}

function renderTmuxSegment(segment: Segment): string {
  const bold = segment.tone === "high" ? ",bold" : "";
  return `#[fg=${TMUX_COLORS[segment.tone]}${bold}]${tmuxEscape(segment.plain)}#[default]`;
}

function renderSegments(segments: Segment[], options: StatusLineOptions): string {
  const format = options.format ?? (options.color ? "ansi" : "plain");
  if (format === "plain") return segments.map((segment) => segment.plain).join(" | ");
  if (format === "tmux") {
    const separator = "#[fg=#6b7280] | #[default]";
    return segments.map(renderTmuxSegment).join(separator);
  }
  const colors = pc.createColors(options.color);
  return segments.map((segment) => renderAnsiSegment(segment, options.color)).join(colors.dim(" | "));
}

function truncateToWidth(value: string, width: number): string {
  let result = "";
  let used = 0;
  for (const character of value) {
    const characterWidth = stringWidth(character);
    if (used + characterWidth > width) break;
    result += character;
    used += characterWidth;
  }
  return result;
}

export function renderStatusLine(snapshot: StatusLineSnapshot, options: StatusLineOptions): string {
  let compactContext = false;
  let segments = createSegments(snapshot, compactContext);
  const removalOrder: SegmentKey[] = ["total", "cache", "model", "speed", "time"];

  for (const key of removalOrder) {
    if (lineWidth(segments) <= options.width) break;
    segments = segments.filter((segment) => segment.key !== key);
  }
  if (lineWidth(segments) > options.width) {
    compactContext = true;
    const remaining = new Set(segments.map((segment) => segment.key));
    segments = createSegments(snapshot, compactContext).filter((segment) => remaining.has(segment.key));
  }

  const rendered = renderSegments(segments, options);
  if (lineWidth(segments) <= options.width) return rendered;
  const plain = truncateToWidth(renderSegments(segments, { ...options, format: "plain" }), Math.max(0, options.width));
  if (options.format === "tmux") return `#[fg=#6b7280]${tmuxEscape(plain)}#[default]`;
  return plain;
}
