import { describe, expect, it } from "vitest";

import { buildResumeShellCommand } from "../src/terminal.js";

describe("buildResumeShellCommand", () => {
  it("quotes cwd and resumes with the session model and effort", () => {
    expect(
      buildResumeShellCommand({
        sessionId: "session-id",
        cwd: "/workspace/project with spaces",
        retryAt: "2026-07-10T07:00:00.000Z",
        scheduledRunAt: "2026-07-10T07:10:00.000Z",
        scope: "session",
        modelName: "gpt-5.6-sol",
        effort: "high",
        status: "pending",
        createdAt: "2026-07-10T02:00:00.000Z",
        updatedAt: "2026-07-10T02:00:00.000Z",
      }),
    ).toBe(
      "cd '/workspace/project with spaces' && codex resume -m 'gpt-5.6-sol' -c 'model_reasoning_effort=high' --yolo 'session-id' 'continue'",
    );
  });
});
