import type { NormalizedFinding } from "../../src/consensus/types.js";

export function makeFinding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    findingId: "x",
    sourceId: "agent_a",
    originalSeverity: "high",
    severity: "P1",
    title: "issue",
    category: "security",
    location: null,
    rootCause: null,
    impact: "impact",
    evidence: [],
    evidenceTier: "agent_asserted",
    reproduction: [],
    suggestedFix: null,
    needsRuntimeValidation: false,
    rawArtifactSha256: "abc",
    ...overrides,
  };
}
