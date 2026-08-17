import pc from "picocolors";
import type { RunRecord } from "../state/run.js";

export function formatRunStatus(run: RunRecord): string {
  return [
    pc.bold(`run ${run.runId}`),
    `  project: ${run.projectPath}`,
    `  stage:   ${pc.cyan(run.stage)}`,
    `  created: ${run.createdAt}`,
    `  updated: ${run.updatedAt}`,
    `  events:  ${run.events.length}`,
    "",
  ].join("\n");
}

export function formatRunList(runs: RunRecord[]): string {
  if (runs.length === 0) return "No runs found.\n";
  const lines = [`Found ${runs.length} run(s):`];
  for (const run of runs) {
    lines.push(`  ${pc.cyan(run.runId)}  ${run.stage}  ${run.projectPath}`);
  }
  lines.push("");
  return lines.join("\n");
}
