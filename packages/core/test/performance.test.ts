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

  it("reports the latest model call instead of mixing it with the whole agent turn", () => {
    const result = deriveTurnPerformance([
      { timestamp: "2026-07-10T02:00:00.000Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-10T02:00:05.000Z", type: "response_item", payload: { type: "reasoning" } },
      { timestamp: "2026-07-10T02:00:08.000Z", type: "response_item", payload: { type: "custom_tool_call" } },
      { timestamp: "2026-07-10T02:00:20.000Z", type: "response_item", payload: { type: "custom_tool_call_output" } },
      {
        timestamp: "2026-07-10T02:00:20.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: { last_token_usage: { output_tokens: 80 } } },
      },
      { timestamp: "2026-07-10T02:00:24.000Z", type: "response_item", payload: { type: "reasoning" } },
      { timestamp: "2026-07-10T02:00:26.000Z", type: "response_item", payload: { type: "message", role: "assistant" } },
      {
        timestamp: "2026-07-10T02:00:27.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: { last_token_usage: { output_tokens: 40 } } },
      },
      { timestamp: "2026-07-10T02:00:28.000Z", type: "event_msg", payload: { type: "task_complete" } },
    ]);

    expect(result).toMatchObject({
      state: "completed",
      elapsedSeconds: 8,
      timeToFirstTokenSeconds: 4,
      outputTokens: 40,
      outputTokensPerSecond: 10,
    });
  });

  it("keeps the last complete model-call metrics while the next call is running", () => {
    const result = deriveTurnPerformance([
      { timestamp: "2026-07-10T02:00:00.000Z", type: "event_msg", payload: { type: "task_started" } },
      { timestamp: "2026-07-10T02:00:05.000Z", type: "response_item", payload: { type: "reasoning" } },
      { timestamp: "2026-07-10T02:00:08.000Z", type: "response_item", payload: { type: "custom_tool_call" } },
      { timestamp: "2026-07-10T02:00:20.000Z", type: "response_item", payload: { type: "custom_tool_call_output" } },
      {
        timestamp: "2026-07-10T02:00:20.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: { last_token_usage: { output_tokens: 80 } } },
      },
      { timestamp: "2026-07-10T02:00:24.000Z", type: "response_item", payload: { type: "reasoning" } },
    ]);

    expect(result).toMatchObject({
      state: "running",
      elapsedSeconds: 8,
      timeToFirstTokenSeconds: 5,
      outputTokens: 80,
      outputTokensPerSecond: 80 / 3,
    });
  });
});
