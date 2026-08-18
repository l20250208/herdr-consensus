import { describe, expect, it } from "vitest";
import { evidenceSnapshotSha256 } from "../../src/decisions/snapshot.js";
import { upsertDecision } from "../../src/decisions/store.js";
import type { ConsensusItem } from "../../src/consensus/types.js";

const item: ConsensusItem = { itemId: "i1", findingIds: ["f1"], relation: "single_source", matchScore: null, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: [], status: "needs_validation" };

describe("decisions", () => {
  it("creates stable evidence snapshot hashes", () => {
    const a = evidenceSnapshotSha256({ item, findings: [], validations: [], arbitration: [] });
    const b = evidenceSnapshotSha256({ item, findings: [], validations: [], arbitration: [] });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("upserts by item id", () => {
    const first = { itemId: "i1", decision: "deferred" as const, reason: null, decidedAt: "t1", evidenceSnapshotSha256: "h1" };
    const second = { ...first, decision: "approved_fix" as const, decidedAt: "t2" };
    expect(upsertDecision([first], second)).toEqual([second]);
  });
});
