import { randomBytes } from "node:crypto";
import { z } from "zod";

/** Ordered run lifecycle. Stages only advance forward in stage 2. */
export const RUN_STAGES = [
  "created",
  "reviewing",
  "normalized",
  "consensus",
  "validating",
  "arbitrating",
  "deciding",
  "locked",
  "applying",
  "reported",
] as const;

export type RunStage = (typeof RUN_STAGES)[number];

export const CURRENT_SCHEMA_VERSION = 1;

const RunStageSchema = z.enum(RUN_STAGES);

export const AuditEventSchema = z.object({
  seq: z.number().int().positive(),
  at: z.string(),
  type: z.enum(["created", "transition"]),
  from: RunStageSchema.nullable(),
  to: RunStageSchema,
  detail: z.record(z.string(), z.unknown()),
});

export const RunRecordSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  runId: z.string(),
  projectPath: z.string(),
  projectHash: z.string(),
  stage: RunStageSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(AuditEventSchema),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;

export class RunRecordError extends Error {}

/** Generates a sortable, human-readable run id: `run-YYYYMMDDHHMMSS-<hex>`. */
export function generateRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `run-${stamp}-${randomBytes(4).toString("hex")}`;
}

export function stageIndex(stage: RunStage): number {
  const index = RUN_STAGES.indexOf(stage);
  if (index < 0) throw new Error(`unknown stage: ${stage}`);
  return index;
}

/**
 * Validates an untrusted run record on load. Distinguishes a schema version
 * mismatch (which needs a migration/recovery decision) from an invalid record.
 */
export function decodeRunRecord(raw: unknown): RunRecord {
  const parsed = RunRecordSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw) {
    const version = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (typeof version === "number" && version !== CURRENT_SCHEMA_VERSION) {
      throw new RunRecordError(
        `unsupported schema version ${version} (expected ${CURRENT_SCHEMA_VERSION})`,
      );
    }
  }

  const firstIssue = parsed.error.issues[0];
  const detail = firstIssue ? `: ${firstIssue.message}` : "";
  throw new RunRecordError(`invalid run record${detail}`);
}
