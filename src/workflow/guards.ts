import { access } from "node:fs/promises";
import { basename } from "node:path";
import type { RunRecord, RunStage } from "../state/run.js";

export class WorkflowPreconditionError extends Error {}

export function requireRunStage(
  run: RunRecord,
  allowedStages: readonly RunStage[],
  command: string,
): void {
  if (allowedStages.includes(run.stage)) return;
  throw new WorkflowPreconditionError(
    `${command} requires stage ${allowedStages.join(" or ")}; current stage is ${run.stage}`,
  );
}

export async function requireArtifacts(paths: readonly string[], command: string): Promise<void> {
  const missing: string[] = [];
  for (const path of paths) {
    try {
      await access(path);
    } catch {
      missing.push(basename(path));
    }
  }
  if (missing.length > 0) {
    throw new WorkflowPreconditionError(
      `${command} requires missing artifact${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
    );
  }
}
