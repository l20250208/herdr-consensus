import type { RunRecord } from "../state/run.js";
import type { Runner } from "../spawn.js";
import type { UnifiedReport } from "./types.js";
import { UnifiedReportSchema } from "./schema.js";

export async function collectGitDiffSummary(worktreePath: string, run: Runner, baseCommit: string): Promise<string | null> {
  const result = await run(["git", "diff", "--stat", baseCommit, "--"], { cwd: worktreePath });
  if (!result.ok || result.code !== 0) throw new Error(result.ok ? result.stderr : result.error);
  return result.stdout.trim() === "" ? null : result.stdout;
}

export async function runRegression(input: { worktreePath: string; argv: readonly string[]; run: Runner; approvedByUser: boolean }): Promise<Omit<UnifiedReport["regression"], "workspaceSnapshotSha256">> {
  const startedAt = new Date().toISOString();
  const result = await input.run(input.argv, { cwd: input.worktreePath, timeoutMs: 300_000 });
  return {
    argv: [...input.argv],
    approvedByUser: input.approvedByUser,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.ok ? result.code : null,
    stdout: result.ok ? result.stdout : "",
    stderr: result.ok ? result.stderr : result.error,
  };
}

export function buildUnifiedReport(input: {
  run: RunRecord;
  consensus: unknown;
  validations: unknown;
  arbitration: unknown;
  arbitrationMetadata: unknown;
  decisions: unknown;
  fixPlan: unknown;
  gitDiffSummary: string | null;
  changedPaths: string[];
  pathPolicy: UnifiedReport["pathPolicy"];
  targetedChecks: UnifiedReport["targetedChecks"];
  regression: UnifiedReport["regression"];
  generatedAt?: string;
}): UnifiedReport {
  const report: UnifiedReport = {
    schemaVersion: 1,
    runId: input.run.runId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    run: input.run,
    consensus: input.consensus,
    validations: input.validations,
    arbitration: input.arbitration,
    arbitrationMetadata: input.arbitrationMetadata,
    decisions: input.decisions,
    fixPlan: input.fixPlan,
    gitDiffSummary: input.gitDiffSummary,
    changedPaths: input.changedPaths,
    pathPolicy: input.pathPolicy,
    targetedChecks: input.targetedChecks,
    regression: input.regression,
  };
  UnifiedReportSchema.parse(report);
  return report;
}

export function renderUnifiedReportMarkdown(report: UnifiedReport): string {
  return [
    "# Herdr Consensus Final Report",
    "",
    `Run: ${report.runId}`,
    `Generated: ${report.generatedAt}`,
    "",
    "## Fix Plan",
    "",
    "```json",
    JSON.stringify(report.fixPlan, null, 2),
    "```",
    "",
    "## Decisions",
    "",
    "```json",
    JSON.stringify(report.decisions, null, 2),
    "```",
    "",
    "## Validation Records",
    "",
    "```json",
    JSON.stringify(report.validations, null, 2),
    "```",
    "",
    "## Arbitration Advice",
    "",
    "```json",
    JSON.stringify(report.arbitration, null, 2),
    "```",
    "",
    "## Arbitration Metadata",
    "",
    "```json",
    JSON.stringify(report.arbitrationMetadata, null, 2),
    "```",
    "",
    "## Git Diff Summary",
    "",
    report.gitDiffSummary ?? "No diff summary available.",
    "",
    "## Changed Paths and Locked-Path Policy",
    "",
    "```json",
    JSON.stringify({ changedPaths: report.changedPaths, pathPolicy: report.pathPolicy }, null, 2),
    "```",
    "",
    "## Targeted Checks",
    "",
    "```json",
    JSON.stringify(report.targetedChecks, null, 2),
    "```",
    "",
    "## Regression",
    "",
    `Command: ${report.regression.argv.join(" ")}\nApproved by user: ${report.regression.approvedByUser}\nExit code: ${report.regression.exitCode}`,
    "",
  ].join("\n");
}
