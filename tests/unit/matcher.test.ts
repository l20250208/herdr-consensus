import { describe, expect, it } from "vitest";
import { isDeterministicMatch, similarityScore } from "../../src/consensus/matcher.js";
import { makeFinding } from "./finding-helper.js";

describe("isDeterministicMatch", () => {
  it("matches same path with overlapping lines", () => {
    const a = makeFinding({ location: { path: "src/a.ts", startLine: 10, endLine: 20, symbol: null } });
    const b = makeFinding({ location: { path: "src/a.ts", startLine: 15, endLine: 25, symbol: null } });
    expect(isDeterministicMatch(a, b)).toBe(true);
  });

  it("does not match different paths", () => {
    const a = makeFinding({ location: { path: "src/a.ts", startLine: 10, endLine: 20, symbol: null } });
    const b = makeFinding({ location: { path: "src/b.ts", startLine: 10, endLine: 20, symbol: null } });
    expect(isDeterministicMatch(a, b)).toBe(false);
  });

  it("does not match non-overlapping lines", () => {
    const a = makeFinding({ location: { path: "src/a.ts", startLine: 10, endLine: 10, symbol: null } });
    const b = makeFinding({ location: { path: "src/a.ts", startLine: 50, endLine: 50, symbol: null } });
    expect(isDeterministicMatch(a, b)).toBe(false);
  });

  it("requires a location on both", () => {
    const a = makeFinding({ location: null });
    const b = makeFinding({ location: { path: "src/a.ts", startLine: 10, endLine: 10, symbol: null } });
    expect(isDeterministicMatch(a, b)).toBe(false);
  });
});

describe("similarityScore", () => {
  it("returns ~1 for identical findings", () => {
    const a = makeFinding({
      location: { path: "src/a.ts", startLine: 10, endLine: 10, symbol: "f" },
      title: "sql injection",
      rootCause: "unsanitized",
      category: "security",
      suggestedFix: "parameterize",
    });
    expect(similarityScore(a, a)).toBeCloseTo(1);
  });

  it("returns 0.45 for same path and category only", () => {
    const a = makeFinding({ location: { path: "src/a.ts", startLine: 10, endLine: 10, symbol: null }, title: "aaa" });
    const b = makeFinding({ location: { path: "src/a.ts", startLine: 50, endLine: 50, symbol: null }, title: "bbb" });
    expect(similarityScore(a, b)).toBeCloseTo(0.45);
  });

  it("stays within [0, 1]", () => {
    const a = makeFinding({ location: { path: "src/a.ts", startLine: 1, endLine: 1, symbol: "f" } });
    const b = makeFinding({ location: { path: "src/b.ts", startLine: 2, endLine: 2, symbol: "g" } });
    const s = similarityScore(a, b);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
