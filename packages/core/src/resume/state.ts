import { open, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ResumeState } from "./scheduler.js";

export async function readResumeState(path: string): Promise<ResumeState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { jobs?: unknown };
    return { jobs: Array.isArray(value.jobs) ? (value.jobs as ResumeState["jobs"]) : [] };
  } catch {
    return { jobs: [] };
  }
}

export async function saveResumeState(path: string, state: ResumeState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function acquireWatcherLock(path: string): Promise<{ release(): Promise<void> }> {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("watcher is already running");
    throw error;
  }
  await handle.writeFile(`${process.pid}\n`, "utf8");
  return {
    async release() {
      await handle.close();
      await unlink(path).catch(() => undefined);
    },
  };
}

