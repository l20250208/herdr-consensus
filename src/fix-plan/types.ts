import type { Severity } from "../consensus/types.js";

export interface LockedFixPlanItem {
  itemId: string;
  severity: Severity;
  acceptanceCriteria: string[];
  allowedPaths: string[];
}

export interface LockedFixPlan {
  runId: string;
  version: number;
  items: LockedFixPlanItem[];
  createdAt: string;
  sha256: string;
}
