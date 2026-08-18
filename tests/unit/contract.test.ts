import { describe, expect, it } from "vitest";
import {
  buildReviewContract,
  CONTRACT_VERSION,
  DEFAULT_MARKERS,
} from "../../src/reports/contract.js";

describe("buildReviewContract", () => {
  it("includes the project path and contract version", () => {
    const contract = buildReviewContract({ projectPath: "/tmp/repo" });
    expect(contract).toContain("/tmp/repo");
    expect(contract).toContain(String(CONTRACT_VERSION));
  });

  it("includes the JSON markers", () => {
    const contract = buildReviewContract({ projectPath: "/tmp/repo" });
    expect(contract).toContain(DEFAULT_MARKERS.start);
    expect(contract).toContain(DEFAULT_MARKERS.end);
  });

  it("demands a read-only review", () => {
    const contract = buildReviewContract({ projectPath: "/tmp/repo" });
    expect(contract.toLowerCase()).toMatch(/read-only|read only|do not modify/);
  });

  it("limits string lengths to protect JSON from terminal hard wrapping", () => {
    const contract = buildReviewContract({ projectPath: "/tmp/repo" });
    expect(contract).toMatch(/string.*100 characters/i);
  });

  it("requires the controlled artifact file while keeping the project read-only", () => {
    const contract = buildReviewContract({ projectPath: "/tmp/repo" });
    expect(contract).toContain("HERDR_CONSENSUS_OUTPUT");
    expect(contract).toMatch(/only allowed write/i);
    expect(contract).toMatch(/artifact working directory.*not.*reviewed project/i);
  });

  it("is deterministic for the same project", () => {
    expect(buildReviewContract({ projectPath: "/tmp/repo" })).toBe(
      buildReviewContract({ projectPath: "/tmp/repo" }),
    );
  });

  it("does not mention any other reviewer", () => {
    const contract = buildReviewContract({ projectPath: "/tmp/repo" });
    expect(contract).not.toContain("reviewer-b");
    expect(contract).not.toContain("agent_b");
  });
});
