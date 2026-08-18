import { describe, expect, it } from "vitest";
import { runConsensus } from "../../src/consensus/engine.js";
import { makeFinding } from "./finding-helper.js";

describe("runConsensus", () => {
  it("merges deterministic matches as common", () => {
    const a = [
      makeFinding({
        findingId: "a-1",
        location: { path: "src/db.ts", startLine: 10, endLine: 20, symbol: null },
        title: "SQL injection",
        category: "security",
        severity: "P1",
      }),
    ];
    const b = [
      makeFinding({
        findingId: "b-1",
        sourceId: "agent_b",
        location: { path: "src/db.ts", startLine: 15, endLine: 25, symbol: null },
        title: "SQL injection",
        category: "security",
        severity: "P1",
      }),
    ];
    const items = runConsensus(a, b);
    expect(items).toHaveLength(1);
    expect(items[0]?.relation).toBe("common");
    expect(items[0]?.findingIds).toEqual(["a-1", "b-1"]);
    expect(items[0]?.evidenceTier).toBe("corroborated");
  });

  it("marks a severity gap of two or more as disputed", () => {
    const a = [makeFinding({ findingId: "a-1", location: { path: "src/db.ts", startLine: 10, endLine: 10, symbol: null }, severity: "P0" })];
    const b = [makeFinding({ findingId: "b-1", sourceId: "agent_b", location: { path: "src/db.ts", startLine: 10, endLine: 10, symbol: null }, severity: "P2" })];
    const items = runConsensus(a, b);
    expect(items[0]?.relation).toBe("disputed");
    expect(items[0]?.disagreementReasons.length).toBeGreaterThan(0);
  });

  it("keeps unmatched findings as single_source", () => {
    const a = [makeFinding({ findingId: "a-1", location: { path: "src/a.ts", startLine: 1, endLine: 1, symbol: null }, title: "only in a" })];
    const b = [makeFinding({ findingId: "b-1", sourceId: "agent_b", location: { path: "src/b.ts", startLine: 1, endLine: 1, symbol: null }, title: "only in b" })];
    const items = runConsensus(a, b);
    expect(items.map((i) => i.relation).sort()).toEqual(["single_source", "single_source"]);
  });

  it("merges the higher severity on a common item", () => {
    const a = [makeFinding({ findingId: "a-1", location: { path: "src/db.ts", startLine: 10, endLine: 20, symbol: null }, severity: "P1" })];
    const b = [makeFinding({ findingId: "b-1", sourceId: "agent_b", location: { path: "src/db.ts", startLine: 15, endLine: 25, symbol: null }, severity: "P0" })];
    const items = runConsensus(a, b);
    expect(items[0]?.relation).toBe("common");
    expect(items[0]?.severity).toBe("P0");
  });

  it("is deterministic across runs", () => {
    const a = [makeFinding({ findingId: "a-1", location: { path: "src/db.ts", startLine: 10, endLine: 20, symbol: null }, title: "SQLi" })];
    const b = [makeFinding({ findingId: "b-1", sourceId: "agent_b", location: { path: "src/db.ts", startLine: 15, endLine: 25, symbol: null }, title: "SQLi" })];
    expect(runConsensus(a, b)).toEqual(runConsensus(a, b));
  });
});
