import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { normalizeWorkat } from "@codex-auto/core";

export interface RuntimeConfig {
  workat: string[];
  proxy: Partial<Record<"HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY", string>>;
}

export async function readRuntimeConfig(path: string): Promise<RuntimeConfig> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      workat?: unknown;
      proxy?: Record<string, unknown>;
    };
    const proxy: RuntimeConfig["proxy"] = {};
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] as const) {
      if (typeof value.proxy?.[name] === "string" && value.proxy[name]) proxy[name] = value.proxy[name];
    }
    return {
      workat: Array.isArray(value.workat)
        ? normalizeWorkat(value.workat.filter((item): item is string => typeof item === "string"))
        : [],
      proxy,
    };
  } catch {
    return { workat: [], proxy: {} };
  }
}

export async function saveRuntimeConfig(path: string, config: RuntimeConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
