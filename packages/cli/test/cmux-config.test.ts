import { describe, expect, it } from "vitest";

import {
  installCmuxControl,
  removeCmuxControl,
  renderCmuxControl,
} from "../src/cmux-config.js";

const existing = `${JSON.stringify({
  version: 1,
  controls: [{ id: "tests", title: "Tests", command: "pnpm test", height: 180 }],
}, null, 2)}\n`;

describe("cmux Dock config transforms", () => {
  it("adds one managed global control and preserves unknown data", () => {
    const result = JSON.parse(installCmuxControl(existing, renderCmuxControl("/usr/local/bin/codex-auto")));

    expect(result.version).toBe(1);
    expect(result.controls).toContainEqual(expect.objectContaining({ id: "tests" }));
    expect(result.controls).toContainEqual({
      id: "codex-auto",
      title: "Codex Insights",
      command: "'/usr/local/bin/codex-auto' dock --watch",
      height: 260,
    });
  });

  it("replaces the managed control idempotently", () => {
    const first = installCmuxControl(existing, renderCmuxControl("/old/codex-auto"));
    const second = installCmuxControl(first, renderCmuxControl("/new/codex-auto"));
    const controls = JSON.parse(second).controls;

    expect(controls.filter((control: { id?: string }) => control.id === "codex-auto")).toHaveLength(1);
    expect(second).not.toContain("/old/codex-auto");
  });

  it("quotes executable paths containing apostrophes", () => {
    expect(renderCmuxControl("/Users/test/O'Brien/codex-auto").command)
      .toBe("'/Users/test/O'\"'\"'Brien/codex-auto' dock --watch");
  });

  it("removes only the managed control and preserves an absent file", () => {
    const installed = installCmuxControl(existing, renderCmuxControl("/bin/codex-auto"));

    expect(JSON.parse(removeCmuxControl(installed))).toEqual(JSON.parse(existing));
    expect(removeCmuxControl("")).toBe("");
  });

  it("rejects malformed JSON and non-array controls", () => {
    expect(() => installCmuxControl("not json", renderCmuxControl("/bin/codex-auto"))).toThrow();
    expect(() => installCmuxControl('{"controls":{}}', renderCmuxControl("/bin/codex-auto")))
      .toThrow("controls must be an array");
  });
});
