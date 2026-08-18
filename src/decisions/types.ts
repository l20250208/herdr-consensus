export type UserDecisionValue = "approved_fix" | "deferred" | "rejected" | "validate_more";

export interface UserDecision {
  itemId: string;
  decision: UserDecisionValue;
  reason: string | null;
  decidedAt: string;
  evidenceSnapshotSha256: string;
}
