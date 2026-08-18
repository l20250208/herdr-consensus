import { describe, expect, it } from "vitest";
import { buildArbitrationPrompt } from "../../src/arbitration/prompt.js";
import { parseArbitrationAdvice } from "../../src/arbitration/parser.js";
import type { ConsensusItem } from "../../src/consensus/types.js";

const item: ConsensusItem = { itemId: "i1", findingIds: ["f1"], relation: "disputed", matchScore: 0.8, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: ["conflict"], status: "disputed" };

describe("arbitration", () => {
  it("builds a read-only prompt", () => {
    const prompt = buildArbitrationPrompt({ item, findings: [], validations: [] });
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Do not modify files");
    expect(prompt).toContain("i1");
  });

  it("parses valid marked advice and rejects unmarked prose", () => {
    const text = `<<<HERDR_CONSENSUS_ARBITRATION_JSON_START>>>\n${JSON.stringify({ itemId: "i1", recommendation: "fix", rationale: "evidence supports it", evidenceRefs: ["f1"], confidence: "medium", missingValidation: [] })}\n<<<HERDR_CONSENSUS_ARBITRATION_JSON_END>>>`;
    const parsed = parseArbitrationAdvice(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.advice.artifactSha256).toHaveLength(64);
    expect(parseArbitrationAdvice("fix it").ok).toBe(false);
  });

  it("uses the latest marker pair after the echoed prompt template", () => {
    const advice = JSON.stringify({ itemId: "i1", recommendation: "fix", rationale: "evidence", evidenceRefs: [], confidence: "medium", missingValidation: [] });
    const text = `<<<HERDR_CONSENSUS_ARBITRATION_JSON_START>>>\n\n<<<HERDR_CONSENSUS_ARBITRATION_JSON_END>>>\n<<<HERDR_CONSENSUS_ARBITRATION_JSON_START>>>\n${advice}\n<<<HERDR_CONSENSUS_ARBITRATION_JSON_END>>>`;
    expect(parseArbitrationAdvice(text).ok).toBe(true);
  });
});
