import { readFile } from "node:fs/promises";

import { parse } from "smol-toml";

import type { ModelSettings } from "./types.js";

export async function readConfiguredModel(path: string): Promise<ModelSettings | null> {
  try {
    const config = parse(await readFile(path, "utf8"));
    const name = typeof config.model === "string" ? config.model : undefined;
    if (!name) return null;
    const effort = typeof config.model_reasoning_effort === "string" ? config.model_reasoning_effort : undefined;
    return effort ? { name, effort, source: "config" } : { name, source: "config" };
  } catch {
    return null;
  }
}

