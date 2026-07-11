import { describe, expect, it } from "vitest";

import { runDock } from "../src/dock-runner.js";

const snapshot = { context: { usedTokens: 1, maxTokens: 2, ratio: 0.5 } };

describe("runDock", () => {
  it("renders one frame immediately in one-shot mode", async () => {
    const writes: string[] = [];
    const result = await runDock(
      { watch: false, intervalMs: 10_000 },
      {
        load: async () => snapshot,
        render: () => "frame",
        write: (value) => writes.push(value),
        wait: async () => undefined,
      },
    );

    expect(result).toBe("ok");
    expect(writes).toEqual(["frame\n"]);
  });

  it("replaces frames until its abort signal fires", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    let loads = 0;
    let waits = 0;
    await runDock(
      { watch: true, intervalMs: 10_000, signal: controller.signal },
      {
        load: async () => {
          loads += 1;
          return snapshot;
        },
        render: () => `frame-${loads}`,
        write: (value) => writes.push(value),
        wait: async () => {
          waits += 1;
          if (waits === 2) controller.abort();
        },
      },
    );

    expect(loads).toBe(2);
    expect(writes).toEqual(["frame-1\n", "\u001B[2J\u001B[Hframe-2\n"]);
  });

  it("shows one concise error frame and retries on the next interval", async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    let loads = 0;
    await runDock(
      { watch: true, intervalMs: 10_000, signal: controller.signal },
      {
        load: async () => {
          loads += 1;
          if (loads === 1) throw new Error("rollout unavailable\nextra detail");
          return snapshot;
        },
        render: () => "recovered",
        write: (value) => writes.push(value),
        wait: async () => {
          if (loads === 2) controller.abort();
        },
      },
    );

    expect(writes[0]).toBe("Codex Insights\nUnavailable: rollout unavailable\n");
    expect(writes[1]).toBe("\u001B[2J\u001B[Hrecovered\n");
  });
});
