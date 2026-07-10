import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { readSessionSnapshot } from "./rollout.js";
import type { SessionSnapshot } from "./types.js";

async function collectRollouts(root: string): Promise<string[]> {
  const paths: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...(await collectRollouts(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) paths.push(path);
  }
  return paths;
}

export async function findLatestSession(options: {
  codexHome: string;
  cwd?: string;
}): Promise<SessionSnapshot | null> {
  const sessions = await listSessions({ codexHome: options.codexHome });
  if (!options.cwd) return sessions[0] ?? null;
  const exact = sessions.find((session) => session.cwd === options.cwd);
  if (exact) return exact;
  const parents = sessions.filter((session) => {
    const path = relative(session.cwd, options.cwd!);
    return path !== "" && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
  });
  return parents.sort((left, right) => right.cwd.length - left.cwd.length || right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
}

export async function listSessions(options: {
  codexHome: string;
  cwd?: string;
}): Promise<SessionSnapshot[]> {
  const sessions: SessionSnapshot[] = [];
  for (const path of await collectRollouts(join(options.codexHome, "sessions"))) {
    const snapshot = await readSessionSnapshot(path);
    if (!snapshot || (options.cwd && snapshot.cwd !== options.cwd)) continue;
    sessions.push(snapshot);
  }
  return sessions.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}
