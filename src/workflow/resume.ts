import { join } from "node:path";
import { runConsensus } from "../consensus/engine.js";
import type { NormalizedFinding } from "../consensus/types.js";
import { loadRawReports } from "../reports/storage.js";
import { readJsonFile, writeJsonAtomic } from "../state/json.js";
import { runDir as buildRunDir } from "../state/paths.js";
import type { RunStage } from "../state/run.js";
import type { RunStore } from "../state/store.js";
import { processReview } from "./process-review.js";

export interface ResumeResult {
  stage: RunStage;
  nextCommand: string | null;
}

export class ResumeError extends Error {}

function nextCommand(stage: RunStage, runId: string): string | null {
  switch (stage) {
    case "consensus":
      return `validate ${runId}`;
    case "validating":
      return `arbitrate ${runId} --agent <kind>`;
    case "arbitrating":
      return `decide ${runId}`;
    case "deciding":
      return `lock ${runId}`;
    case "locked":
      return `apply ${runId} --agent <kind>`;
    case "applying":
      return `report ${runId}`;
    default:
      return null;
  }
}

function isFindingArray(value: unknown): value is NormalizedFinding[] {
  return Array.isArray(value) && value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const finding = item as Partial<NormalizedFinding>;
    return typeof finding.findingId === "string" && typeof finding.sourceId === "string";
  });
}

export async function resumeRun(
  runId: string,
  stateRoot: string,
  store: RunStore,
): Promise<ResumeResult> {
  let run = await store.findRunById(runId);
  if (run === null) throw new ResumeError(`no run found with id ${runId}`);
  const dir = buildRunDir(stateRoot, run.projectHash, run.runId);

  if (run.stage === "created") {
    throw new ResumeError("cannot resume a created run; start or import a review first");
  }

  if (run.stage === "reviewing") {
    const artifacts = await loadRawReports(dir);
    const missing = [artifacts.a === null ? "A" : null, artifacts.b === null ? "B" : null]
      .filter((slot): slot is string => slot !== null);
    if (artifacts.a === null || artifacts.b === null) {
      throw new ResumeError(`cannot resume reviewing: missing raw report ${missing.join(" and ")}`);
    }
    await processReview({ run, runDir: dir, artifacts: { a: artifacts.a, b: artifacts.b } }, store);
    run = await store.findRunById(runId);
    if (run === null) throw new ResumeError(`run ${runId} disappeared after processing`);
  } else if (run.stage === "normalized") {
    const rawFindings = await readJsonFile(join(dir, "normalized", "findings.json"));
    if (!isFindingArray(rawFindings)) {
      throw new ResumeError("cannot resume normalized run: normalized/findings.json is missing or invalid");
    }
    const findingsA = rawFindings.filter((finding) => finding.sourceId === "agent_a");
    const findingsB = rawFindings.filter((finding) => finding.sourceId === "agent_b");
    const items = runConsensus(findingsA, findingsB);
    await writeJsonAtomic(join(dir, "consensus.json"), { items });
    run = await store.transition(runId, "consensus", { itemCount: items.length, resumed: true });
  }

  if (run.stage === "arbitrating" || run.stage === "deciding") {
    const decisions = await readJsonFile(join(dir, "decisions.json"));
    if (Array.isArray(decisions) && decisions.some((value) => typeof value === "object" && value !== null && (value as { decision?: unknown }).decision === "validate_more")) {
      return { stage: run.stage, nextCommand: `validate ${run.runId}` };
    }
  }

  return { stage: run.stage, nextCommand: nextCommand(run.stage, run.runId) };
}
