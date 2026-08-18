import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import type { RunRecord } from "../state/run.js";
import { readJsonFile } from "../state/json.js";
import { decodeArtifact, LockedFixPlanSchema } from "../workflow/artifacts.js";
import { computeLockedFixPlanSha256 } from "./generate.js";
import type { LockedFixPlan } from "./types.js";

export async function verifyLockedFixPlanIntegrity(input: {
  plan: LockedFixPlan;
  run: RunRecord;
  runDir: string;
}): Promise<void> {
  const { sha256, ...withoutHash } = input.plan;
  if (input.plan.runId !== input.run.runId) throw new Error("locked fix-plan runId does not match the current run");
  if (computeLockedFixPlanSha256(withoutHash) !== sha256) throw new Error("locked fix-plan SHA-256 does not match its contents");

  const lockedEvent = [...input.run.events].reverse().find((event) => event.type === "transition" && event.to === "locked");
  if (lockedEvent === undefined) throw new Error("run has no locked audit event");
  if (lockedEvent.detail.version !== input.plan.version || lockedEvent.detail.sha256 !== input.plan.sha256) {
    throw new Error("locked fix-plan does not match the locked audit event");
  }

  const archivePath = join(input.runDir, "fix-plans", `v${input.plan.version}.json`);
  const rawArchive = await readJsonFile(archivePath);
  if (rawArchive === null) throw new Error(`locked fix-plan archive is missing: ${archivePath}`);
  const archive = decodeArtifact(LockedFixPlanSchema, rawArchive, `fix-plans/v${input.plan.version}.json`);
  if (!isDeepStrictEqual(archive, input.plan)) throw new Error("locked fix-plan root file does not match its immutable archive");
}
