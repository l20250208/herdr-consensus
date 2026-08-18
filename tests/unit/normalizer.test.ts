import { describe, expect, it } from "vitest";
import { normalizeReport } from "../../src/consensus/normalizer.js";
import { makeArtifact } from "../../src/reports/artifact.js";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";

function artifact(content: string) {
  return makeArtifact({ sourceId: "agent_a", agentKind: "claude", content });
}

function report(findings: unknown[]): string {
  return `${DEFAULT_MARKERS.start}\n${JSON.stringify({ schemaVersion: 1, findings })}\n${DEFAULT_MARKERS.end}\n`;
}

describe("normalizeReport", () => {
  it("normalizes findings with mapped severity and repo-relative paths", () => {
    const content = report([
      {
        title: "SQL injection",
        category: "security",
        severity: "high",
        location: { path: "/repo/src/db.ts", startLine: 10, endLine: 20, symbol: "runQuery" },
        rootCause: "unsanitized input",
        impact: "data leak",
        evidence: ["line 12 uses string concat"],
        reproduction: ["call /x?id=1' OR 1=1"],
        suggestedFix: "use parameterized queries",
      },
    ]);
    const findings = normalizeReport(artifact(content), { repoRoot: "/repo", sourceId: "agent_a" });
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.severity).toBe("P1");
    expect(f.originalSeverity).toBe("high");
    expect(f.location?.path).toBe("src/db.ts");
    expect(f.findingId).toBe("agent_a-1");
    expect(f.evidenceTier).toBe("agent_asserted");
    expect(f.needsRuntimeValidation).toBe(false);
  });

  it("drops the location when the path escapes the repo", () => {
    const content = report([
      { title: "x", category: "c", severity: "low", impact: "i", location: { path: "../secret.ts" } },
    ]);
    const findings = normalizeReport(artifact(content), { repoRoot: "/repo", sourceId: "agent_a" });
    expect(findings[0]?.location).toBeNull();
  });

  it("returns empty on invalid JSON or invalid findings", () => {
    expect(normalizeReport(artifact("garbage"), { repoRoot: "/repo", sourceId: "agent_a" })).toEqual([]);
    const content = report([{ title: "missing category" }]);
    expect(normalizeReport(artifact(content), { repoRoot: "/repo", sourceId: "agent_a" })).toEqual([]);
  });

  it("flags P2 as needing runtime validation", () => {
    const content = report([
      { title: "x", category: "perf", severity: "medium", impact: "i", evidence: [], reproduction: [] },
    ]);
    expect(
      normalizeReport(artifact(content), { repoRoot: "/repo", sourceId: "agent_a" })[0]
        ?.needsRuntimeValidation,
    ).toBe(true);
  });
});
