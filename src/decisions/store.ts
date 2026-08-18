import type { UserDecision } from "./types.js";
import { readJsonFile, writeJsonAtomic } from "../state/json.js";

export async function loadDecisions(path: string): Promise<UserDecision[]> {
  const value = await readJsonFile(path);
  if (value === null) return [];
  const allowed = new Set(["approved_fix", "deferred", "rejected", "validate_more"]);
  if (!Array.isArray(value) || !value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const decision = item as Partial<UserDecision>;
    return typeof decision.itemId === "string"
      && typeof decision.decision === "string"
      && allowed.has(decision.decision)
      && (typeof decision.reason === "string" || decision.reason === null)
      && typeof decision.decidedAt === "string"
      && typeof decision.evidenceSnapshotSha256 === "string";
  })) {
    throw new Error(`invalid decisions artifact: ${path}`);
  }
  return value as UserDecision[];
}

export async function saveDecisions(path: string, decisions: readonly UserDecision[]): Promise<void> {
  await writeJsonAtomic(path, decisions);
}

export function upsertDecision(decisions: readonly UserDecision[], decision: UserDecision): UserDecision[] {
  return [...decisions.filter((existing) => existing.itemId !== decision.itemId), decision];
}
