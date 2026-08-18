import { describe, expect, it } from "vitest";
import type { ConsensusItem, NormalizedFinding } from "../../src/consensus/types.js";
import type { PromptAdapter } from "../../src/ui/prompts.js";
import { runDecisionWizard } from "../../src/ui/decision-wizard.js";

function finding(): NormalizedFinding {
  return {
    findingId: "f1",
    sourceId: "agent_a",
    originalSeverity: "medium",
    severity: "P2",
    title: "Unchecked result",
    category: "correctness",
    location: null,
    rootCause: "return value ignored",
    impact: "request fails",
    evidence: ["call site ignores error"],
    evidenceTier: "agent_asserted",
    reproduction: ["pnpm test"],
    suggestedFix: "check result",
    needsRuntimeValidation: true,
    rawArtifactSha256: "raw",
  };
}

function item(): ConsensusItem {
  return {
    itemId: "i1",
    findingIds: ["f1"],
    relation: "disputed",
    matchScore: 0.7,
    severity: "P2",
    evidenceTier: "agent_asserted",
    disagreementReasons: ["root cause conflict"],
    status: "disputed",
  };
}

describe("decision wizard", () => {
  it("shows evidence and persists a snapshot-bound decision after each item", async () => {
    const messages: string[] = [];
    const prompts: PromptAdapter = {
      async input(message) {
        messages.push(message);
        return "confirmed by reproduction";
      },
      async select<T>(message: string): Promise<T> {
        messages.push(message);
        return "approved_fix" as T;
      },
      async confirm() {
        throw new Error("unused");
      },
    };
    const saved: string[][] = [];

    const decisions = await runDecisionWizard(
      {
        items: [item()],
        findings: [finding()],
        validations: [{ itemId: "i1", conclusion: "validated_true" }],
        arbitration: [{ itemId: "i1", recommendation: "fix", confidence: "high" }],
      },
      [],
      prompts,
      async (current) => {
        saved.push(current.map((decision) => decision.decision));
      },
    );

    expect(messages.join("\n")).toContain("Unchecked result");
    expect(messages.join("\n")).toContain("validated_true");
    expect(messages.join("\n")).toContain("recommendation");
    expect(decisions[0]).toMatchObject({
      itemId: "i1",
      decision: "approved_fix",
      reason: "confirmed by reproduction",
    });
    expect(decisions[0]?.evidenceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved).toEqual([["approved_fix"]]);
  });

  it("skips items that already have a decision", async () => {
    const existing = [{
      itemId: "i1",
      decision: "deferred" as const,
      reason: null,
      decidedAt: "2026-08-18T00:00:00.000Z",
      evidenceSnapshotSha256: "hash",
    }];
    const prompts: PromptAdapter = {
      async input() { throw new Error("must not prompt"); },
      async select<T>() { throw new Error("must not prompt") as T; },
      async confirm() { throw new Error("must not prompt"); },
    };

    await expect(runDecisionWizard(
      { items: [item()], findings: [finding()], validations: [], arbitration: [] },
      existing,
      prompts,
      async () => {},
    )).resolves.toEqual(existing);
  });
});
