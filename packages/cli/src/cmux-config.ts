import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { shellQuote } from "./shell.js";

export const CMUX_CONTROL_ID = "codex-auto";

export interface CmuxDockControl {
  id: string;
  title: string;
  command: string;
  height: number;
  cwd?: string;
  [key: string]: unknown;
}

interface CmuxDockConfig {
  controls: unknown[];
  [key: string]: unknown;
}

function parseCmuxDockConfig(source: string): CmuxDockConfig {
  if (!source.trim()) return { controls: [] };
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Dock config must be a JSON object");
  }
  const config = parsed as Record<string, unknown>;
  if (config.controls !== undefined && !Array.isArray(config.controls)) {
    throw new Error("Dock config controls must be an array");
  }
  return { ...config, controls: (config.controls as unknown[] | undefined) ?? [] };
}

function isManagedControl(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === CMUX_CONTROL_ID);
}

function serialize(config: CmuxDockConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function renderCmuxControl(
  executable: string,
  nodeExecutable = process.execPath,
  cwd?: string,
): CmuxDockControl {
  const resolvedExecutable = resolve(executable);
  const command = [".js", ".cjs", ".mjs"].includes(extname(resolvedExecutable).toLowerCase())
    ? `${shellQuote(resolve(nodeExecutable))} ${shellQuote(resolvedExecutable)} dock --watch`
    : `${shellQuote(resolvedExecutable)} dock --watch`;
  return {
    id: CMUX_CONTROL_ID,
    title: "Codex Insights",
    command,
    height: 260,
    ...(cwd ? { cwd: resolve(cwd) } : {}),
  };
}

export function installCmuxControl(source: string, control: CmuxDockControl): string {
  const config = parseCmuxDockConfig(source);
  return serialize({
    ...config,
    controls: [...config.controls.filter((candidate) => !isManagedControl(candidate)), control],
  });
}

export function removeCmuxControl(source: string): string {
  if (!source.trim()) return source;
  const config = parseCmuxDockConfig(source);
  const controls = config.controls.filter((candidate) => !isManagedControl(candidate));
  if (controls.length === config.controls.length) return source;
  return serialize({ ...config, controls });
}

export async function writeCmuxDockConfig(path: string, transformed: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, transformed, "utf8");
  await rename(temporaryPath, path);
}
