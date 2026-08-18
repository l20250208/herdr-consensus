import { z } from "zod";

const ArbitrationMetadataSchema = z.object({
  reviewAgentKinds: z.array(z.string()),
  agentKind: z.string(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  independence: z.enum(["strong", "weak", "unknown"]),
});

const PathPolicySchema = z.object({
  ok: z.boolean(),
  violations: z.array(z.string()),
});

const TargetedCheckSchema = z.object({
  itemId: z.string(),
  argv: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
});

const RegressionSchema = z.object({
  argv: z.array(z.string()),
  approvedByUser: z.literal(true),
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  workspaceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const UnifiedReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  generatedAt: z.string(),
  run: z.object({ runId: z.string(), stage: z.string() }).passthrough(),
  consensus: z.object({ items: z.array(z.unknown()) }),
  validations: z.array(z.unknown()),
  arbitration: z.array(z.unknown()),
  arbitrationMetadata: ArbitrationMetadataSchema,
  decisions: z.array(z.unknown()),
  fixPlan: z.object({
    runId: z.string(),
    version: z.number().int().positive(),
    items: z.array(z.unknown()),
    createdAt: z.string(),
    sha256: z.string(),
  }),
  gitDiffSummary: z.string().nullable(),
  changedPaths: z.array(z.string()),
  pathPolicy: PathPolicySchema,
  targetedChecks: z.array(TargetedCheckSchema),
  regression: RegressionSchema,
});
