import pc from "picocolors";
import type { RunRecord } from "../state/run.js";

export function formatResume(run: RunRecord): string {
  return `${pc.bold("Resuming")} run ${pc.cyan(run.runId)} at stage ${pc.cyan(run.stage)}.\n`;
}
