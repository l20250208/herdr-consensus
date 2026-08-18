import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isDeterministicMatch, similarityScore } from "../../src/consensus/matcher.js";
import { normalizeRepoPath } from "../../src/consensus/path.js";
import { runConsensus } from "../../src/consensus/engine.js";
import type { NormalizedFinding, Severity, SourceLocation } from "../../src/consensus/types.js";

const fcSeverity = fc.constantFrom<Severity>("P0", "P1", "P2", "P3");

const fcLocation = fc.record({
  path: fc.constantFrom("src/a.ts", "src/b.ts", "src/c.ts"),
  startLine: fc.option(fc.integer({ min: 1, max: 50 })),
  endLine: fc.option(fc.integer({ min: 1, max: 50 })),
  symbol: fc.option(fc.constantFrom("foo", "bar", "baz")),
});

interface RawFinding {
  severity: Severity;
  title: string;
  category: string;
  location: SourceLocation | null;
  rootCause: string | null;
  suggestedFix: string | null;
}

const fcFinding = fc.record<RawFinding>({
  severity: fcSeverity,
  title: fc.string({ minLength: 1, maxLength: 10 }),
  category: fc.constantFrom("security", "performance", "correctness"),
  location: fc.option(fcLocation),
  rootCause: fc.option(fc.string({ minLength: 1, maxLength: 10 })),
  suggestedFix: fc.option(fc.string({ minLength: 1, maxLength: 10 })),
});

function toFinding(raw: RawFinding, id: string): NormalizedFinding {
  return {
    findingId: id,
    sourceId: id.startsWith("a") ? "agent_a" : "agent_b",
    originalSeverity: raw.severity,
    severity: raw.severity,
    title: raw.title,
    category: raw.category,
    location: raw.location,
    rootCause: raw.rootCause,
    impact: "impact",
    evidence: [],
    evidenceTier: "agent_asserted",
    reproduction: [],
    suggestedFix: raw.suggestedFix,
    needsRuntimeValidation: false,
    rawArtifactSha256: "abc",
  };
}

describe("consensus property tests", () => {
  it("similarityScore is symmetric and bounded", () => {
    fc.assert(
      fc.property(fcFinding, fcFinding, (fa, fb) => {
        const a = toFinding(fa, "a-1");
        const b = toFinding(fb, "b-1");
        const s1 = similarityScore(a, b);
        const s2 = similarityScore(b, a);
        expect(s1).toBe(s2);
        expect(s1).toBeGreaterThanOrEqual(0);
        expect(s1).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("isDeterministicMatch is symmetric", () => {
    fc.assert(
      fc.property(fcFinding, fcFinding, (fa, fb) => {
        const a = toFinding(fa, "a-1");
        const b = toFinding(fb, "b-1");
        expect(isDeterministicMatch(a, b)).toBe(isDeterministicMatch(b, a));
      }),
    );
  });

  it("normalizeRepoPath never escapes the repo", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const p = normalizeRepoPath(raw, "/repo");
        if (p !== null) {
          expect(p.split("/")).not.toContain("..");
        }
      }),
    );
  });

  it("runConsensus partitions every finding exactly once", () => {
    fc.assert(
      fc.property(fc.array(fcFinding, { maxLength: 5 }), fc.array(fcFinding, { maxLength: 5 }), (listA, listB) => {
        const a = listA.map((f, i) => toFinding(f, `a-${i}`));
        const b = listB.map((f, i) => toFinding(f, `b-${i}`));
        const items = runConsensus(a, b);
        const seen = new Set<string>();
        for (const item of items) {
          for (const id of item.findingIds) {
            expect(seen.has(id)).toBe(false);
            seen.add(id);
          }
        }
        expect(seen.size).toBe(a.length + b.length);
      }),
    );
  });
});
