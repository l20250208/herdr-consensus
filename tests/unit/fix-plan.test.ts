import { describe, expect, it } from "vitest";
import { generateLockedFixPlan, renderFixPlanMarkdown } from "../../src/fix-plan/generate.js";
import type { ConsensusItem, NormalizedFinding } from "../../src/consensus/types.js";

const item: ConsensusItem = { itemId: "i1", findingIds: ["f1"], relation: "single_source", matchScore: null, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: [], status: "needs_validation" };
const finding: NormalizedFinding = { findingId: "f1", sourceId: "agent_a", originalSeverity: "m", severity: "P2", title: "bug", category: "bug", location: { path: "src/a.ts", startLine: 1, endLine: 2, symbol: null }, rootCause: null, impact: "impact", evidence: [], evidenceTier: "agent_asserted", reproduction: ["pnpm test"], suggestedFix: null, needsRuntimeValidation: true, rawArtifactSha256: "x" };

describe("fix plan", () => {
  it("includes approved decisions and hashes normalized content", () => {
    const plan = generateLockedFixPlan({ runId: "r", version: 1, items: [item], findings: [finding], decisions: [{ itemId: "i1", decision: "approved_fix", reason: null, decidedAt: "t", evidenceSnapshotSha256: "h" }], createdAt: "now" });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.allowedPaths).toEqual(["src/a.ts"]);
    expect(plan.sha256).toHaveLength(64);
    expect(renderFixPlanMarkdown(plan)).toContain("Locked Fix Plan");
  });
});
