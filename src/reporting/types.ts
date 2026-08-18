export interface UnifiedReport {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  run: unknown;
  consensus: unknown;
  validations: unknown;
  arbitration: unknown;
  arbitrationMetadata: unknown;
  decisions: unknown;
  fixPlan: unknown;
  gitDiffSummary: string | null;
  changedPaths: string[];
  pathPolicy: { ok: boolean; violations: string[] };
  targetedChecks: Array<{
    itemId: string;
    argv: string[];
    startedAt: string;
    finishedAt: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
  regression: {
    argv: string[];
    approvedByUser: boolean;
    startedAt: string;
    finishedAt: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    workspaceSnapshotSha256: string;
  };
}
