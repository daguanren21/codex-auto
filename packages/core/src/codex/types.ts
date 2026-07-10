export interface ModelSettings {
  name: string;
  effort?: string;
  source: "session" | "config";
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface RateLimitWindow {
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: number;
}

export interface RateLimits {
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

export interface SessionSnapshot {
  sessionId: string;
  rolloutPath: string;
  cwd: string;
  updatedAt: Date;
  model?: ModelSettings;
  context: {
    usedTokens: number;
    maxTokens: number;
    ratio: number;
  };
  lastUsage: TokenUsage;
  cumulativeUsage: TokenUsage;
  cumulativeTokens: number;
  cacheRatio: number;
  limits: RateLimits | null;
  stale: boolean;
  performance?: import("../performance.js").TurnPerformanceSnapshot;
  limitObservedAt?: Date;
  lastAssistantAt?: Date;
}
