import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readCachedStatusLine, statusCachePath } from "../src/status-cache.js";

const snapshot = { context: { usedTokens: 50, maxTokens: 100, ratio: 0.5 } };

describe("statusline cache", () => {
  it("uses a fresh cache entry without calling the loader", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "codex-auto-cache-"));
    let calls = 0;
    const load = async () => {
      calls += 1;
      return snapshot;
    };
    const options = {
      cacheDir,
      codexHome: "/codex",
      cwd: "/repo",
      ttlSeconds: 10,
      now: new Date("2026-07-10T09:00:00Z"),
    };

    expect(await readCachedStatusLine(options, load)).toEqual(snapshot);
    expect(
      await readCachedStatusLine({ ...options, now: new Date("2026-07-10T09:00:05Z") }, load),
    ).toEqual(snapshot);
    expect(calls).toBe(1);
  });

  it("replaces stale or corrupt cache entries", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "codex-auto-cache-"));
    const options = {
      cacheDir,
      codexHome: "/codex",
      cwd: "/repo",
      ttlSeconds: 10,
      now: new Date("2026-07-10T09:00:20Z"),
    };
    await writeFile(statusCachePath(options), "not json", "utf8");
    let calls = 0;

    const result = await readCachedStatusLine(options, async () => {
      calls += 1;
      return snapshot;
    });

    expect(result).toEqual(snapshot);
    expect(calls).toBe(1);
  });

  it("returns the loaded snapshot when the cache cannot be written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-auto-cache-blocked-"));
    const blocked = join(dir, "file");
    await writeFile(blocked, "not a directory", "utf8");

    await expect(
      readCachedStatusLine(
        {
          cacheDir: join(blocked, "cache"),
          codexHome: "/codex",
          cwd: "/repo",
          ttlSeconds: 10,
        },
        async () => snapshot,
      ),
    ).resolves.toEqual(snapshot);
  });
});
