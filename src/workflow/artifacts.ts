import { z } from "zod";

const SeveritySchema = z.enum(["P0", "P1", "P2", "P3"]);
const EvidenceTierSchema = z.enum(["runtime_reproduced", "code_proven", "corroborated", "agent_asserted", "unknown"]);

export const ConsensusItemSchema = z.object({
  itemId: z.string().min(1),
  findingIds: z.array(z.string()),
  relation: z.enum(["common", "single_source", "possible_match", "disputed"]),
  matchScore: z.number().nullable(),
  severity: SeveritySchema,
  evidenceTier: EvidenceTierSchema,
  disagreementReasons: z.array(z.string()),
  status: z.string(),
}).strict();

export const ConsensusArtifactSchema = z.object({ items: z.array(ConsensusItemSchema) }).strict();

export const NormalizedFindingSchema = z.object({
  findingId: z.string().min(1),
  sourceId: z.string().min(1),
  originalSeverity: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  category: z.string(),
  location: z.object({
    path: z.string(),
    startLine: z.number().int().nullable(),
    endLine: z.number().int().nullable(),
    symbol: z.string().nullable(),
  }).strict().nullable(),
  rootCause: z.string().nullable(),
  impact: z.string(),
  evidence: z.array(z.string()),
  evidenceTier: EvidenceTierSchema,
  reproduction: z.array(z.string()),
  suggestedFix: z.string().nullable(),
  needsRuntimeValidation: z.boolean(),
  rawArtifactSha256: z.string(),
}).strict();

export const NormalizedFindingsArtifactSchema = z.array(NormalizedFindingSchema);

export const ValidationRecordSchema = z.object({
  validationId: z.string().min(1),
  itemId: z.string().min(1),
  argv: z.array(z.string()),
  cwd: z.string(),
  approvedByUser: z.boolean(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  stdoutSha256: z.string().nullable(),
  stderrSha256: z.string().nullable(),
  conclusion: z.enum(["validated_true", "validated_false", "inconclusive"]),
}).strict();

export const ValidationRecordsArtifactSchema = z.array(ValidationRecordSchema);

export const ArbitrationAdviceSchema = z.object({
  itemId: z.string().min(1),
  recommendation: z.enum(["fix", "defer", "reject", "validate_more"]),
  rationale: z.string(),
  evidenceRefs: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  missingValidation: z.array(z.string()),
  artifactSha256: z.string(),
}).strict();

export const ArbitrationAdviceArtifactSchema = z.array(ArbitrationAdviceSchema);

export const ArbitrationMetadataArtifactSchema = z.object({
  reviewAgentKinds: z.array(z.string()),
  agentKind: z.string(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  independence: z.enum(["strong", "weak", "unknown"]),
}).strict();

export const LockedFixPlanSchema = z.object({
  runId: z.string().min(1),
  version: z.number().int().positive(),
  items: z.array(z.object({
    itemId: z.string().min(1),
    severity: SeveritySchema,
    acceptanceCriteria: z.array(z.string()),
    allowedPaths: z.array(z.string()),
  }).strict()),
  createdAt: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const PathPolicyArtifactSchema = z.object({
  baseCommit: z.string().min(1),
  currentHead: z.string().min(1),
  headMoved: z.boolean(),
  changedPaths: z.array(z.string()),
  ok: z.boolean(),
  violations: z.array(z.string()),
}).strict();

export const TargetedCheckSchema = z.object({
  itemId: z.string(),
  argv: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
}).strict();

export const TargetedChecksArtifactSchema = z.array(TargetedCheckSchema);

export const RegressionArtifactSchema = z.object({
  argv: z.array(z.string()),
  approvedByUser: z.literal(true),
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  workspaceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function decodeArtifact<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Error(`invalid ${label} artifact${issue === undefined ? "" : `: ${issue.path.join(".") || "root"} ${issue.message}`}`);
}
