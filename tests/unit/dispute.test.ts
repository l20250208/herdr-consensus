import { describe, expect, it } from "vitest";
import { detectDisputes } from "../../src/consensus/dispute.js";
import { makeFinding } from "./finding-helper.js";

describe("detectDisputes", () => {
  it("flags a severity gap of two or more levels", () => {
    const a = makeFinding({ severity: "P0" });
    const b = makeFinding({ severity: "P2" });
    expect(detectDisputes(a, b).some((r) => r.includes("severity"))).toBe(true);
  });

  it("does not flag a one-level severity gap", () => {
    const a = makeFinding({ severity: "P0" });
    const b = makeFinding({ severity: "P1" });
    expect(detectDisputes(a, b).some((r) => r.includes("severity"))).toBe(false);
  });

  it("flags a protection vs exploitable conflict", () => {
    const a = makeFinding({ rootCause: "this is already handled by prepared statements" });
    const b = makeFinding({ rootCause: "the input reaches the query unsanitized" });
    expect(detectDisputes(a, b).some((r) => r.includes("protected"))).toBe(true);
  });

  it("returns no disputes for agreeing findings", () => {
    const a = makeFinding({ severity: "P1", rootCause: "unsanitized input", suggestedFix: "parameterize" });
    const b = makeFinding({ severity: "P1", rootCause: "unsanitized input", suggestedFix: "parameterize" });
    expect(detectDisputes(a, b)).toEqual([]);
  });
});
