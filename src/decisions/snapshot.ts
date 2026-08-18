import { createHash } from "node:crypto";
import type { ConsensusItem, NormalizedFinding } from "../consensus/types.js";

export function evidenceSnapshotSha256(input: {
  item: ConsensusItem;
  findings: readonly NormalizedFinding[];
  validations: readonly unknown[];
  arbitration: readonly unknown[];
}): string {
  const canonical = JSON.stringify({
    item: input.item,
    findings: [...input.findings].sort((a, b) => a.findingId.localeCompare(b.findingId)),
    validations: input.validations,
    arbitration: input.arbitration,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
