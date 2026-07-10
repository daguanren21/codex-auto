import { describe, expect, it } from "vitest";

import { installTmuxBlock, removeTmuxBlock, renderTmuxBlock } from "../src/tmux-config.js";

const existing = `set -g @plugin 'tmux-plugins/tpm'\nrun "~/.config/tmux/plugins/tpm/tpm"\n`;

describe("tmux config transforms", () => {
  it("inserts one managed block before TPM and preserves existing content", () => {
    const block = renderTmuxBlock("/Users/test/.local/bin/codex-auto");
    const result = installTmuxBlock(existing, block);

    expect(result.indexOf("# BEGIN codex-auto statusline")).toBeLessThan(
      result.indexOf('run "~/.config/tmux/plugins/tpm/tpm"'),
    );
    expect(result).toContain("set -g @plugin 'tmux-plugins/tpm'");
    expect(result.match(/BEGIN codex-auto statusline/g)).toHaveLength(1);
  });

  it("replaces the managed block idempotently", () => {
    const first = installTmuxBlock(existing, renderTmuxBlock("/old/codex-auto"));
    const second = installTmuxBlock(first, renderTmuxBlock("/new/codex-auto"));

    expect(second).not.toContain("/old/codex-auto");
    expect(second.match(/BEGIN codex-auto statusline/g)).toHaveLength(1);
  });

  it("uninstalls only the managed block", () => {
    const installed = installTmuxBlock(existing, renderTmuxBlock("/bin/codex-auto"));

    expect(removeTmuxBlock(installed)).toBe(existing);
  });
});
