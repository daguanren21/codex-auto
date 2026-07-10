import { describe, expect, it } from "vitest";

import { deriveTurnPerformance } from "../src/index.js";

describe("deriveTurnPerformance", () => {
  it("derives elapsed time, time to first token, and output speed", () => {
    const result = deriveTurnPerformance([
      { timestamp: "2026-07-10T02:00:00.000Z", type: "event_msg", payload: { type: "task_started" } },
      {
        timestamp: "2026-07-10T02:00:05.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant" },
      },
      {
        timestamp: "2026-07-10T02:00:09.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { output_tokens: 80 } },
        },
      },
      { timestamp: "2026-07-10T02:00:10.000Z", type: "event_msg", payload: { type: "task_complete" } },
    ]);

    expect(result).toMatchObject({
      state: "completed",
      elapsedSeconds: 10,
      timeToFirstTokenSeconds: 5,
      outputTokens: 80,
      outputTokensPerSecond: 16,
    });
  });

  it("does not fabricate speed when first output timing is unavailable", () => {
    const result = deriveTurnPerformance([
      { timestamp: "2026-07-10T02:00:00.000Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-10T02:00:10.000Z", type: "event_msg", payload: { type: "task_complete" } },
    ]);

    expect(result).toEqual({
      state: "completed",
      elapsedSeconds: 10,
      outputTokens: 0,
    });
  });
});
