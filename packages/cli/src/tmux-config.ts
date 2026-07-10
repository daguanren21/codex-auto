import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const TMUX_BLOCK_START = "# BEGIN codex-auto statusline";
export const TMUX_BLOCK_END = "# END codex-auto statusline";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderTmuxBlock(executable: string): string {
  const command = `${shellQuote(executable)} statusline --format tmux --cache-ttl 10 --cwd #{q:pane_current_path} --width #{client_width}`;
  return [
    TMUX_BLOCK_START,
    "set -g status on",
    "set -g status-position bottom",
    "set -g status-interval 10",
    "set -g status-right-length 220",
    `set -g status-right "#(${command})"`,
    TMUX_BLOCK_END,
  ].join("\n");
}

export function removeTmuxBlock(source: string): string {
  let result = source;
  while (true) {
    const start = result.indexOf(TMUX_BLOCK_START);
    if (start < 0) return result;
    const markerEnd = result.indexOf(TMUX_BLOCK_END, start + TMUX_BLOCK_START.length);
    if (markerEnd < 0) return result;

    let end = markerEnd + TMUX_BLOCK_END.length;
    if (result.startsWith("\r\n\r\n", end)) end += 4;
    else if (result.startsWith("\n\n", end)) end += 2;
    else if (result.startsWith("\r\n", end)) end += 2;
    else if (result.startsWith("\n", end)) end += 1;
    result = result.slice(0, start) + result.slice(end);
  }
}

export function installTmuxBlock(source: string, block: string): string {
  const cleaned = removeTmuxBlock(source);
  const tpm = /^\s*run(?:-shell)?\s+.*tpm.*$/m.exec(cleaned);
  if (tpm?.index !== undefined) {
    return `${cleaned.slice(0, tpm.index)}${block}\n\n${cleaned.slice(tpm.index)}`;
  }
  if (cleaned.length === 0) return `${block}\n`;
  const separator = cleaned.endsWith("\n\n") ? "" : cleaned.endsWith("\n") ? "\n" : "\n\n";
  return `${cleaned}${separator}${block}\n`;
}

export async function writeTmuxConfig(path: string, transformed: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, transformed, "utf8");
  await rename(temporaryPath, path);
}
