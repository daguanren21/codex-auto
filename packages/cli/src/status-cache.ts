import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { StatusLineSnapshot } from "@codex-auto/core";

export interface StatusCacheOptions {
  cacheDir: string;
  codexHome: string;
  cwd: string;
  ttlSeconds: number;
  now?: Date;
}

interface StoredStatusLine {
  createdAt: string;
  snapshot: StatusLineSnapshot | null;
}

export function statusCachePath(options: StatusCacheOptions): string {
  const key = createHash("sha256")
    .update(`${resolve(options.codexHome)}\0${resolve(options.cwd)}`)
    .digest("hex");
  return resolve(options.cacheDir, `${key}.json`);
}

function parseStoredStatusLine(value: string): StoredStatusLine | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredStatusLine>;
    if (typeof parsed.createdAt !== "string" || !("snapshot" in parsed)) return null;
    return parsed as StoredStatusLine;
  } catch {
    return null;
  }
}

export async function readCachedStatusLine(
  options: StatusCacheOptions,
  loader: () => Promise<StatusLineSnapshot | null>,
): Promise<StatusLineSnapshot | null> {
  if (options.ttlSeconds <= 0) return loader();

  const now = options.now ?? new Date();
  const path = statusCachePath(options);
  try {
    const stored = parseStoredStatusLine(await readFile(path, "utf8"));
    if (stored) {
      const age = now.getTime() - new Date(stored.createdAt).getTime();
      if (Number.isFinite(age) && age >= 0 && age < options.ttlSeconds * 1_000) return stored.snapshot;
    }
  } catch {
    // Missing or unreadable cache entries are replaced below.
  }

  const snapshot = await loader();
  try {
    const stored: StoredStatusLine = { createdAt: now.toISOString(), snapshot };
    await mkdir(options.cacheDir, { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(stored)}\n`, "utf8");
    await rename(temporaryPath, path);
  } catch {
    // The statusline remains usable when its optional cache is unavailable.
  }
  return snapshot;
}
