import type { StatusLineSnapshot } from "@codex-auto/core";

export interface DockRunOptions {
  watch: boolean;
  intervalMs: number;
  signal?: AbortSignal;
}

export interface DockRunDependencies {
  load(): Promise<StatusLineSnapshot | null>;
  render(snapshot: StatusLineSnapshot | null): string;
  write(value: string): void;
  wait(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0] || "unknown error";
}

export function waitForDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function runDock(
  options: DockRunOptions,
  dependencies: DockRunDependencies,
): Promise<"ok" | "error"> {
  let first = true;
  do {
    if (options.signal?.aborted) return "ok";
    let frame: string;
    let result: "ok" | "error" = "ok";
    try {
      const snapshot = await dependencies.load();
      if (options.signal?.aborted) return "ok";
      frame = dependencies.render(snapshot);
    } catch (error) {
      if (options.signal?.aborted) return "ok";
      frame = `Codex Insights\nUnavailable: ${conciseError(error)}`;
      result = "error";
    }
    dependencies.write(`${first ? "" : "\u001B[2J\u001B[H"}${frame}\n`);
    first = false;
    if (!options.watch) return result;
    await dependencies.wait(options.intervalMs, options.signal);
  } while (!options.signal?.aborted);
  return "ok";
}
