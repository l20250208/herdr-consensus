export type ValidationConclusion = "validated_true" | "validated_false" | "inconclusive";

export interface ValidationRecord {
  validationId: string;
  itemId: string;
  argv: string[];
  cwd: string;
  approvedByUser: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  stdoutSha256: string | null;
  stderrSha256: string | null;
  conclusion: ValidationConclusion;
}

export interface ValidationPlan {
  itemId: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  reason: string;
}
