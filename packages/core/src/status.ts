import { join } from "node:path";

import { readConfiguredModel } from "./codex/config.js";
import { findLatestSession } from "./codex/sessions.js";
import type { ModelSettings, SessionSnapshot } from "./codex/types.js";
import { probeGit, type GitSnapshot } from "./git.js";

export interface CurrentStatusSnapshot extends Omit<SessionSnapshot, "model"> {
  model?: ModelSettings;
  git: GitSnapshot | null;
}

export async function getCurrentStatus(options: {
  codexHome: string;
  cwd: string;
}): Promise<CurrentStatusSnapshot | null> {
  const session = await findLatestSession(options);
  if (!session) return null;
  const configuredModel = session.model ?? (await readConfiguredModel(join(options.codexHome, "config.toml")));
  const git = await probeGit(options.cwd);
  return {
    ...session,
    ...(configuredModel ? { model: configuredModel } : {}),
    git,
  };
}

