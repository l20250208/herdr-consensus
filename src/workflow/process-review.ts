import { join } from "node:path";
import { runConsensus } from "../consensus/engine.js";
import { normalizeReport } from "../consensus/normalizer.js";
import type { ConsensusItem, NormalizedFinding } from "../consensus/types.js";
import type { RawReportArtifact } from "../reports/artifact.js";
import { parseReportContent } from "../reports/content.js";
import { writeJsonAtomic } from "../state/json.js";
import type { RunRecord } from "../state/run.js";
import type { RunStore } from "../state/store.js";

export interface ProcessReviewInput {
  run: RunRecord;
  runDir: string;
  artifacts: Record<"a" | "b", RawReportArtifact>;
}

export interface ProcessReviewResult {
  findings: NormalizedFinding[];
  items: ConsensusItem[];
}

export class ReviewProcessingError extends Error {}

function assertParseable(slot: "A" | "B", artifact: RawReportArtifact): void {
  const parsed = parseReportContent(artifact.content);
  if (!parsed.ok) throw new ReviewProcessingError(`report ${slot} could not be processed: ${parsed.error}`);
}

export async function processReview(
  input: ProcessReviewInput,
  store: RunStore,
): Promise<ProcessReviewResult> {
  if (input.run.stage !== "reviewing") {
    throw new ReviewProcessingError(`review processing requires stage reviewing, got ${input.run.stage}`);
  }

  assertParseable("A", input.artifacts.a);
  assertParseable("B", input.artifacts.b);

  const findingsA = normalizeReport(input.artifacts.a, {
    repoRoot: input.run.projectPath,
    sourceId: "agent_a",
  });
  const findingsB = normalizeReport(input.artifacts.b, {
    repoRoot: input.run.projectPath,
    sourceId: "agent_b",
  });
  const findings = [...findingsA, ...findingsB];

  await writeJsonAtomic(join(input.runDir, "normalized", "findings.json"), findings);
  await store.transition(input.run.runId, "normalized", { findingCount: findings.length });

  const items = runConsensus(findingsA, findingsB);
  await writeJsonAtomic(join(input.runDir, "consensus.json"), { items });
  await store.transition(input.run.runId, "consensus", { itemCount: items.length });

  return { findings, items };
}
