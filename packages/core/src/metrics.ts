export type MetricKind = "context" | "duration" | "speed" | "cache";
export type MetricLevel = "low" | "medium" | "high" | "neutral";

export function classifyMetric(kind: MetricKind, value: number): MetricLevel {
  if (kind === "context") {
    return value >= 0.85 ? "high" : value >= 0.6 ? "medium" : "low";
  }
  if (kind === "duration") {
    return value > 45 ? "high" : value >= 15 ? "medium" : "low";
  }
  if (kind === "speed") {
    return value < 15 ? "high" : value < 50 ? "medium" : "low";
  }
  return value < 0.5 ? "neutral" : value < 0.8 ? "medium" : "low";
}

