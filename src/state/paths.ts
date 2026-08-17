import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Resolves the plugin's local state root, following `DESIGN.md` §7.1:
 * `$XDG_STATE_HOME/herdr-consensus/`, with a macOS `Application Support`
 * fallback and a Linux `~/.local/state` fallback.
 */
export function stateRoot(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const xdg = env.XDG_STATE_HOME;
  if (xdg !== undefined && xdg !== "") return join(xdg, "herdr-consensus");
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "herdr-consensus");
  }
  return join(home, ".local", "state", "herdr-consensus");
}

/** Stable project directory key: `sha256(real-repo-path)`. */
export function projectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex");
}

export function projectDir(root: string, hash: string): string {
  return join(root, "projects", hash);
}

export function runDir(root: string, hash: string, runId: string): string {
  return join(projectDir(root, hash), "runs", runId);
}

export function runJsonPath(root: string, hash: string, runId: string): string {
  return join(runDir(root, hash, runId), "run.json");
}
